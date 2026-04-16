import { randomUUID } from "crypto";
import { BotConfig, log } from "../../infrastructure/config/config.js";

export type KnowledgeScope = "user" | "group" | "global";
export type KnowledgeSearchScope = KnowledgeScope | "auto";

export interface KnowledgeUpsertInput {
  text: string;
  userId?: string;
  groupId?: string;
  scope?: KnowledgeScope;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface KnowledgeSearchInput {
  query: string;
  userId?: string;
  groupId?: string;
  scope?: KnowledgeSearchScope;
  limit?: number;
  minScore?: number;
}

export interface KnowledgeSearchResult {
  id: string;
  score: number;
  text: string;
  payload: Record<string, unknown>;
}

export interface KnowledgeListInput {
  scope?: KnowledgeSearchScope;
  userId?: string;
  groupId?: string;
  sourceType?: string;
  sourceId?: string;
  limit?: number;
}

export interface KnowledgeListItem {
  id: string;
  scope: KnowledgeScope;
  sourceType: string;
  sourceId: string | null;
  createdAt: number | null;
  preview: string;
}

export interface KnowledgeStatusInput {
  scope?: KnowledgeSearchScope;
  userId?: string;
  groupId?: string;
}

export interface KnowledgeStatus {
  configured: boolean;
  collection: string;
  embeddingModel: string;
  topK: number;
  minScore: number;
  vectorSize: number | null;
  totalPoints: number | null;
  scopedPoints: number | null;
  scope: KnowledgeScope | null;
}

interface QdrantPoint {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
}

interface GeminiEmbeddingResponse {
  embedding?: {
    values?: number[];
  };
  embeddings?: Array<{
    values?: number[];
  }>;
}

interface QdrantCollectionInfo {
  config?: {
    params?: {
      vectors?: { size?: number } | Record<string, { size?: number }>;
    };
  };
  points_count?: number;
}

export class AIKnowledgeVectorService {
  private static instance: AIKnowledgeVectorService | null = null;

  private collectionReady = false;
  private collectionVectorSize: number | null = null;

  static getInstance(): AIKnowledgeVectorService {
    if (!AIKnowledgeVectorService.instance) {
      AIKnowledgeVectorService.instance = new AIKnowledgeVectorService();
    }

    return AIKnowledgeVectorService.instance;
  }

  isConfigured(): boolean {
    return Boolean(BotConfig.qdrantUrl && BotConfig.googleGenerativeAiApiKey);
  }

  async searchKnowledge(
    input: KnowledgeSearchInput,
  ): Promise<KnowledgeSearchResult[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const query = input.query.trim();
    if (!query) {
      return [];
    }

    const resolvedScope = this.resolveScope(input);
    const limit = Math.max(
      1,
      Math.min(input.limit || BotConfig.aiVectorTopK, 10),
    );
    const minScore = input.minScore ?? BotConfig.aiVectorMinScore;

    const queryVector = await this.embedText(query, "RETRIEVAL_QUERY");
    await this.ensureCollection(queryVector.length);

    const body: Record<string, unknown> = {
      vector: queryVector,
      limit,
      with_payload: true,
      with_vector: false,
      filter: this.buildFilter(resolvedScope, input.userId, input.groupId),
    };

    const collection = encodeURIComponent(BotConfig.qdrantCollection);
    const points = await this.qdrantRequest<QdrantPoint[]>(
      `/collections/${collection}/points/search`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    if (!Array.isArray(points)) {
      return [];
    }

    return points
      .filter(
        (item) => typeof item.score === "number" && item.score >= minScore,
      )
      .map((item) => {
        const payload =
          item.payload && typeof item.payload === "object" ? item.payload : {};
        const text = typeof payload.text === "string" ? payload.text : "";

        return {
          id: String(item.id),
          score: item.score,
          text,
          payload,
        };
      })
      .filter((item) => item.text.length > 0);
  }

  async upsertKnowledge(input: KnowledgeUpsertInput): Promise<number> {
    if (!this.isConfigured()) {
      return 0;
    }

    const chunks = this.chunkText(input.text);
    if (chunks.length === 0) {
      return 0;
    }

    const scope = input.scope || this.resolveScope(input);
    const createdAt = Date.now();
    const points: Array<{
      id: string;
      vector: number[];
      payload: Record<string, unknown>;
    }> = [];

    for (const [index, chunk] of chunks.entries()) {
      const vector = await this.embedText(chunk, "RETRIEVAL_DOCUMENT");
      await this.ensureCollection(vector.length);

      const payload: Record<string, unknown> = {
        text: chunk,
        scope,
        userId: input.userId,
        groupId: input.groupId,
        sourceType: input.sourceType || "chat_turn",
        sourceId: input.sourceId || null,
        chunkIndex: index,
        createdAt,
        ...(input.metadata || {}),
      };

      const cleanPayload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined) {
          cleanPayload[key] = value;
        }
      }

      points.push({
        id: randomUUID(),
        vector,
        payload: cleanPayload,
      });
    }

