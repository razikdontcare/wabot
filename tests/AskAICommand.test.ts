import { describe, expect, it, mock, spyOn, beforeEach } from "bun:test";
import { AskAICommand } from "../src/app/commands/AskAICommand.js";

describe("AskAICommand Feedback", () => {
  let command: AskAICommand;
  let mockSock: any;

  beforeEach(() => {
    command = new AskAICommand();
    mockSock = {
      sendMessage: mock(async () => ({ key: { id: "status-msg" } })),
    };
  });

  it("should send status message when tools are called", async () => {
    // Mock the global bot client
    (globalThis as any).__botClient = {
        getAIProviderRoute: () => ({ provider: "google", modelId: "gemini" })
    };

    // This test is tricky because it depends on createAskAgent which is an external import
    // But we can verify the logic by calling the internal methods if they were accessible, 
    // or by mocking the entire agent.
    
    // Let's assume we can mock the agent generation
    mock.module("../src/app/agents/AskAgent.js", () => {
        return {
            createAskAgent: () => ({
                generate: async ({ onStepFinish }: any) => {
                    // Simulate a tool call step
                    await onStepFinish({ 
                        toolCalls: [{ toolName: "web_search" }],
                        text: "Thinking..." 
                    });
                    return { text: "Final answer" };
                }
            })
        };
    });

    await (command as any).getAICompletion(
        [{ role: "user", content: "hello" }],
        "user@s.whatsapp.net",
        "Test User",
        "", // groupContext
        "jid@g.us",
        mockSock,
        { pushName: "Test User" } as any
    );

    // Should have sent the initial status message
    expect(mockSock.sendMessage).toHaveBeenCalled();
    const calls = mockSock.sendMessage.mock.calls;
    const statusCall = calls.find(c => c[1].text?.includes("AI sedang bekerja") && c[1].text?.includes("Web Search"));
    expect(statusCall).toBeDefined();
  });
});
