import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { registerCommandRoutes } from "../src/infrastructure/web/commandRoutes.js";
import {
  CommandConflictError,
  CommandNotFoundError,
  CommandStoreUnavailableError,
  CommandValidationError,
} from "../src/domain/services/CommandRegistryService.js";
import type { CommandRegistry } from "../src/domain/services/CommandRegistryService.js";

const view = {
  name: "halo",
  aliases: [] as string[],
  description: "Sapaan",
  category: "general" as const,
  source: "custom" as const,
  enabled: true,
  response: "Halo {{args}}",
};

function appWith(overrides: Partial<CommandRegistry>) {
  const registry = {
    initialize: async () => {},
    listSync: () => [],
    getSync: () => undefined,
    create: async () => view,
    updateCustom: async () => view,
    updateBuiltin: async () => view,
    removeCustom: async () => {},
    resetBuiltin: async () => view,
    ...overrides,
  } as unknown as CommandRegistry;
  const app = new Hono();
  registerCommandRoutes(app, async () => registry);
  return app;
}

describe("command routes", () => {
  it("lists commands", async () => {
    const app = appWith({});
    const res = await app.request("/api/commands");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commands: [] });
  });

  it("creates a custom command", async () => {
    const app = appWith({});
    const res = await app.request("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "halo",
        description: "Sapaan",
        response: "Halo {{args}}",
      }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 404 for mutations addressed through an alias", async () => {
    const customView = { ...view, name: "halo" };
    const customAliasApp = appWith({
      getSync: (name: string) =>
        name === "hi" || name === "halo" ? (customView as never) : undefined,
    });

    expect(
      (
        await customAliasApp.request("/api/commands/hi", {
          method: "PATCH",
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(404);

    const builtinView = {
      name: "search",
      aliases: ["ws"],
      description: "Cari",
      category: "general",
      source: "builtin",
      enabled: true,
    };
    const builtinAliasApp = appWith({
      getSync: (name: string) =>
        name === "ws" || name === "search" ? (builtinView as never) : undefined,
    });

    expect(
      (await builtinAliasApp.request("/api/commands/ws", { method: "DELETE" }))
        .status,
    ).toBe(404);
    expect(
      (
        await builtinAliasApp.request("/api/commands/ws/reset", {
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });

  it("maps registry errors to HTTP statuses", async () => {
    const conflict = appWith({
      create: async () => {
        throw new CommandConflictError("exists");
      },
    });
    expect(
      (
        await conflict.request("/api/commands", {
          method: "POST",
          body: JSON.stringify({ name: "x", description: "x", response: "x" }),
        })
      ).status,
    ).toBe(409);

    const invalid = appWith({
      create: async () => {
        throw new CommandValidationError([
          { field: "response", message: "bad" },
        ]);
      },
    });
    expect(
      (
        await invalid.request("/api/commands", {
          method: "POST",
          body: JSON.stringify({ name: "x", description: "x", response: "x" }),
        })
      ).status,
    ).toBe(400);

    const missing = appWith({
      updateCustom: async () => {
        throw new CommandNotFoundError("halo");
      },
    });
    expect(
      (
        await missing.request("/api/commands/halo", {
          method: "PATCH",
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(404);

    const down = appWith({
      create: async () => {
        throw new CommandStoreUnavailableError();
      },
    });
    expect(
      (
        await down.request("/api/commands", {
          method: "POST",
          body: JSON.stringify({ name: "x", description: "x", response: "x" }),
        })
      ).status,
    ).toBe(503);
  });
});
