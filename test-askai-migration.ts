/// <reference types="bun" />

import { createGroq } from "@ai-sdk/groq";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

type CheckStatus = "pass" | "fail" | "skip";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface LiveAttempt {
  name: string;
  prompt: string;
  toolChoice?: "required" | { type: "tool"; toolName: "ping_tool" };
}

interface LiveAttemptOutcome {
  name: string;
  success: boolean;
  detail: string;
}

interface LiveGenerateResult {
  steps: Array<{
    toolCalls: Array<{ toolName?: string } | undefined>;
    toolResults: unknown[];
  }>;
  text: string;
}

function hasPattern(content: string, pattern: RegExp): boolean {
  return pattern.test(content);
}

async function readTextFile(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${filePath}`);
  }

  return file.text();
}

function printCheck(result: CheckResult): void {
  const prefix =
    result.status === "pass"
      ? "[PASS]"
      : result.status === "fail"
        ? "[FAIL]"
        : "[SKIP]";

  console.log(`${prefix} ${result.name} - ${result.detail}`);
}

function evaluateToolExecution(
  attemptName: string,
  result: LiveGenerateResult,
): LiveAttemptOutcome {
  const allToolCalls = result.steps.flatMap((step) => step.toolCalls);
  const allToolResults = result.steps.flatMap((step) => step.toolResults);
  const text = result.text.trim();

  const hasToolCall = allToolCalls.some(
    (call) => call?.toolName === "ping_tool",
  );
  const hasExpectedOutput = /pong:migration-check/i.test(text);
  const hasToolResult = allToolResults.length > 0;

  const success = hasToolCall && hasToolResult && hasExpectedOutput;

  return {
    name: attemptName,
    success,
    detail: `toolCalls=${allToolCalls.length}, toolResults=${allToolResults.length}, text='${text.slice(
      0,
      120,
    )}'`,
  };
}

