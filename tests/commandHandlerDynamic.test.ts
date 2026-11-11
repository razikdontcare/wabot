import { describe, expect, it } from "bun:test";
import { CommandHandler } from "../src/app/handlers/CommandHandler.js";
import type { CommandRegistry } from "../src/domain/services/CommandRegistryService.js";
import type { RuntimeCommandInfo } from "../src/domain/services/CommandRegistryService.js";
import type { CustomCommandDefinition } from "../src/domain/models/CommandDefinition.js";

function customInfo(enabled: boolean): RuntimeCommandInfo {
  const definition = {
    name: "halo",
    aliases: ["hi"],
    description: "Sapaan",
    category: "general" as const,
    response: "Halo {{args}}",
    enabled,
    createdBy: "api",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    updatedBy: "api",
  } satisfies CustomCommandDefinition;

  return {
    name: "halo",
    aliases: ["hi"],
    description: definition.description,
    category: "general",
    source: "custom",
    enabled,
    disabled: !enabled,
    customDefinition: definition,
  };
}

function registry(info: RuntimeCommandInfo | undefined): CommandRegistry {
  return {
    initialize: async () => {},
    listSync: () => (info ? [info] : []),
    getSync: (name: string) =>
      info && (name === "halo" || name === "hi") ? info : undefined,
    create: async () => {
      throw new Error("not used");
    },
    updateCustom: async () => {
      throw new Error("not used");
    },
    updateBuiltin: async () => {
      throw new Error("not used");
    },
    removeCustom: async () => {},
    resetBuiltin: async () => {
      throw new Error("not used");
    },
  };
}

function handlerFor(info: RuntimeCommandInfo) {
  return new CommandHandler(
    { getSession: async () => null } as never,
    undefined,
    { registry: registry(info), sessionCleanupIntervalMs: 0 },
  );
}

function fakeSocket(sent: string[]) {
  return {
    sendMessage: async (_jid: string, content: { text?: string }) => {
      sent.push(content.text ?? "");
      return { key: { id: String(sent.length) } };
    },
  } as never;
}

describe("CommandHandler custom commands", () => {
  it("executes a custom command through the AI execution path", async () => {
    const sent: string[] = [];
    const handler = handlerFor(customInfo(true));
    await handler.waitForInitialization();

    const result = await handler.executeCommandForAI(
      "halo",
      ["dunia"],
      "1201@g.us",
      "62811@s.whatsapp.net",
      fakeSocket(sent),
      {} as never,
    );

    expect(result.success).toBe(true);
    expect(sent).toEqual(["Halo dunia"]);
  });

  it("reports a disabled custom command instead of executing it", async () => {
    const sent: string[] = [];
    const handler = handlerFor(customInfo(false));
    await handler.waitForInitialization();

    const result = await handler.executeCommandForAI(
      "halo",
      ["dunia"],
      "1201@g.us",
      "62811@s.whatsapp.net",
      fakeSocket(sent),
      {} as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("disabled");
    expect(sent).toEqual([]);
  });
});
