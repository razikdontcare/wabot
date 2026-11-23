import type { ZodError } from "zod";
import type { CommandInfo } from "../../app/handlers/CommandInterface.js";
import { log } from "../../infrastructure/config/config.js";
import { validateCommandTemplate } from "../../shared/utils/commandTemplates.js";
import {
  CORE_COMMAND_NAMES,
  COMMAND_NAME_PATTERN,
  createCustomCommandSchema,
  updateBuiltinCommandSchema,
  updateCustomCommandSchema,
  type CreateCustomCommandInput,
  type CustomCommandDefinition,
  type StoredBuiltinOverride,
  type StoredCommandRecord,
  type StoredCustomCommand,
  type UpdateBuiltinCommandInput,
  type UpdateCustomCommandInput,
} from "../models/CommandDefinition.js";
import type { CommandStore } from "./CommandStore.js";

const DEFAULT_CACHE_TTL_MS = 30_000;

/** Built-in command plus the runtime state contributed by the store. */
export interface RuntimeCommandInfo extends CommandInfo {
  source: "builtin" | "custom";
  enabled: boolean;
  customDefinition?: CustomCommandDefinition;
}

/** Merge of built-in code commands, admin overrides and custom commands. */
export interface CommandRegistry {
  initialize(): Promise<void>;
  listSync(): RuntimeCommandInfo[];
  getSync(nameOrAlias: string): RuntimeCommandInfo | undefined;
  create(
    input: CreateCustomCommandInput,
    actor: string,
  ): Promise<RuntimeCommandInfo>;
  updateCustom(
    name: string,
    input: UpdateCustomCommandInput,
    actor: string,
  ): Promise<RuntimeCommandInfo>;
  updateBuiltin(
    name: string,
    input: UpdateBuiltinCommandInput,
    actor: string,
  ): Promise<RuntimeCommandInfo>;
  removeCustom(name: string, actor: string): Promise<void>;
  resetBuiltin(name: string, actor: string): Promise<void>;
}

export interface CommandValidationIssue {
  field: string;
  message: string;
}

/** A name or alias would shadow an existing command or a core command. */
export class CommandConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandConflictError";
  }
}

/** No stored command (or built-in command) matches the requested name. */
export class CommandNotFoundError extends Error {
  constructor(name: string) {
    super(`Command "${name}" was not found`);
    this.name = "CommandNotFoundError";
  }
}

/** The Mongo-backed store could not be reached. Built-ins keep working. */
export class CommandStoreUnavailableError extends Error {
  constructor(message = "Command storage is currently unavailable") {
    super(message);
    this.name = "CommandStoreUnavailableError";
  }
}

/** A submitted command failed field-level validation. */
export class CommandValidationError extends Error {
  readonly issues: CommandValidationIssue[];

  constructor(issues: CommandValidationIssue[]) {
    super(
      issues.length > 0
        ? issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")
        : "Invalid command",
    );
    this.name = "CommandValidationError";
    this.issues = issues;
  }
}

function toValidationError(error: ZodError): CommandValidationError {
  return new CommandValidationError(
    error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join(".") : "command",
      message: issue.message,
    })),
  );
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeAliases(aliases: string[] | undefined): string[] {
  return (aliases ?? []).map(normalizeName).filter((alias) => alias.length > 0);
}

function isCoreCommandName(name: string): boolean {
  return (CORE_COMMAND_NAMES as readonly string[]).includes(name);
}

/**
 * Merges the compiled-in command classes with Mongo-backed overrides and
 * admin-created custom commands. Reads are served from an in-memory cache so
 * the message hot path never awaits Mongo; writes refresh it synchronously.
 */
export class CommandRegistryService implements CommandRegistry {
  private readonly views = new Map<string, RuntimeCommandInfo>();
  private readonly aliasToName = new Map<string, string>();
  private readonly builtinOverrides = new Map<string, StoredBuiltinOverride>();
  private readonly customRecords = new Map<string, StoredCustomCommand>();
  private readonly cacheTtlMs: number;
  private builtins: CommandInfo[] = [];
  private operations: Promise<void> = Promise.resolve();
  private storeSnapshotValid = false;
  private loadedAt = 0;
  private refreshPromise: Promise<void> | null = null;