async function runLiveAttempt(
  provider: ReturnType<typeof createGroq>,
  modelId: string,
  attempt: LiveAttempt,
): Promise<LiveAttemptOutcome> {
  const tools = {
    ping_tool: tool({
      description: "Return a deterministic ping payload for migration tests",
      inputSchema: z.object({
        message: z.string().min(1),
      }),
      execute: async ({ message }) => `pong:${message}`,
    }),
  };

  try {
    const result = await generateText({
      model: provider(modelId),
      temperature: 0,
      maxOutputTokens: 256,
      stopWhen: stepCountIs(3),
      toolChoice: attempt.toolChoice,
      tools,
      prompt: attempt.prompt,
    });

    return evaluateToolExecution(attempt.name, result);
  } catch (error) {
    return {
      name: attempt.name,
      success: false,
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function runStaticChecks(rootDir: string): Promise<CheckResult[]> {
  const askAiPath = `${rootDir}/src/app/commands/AskAICommand.ts`;
  const providerRouterPath = `${rootDir}/src/domain/services/AIProviderRouterService.ts`;
  const configPath = `${rootDir}/src/infrastructure/config/config.ts`;
  const aiToolsPath = `${rootDir}/src/shared/utils/ai_tools.ts`;
  const packageJsonPath = `${rootDir}/package.json`;

  const [
    askAiSource,
    routerSource,
    configSource,
    aiToolsSource,
    packageSource,
  ] = await Promise.all([
    readTextFile(askAiPath),
    readTextFile(providerRouterPath),
    readTextFile(configPath),
    readTextFile(aiToolsPath),
    readTextFile(packageJsonPath),
  ]);

  const pkg = JSON.parse(packageSource) as {
    dependencies?: Record<string, string>;
  };

  const deps = pkg.dependencies ?? {};

  return [
    {
      name: "AskAI uses AI SDK generateText",
      status: hasPattern(askAiSource, /\bgenerateText\s*\(/) ? "pass" : "fail",
      detail: "Expected generateText invocation in AskAICommand.",
    },
    {
      name: "AskAI uses provider router",
      status:
        hasPattern(askAiSource, /AIProviderRouterService/) &&
        hasPattern(askAiSource, /getRoutedModel\s*\(/)
          ? "pass"
          : "fail",
      detail:
        "Expected AskAICommand to delegate provider selection to router service.",
    },
    {
      name: "AskAI no longer uses groq-sdk client calls",
      status:
        !hasPattern(askAiSource, /new\s+Groq\s*\(/) &&
        !hasPattern(askAiSource, /chat\.completions\.create\s*\(/)
          ? "pass"
          : "fail",
      detail: "Expected no direct Groq SDK chat.completions.create usage.",
    },
    {
      name: "AskAI enables multi-step tool loop",
      status: hasPattern(askAiSource, /stopWhen\s*:\s*stepCountIs\s*\(/)
        ? "pass"
        : "fail",
      detail: "Expected stopWhen: stepCountIs(...) in generateText call.",
    },
    {
      name: "AskAI multimodal image parts wired",
      status:
        hasPattern(askAiSource, /type:\s*"image"/) &&
        hasPattern(askAiSource, /extractImageInput\s*\(/)
          ? "pass"
          : "fail",
      detail:
        "Expected image extraction and image content parts for multimodal requests.",
    },
    {
      name: "Provider router supports Groq and Google",
      status:
        hasPattern(routerSource, /createGroq\s*\(/) &&
        hasPattern(routerSource, /createGoogleGenerativeAI\s*\(/) &&
        hasPattern(routerSource, /requiresMultimodal/)
          ? "pass"
          : "fail",
      detail:
        "Expected router service to initialize both providers and route multimodal to Google.",
    },
    {
      name: "Config exposes provider routing fields",
      status:
        hasPattern(configSource, /aiProvider\s*:/) &&
        hasPattern(configSource, /aiModelGroq\s*:/) &&
        hasPattern(configSource, /aiModelGoogle\s*:/) &&
        hasPattern(configSource, /aiMultimodalModelGoogle\s*:/) &&
        hasPattern(configSource, /googleGenerativeAiApiKey\s*:/)
          ? "pass"
          : "fail",
      detail:
        "Expected BotConfig to include provider selection and Google multimodal model settings.",
    },
    {
      name: "Legacy tools array removed from ai_tools",
      status: !hasPattern(aiToolsSource, /export\s+const\s+tools\s*=/)
        ? "pass"
        : "fail",
      detail: "Expected legacy OpenAI-style tools export to be removed.",
    },
    {
      name: "Dependencies include ai-sdk migration packages",
      status:
        Boolean(deps["ai"]) &&
        Boolean(deps["@ai-sdk/groq"]) &&
        Boolean(deps["@ai-sdk/google"]) &&
        Boolean(deps["zod"])
          ? "pass"
          : "fail",
      detail:
        "Expected ai, @ai-sdk/groq, @ai-sdk/google, and zod dependencies.",
    },
    {
      name: "groq-sdk dependency removed",
      status: deps["groq-sdk"] ? "fail" : "pass",
      detail: "Expected groq-sdk to be absent after migration.",
    },
  ];
}

async function runLiveSmokeTest(modelId: string): Promise<CheckResult[]> {
  if (!Bun.env.GROQ_API_KEY) {
    return [
      {
        name: "Live tool-calling smoke test",
        status: "skip",
        detail: "Set GROQ_API_KEY and pass --live to run this check.",
      },
    ];
  }

  try {
    const groqProvider = createGroq({ apiKey: Bun.env.GROQ_API_KEY });

    const attempts: LiveAttempt[] = [
      {
        name: "forced-specific-tool",
        toolChoice: { type: "tool", toolName: "ping_tool" },
        prompt:
          "For migration verification, call ping_tool with message 'migration-check'. After tool result, output exactly that result only.",
      },
      {
        name: "required-tool-choice",
        toolChoice: "required",
        prompt:
          "Call ping_tool with message 'migration-check', then answer with exactly the returned value.",
      },
      {
        name: "auto-tool-choice",
        prompt:
          "Use ping_tool with message 'migration-check' before final answer. Final answer must be exactly the tool output.",
      },
    ];

    const outcomes: LiveAttemptOutcome[] = [];
    for (const attempt of attempts) {
      const outcome = await runLiveAttempt(groqProvider, modelId, attempt);
      outcomes.push(outcome);
      if (outcome.success) {
        return [
          {
            name: "Live tool-calling smoke test",
            status: "pass",
            detail: `attempt=${outcome.name}; ${outcome.detail}`,
          },
        ];
      }
    }

    const attemptsSummary = outcomes
      .map((outcome) => `${outcome.name}: ${outcome.detail}`)
      .join(" | ");

    return [
      {
        name: "Live tool-calling smoke test",
        status: "fail",
        detail: attemptsSummary,
      },
    ];
  } catch (error) {
    return [
      {
        name: "Live tool-calling smoke test",
        status: "fail",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
    ];
  }
}

async function main(): Promise<void> {
  const rootDir = import.meta.dir;
  const runLive = Bun.argv.includes("--live");
  const modelId =
    Bun.env.AI_MODEL_GROQ ?? Bun.env.AI_MODEL ?? "openai/gpt-oss-120b";

  console.log("AskAI migration verification");
  console.log(`Working directory: ${rootDir}`);
  console.log(`Mode: ${runLive ? "static + live" : "static only"}`);

  const checks: CheckResult[] = [];
  checks.push(...(await runStaticChecks(rootDir)));

  if (runLive) {
    checks.push(...(await runLiveSmokeTest(modelId)));
  } else {
    checks.push({
      name: "Live tool-calling smoke test",
      status: "skip",
      detail: "Not requested. Pass --live to execute provider call.",
    });
  }

  console.log("\nResults:");
  checks.forEach(printCheck);

  const failedCount = checks.filter((check) => check.status === "fail").length;
  const passedCount = checks.filter((check) => check.status === "pass").length;
  const skippedCount = checks.filter((check) => check.status === "skip").length;

  console.log(
    `\nSummary: ${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped.`,
  );

  if (failedCount > 0) {
    throw new Error("Migration checks failed.");
  }
}

main().catch((error) => {
  console.error("Migration test script failed:", error);
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
