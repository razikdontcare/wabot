import { CommandRegistryService, type CommandRegistry } from "../../domain/services/CommandRegistryService.js";
import { loadBuiltinCommands } from "../../shared/utils/commandLoader.js";
import { MongoCommandStore } from "./mongoCommandStore.js";

let registryPromise: Promise<CommandRegistry> | null = null;

/**
 * Process-wide command registry shared by the bot handler and the HTTP API so
 * an admin edit is visible to the running bot immediately.
 */
export function getCommandRegistry(): Promise<CommandRegistry> {
  registryPromise ??= (async () => {
    const registry = new CommandRegistryService(
      new MongoCommandStore(),
      () => loadBuiltinCommands(),
    );
    await registry.initialize();
    return registry;
  })();

  return registryPromise;
}

export function resetCommandRegistryForTests(): void {
  registryPromise = null;
}
