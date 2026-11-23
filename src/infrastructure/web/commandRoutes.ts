import type { Context, Hono } from "hono";
import type { ZodError } from "zod";
import {
  createCustomCommandSchema,
  updateBuiltinCommandSchema,
  updateCustomCommandSchema,
} from "../../domain/models/CommandDefinition.js";
import {
  CommandConflictError,
  CommandNotFoundError,
  CommandStoreUnavailableError,
  CommandValidationError,
  type CommandRegistry,
  type RuntimeCommandInfo,
} from "../../domain/services/CommandRegistryService.js";
import { log } from "../config/config.js";
import { getCommandRegistry } from "../config/commandRegistry.js";

/** Shape returned to the admin console. Never includes `commandClass`. */
export interface PublicCommandView {
  name: string;
  aliases: string[];
  description: string;
  helpText?: string;
  category: RuntimeCommandInfo["category"];
  source: RuntimeCommandInfo["source"];
  enabled: boolean;
  disabledReason?: string;
  cooldown?: number;
  maxUses?: number;
  vipOnly?: boolean;
  requiredRoles?: RuntimeCommandInfo["requiredRoles"];
  /** Only present for custom (data-only) commands. */
  response?: string;
  /** Only present for custom commands (built-in overrides do not expose audit fields). */
  updatedAt?: Date;
  updatedBy?: string;
}

export function toPublicCommandView(
  info: RuntimeCommandInfo,
): PublicCommandView {
  const definition = info.customDefinition;

  return {
    name: info.name,
    aliases: info.aliases ?? [],
    description: info.description,
    helpText: info.helpText,
    category: info.category,
    source: info.source,
    enabled: info.enabled,
    disabledReason: info.disabledReason,
    cooldown: info.cooldown,
    maxUses: info.maxUses,
    vipOnly: info.vipOnly,
    requiredRoles: info.requiredRoles,
    ...(definition
      ? {
          response: definition.response,
          updatedAt: definition.updatedAt,
          updatedBy: definition.updatedBy,
        }
      : {}),
  };
}

function invalidBody(c: Context, error: ZodError) {
  return c.json(
    {
      error: "Invalid request body",
      details: error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.join(".") : "(body)",
        message: issue.message,
      })),
    },
    400,
  );
}

function invalidJson(c: Context) {
  return c.json({ error: "Request body must be valid JSON" }, 400);
}

function notFound(c: Context, name: string) {
  return c.json({ error: `Command "${name}" was not found` }, 404);
}

function mapError(c: Context, error: unknown) {
  if (error instanceof CommandValidationError) {
    return c.json(
      { error: "Invalid request body", details: error.issues },
      400,
    );
  }
  if (error instanceof CommandConflictError) {
    return c.json({ error: error.message }, 409);
  }
  if (error instanceof CommandNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof CommandStoreUnavailableError) {
    return c.json({ error: error.message }, 503);
  }

  log.error("Command API request failed:", error);
  return c.json({ error: "Internal server error" }, 500);
}

async function readJsonBody(c: Context): Promise<unknown | undefined> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/**
 * Registers the admin command-management API. All routes live under `/api/*`
 * and inherit the Basic Auth middleware applied in `src/api.ts`.
 */
export function registerCommandRoutes(
  app: Hono,
  getRegistry: () => Promise<CommandRegistry> = getCommandRegistry,
): void {
  app.get("/api/commands", async (c) => {
    try {
      const registry = await getRegistry();
      return c.json({
        commands: registry.listSync().map(toPublicCommandView),
      });
    } catch (error) {
      return mapError(c, error);
    }
  });

  app.get("/api/commands/:name", async (c) => {
    try {
      const registry = await getRegistry();
      const name = c.req.param("name").toLowerCase();
      const info = registry.getSync(name);
      if (!info) return notFound(c, name);

      return c.json({ command: toPublicCommandView(info) });
    } catch (error) {
      return mapError(c, error);
    }
  });

  app.post("/api/commands", async (c) => {
    try {
      const registry = await getRegistry();
      const body = await readJsonBody(c);
      if (body === undefined) return invalidJson(c);

      const parsed = createCustomCommandSchema.safeParse(body);
      if (!parsed.success) return invalidBody(c, parsed.error);

      const command = await registry.create(parsed.data, "api");
      return c.json({ command: toPublicCommandView(command) }, 201);
    } catch (error) {
      return mapError(c, error);
    }
  });

  app.patch("/api/commands/:name", async (c) => {
    try {
      const registry = await getRegistry();
      const name = c.req.param("name").toLowerCase();
      const current = registry.getSync(name);
      // Mutations must address the canonical name: aliases are read-only, so
      // an alias resolves to a command whose name differs from the URL segment.
      if (!current || current.name !== name) return notFound(c, name);

      const body = await readJsonBody(c);
      if (body === undefined) return invalidJson(c);

      if (current.source === "custom") {
        const parsed = updateCustomCommandSchema.safeParse(body);
        if (!parsed.success) return invalidBody(c, parsed.error);

        const command = await registry.updateCustom(name, parsed.data, "api");
        return c.json({ command: toPublicCommandView(command) });
      }

      const parsed = updateBuiltinCommandSchema.safeParse(body);
      if (!parsed.success) return invalidBody(c, parsed.error);

      const command = await registry.updateBuiltin(name, parsed.data, "api");
      return c.json({ command: toPublicCommandView(command) });
    } catch (error) {
      return mapError(c, error);
    }
  });

  app.delete("/api/commands/:name", async (c) => {
    try {
      const registry = await getRegistry();
      const name = c.req.param("name").toLowerCase();
      const current = registry.getSync(name);
      // Mutations must address the canonical name: aliases are read-only, so
      // an alias resolves to a command whose name differs from the URL segment.
      if (!current || current.name !== name) return notFound(c, name);

      if (current.source === "builtin") {
        return c.json(
          {
            error: `Built-in command "${name}" cannot be deleted; disable it instead`,
          },
          409,
        );
      }

      await registry.removeCustom(name, "api");
      return c.json({ message: `Command "${name}" deleted` });
    } catch (error) {
      return mapError(c, error);
    }
  });

  app.post("/api/commands/:name/reset", async (c) => {
    try {
      const registry = await getRegistry();
      const name = c.req.param("name").toLowerCase();
      const current = registry.getSync(name);
      // Mutations must address the canonical name: aliases are read-only, so
      // an alias resolves to a command whose name differs from the URL segment.
      if (!current || current.name !== name) return notFound(c, name);

      if (current.source === "custom") {
        return c.json(
          { error: `Command "${name}" is not a built-in command` },
          409,
        );
      }

      await registry.resetBuiltin(name, "api");
      const command = registry.getSync(name);
      if (!command) return notFound(c, name);

      return c.json({ command: toPublicCommandView(command) });
    } catch (error) {
      return mapError(c, error);
    }
  });
}
