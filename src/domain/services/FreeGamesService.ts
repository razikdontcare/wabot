import { Collection, MongoClient } from "mongodb";
import { BotConfig, log } from "../../infrastructure/config/config.js";

export interface GamerPowerGiveaway {
  id: number;
  title: string;
  worth: string;
  thumbnail: string;
  image: string;
  description: string;
  instructions: string;
  open_giveaway_url: string;
  published_date: string;
  type: string;
  platforms: string;
  end_date: string;
  users: number;
  status: string;
  gamerpower_url: string;
  open_giveaway: string;
}

interface SeenGiveaway {
  giveawayId: number;
  publishedAt: Date;
  firstSeenAt: Date;
}

export class FreeGamesService {
  private static instance: FreeGamesService | null = null;

  private readonly collection: Collection<SeenGiveaway>;

  private readonly apiUrl = "https://www.gamerpower.com/api/giveaways";

  private constructor(mongoClient: MongoClient) {
    this.collection = mongoClient
      .db(BotConfig.sessionName)
      .collection<SeenGiveaway>("freegames_seen");
    this.ensureIndexes().catch((error) => {
      log.error("Failed to initialize FreeGamesService indexes:", error);
    });
  }

  static async getInstance(
    mongoClient?: MongoClient,
  ): Promise<FreeGamesService> {
    if (!FreeGamesService.instance) {
      if (!mongoClient) {
        throw new Error(
          "MongoClient is required for first FreeGamesService initialization",
        );
      }
      FreeGamesService.instance = new FreeGamesService(mongoClient);
    }

    return FreeGamesService.instance;
  }

  async pollNewGiveaways(): Promise<GamerPowerGiveaway[]> {
    const giveaways = await this.fetchGiveaways();
    if (giveaways.length === 0) {
      return [];
    }

    const count = await this.collection.estimatedDocumentCount();
    if (count === 0) {
      await this.seedSeenGiveaways(giveaways);
      log.info(
        `[FreeGamesService] Initial seed completed with ${giveaways.length} giveaway(s)`,
      );
      return [];
    }

    const ids = giveaways
      .map((item) => item.id)
      .filter((item) => Number.isFinite(item));
    const knownIds = await this.collection
      .find({ giveawayId: { $in: ids } })
      .project({ giveawayId: 1, _id: 0 })
      .toArray();

    const knownIdSet = new Set(knownIds.map((item) => item.giveawayId));
    const newGiveaways = giveaways.filter((item) => !knownIdSet.has(item.id));

    if (newGiveaways.length === 0) {
      return [];
    }

    await this.persistSeenGiveaways(newGiveaways);

    return newGiveaways.sort(
      (a, b) =>
        this.parseDate(a.published_date).getTime() -
        this.parseDate(b.published_date).getTime(),
    );
  }

  async getLatestGiveaways(limit = 5): Promise<GamerPowerGiveaway[]> {
    const giveaways = await this.fetchGiveaways();
    return giveaways
      .sort(
        (a, b) =>
          this.parseDate(b.published_date).getTime() -
          this.parseDate(a.published_date).getTime(),
      )
      .slice(0, limit);
  }

  async resolveRedirectLocation(url: string): Promise<string> {
    let currentUrl = url;
    const visited = new Set<string>();

    for (let i = 0; i < 5; i += 1) {
      if (visited.has(currentUrl)) {
        break;
      }

      visited.add(currentUrl);
      const nextUrl = await this.getSingleRedirectLocation(currentUrl);
      if (!nextUrl) {
        return currentUrl;
      }

      currentUrl = nextUrl;
    }

    return currentUrl;
  }

  private async fetchGiveaways(): Promise<GamerPowerGiveaway[]> {
    const response = await fetch(this.apiUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "WhatsApp-FunBot",
      },
    });

    if (!response.ok) {
      throw new Error(
        `GamerPower API returned ${response.status}: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GamerPowerGiveaway[];
    if (!Array.isArray(data)) {
      return [];
    }

    return data.filter((item) => typeof item.id === "number");
  }

  private async getSingleRedirectLocation(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "WhatsApp-FunBot",
        },
        signal: controller.signal,
      });

      if (response.status < 300 || response.status >= 400) {
        return null;
      }

      const location = response.headers.get("location");
      if (!location) {
        return null;
      }

      return new URL(location, url).toString();
    } catch (error) {
      log.warn(`Failed to resolve redirect location for URL: ${url}`, error);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async seedSeenGiveaways(
    giveaways: GamerPowerGiveaway[],
  ): Promise<void> {
    if (giveaways.length === 0) {
      return;
    }

    const now = new Date();
    const docs: SeenGiveaway[] = giveaways.map((item) => ({
      giveawayId: item.id,
      publishedAt: this.parseDate(item.published_date),
      firstSeenAt: now,
    }));

    try {
      await this.collection.insertMany(docs, { ordered: false });
    } catch (error) {
      if (!isDuplicateWriteError(error)) {
        throw error;
      }
    }
  }

  private async persistSeenGiveaways(
    giveaways: GamerPowerGiveaway[],
  ): Promise<void> {
    if (giveaways.length === 0) {
      return;
    }

    const now = new Date();
    const docs: SeenGiveaway[] = giveaways.map((item) => ({
      giveawayId: item.id,
      publishedAt: this.parseDate(item.published_date),
      firstSeenAt: now,
    }));

    try {
      await this.collection.insertMany(docs, { ordered: false });
    } catch (error) {
      if (!isDuplicateWriteError(error)) {
        throw error;
      }
    }
  }

  private parseDate(input: string): Date {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      return new Date();
    }

    return date;
  }

  private async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ giveawayId: 1 }, { unique: true });
    await this.collection.createIndex({ publishedAt: -1 });
  }
}

function isDuplicateWriteError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return "code" in error && error.code === 11000;
}
