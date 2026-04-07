/// <reference types="bun" />

import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { BotConfig } from "./src/infrastructure/config/config.js";
import { loadNexaPrompt } from "./src/shared/utils/promptLoader.js";

interface ProviderRunResult {
  provider: "groq" | "google";
  model: string;
  ok: boolean;
  text?: string;
  error?: string;
  latencyMs: number;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

async function runGroq(
  systemPrompt: string,
  userPrompt: string,
  maxOutputTokens: number,
): Promise<ProviderRunResult> {
  const startedAt = Date.now();

  if (!BotConfig.groqApiKey) {
    return {
      provider: "groq",
      model: BotConfig.aiModelGroq,
      ok: false,
      error: "GROQ_API_KEY is not configured.",
      latencyMs: Date.now() - startedAt,
    };
  }

  try {
    const groq = createGroq({ apiKey: BotConfig.groqApiKey });

    const result = await generateText({
      model: groq(BotConfig.aiModelGroq),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      maxOutputTokens,
    });

    return {
      provider: "groq",
      model: BotConfig.aiModelGroq,
      ok: true,
      text: result.text,
      latencyMs: Date.now() - startedAt,
      finishReason: result.finishReason,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
    };
  } catch (error) {
    return {
      provider: "groq",
      model: BotConfig.aiModelGroq,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function runGoogle(
  systemPrompt: string,
  userPrompt: string,
  maxOutputTokens: number,
): Promise<ProviderRunResult> {
  const startedAt = Date.now();

  if (!BotConfig.googleGenerativeAiApiKey) {
    return {
      provider: "google",
      model: BotConfig.aiModelGoogle,
      ok: false,
      error: "GOOGLE_GENERATIVE_AI_API_KEY is not configured.",
      latencyMs: Date.now() - startedAt,
    };
  }

  try {
    const google = createGoogleGenerativeAI({
      apiKey: BotConfig.googleGenerativeAiApiKey,
    });

    const result = await generateText({
      model: google(BotConfig.aiModelGoogle),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      maxOutputTokens,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: "minimal",
          },
        },
      },
    });

    return {
      provider: "google",
      model: BotConfig.aiModelGoogle,
      ok: true,
      text: result.text,
      latencyMs: Date.now() - startedAt,
      finishReason: result.finishReason,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
    };
  } catch (error) {
    return {
      provider: "google",
      model: BotConfig.aiModelGoogle,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      latencyMs: Date.now() - startedAt,
    };
  }
}

function printResult(result: ProviderRunResult): void {
  const title = `${result.provider.toUpperCase()} (${result.model})`;
  console.log("\n" + "=".repeat(80));
  console.log(title);
  console.log("=".repeat(80));
  console.log(`Latency: ${result.latencyMs} ms`);
  if (result.finishReason) {
    console.log(`Finish reason: ${result.finishReason}`);
  }

  if (
    result.inputTokens !== undefined ||
    result.outputTokens !== undefined ||
    result.totalTokens !== undefined
  ) {
    console.log(
      `Usage: in=${result.inputTokens ?? "n/a"}, out=${result.outputTokens ?? "n/a"}, total=${result.totalTokens ?? "n/a"}`,
    );
  }

  if (result.ok) {
    console.log("Status: OK");
    console.log("\nOutput:\n");
    console.log(result.text?.trim() || "(empty output)");
  } else {
    console.log("Status: FAILED");
    console.log(`Error: ${result.error || "Unknown error"}`);
  }
}

async function main(): Promise<void> {
  const userPrompt =
    Bun.argv.slice(2).join(" ").trim() ||
    "Perkenalkan diri kamu secara singkat dan ramah dalam bahasa Indonesia.";
  const maxOutputTokens = Number(Bun.env.COMPARE_MAX_OUTPUT_TOKENS ?? "1024");

  const systemPrompt = loadNexaPrompt({
    currentDate: new Date().toString(),
    additionalInstructions:
      "For this provider comparison run, answer directly without calling tools.",
  });

  console.log("Nexa Provider Comparison");
  console.log(`Prompt: ${userPrompt}`);
  console.log(`Max output tokens: ${maxOutputTokens}`);

  const [groqResult, googleResult] = await Promise.all([
    runGroq(systemPrompt, userPrompt, maxOutputTokens),
    runGoogle(systemPrompt, userPrompt, maxOutputTokens),
  ]);

  printResult(groqResult);
  printResult(googleResult);

  if (!groqResult.ok && !googleResult.ok) {
    throw new Error("Both providers failed.");
  }
}

main().catch((error) => {
  console.error("\nScript failed:", error);
  const runtime = globalThis as {
    process?: {
      exitCode?: number;
    };
  };

  if (runtime.process) {
    runtime.process.exitCode = 1;
  } else {
    throw error;
  }
});
