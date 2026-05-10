import { createAskAgent } from "./src/app/agents/AskAgent.js";

async function main() {
  // Minimal smoke test: ensure factory returns an object with generate/stream methods
  const fakeRoute = {
    provider: "groq",
    modelId: "mock-model",
    model: {} as any,
    supportsMultimodal: false,
  } as const;

  const agent = createAskAgent(fakeRoute as any, "You are a test agent.", {});

  if (!agent || typeof (agent as any).generate !== "function") {
    console.error("Agent creation failed or generate() missing");
    process.exitCode = 2;
    return;
  }

  console.log("AskAgent factory smoke test: OK");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exitCode = 1;
});
