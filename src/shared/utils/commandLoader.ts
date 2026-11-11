import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CommandInfo } from "../../app/handlers/CommandInterface.js";
import { log } from "../../infrastructure/config/config.js";

const COMMAND_FILE_PATTERN = /\.(ts|js)$/;
const DECLARATION_FILE_PATTERN = /\.d\.ts$/;

const DEFAULT_COMMANDS_DIR = fileURLToPath(
  new URL("../../app/commands/", import.meta.url),
);

type CommandModule = Record<string, unknown>;

/**
 * Lists the importable command files in a directory, independent of the
 * runtime the process is executing on (Bun runs `.ts` directly).
 */
export function selectCommandFiles(commandsDir: string): string[] {
  return readdirSync(commandsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        COMMAND_FILE_PATTERN.test(name) && !DECLARATION_FILE_PATTERN.test(name),
    )
    .sort((left, right) => left.localeCompare(right));
}

function extractCommandInfo(candidate: unknown): CommandInfo | undefined {
  if (
    candidate === null ||
    (typeof candidate !== "object" && typeof candidate !== "function")
  ) {
    return undefined;
  }

  const commandInfo = (candidate as { commandInfo?: unknown }).commandInfo;
  if (typeof commandInfo !== "object" || commandInfo === null) {
    return undefined;
  }

  const record = commandInfo as Record<string, unknown>;
  const isValid =
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    typeof record.category === "string" &&
    typeof record.commandClass === "function";

  return isValid ? (commandInfo as CommandInfo) : undefined;
}

/**
 * Imports every built-in command class from `commandsDir` (or the shipped
 * `src/app/commands` directory) and returns its `CommandInfo`.
 *
 * Duplicate names keep the first definition, invalid exports are skipped with
 * a warning, and only an unreadable directory throws.
 */
export async function loadBuiltinCommands(
  commandsDir: string = DEFAULT_COMMANDS_DIR,
): Promise<CommandInfo[]> {
  const files = selectCommandFiles(commandsDir);
  log.info(`Loading ${files.length} command files from ${commandsDir}`);

  const commands = new Map<string, CommandInfo>();

  for (const file of files) {
    try {
      const moduleUrl = pathToFileURL(join(commandsDir, file)).href;
      const commandModule = (await import(moduleUrl)) as CommandModule;
      const commandInfo = extractCommandInfo(
        commandModule.default ?? Object.values(commandModule)[0],
      );

      if (!commandInfo) {
        log.warn(`Command file ${file} does not export a valid command class`);
        continue;
      }

      const key = commandInfo.name.toLowerCase();
      if (commands.has(key)) {
        log.warn(
          `Duplicate command name "${commandInfo.name}" in ${file}; keeping the first definition`,
        );
        continue;
      }

      commands.set(key, commandInfo);
      log.debug(`Registered command: ${commandInfo.name}`);
    } catch (error) {
      log.warn(`Failed to load command from ${file}:`, error);
    }
  }

  return [...commands.values()];
}
