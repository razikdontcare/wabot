import { Collection, MongoClient } from "mongodb";
import { BotConfig } from "../../infrastructure/config/config.js";

export interface GroupSetting {
  group: string; // WhatsApp group JID
  prefix?: string;
  enabledCommands?: string[];
  welcomeMessage?: string;
  adminOnly?: boolean;
  freeGamesEnabled?: boolean;
  freeGamesEnabledAt?: Date;
  freeGamesEnabledBy?: string;
}

export class GroupSettingService {
  private collection: Collection<GroupSetting>;

  constructor(
    mongoClient: MongoClient,
    dbName = BotConfig.sessionName,
    collectionName = "group_settings",
  ) {
    this.collection = mongoClient.db(dbName).collection(collectionName);
  }

  async get(group: string): Promise<GroupSetting | null> {
    return this.collection.findOne({ group });
  }

  async set(group: string, data: Partial<GroupSetting>): Promise<void> {
    await this.collection.updateOne(
      { group },
      { $set: { group, ...data } },
      { upsert: true },
    );
  }

  async setFreeGamesEnabled(
    group: string,
    enabled: boolean,
    by?: string,
  ): Promise<void> {
    if (enabled) {
      await this.set(group, {
        freeGamesEnabled: true,
        freeGamesEnabledAt: new Date(),
        freeGamesEnabledBy: by,
      });
      return;
    }

    await this.set(group, {
      freeGamesEnabled: false,
    });
  }

  async getFreeGamesEnabledGroups(): Promise<string[]> {
    const groups = await this.collection
      .find({ freeGamesEnabled: true })
      .project({ group: 1 })
      .toArray();
    return groups.map((item) => item.group);
  }
}
