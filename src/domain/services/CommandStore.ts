import type { StoredCommandRecord } from "../models/CommandDefinition.js";

/**
 * Persistence boundary for merged command records (built-in overrides and
 * custom commands). Tests use an in-memory implementation.
 */
export interface CommandStore {
  list(): Promise<StoredCommandRecord[]>;
  upsert(record: StoredCommandRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  ensureIndexes(): Promise<void>;
}
