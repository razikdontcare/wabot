import { createAskAgent } from "./src/app/agents/AskAgent.js";
import { AIProviderRouterService } from "./src/domain/services/AIProviderRouterService.js";
import { tool } from "ai";
import { z } from "zod";
import { web_search } from "./src/shared/utils/ai_tools.js";

async function main() {
  console.log("Live AskAgent test starting...");

  const router = AIProviderRouterService.getInstance();
  const preferred = process.env.TEST_PROVIDER as any | undefined;

  let route;
  try {
    route = router.getRoutedModel({ preferredProvider: preferred });
  } catch (err) {
    console.error(
      "Failed to resolve AI provider route. Ensure GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or OPENROUTER_API_KEY is set.",
    );
    throw err;
  }

  console.log(`Using provider=${route.provider} model=${route.modelId}`);

  const tools = {
    ping_tool: tool({
      description: "Return a deterministic ping payload for live tests",
      inputSchema: z.object({ message: z.string().min(1) }),
      execute: async ({ message }) => {
        console.log("ping_tool executed with message:", message);
        return `pong:${message}`;
      },
    }),

    web_search: tool({
      description: "Perform a web search via Tavily (test)",
      inputSchema: z.object({
        query: z.string().min(1),
        topic: z.enum(["general", "news", "finance"]).optional(),
        searchDepth: z
          .enum(["basic", "advanced", "fast", "ultra-fast"])
          .optional(),
        includeAnswer: z
          .union([z.boolean(), z.enum(["basic", "advanced"])])
          .optional(),
      }),
      execute: async ({ query, topic, searchDepth, includeAnswer }) => {
        console.log("web_search called with:", {
          query,
          topic,
          searchDepth,
          includeAnswer,
        });
        return await web_search(query, topic, { searchDepth, includeAnswer });
      },
    }),

    web_fetch: tool({
      description: "Fetch a URL and return page text (truncated) for research",
      inputSchema: z.object({
        url: z.string().url(),
        maxChars: z.number().optional(),
      }),
      execute: async ({ url, maxChars }) => {
        console.log("web_fetch called with:", { url, maxChars });
        try {
          const res = await fetch(url, {
            headers: { "user-agent": "Mozilla/5.0 (compatible; bot/1.0)" },
          });
          if (!res.ok) return `ERROR: HTTP ${res.status}`;
          const contentType = (
            res.headers.get("content-type") || ""
          ).toLowerCase();
          const text = await res.text();

          if (contentType.includes("html")) {
            const titleMatch = text.match(/<title[^>]*>([^<]*)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : "";
            let body = text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
            body = body.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
            body = body.replace(/<[^>]+>/g, " ");
            body = body.replace(/\s+/g, " ").trim();
            const max = typeof maxChars === "number" ? maxChars : 20000;
            const snippet =
              body.length > max ? `${body.slice(0, max)}... [truncated]` : body;
            return { url, title, text: snippet };
          }

          // For non-HTML text (json, plain), just return truncated text
          const max = typeof maxChars === "number" ? maxChars : 20000;
          const snippet =
            text.length > max ? `${text.slice(0, max)}... [truncated]` : text;
          return { url, title: "", text: snippet };
        } catch (err) {
          console.error("web_fetch error:", err);
          return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    send_message: tool({
      description: "Send a message to terminal (test-only)",
      inputSchema: z.object({ text: z.string().min(1) }),
      execute: async ({ text }) => {
        console.log("AGENT SEND_MESSAGE ->", text);
        return "sent";
      },
    }),
  } as const;

  const instructions = "You are an ai assistant.";

  const agent = createAskAgent(route as any, instructions, tools as any, 5);

  const prompt =
    'Call ping_tool with message "live-test" and then output exactly the tool result (e.g., pong:live-test).';

  console.log("Sending prompt to agent:", prompt);

  const result = await agent.generate({
    prompt,
    timeout: { totalMs: 120000 },
  } as any);

  console.log("=== AGENT RESULT TEXT ===");
  console.log(result.text);

  if ((result as any).steps) {
    console.log("=== AGENT STEPS ===");
    for (const [i, step] of (result as any).steps.entries()) {
      console.log(`# Step ${i + 1}:`);
      console.log("toolCalls:", step.toolCalls);
      console.log("toolResults:", step.toolResults);
      console.log("parts:", step.parts);
    }
  }

  if (result.text?.includes("pong:")) {
    console.log("SUCCESS: Agent returned ping result.");
  } else {
    console.warn(
      "Agent did not return expected ping result. Inspect above data.",
    );
  }

  // --- Research case using web_search + send_message ---
  const researchPrompt = `You are a research assistant. Use the web_search tool to research "latest hantavirus updates". For top results, call the web_fetch tool to retrieve page content and use it to form a concise summary (3 sentences). Deliver the summary using the send_message tool. Before you start researching, tell the to wait for you to finish searching, then start researching. `;

  console.log("\n--- Running research prompt ---\n", researchPrompt);

  const researchResult = await agent.generate({
    prompt: researchPrompt,
    timeout: { totalMs: 180000 },
  } as any);

  console.log("=== RESEARCH RESULT TEXT ===");
  console.log(researchResult.text);

  if ((researchResult as any).steps) {
    console.log("=== RESEARCH STEPS ===");
    for (const [i, step] of (researchResult as any).steps.entries()) {
      console.log(`# Step ${i + 1}:`);
      console.log("toolCalls:", step.toolCalls);
      console.log("toolResults:", step.toolResults?.slice?.(0, 2));
      console.log("parts:", step.parts);
    }
  }
}

main().catch((err) => {
  console.error("Live test failed:", err);
  process.exitCode = 1;
});
