import { describe, expect, it } from "bun:test";
import type { CommandInfo } from "../src/app/handlers/CommandInterface.js";
import type { CommandStore } from "../src/domain/services/CommandStore.js";
import {
  CommandConflictError,
  CommandRegistryService,
  CommandStoreUnavailableError,
  CommandValidationError,
  type CommandRegistry,
} from "../src/domain/services/CommandRegistryService.js";
import type { StoredCommandRecord } from "../src/domain/models/CommandDefinition.js";

class MemoryStore implements CommandStore {
  records = new Map<string, StoredCommandRecord>();
  async list() { return [...this.records.values()]; }
  async upsert(record: StoredCommandRecord) { this.records.set(record._id, record); }
  async delete(id: string) { return this.records.delete(id); }
  async ensureIndexes() {}
}

class BrokenStore extends MemoryStore {
  async list(): Promise<StoredCommandRecord[]> { throw new Error("mongo down"); }
  async upsert(): Promise<void> { throw new Error("mongo down"); }
}

function builtin(overrides: Partial<CommandInfo>): CommandInfo {
  return {
    name: "search",
    aliases: ["ws"],
    description: "Cari web",
    category: "general",
    commandClass: class {} as never,
    ...overrides,
  };
}

const builtins = [
  builtin({}),
  builtin({ name: "help", aliases: [], description: "Bantuan", category: "general" }),
];

async function createRegistry(store: CommandStore = new MemoryStore()): Promise<{
  registry: CommandRegistry;
  store: CommandStore;
}> {
  const registry = new CommandRegistryService(store, async () => builtins);
  await registry.initialize();
  return { registry, store };
}

describe("CommandRegistryService", () => {
  it("merges built-ins, overrides and custom commands and resolves aliases", async () => {
    const { registry } = await createRegistry();
    await registry.create(
      { name: "halo", aliases: ["hi"], description: "Sapaan", response: "Halo {{args}}" },
      "api",
    );

    expect(registry.getSync("hi")?.name).toBe("halo");
    expect(registry.getSync("ws")?.name).toBe("search");
    expect(registry.listSync().map((entry) => entry.name)).toContain("halo");
  });

  it("disables and re-enables a built-in through an override, then resets it", async () => {
    const { registry } = await createRegistry();
    await registry.updateBuiltin("search", { enabled: false, disabledReason: "rusak" }, "api");

    expect(registry.getSync("search")?.disabled).toBe(true);
    expect(registry.getSync("search")?.disabledReason).toBe("rusak");

    await registry.resetBuiltin("search", "api");
    expect(registry.getSync("search")?.disabled).toBe(false);
  });

  it("rejects names and aliases that collide with built-ins or core commands", async () => {
    const { registry } = await createRegistry();

    await expect(
      registry.create({ name: "search", description: "x", response: "x" }, "api"),
    ).rejects.toBeInstanceOf(CommandConflictError);
    await expect(
      registry.create({ name: "halo", aliases: ["ws"], description: "x", response: "x" }, "api"),
    ).rejects.toBeInstanceOf(CommandConflictError);
    await expect(
      registry.create({ name: "help", description: "x", response: "x" }, "api"),
    ).rejects.toBeInstanceOf(CommandConflictError);
  });

  it("deletes custom commands but refuses to delete built-ins", async () => {
    const { registry } = await createRegistry();
    await registry.create({ name: "halo", description: "x", response: "x" }, "api");

    await expect(registry.removeCustom("search", "api")).rejects.toBeInstanceOf(CommandConflictError);
    await registry.removeCustom("halo", "api");
    expect(registry.getSync("halo")).toBeUndefined();
  });

  it("rejects unknown template placeholders", async () => {
    const { registry } = await createRegistry();

    await expect(
      registry.create({ name: "halo", description: "x", response: "Hai {{bogus}}" }, "api"),
    ).rejects.toBeInstanceOf(CommandValidationError);
  });

  it("keeps untouched fields when a custom command is partially updated", async () => {
    const { registry } = await createRegistry();
    await registry.create(
      {
        name: "halo",
        aliases: ["hi"],
        description: "Sapaan",
        helpText: "Bantuan sapaan",
        response: "Halo {{args}}",
        category: "utility",
      },
      "api",
    );

    const disabled = await registry.updateCustom("halo", { enabled: false }, "api");

    expect(disabled.enabled).toBe(false);
    expect(disabled.disabled).toBe(true);
    expect(disabled.aliases).toEqual(["hi"]);
    expect(disabled.category).toBe("utility");
    expect(disabled.description).toBe("Sapaan");
    expect(disabled.helpText).toBe("Bantuan sapaan");
    expect(disabled.customDefinition?.response).toBe("Halo {{args}}");
    expect(disabled.customDefinition?.aliases).toEqual(["hi"]);

    // Editing a disabled command must not silently re-enable it.
    const edited = await registry.updateCustom(
      "halo",
      { description: "Sapaan baru" },
      "api",
    );
    expect(edited.enabled).toBe(false);
    expect(edited.description).toBe("Sapaan baru");
    expect(edited.aliases).toEqual(["hi"]);
    expect(edited.category).toBe("utility");
  });

  it("keeps built-ins usable when the store is unavailable", async () => {
    const registry = new CommandRegistryService(new BrokenStore(), async () => builtins);
    await registry.initialize();

    expect(registry.getSync("search")?.name).toBe("search");
    await expect(
      registry.create({ name: "halo", description: "x", response: "x" }, "api"),
    ).rejects.toBeInstanceOf(CommandStoreUnavailableError);
  });
});
