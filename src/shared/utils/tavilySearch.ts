import { tavily } from "@tavily/core";
import { BotConfig } from "../../infrastructure/config/config.js";

export type TavilyTopic = "general" | "news" | "finance";

export interface TavilySearchSource {
  title: string;
  url: string;
  score: number;
  content: string;
}

export interface TavilySearchResponse {
  answer: string | null;
  results: TavilySearchSource[];
}

interface RawTavilyResult {
  title?: unknown;
  url?: unknown;
  score?: unknown;
  content?: unknown;
}

interface RawTavilyResponse {
  answer?: unknown;
  results?: unknown;
}

const tavilyClient = tavily({
  apiKey: BotConfig.tavilyApiKey,
});

function normalizeResult(result: RawTavilyResult): TavilySearchSource | null {
  if (typeof result.url !== "string" || !result.url.trim()) {
    return null;
  }

  const title =
    typeof result.title === "string" && result.title.trim()
      ? result.title.trim()
      : "Tanpa judul";

  const content =
    typeof result.content === "string" ? result.content.trim() : "";

  const score =
    typeof result.score === "number" && Number.isFinite(result.score)
      ? result.score
      : 0;

  return {
    title,
    url: result.url.trim(),
    score,
    content,
  };
}

export async function performTavilySearch(
  query: string,
  options: {
    topic?: TavilyTopic;
    maxResults?: number;
  } = {},
): Promise<TavilySearchResponse> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      answer: null,
      results: [],
    };
  }

  const rawResponse = (await tavilyClient.search(normalizedQuery, {
    searchDepth: "advanced",
    includeAnswer: "advanced",
    topic: options.topic,
  })) as RawTavilyResponse;

  const rawResults = Array.isArray(rawResponse.results)
    ? (rawResponse.results as RawTavilyResult[])
    : [];

  const maxResults = Math.max(1, Math.min(options.maxResults ?? 5, 10));

  const results = rawResults
    .map((item) => normalizeResult(item))
    .filter((item): item is TavilySearchSource => item !== null)
    .slice(0, maxResults);

  const answer =
    typeof rawResponse.answer === "string" && rawResponse.answer.trim()
      ? rawResponse.answer.trim()
      : null;

  return {
    answer,
    results,
  };
}
