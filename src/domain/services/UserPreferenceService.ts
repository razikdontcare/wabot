import { Collection, MongoClient } from "mongodb";
import { BotConfig } from "../../infrastructure/config/config.js";
import type { AIProviderPreference } from "../../infrastructure/config/config.js";

export interface UserPreference {
  user: string; // WhatsApp JID
  language?: string;
  nickname?: string;
  notifications?: boolean;
  customAliases?: Record<string, string>;
  aiProviderPreference?: AIProviderPreference;
}

export class UserPreferenceService {
  private collection: Collection<UserPreference>;

  constructor(
    mongoClient: MongoClient,
    dbName = BotConfig.sessionName,
    collectionName = "user_preferences",
  ) {
    this.collection = mongoClient.db(dbName).collection(collectionName);
  }

  async get(user: string): Promise<UserPreference | null> {
    return this.collection.findOne({ user });
  }

  async set(user: string, data: Partial<UserPreference>): Promise<void> {
    await this.collection.updateOne({ user }, { $set: data }, { upsert: true });
  }

  async getAIProviderPreference(
    user: string,
  ): Promise<AIProviderPreference | null> {
    const preference = await this.get(user);
    const value = preference?.aiProviderPreference;

    if (value === "groq" || value === "google" || value === "auto") {
      return value;
    }

    return null;
  }

  async setAIProviderPreference(
    user: string,
    provider: AIProviderPreference,
  ): Promise<void> {
    await this.set(user, { aiProviderPreference: provider });
  }

  async clearAIProviderPreference(user: string): Promise<void> {
    await this.collection.updateOne(
      { user },
      { $unset: { aiProviderPreference: "" } },
    );
  }
}
