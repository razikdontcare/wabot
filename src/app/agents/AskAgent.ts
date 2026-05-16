import { ToolLoopAgent, stepCountIs } from "ai";
import type { AIProviderRoute } from "../../domain/services/AIProviderRouterService.js";

export function createAskAgent(
  route: AIProviderRoute,
  instructions: string,
  tools: ConstructorParameters<typeof ToolLoopAgent>[0]["tools"],
  stopWhenSteps = 10,
) {
  return new ToolLoopAgent({
    id: "ask-ai-agent",
    model: route.model,
    instructions,
    tools,
    stopWhen: stepCountIs(stopWhenSteps),
    providerOptions:
      route.provider === "google"
        ? {
            google: {
              thinkingConfig: {
                thinkingLevel: "minimal",
              },
            },
          }
        : undefined,
  });
}
