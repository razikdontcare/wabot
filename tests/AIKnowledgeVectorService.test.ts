import { describe, expect, it, mock, spyOn, beforeEach } from "bun:test";
import { AIKnowledgeVectorService } from "../src/domain/services/AIKnowledgeVectorService.js";
import { BotConfig } from "../src/infrastructure/config/config.js";

describe("AIKnowledgeVectorService", () => {
  let service: AIKnowledgeVectorService;

  beforeEach(() => {
    // Reset singleton instance or create a fresh one if possible
    // Since it's a singleton with no reset, we'll just use the instance
    service = AIKnowledgeVectorService.getInstance();
    
    // Mock BotConfig for testing
    BotConfig.qdrantUrl = "http://localhost:6333";
    BotConfig.qdrantCollection = "test-collection";
    BotConfig.googleGenerativeAiApiKey = "fake-key";
    
    // Mock global fetch
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        
        // Mock Gemini Embedding
        if (urlStr.includes("generativelanguage.googleapis.com")) {
            return new Response(JSON.stringify({
                embedding: { values: new Array(768).fill(0.1) }
            }), { status: 200 });
        }
        
        // Mock Qdrant Search
        if (urlStr.includes("/points/search")) {
            return new Response(JSON.stringify({
                result: [
                    { id: "1", score: 0.9, payload: { text: "Search result 1" } }
                ]
            }), { status: 200 });
        }
        
        // Mock Qdrant Put Points
        if (urlStr.includes("/points?wait=true")) {
            return new Response(JSON.stringify({ result: { status: "ok" } }), { status: 200 });
        }

        // Mock Qdrant Index Creation
        if (urlStr.includes("/index")) {
            return new Response(JSON.stringify({ result: { status: "ok" } }), { status: 200 });
        }

        // Mock Qdrant Collection Info (including payload_schema)
        if (urlStr.endsWith("/collections/test-collection")) {
            return new Response(JSON.stringify({
                result: { 
                    config: { params: { vectors: { size: 768 } } }, 
                    points_count: 10,
                    payload_schema: { scope: { data_type: "keyword" } } // scope already exists
                }
            }), { status: 200 });
        }
        
        // Default
        return new Response(JSON.stringify({ result: {} }), { status: 200 });
    }) as any;
  });

  it("should check if configured correctly", () => {
    expect(service.isConfigured()).toBe(true);
    
    const originalUrl = BotConfig.qdrantUrl;
    BotConfig.qdrantUrl = "";
    expect(service.isConfigured()).toBe(false);
    BotConfig.qdrantUrl = originalUrl;
  });

  it("should perform a search", async () => {
    const results = await service.searchKnowledge({
        query: "test query",
        userId: "user123"
    });
    
    expect(results.length).toBe(1);
    expect(results[0].text).toBe("Search result 1");
    expect(results[0].score).toBe(0.9);
  });

  it("should upsert knowledge", async () => {
    const count = await service.upsertKnowledge({
        text: "This is a test knowledge that is long enough to be kept as is or chunked.",
        userId: "user123",
        scope: "user"
    });
    
    expect(count).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalled();
  });

  it("should get status", async () => {
    const status = await service.getStatus({ userId: "user123", scope: "user" });
    
    expect(status.configured).toBe(true);
    expect(status.totalPoints).toBe(10);
    expect(status.vectorSize).toBe(768);
  });

  it("should chunk text correctly", () => {
    // Access private method for testing
    const chunks = (service as any).chunkText("word ".repeat(500), 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(100);
  });

  it("should resolve scope correctly", () => {
    // global scope
    expect((service as any).resolveScope({ scope: "global" })).toBe("global");
    
    // group scope with groupId
    expect((service as any).resolveScope({ scope: "group", groupId: "123" })).toBe("group");
    
    // group scope WITHOUT groupId should fallback to user (if userId present) or global
    expect((service as any).resolveScope({ scope: "group", userId: "user1" })).toBe("user");
    expect((service as any).resolveScope({ scope: "group" })).toBe("global");
    
    // auto scope (default behavior)
    expect((service as any).resolveScope({ groupId: "123" })).toBe("group");
    expect((service as any).resolveScope({ userId: "user1" })).toBe("user");
    expect((service as any).resolveScope({})).toBe("global");
  });
});
