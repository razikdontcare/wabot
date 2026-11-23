import type { Collection } from "mongodb";
import type { StoredCommandRecord } from "../../domain/models/CommandDefinition.js";
import type { CommandStore } from "../../domain/services/CommandStore.js";
import { BotConfig, log } from "../../infrastructure/config/config.js";
import { getActiveMongoClient } from "../../infrastructure/config/mongo.js";

const DEFAULT_COLLECTION_NAME = "bot_commands";

/**
 * Mongo-backed command store. Access is lazy through `getActiveMongoClient()`
 * so the registry can be constructed before the bot connects to Mongo.
 */
export class MongoCommandStore implements CommandStore {
  private readonly dbName: string;
  private readonly collectionName: string;

  constructor(
    dbName: string = BotConfig.sessionName,
    collectionName: string = DEFAULT_COLLECTION_NAME,
  ) {
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  private get collection(): Collection<StoredCommandRecord> {
    return getActiveMongoClient()
      .db(this.dbName)
      .collection<StoredCommandRecord>(this.collectionName);
  }

  async list(): Promise<StoredCommandRecord[]> {
    return this.collection.find({}).toArray();
  }

  async upsert(record: StoredCommandRecord): Promise<void> {
    await this.collection.updateOne(
      { _id: record._id },
      { $set: record },
      { upsert: true },
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  async ensureIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ name: 1 }, { unique: true });
    } catch (error) {
      // A pre-existing collection with duplicate names must not crash boot.
      log.warn("Could not ensure unique index on bot_commands.name:", error);
    }
  }
}