    if (points.length === 0) {
      return 0;
    }

    const collection = encodeURIComponent(BotConfig.qdrantCollection);
    await this.qdrantRequest(`/collections/${collection}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points }),
    });

    return points.length;
  }

  async getStatus(input?: KnowledgeStatusInput): Promise<KnowledgeStatus> {
    const baseStatus: KnowledgeStatus = {
      configured: this.isConfigured(),
      collection: BotConfig.qdrantCollection,
      embeddingModel: BotConfig.aiEmbeddingModelGoogle,
      topK: BotConfig.aiVectorTopK,
      minScore: BotConfig.aiVectorMinScore,
      vectorSize: null,
      totalPoints: null,
      scopedPoints: null,
      scope: null,
    };

    if (!baseStatus.configured) {
      return baseStatus;
    }

    const collectionInfo = await this.getCollectionInfo();
    baseStatus.vectorSize = this.extractVectorSize(
      collectionInfo?.config?.params?.vectors,
    );

    if (typeof collectionInfo?.points_count === "number") {
      baseStatus.totalPoints = collectionInfo.points_count;
    } else {
      baseStatus.totalPoints = await this.countPoints();
    }

    if (input) {
      const resolvedScope = this.resolveScope(input);
      baseStatus.scope = resolvedScope;
      baseStatus.scopedPoints = await this.countPoints(
        this.buildFilter(resolvedScope, input.userId, input.groupId),
      );
    }

    return baseStatus;
  }

  async listKnowledge(input: KnowledgeListInput): Promise<KnowledgeListItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const resolvedScope = this.resolveScope(input);
    const requestedLimit = input.limit || 10;
    const limit = Math.max(1, Math.min(requestedLimit, 30));
    const filter = this.buildFilter(
      resolvedScope,
      input.userId,
      input.groupId,
      input.sourceType,
      input.sourceId,
    );

    const points = await this.scrollPoints(filter, Math.max(limit * 3, limit));
    const mapped = points
      .map((point) => {
        const payload =
          point.payload && typeof point.payload === "object"
            ? point.payload
            : {};
        const text = typeof payload.text === "string" ? payload.text : "";
        const scopeValue =
          payload.scope === "group" ||
          payload.scope === "user" ||
          payload.scope === "global"
            ? (payload.scope as KnowledgeScope)
            : resolvedScope;
        const sourceType =
          typeof payload.sourceType === "string"
            ? payload.sourceType
            : "unknown";
        const sourceId =
          typeof payload.sourceId === "string" ? payload.sourceId : null;
        const createdAt =
          typeof payload.createdAt === "number"
            ? payload.createdAt
            : Number.isFinite(Number(payload.createdAt))
              ? Number(payload.createdAt)
              : null;

        return {
          id: String(point.id),
          scope: scopeValue,
          sourceType,
          sourceId,
          createdAt,
          preview:
            text.length > 180 ? `${text.slice(0, 180).trim()}...` : text.trim(),
        };
      })
      .filter((item) => item.preview.length > 0);

    mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return mapped.slice(0, limit);
  }

  async deleteKnowledgeBySource(input: {
    sourceId: string;
    scope?: KnowledgeSearchScope;
    userId?: string;
    groupId?: string;
  }): Promise<number> {
    if (!this.isConfigured()) {
      return 0;
    }

    const sourceId = input.sourceId.trim();
    if (!sourceId) {
      return 0;
    }

    const resolvedScope = this.resolveScope(input);
    const filter = this.buildFilter(
      resolvedScope,
      input.userId,
      input.groupId,
      undefined,
      sourceId,
    );

    const count = await this.countPoints(filter);
    if (count <= 0) {
      return 0;
    }

    const collection = encodeURIComponent(BotConfig.qdrantCollection);
    await this.qdrantRequest(
      `/collections/${collection}/points/delete?wait=true`,
      {
        method: "POST",
        body: JSON.stringify({ filter }),
      },
    );

    return count;
  }

  async reindexKnowledgeBySource(input: {
    sourceId: string;
    scope?: KnowledgeSearchScope;
    userId?: string;
    groupId?: string;
  }): Promise<number> {
    if (!this.isConfigured()) {
      return 0;
    }

    const sourceId = input.sourceId.trim();
    if (!sourceId) {
      return 0;
    }

    const resolvedScope = this.resolveScope(input);
    const filter = this.buildFilter(
      resolvedScope,
      input.userId,
      input.groupId,
      undefined,
      sourceId,
    );

    const points = await this.scrollPoints(filter, 200);
    if (points.length === 0) {
      return 0;
    }

    const reindexedAt = Date.now();
    const upsertPoints: Array<{
      id: string | number;
      vector: number[];
      payload: Record<string, unknown>;
    }> = [];

    for (const point of points) {
      const payload =
        point.payload && typeof point.payload === "object" ? point.payload : {};
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) {
        continue;
      }

      const vector = await this.embedText(text, "RETRIEVAL_DOCUMENT");
      await this.ensureCollection(vector.length);
      upsertPoints.push({
        id: point.id,
        vector,
        payload: {
          ...payload,
          reindexedAt,
        },
      });
    }

    if (upsertPoints.length === 0) {
      return 0;
    }

    const collection = encodeURIComponent(BotConfig.qdrantCollection);
    await this.qdrantRequest(`/collections/${collection}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points: upsertPoints }),
    });

    return upsertPoints.length;
  }

  private resolveScope(input: {
    scope?: KnowledgeSearchScope;
    userId?: string;
    groupId?: string;
  }): KnowledgeScope {
    const requestedScope = input.scope;

    if (requestedScope === "group") {
      return input.groupId ? "group" : input.userId ? "user" : "global";
    }

    if (requestedScope === "user") {
      return input.userId ? "user" : "global";
    }

    if (requestedScope === "global") {
      return "global";
    }

    if (input.groupId) {
      return "group";
    }

    if (input.userId) {
      return "user";
    }

    return "global";
  }

  private buildFilter(
    scope: KnowledgeScope,
    userId?: string,
    groupId?: string,
    sourceType?: string,
    sourceId?: string,
  ): Record<string, unknown> {
    const must: Array<Record<string, unknown>> = [
      {
        key: "scope",
        match: { value: scope },
      },
    ];

    if (scope === "group" && groupId) {
      must.push({
        key: "groupId",
        match: { value: groupId },
      });
    }

    if (scope === "user" && userId) {
      must.push({
        key: "userId",
        match: { value: userId },
      });
    }

    if (sourceType) {
      must.push({
        key: "sourceType",
        match: { value: sourceType },
      });
    }

    if (sourceId) {
      must.push({
        key: "sourceId",
        match: { value: sourceId },
      });
    }

    return { must };
  }

  private async getCollectionInfo(): Promise<QdrantCollectionInfo | null> {
    const collection = encodeURIComponent(BotConfig.qdrantCollection);
    const collectionUrl = this.buildQdrantUrl(`/collections/${collection}`);

    const response = await fetch(collectionUrl, {
      method: "GET",
      headers: this.qdrantHeaders(),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to load Qdrant collection info (${response.status}): ${errorText}`,
      );
    }

    const payload = (await response.json()) as {
      result?: QdrantCollectionInfo;
    };
    return payload.result || null;
  }

  private async countPoints(filter?: Record<string, unknown>): Promise<number> {
    const collection = encodeURIComponent(BotConfig.qdrantCollection);
    const result = await this.qdrantRequest<{ count?: number }>(
      `/collections/${collection}/points/count`,
      {
        method: "POST",
        body: JSON.stringify({
          exact: true,
          ...(filter ? { filter } : {}),
        }),
      },
    );

    return typeof result?.count === "number" ? result.count : 0;
  }

  private async scrollPoints(
    filter: Record<string, unknown>,
    limit: number,
  ): Promise<
    Array<{ id: string | number; payload?: Record<string, unknown> }>
  > {
    const collection = encodeURIComponent(BotConfig.qdrantCollection);
    const result = await this.qdrantRequest<{
      points?: Array<{
        id: string | number;
        payload?: Record<string, unknown>;
      }>;
    }>(`/collections/${collection}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({
        filter,
        limit,
        with_payload: true,
        with_vector: false,
      }),
    });

    return Array.isArray(result?.points) ? result.points : [];
  }

  private chunkText(text: string, maxChars = 1600, overlap = 220): string[] {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return [];
    }

    if (normalized.length <= maxChars) {
      return [normalized];
    }

    const chunks: string[] = [];
    const safeOverlap = Math.max(0, Math.min(overlap, maxChars - 1));

    let start = 0;
    while (start < normalized.length) {
      const end = Math.min(start + maxChars, normalized.length);
      const chunk = normalized.slice(start, end).trim();

      if (chunk) {
        chunks.push(chunk);
      }

      if (end >= normalized.length) {
        break;
      }

      start = end - safeOverlap;
    }

    return chunks;
  }

  private async embedText(
    text: string,
    taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT",
  ): Promise<number[]> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(BotConfig.aiEmbeddingModelGoogle)}` +
      `:embedContent?key=${encodeURIComponent(BotConfig.googleGenerativeAiApiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
        taskType,
      }),
    });

    const rawText = await response.text();
    let data: GeminiEmbeddingResponse | null = null;

    if (rawText) {
      try {
        data = JSON.parse(rawText) as GeminiEmbeddingResponse;
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      throw new Error(
        `Gemini embedding request failed (${response.status}): ${rawText}`,
      );
    }

    const values = data?.embedding?.values || data?.embeddings?.[0]?.values;
    if (!values || !Array.isArray(values) || values.length === 0) {
      throw new Error(
        "Gemini embedding response does not include vector values.",
      );
    }

    return values;
  }

  private async ensureCollection(vectorSize: number): Promise<void> {
    if (this.collectionReady && this.collectionVectorSize === vectorSize) {
      return;
    }

    const collection = encodeURIComponent(BotConfig.qdrantCollection);
    const collectionUrl = this.buildQdrantUrl(`/collections/${collection}`);

    const existingResponse = await fetch(collectionUrl, {
      method: "GET",
      headers: this.qdrantHeaders(),
    });

    if (existingResponse.status === 404) {
      await this.qdrantRequest(`/collections/${collection}`, {
        method: "PUT",
        body: JSON.stringify({
          vectors: {
            size: vectorSize,
            distance: "Cosine",
          },
        }),
      });

      this.collectionReady = true;
      this.collectionVectorSize = vectorSize;
      log.info(
        `Created Qdrant collection ${BotConfig.qdrantCollection} with vector size ${vectorSize}.`,
      );
      return;
    }

    if (!existingResponse.ok) {
      const errorText = await existingResponse.text();
      throw new Error(
        `Failed to check Qdrant collection (${existingResponse.status}): ${errorText}`,
      );
    }

    const existingPayload = (await existingResponse.json()) as {
      result?: {
        config?: {
          params?: {
            vectors?: { size?: number } | Record<string, { size?: number }>;
          };
        };
      };
    };

    const vectors = existingPayload.result?.config?.params?.vectors;
    const existingSize = this.extractVectorSize(vectors);

    if (existingSize && existingSize !== vectorSize) {
      throw new Error(
        `Qdrant collection ${BotConfig.qdrantCollection} has vector size ${existingSize}, expected ${vectorSize}.`,
      );
    }

    this.collectionReady = true;
    this.collectionVectorSize = existingSize || vectorSize;
  }

  private extractVectorSize(
    vectors: { size?: number } | Record<string, { size?: number }> | undefined,
  ): number | null {
    if (!vectors) {
      return null;
    }

    if (typeof vectors.size === "number") {
      return vectors.size;
    }

    const firstNamedVector = Object.values(vectors)[0];
    if (firstNamedVector && typeof firstNamedVector.size === "number") {
      return firstNamedVector.size;
    }

    return null;
  }

  private qdrantHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (BotConfig.qdrantApiKey) {
      headers["api-key"] = BotConfig.qdrantApiKey;
    }

    return headers;
  }

  private buildQdrantUrl(path: string): string {
    const base = BotConfig.qdrantUrl.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  }

  private async qdrantRequest<T = unknown>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const response = await fetch(this.buildQdrantUrl(path), {
      ...init,
      headers: {
        ...this.qdrantHeaders(),
        ...(init.headers || {}),
      },
    });

    const rawText = await response.text();
    let data: unknown = null;

    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = rawText;
      }
    }

    if (!response.ok) {
      throw new Error(
        `Qdrant request failed (${response.status}): ${typeof data === "string" ? data : rawText}`,
      );
    }

    if (data && typeof data === "object" && "result" in data) {
      return (data as { result: T }).result;
    }

    return data as T;
  }
}
