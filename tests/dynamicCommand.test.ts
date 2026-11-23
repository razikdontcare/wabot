import { describe, expect, it } from "bun:test";
import { DynamicCommand } from "../src/app/handlers/DynamicCommand.js";
import type { CustomCommandDefinition } from "../src/domain/models/CommandDefinition.js";

function definition(
  overrides: Partial<CustomCommandDefinition> = {},
): CustomCommandDefinition {
  return {
    name: "halo",
    aliases: [],
    description: "Sapaan",
    category: "general",
    response: "Halo {{args}} dari {{command}}",
    enabled: true,
    createdBy: "api",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    updatedBy: "api",
    ...overrides,
  };
}

function fakeSocket() {
  const sent: string[] = [];
  return {
    sent,
    socket: {
      sendMessage: async (_jid: string, content: { text?: string }) => {
        sent.push(content.text ?? "");
        return { key: { id: String(sent.length) } };
      },
    },
  };
}

describe("DynamicCommand", () => {
  it("renders the stored response template and sends it to the chat", async () => {
    const { sent, socket } = fakeSocket();
    const command = new DynamicCommand(
      definition(),
      async () => ({ prefix: "!", name: "Nexa AI" }) as never,
    );

    await command.handleCommand(
      ["dunia"],
      "1201@g.us",
      "62811@s.whatsapp.net",
      socket as never,
      {} as never,
      {} as never,
    );

    expect(sent).toEqual(["Halo dunia dari halo"]);
  });
});
