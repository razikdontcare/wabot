import { z } from "zod";
import type { UserRole } from "../../infrastructure/config/config.js";

/** Commands handled directly by `CommandHandler` before the registry is consulted. */
export const CORE_COMMAND_NAMES = ["games", "help", "stop", "stats"] as const;

/** Lowercase command name/alias: starts alphanumeric, then 0-31 word characters. */
export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** WhatsApp text message cap used by this codebase. */
export const MAX_COMMAND_RESPONSE_LENGTH = 4096;

/** Categories an admin-managed custom command may use. */
export const CUSTOM_COMMAND_CATEGORIES = ["general", "utility"] as const;

export type CustomCommandCategory = (typeof CUSTOM_COMMAND_CATEGORIES)[number];

export const COMMAND_ROLES = ["admin", "moderator", "vip"] as const;

const commandNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    COMMAND_NAME_PATTERN,
    "Name must be lowercase letters, numbers, dashes or underscores (max 32 chars, cannot start with a symbol)",
  );

/**
 * A data-only command created from the admin console. Response text is a
 * `{{placeholder}}` template rendered by `renderCommandTemplate`.
 */
export const createCustomCommandSchema = z
  .object({
    name: commandNameSchema,
    aliases: z.array(commandNameSchema).max(5).default([]),
    description: z.string().trim().min(1).max(200),
    helpText: z.string().trim().max(2000).optional(),
    response: z.string().min(1).max(MAX_COMMAND_RESPONSE_LENGTH),
    category: z.enum(CUSTOM_COMMAND_CATEGORIES).default("general"),
    enabled: z.boolean().default(true),
    cooldown: z.number().int().min(0).max(86_400_000).optional(),
    maxUses: z.number().int().min(1).max(1000).optional(),
    vipOnly: z.boolean().optional(),
    requiredRoles: z.array(z.enum(COMMAND_ROLES)).max(3).optional(),
  })
  .strict();

/**
 * Fields an admin may override on a built-in command. Names are immutable and
 * the response body always lives in code.
 */
export const updateBuiltinCommandSchema = z
  .object({
    aliases: z.array(commandNameSchema).max(5).optional(),
    description: z.string().trim().min(1).max(200).optional(),
    helpText: z.string().trim().max(2000).optional(),
    cooldown: z.number().int().min(0).max(86_400_000).optional(),
    maxUses: z.number().int().min(1).max(1000).optional(),
    vipOnly: z.boolean().optional(),
    requiredRoles: z.array(z.enum(COMMAND_ROLES)).max(3).optional(),
    enabled: z.boolean().optional(),
    disabledReason: z.string().trim().max(200).optional(),
  })
  .strict();

/**
 * Partial update for a custom command. Strict so a rename attempt or an
 * unknown key is rejected with a `400` instead of being silently ignored.
 *
 * Declared explicitly (not derived from the create schema) because Zod keeps
 * `.default()` values through `.partial()`, which would let a one-field PATCH
 * overwrite aliases/category/enabled with create-time defaults. Every field is
 * `.optional()` and none has a default.
 */
export const updateCustomCommandSchema = z
  .object({
    aliases: z.array(commandNameSchema).max(5).optional(),
    description: z.string().trim().min(1).max(200).optional(),
    helpText: z.string().trim().max(2000).optional(),
    response: z.string().min(1).max(MAX_COMMAND_RESPONSE_LENGTH).optional(),
    category: z.enum(CUSTOM_COMMAND_CATEGORIES).optional(),
    enabled: z.boolean().optional(),
    cooldown: z.number().int().min(0).max(86_400_000).optional(),
    maxUses: z.number().int().min(1).max(1000).optional(),
    vipOnly: z.boolean().optional(),
    requiredRoles: z.array(z.enum(COMMAND_ROLES)).max(3).optional(),
  })
  .strict();

export type CreateCustomCommandInput = z.input<typeof createCustomCommandSchema>;
export type UpdateCustomCommandInput = z.input<
  typeof updateCustomCommandSchema
>;
export type UpdateBuiltinCommandInput = z.input<
  typeof updateBuiltinCommandSchema
>;

export type BuiltinOverride = z.infer<typeof updateBuiltinCommandSchema>;

export interface CustomCommandDefinition {
  name: string;
  aliases: string[];
  description: string;
  helpText?: string;
  category: CustomCommandCategory;
  response: string;
  enabled: boolean;
  cooldown?: number;
  maxUses?: number;
  vipOnly?: boolean;
  requiredRoles?: UserRole[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

export interface StoredBuiltinOverride extends BuiltinOverride {
  /** `builtin:<name>` */
  _id: string;
  kind: "builtin";
  name: string;
  updatedAt?: Date;
  updatedBy?: string;
}

export interface StoredCustomCommand extends CustomCommandDefinition {
  /** `custom:<name>` */
  _id: string;
  kind: "custom";
}

export type StoredCommandRecord = StoredBuiltinOverride | StoredCustomCommand;