  constructor(
    private readonly store: CommandStore,
    private readonly loadBuiltins: () => Promise<CommandInfo[]>,
    options: { cacheTtlMs?: number } = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Loads the store-backed view. A Mongo failure at boot must never take the
   * bot down: built-in commands stay registered and writes surface the error.
   */
  async initialize(): Promise<void> {
    return this.serialize(async () => {
      try {
        await this.store.ensureIndexes();
      } catch (error) {
        log.warn("Could not ensure command store indexes:", error);
      }

      try {
        await this.refresh();
      } catch (error) {
        log.warn(
          "Could not load stored commands; continuing with built-in commands only:",
          error,
        );
        this.storeSnapshotValid = false;
        await this.buildViews([]);
        this.loadedAt = Date.now();
      }
    });
  }

  listSync(): RuntimeCommandInfo[] {
    this.refreshIfStale();
    return [...this.views.values()];
  }

  getSync(nameOrAlias: string): RuntimeCommandInfo | undefined {
    this.refreshIfStale();

    const key = normalizeName(nameOrAlias);
    if (!key) {
      return undefined;
    }

    const canonicalName = this.aliasToName.get(key) ?? key;
    return this.views.get(canonicalName);
  }

  async create(
    input: CreateCustomCommandInput,
    actor: string,
  ): Promise<RuntimeCommandInfo> {
    return this.mutate(async () => {
      const parsed = createCustomCommandSchema.safeParse(input);
      if (!parsed.success) {
        throw toValidationError(parsed.error);
      }

      const definition = parsed.data;
      this.assertNameAvailable(definition.name);
      this.assertAliasesAvailable(definition.aliases);
      this.assertTemplateValid(definition.response);

      const now = new Date();
      const record: StoredCustomCommand = {
        ...definition,
        _id: `custom:${definition.name}`,
        kind: "custom",
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
        updatedBy: actor,
      };

      await this.store.upsert(record);
      await this.refresh();
      return this.requireView(definition.name);
    });
  }

  async updateCustom(
    name: string,
    input: UpdateCustomCommandInput,
    actor: string,
  ): Promise<RuntimeCommandInfo> {
    return this.mutate(async () => {
      const canonicalName = normalizeName(name);
      const existing = this.customRecords.get(canonicalName);
      if (!existing) {
        throw new CommandNotFoundError(name);
      }

      const parsed = updateCustomCommandSchema.safeParse(input);
      if (!parsed.success) {
        throw toValidationError(parsed.error);
      }

      const updates = parsed.data;
      if (updates.aliases !== undefined) {
        this.assertAliasesAvailable(updates.aliases, canonicalName);
      }
      if (updates.response !== undefined) {
        this.assertTemplateValid(updates.response);
      }

      const record: StoredCustomCommand = {
        ...existing,
        ...updates,
        _id: existing._id,
        kind: "custom",
        name: canonicalName,
        createdBy: existing.createdBy,
        createdAt: existing.createdAt,
        updatedAt: new Date(),
        updatedBy: actor,
      };

      await this.store.upsert(record);
      await this.refresh();
      return this.requireView(canonicalName);
    });
  }

  async updateBuiltin(
    name: string,
    input: UpdateBuiltinCommandInput,
    actor: string,
  ): Promise<RuntimeCommandInfo> {
    return this.mutate(async () => {
      const canonicalName = normalizeName(name);
      const info = this.views.get(canonicalName);
      if (!info || info.source !== "builtin") {
        throw new CommandNotFoundError(name);
      }
      if (isCoreCommandName(canonicalName)) {
        throw new CommandConflictError(
          `Core command "${canonicalName}" cannot be overridden`,
        );
      }

      const parsed = updateBuiltinCommandSchema.safeParse(input);
      if (!parsed.success) {
        throw toValidationError(parsed.error);
      }

      const updates = parsed.data;
      if (updates.aliases !== undefined) {
        this.assertAliasesAvailable(updates.aliases, canonicalName);
      }

      const existing = this.builtinOverrides.get(canonicalName);
      const record: StoredBuiltinOverride = {
        ...(existing ?? {
          _id: `builtin:${canonicalName}`,
          kind: "builtin" as const,
          name: canonicalName,
        }),
        ...updates,
        _id: existing?._id ?? `builtin:${canonicalName}`,
        kind: "builtin",
        name: canonicalName,
        updatedAt: new Date(),
        updatedBy: actor,
      };

      await this.store.upsert(record);
      await this.refresh();
      return this.requireView(canonicalName);
    });
  }

  async removeCustom(name: string, _actor: string): Promise<void> {
    return this.mutate(async () => {
      const canonicalName = normalizeName(name);
      const info = this.views.get(canonicalName);
      if (!info) {
        throw new CommandNotFoundError(name);
      }
      if (info.source === "builtin") {
        throw new CommandConflictError(
          `Built-in command "${canonicalName}" cannot be deleted; disable it instead`,
        );
      }

      await this.store.delete(`custom:${canonicalName}`);
      await this.refresh();
    });
  }

  async resetBuiltin(name: string, _actor: string): Promise<void> {
    return this.mutate(async () => {
      const canonicalName = normalizeName(name);
      const builtin = this.builtins.find(
        (entry) => normalizeName(entry.name) === canonicalName,
      );
      if (!builtin) {
        throw new CommandNotFoundError(name);
      }

      this.assertAliasesAvailable(normalizeAliases(builtin.aliases), canonicalName);
      await this.store.delete(`builtin:${canonicalName}`);
      await this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    const records = await this.store.list();
    await this.buildViews(records);
    this.storeSnapshotValid = true;
    this.loadedAt = Date.now();
  }

  /** Serves the cache and kicks off a background refresh when it is stale. */
  private refreshIfStale(): void {
    if (this.loadedAt === 0) {
      return;
    }
    if (Date.now() - this.loadedAt <= this.cacheTtlMs) {
      return;
    }
    if (this.refreshPromise) {
      return;
    }

    this.refreshPromise = this.serialize(async () => {
      if (Date.now() - this.loadedAt > this.cacheTtlMs) {
        await this.refresh();
      }
    })
      .catch((error: unknown) => {
        log.warn("Failed to refresh the command registry:", error);
      })
      .finally(() => {
        this.refreshPromise = null;
      });
  }

  private async buildViews(records: StoredCommandRecord[]): Promise<void> {
    const builtins = await this.loadBuiltins();

    this.builtins = builtins;
    this.views.clear();
    this.aliasToName.clear();
    this.builtinOverrides.clear();
    this.customRecords.clear();

    for (const record of records) {
      const normalizedName = normalizeName(record.name);

      if (record.kind === "builtin") {
        this.builtinOverrides.set(normalizedName, {
          ...record,
          name: normalizedName,
        });
      } else {
        this.customRecords.set(normalizedName, {
          ...record,
          name: normalizedName,
        });
      }
    }

    for (const info of builtins) {
      const name = normalizeName(info.name);
      const override = this.builtinOverrides.get(name);
      const enabled = override?.enabled ?? !info.disabled;

      this.views.set(name, {
        ...info,
        name,
        aliases: normalizeAliases(override?.aliases ?? info.aliases),
        description: override?.description ?? info.description,
        helpText: override?.helpText ?? info.helpText,
        cooldown: override?.cooldown ?? info.cooldown,
        maxUses: override?.maxUses ?? info.maxUses,
        vipOnly: override?.vipOnly ?? info.vipOnly,
        requiredRoles: override?.requiredRoles ?? info.requiredRoles,
        disabled: !enabled,
        disabledReason: override?.disabledReason ?? info.disabledReason,
        source: "builtin",
        enabled,
      });
    }

    for (const record of this.customRecords.values()) {
      if (this.views.has(record.name)) {
        log.error(
          `Custom command "${record.name}" collides with a built-in command; skipping it`,
        );
        continue;
      }

      const definition: CustomCommandDefinition = {
        name: record.name,
        aliases: normalizeAliases(record.aliases),
        description: record.description,
        helpText: record.helpText,
        category: record.category,
        response: record.response,
        enabled: record.enabled,
        cooldown: record.cooldown,
        maxUses: record.maxUses,
        vipOnly: record.vipOnly,
        requiredRoles: record.requiredRoles,
        createdBy: record.createdBy,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
      };

      this.views.set(record.name, {
        name: definition.name,
        aliases: definition.aliases,
        description: definition.description,
        helpText: definition.helpText,
        category: definition.category,
        cooldown: definition.cooldown,
        maxUses: definition.maxUses,
        vipOnly: definition.vipOnly,
        requiredRoles: definition.requiredRoles,
        disabled: !definition.enabled,
        source: "custom",
        enabled: definition.enabled,
        customDefinition: definition,
      });
    }

    // Canonical names win over aliases; duplicate aliases (possible only with
    // stale/out-of-band data) keep the first command and log the conflict.
    for (const view of this.views.values()) {
      this.aliasToName.set(view.name, view.name);
    }
    for (const view of this.views.values()) {
      for (const alias of normalizeAliases(view.aliases)) {
        const existing = this.aliasToName.get(alias);
        if (existing !== undefined && existing !== view.name) {
          log.error(
            `Alias "${alias}" for command "${view.name}" is already used by "${existing}"; keeping the first command`,
          );
          continue;
        }
        this.aliasToName.set(alias, view.name);
      }
    }
  }

  private assertNameAvailable(name: string, ignoreName?: string): void {
    if (!COMMAND_NAME_PATTERN.test(name)) {
      throw new CommandValidationError([
        {
          field: "name",
          message: `Name "${name}" is invalid`,
        },
      ]);
    }

    if (isCoreCommandName(name)) {
      throw new CommandConflictError(
        `"${name}" is a core command and cannot be redefined`,
      );
    }

    for (const info of this.views.values()) {
      if (ignoreName !== undefined && info.name === ignoreName) {
        continue;
      }
      if (
        info.name === name ||
        normalizeAliases(info.aliases).includes(name)
      ) {
        throw new CommandConflictError(
          `"${name}" is already used by command "${info.name}"`,
        );
      }
    }
  }

  private assertAliasesAvailable(
    aliases: string[],
    ignoreName?: string,
  ): void {
    const seen = new Set<string>();

    for (const rawAlias of aliases) {
      const alias = normalizeName(rawAlias);

      if (!COMMAND_NAME_PATTERN.test(alias)) {
        throw new CommandValidationError([
          {
            field: "aliases",
            message: `Alias "${rawAlias}" is invalid`,
          },
        ]);
      }

      if (seen.has(alias)) {
        throw new CommandConflictError(`Alias "${alias}" is listed twice`);
      }
      seen.add(alias);

      if (isCoreCommandName(alias)) {
        throw new CommandConflictError(
          `"${alias}" is a core command and cannot be used as an alias`,
        );
      }

      for (const info of this.views.values()) {
        if (ignoreName !== undefined && info.name === ignoreName) {
          continue;
        }
        if (
          info.name === alias ||
          normalizeAliases(info.aliases).includes(alias)
        ) {
          throw new CommandConflictError(
            `Alias "${alias}" is already used by command "${info.name}"`,
          );
        }
      }
    }
  }

  private assertTemplateValid(template: string): void {
    const unknownPlaceholders = validateCommandTemplate(template);
    if (unknownPlaceholders.length === 0) {
      return;
    }

    throw new CommandValidationError(
      unknownPlaceholders.map((placeholder) => ({
        field: "response",
        message: `Unknown template placeholder "{{${placeholder}}}"`,
      })),
    );
  }

  private requireView(name: string): RuntimeCommandInfo {
    const view = this.views.get(name);
    if (!view) {
      throw new CommandStoreUnavailableError(
        "Command was saved but the registry could not reload it",
      );
    }
    return view;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.then(() => {}, () => {});
    return result;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      try {
        if (!this.storeSnapshotValid || Date.now() - this.loadedAt > this.cacheTtlMs) {
          await this.refresh();
        }
        return await operation();
      } catch (error) {
        if (
          error instanceof CommandValidationError ||
          error instanceof CommandConflictError ||
          error instanceof CommandNotFoundError
        ) {
          throw error;
        }
        // A write might have succeeded even if reloading its result failed.
        this.storeSnapshotValid = false;
        if (error instanceof CommandStoreUnavailableError) throw error;
        log.error("Command store mutation failed:", error);
        throw new CommandStoreUnavailableError();
      }
    });
  }
}
