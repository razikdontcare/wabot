import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  loadBuiltinCommands,
  selectCommandFiles,
} from "../src/shared/utils/commandLoader.js";

const COMMANDS_DIR = fileURLToPath(new URL("../src/app/commands", import.meta.url));
const FIXTURE_COMMANDS_DIR = fileURLToPath(
  new URL("./fixtures/commands", import.meta.url),
);

describe("selectCommandFiles", () => {
  it("keeps TypeScript command files and skips declarations and subdirectories", () => {
    const files = selectCommandFiles(COMMANDS_DIR);

    expect(files).toContain("SearchCommand.ts");
    expect(files.every((file) => file.endsWith(".ts") || file.endsWith(".js"))).toBe(true);
    expect(files.some((file) => file.endsWith(".d.ts"))).toBe(false);
    expect(files).not.toContain("prompts");
  });
});

describe("loadBuiltinCommands", () => {
  it("loads every command class exactly once", async () => {
    const commands = await loadBuiltinCommands();

    expect(commands.length).toBeGreaterThanOrEqual(25);
    expect(commands.map((command) => command.name)).toContain("search");
    expect(new Set(commands.map((command) => command.name)).size).toBe(commands.length);
    expect(commands.every((command) => typeof command.commandClass === "function")).toBe(true);
  });

  it("finds the command export even when a plain helper is exported first", async () => {
    const commands = await loadBuiltinCommands(FIXTURE_COMMANDS_DIR);

    expect(commands.map((command) => command.name)).toEqual(["helperfirst"]);
    expect(commands.every((command) => typeof command.commandClass === "function")).toBe(true);
  });
});
