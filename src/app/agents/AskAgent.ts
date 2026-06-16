import { ToolLoopAgent, stepCountIs } from "ai";
import type { AIProviderRoute } from "../../domain/services/AIProviderRouterService.js";

export function createAskAgent(
  route: AIProviderRoute,
  instructions: string,
  tools: ConstructorParameters<typeof ToolLoopAgent>[0]["tools"],
  stopWhenSteps = 10,
  isResearch = false,
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
                thinkingLevel: isResearch ? "on" : "minimal",
              },
            },
          }
        : undefined,
  });
}

export async function runSubagentTask(
  route: AIProviderRoute,
  agentType: "researcher" | "coder" | "writer",
  task: string,
  parentTools?: ConstructorParameters<typeof ToolLoopAgent>[0]["tools"],
): Promise<string> {
  // 1. Select specific toolset for the agentType to prevent tool pollution
  const subagentTools: Record<string, any> = {};
  if (agentType === "researcher") {
    if (parentTools?.web_search) subagentTools.web_search = parentTools.web_search;
    if (parentTools?.web_fetch) subagentTools.web_fetch = parentTools.web_fetch;
    if (parentTools?.web_extract) subagentTools.web_extract = parentTools.web_extract;
  } else if (agentType === "coder") {
    if (parentTools?.list_files) subagentTools.list_files = parentTools.list_files;
    if (parentTools?.read_file) subagentTools.read_file = parentTools.read_file;
    if (parentTools?.write_file) subagentTools.write_file = parentTools.write_file;
    if (parentTools?.delete_file) subagentTools.delete_file = parentTools.delete_file;
    if (parentTools?.exec_command) subagentTools.exec_command = parentTools.exec_command;
  }

  // 2. Define the subagent system instructions
  let instructions = "";
  if (agentType === "researcher") {
    instructions =
      "You are a specialized Web Researcher subagent. Your goal is to investigate the requested task by searching the web, crawling URLs, and verifying facts.\n" +
      "Use web_search and web_extract/web_fetch to retrieve detailed content. Be exhaustive and present a structured report containing citations, URLs, and neutral, verified facts.";
  } else if (agentType === "coder") {
    instructions =
      "You are a specialized Software Coder subagent. Your goal is to execute scripts, compile or modify files, inspect directories, and run commands.\n" +
      "Be precise. Check the directories first, write or modify the files correctly, run execution commands if needed, and verify the output before completing your report.";
  } else if (agentType === "writer") {
    instructions =
      "You are a specialized Copywriter/Synthesis subagent. Your goal is to refine raw technical data or notes into an engaging, beautifully structured, and concise response.\n" +
      "Use clear headers, bullet points, and appropriate emojis. Keep your response highly readable and aligned with the persona requests.";
  }

  // 3. Instantiate and execute the ToolLoopAgent
  const subagent = new ToolLoopAgent({
    id: `subagent-${agentType}`,
    model: route.model,
    instructions,
    tools: subagentTools,
    stopWhen: stepCountIs(20), // 20 steps maximum for subagent tasks
  });

  const result = await subagent.generate({
    messages: [
      {
        role: "user",
        content: `Execute the following task and return a complete report: "${task}"`,
      },
    ],
  });

  return result.text || "Subagent failed to produce a response.";
}
