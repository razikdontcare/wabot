import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { CommandHandler } from "../src/app/handlers/CommandHandler.js";
import { VIPService } from "../src/domain/services/VIPService.js";
import * as config from "../src/infrastructure/config/config.js";
import * as userRoles from "../src/shared/utils/userRoles.js";
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
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (_jid: string, content: { text?: string }) => {
      sent.push(content.text ?? "");
      return { key: { id: String(sent.length) } };
    },
  } as never;
}

describe("CommandHandler custom commands", () => {
  afterEach(() => mock.restore());

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

  it.each([
    { user: "regular", isVIP: false, isAdmin: false, allowed: false },
    { user: "vip", isVIP: true, isAdmin: false, allowed: true },
    { user: "admin", isVIP: false, isAdmin: true, allowed: true },
  ])("enforces VIP-only in chat and AI for $user", async ({ isVIP, isAdmin, allowed }) => {
    const vipService = new VIPService({} as never);
    spyOn(VIPService, "getInstance").mockResolvedValue(vipService);
    spyOn(vipService, "isVIP").mockResolvedValue(isVIP);
    spyOn(config, "getCurrentConfig").mockResolvedValue({
      ...config.BotConfig, maintenanceMode: false,
    });
    spyOn(userRoles, "getUserRolesConsideringAlt").mockResolvedValue(isAdmin ? ["admin"] : []);

    const handler = handlerFor({ ...customInfo(true), vipOnly: true });
    await handler.waitForInitialization();
    const chat = "1201@g.us";
    const user = "62811@s.whatsapp.net";
    const message = { key: {} };
    const chatReplies: string[] = [];
    const aiReplies: string[] = [];
    await handler.handleCommand(`${config.BotConfig.prefix}hi dunia`, chat, user, fakeSocket(chatReplies), message);
    const result = await handler.executeCommandForAI("hi", ["dunia"], chat, user, fakeSocket(aiReplies), message);

    expect(result.success).toBe(allowed);
    expect(aiReplies).toEqual(allowed ? ["Halo dunia"] : []);
    if (allowed) expect(chatReplies).toEqual(aiReplies);
    else expect(chatReplies[0]).toContain("VIP members");
  });
});
