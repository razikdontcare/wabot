import {
  getMongoClient,
  closeMongoClient,
} from "../infrastructure/config/mongo.js";
import { FreeGamesService } from "../domain/services/FreeGamesService.js";
import { log, BotConfig } from "../infrastructure/config/config.js";
import type { MongoClient } from "mongodb";

(async function main() {
  try {
    const client = await getMongoClient();
    const freeGamesService = await FreeGamesService.getInstance(client);

    log.info("[scripts/testFreeGames] Running pollNewGiveaways() for test...");

    const giveaways = await freeGamesService.pollNewGiveaways({
      bootstrapIfEmpty: true,
      bootstrapLimit: 5,
    });

    log.info(
      `[scripts/testFreeGames] pollNewGiveaways returned ${giveaways.length} item(s)`,
    );
    // Print compact summary to stdout for quick inspection
    for (const g of giveaways) {
      console.log(
        `- id=${g.id} title=${g.title} published=${g.published_date}`,
      );
    }

    // Also output full JSON when run interactively
    if (giveaways.length > 0) {
      console.log("\nFull JSON output:");
      console.log(JSON.stringify(giveaways, null, 2));
    }

    // Also query DB directly to inspect seen giveaways
    const db = client.db(BotConfig.sessionName);
    const seenColl = db.collection("freegames_seen");
    const seenCount = await seenColl.countDocuments();
    const latestSeen = await seenColl
      .find()
      .sort({ publishedAt: -1 })
      .limit(1)
      .toArray();

    log.info(`[scripts/testFreeGames] DB has ${seenCount} seen giveaway(s)`);
    if (latestSeen.length > 0) {
      log.info(
        `[scripts/testFreeGames] Latest stored publishedAt=${latestSeen[0].publishedAt.toISOString()}`,
      );
    }

    // Print top 10 fetched giveaways and whether each id exists in DB
    const sample = giveaways.slice(0, 10);
    console.log("\nTop fetched giveaways (showing up to 10):");
    for (const g of sample) {
      const exists = await seenColl.findOne({ giveawayId: g.id });
      const stored = exists
        ? {
            giveawayId: exists.giveawayId,
            publishedAt: exists.publishedAt,
            firstSeenAt: exists.firstSeenAt,
          }
        : null;
      console.log(
        `- id=${g.id} published=${g.published_date} known=${exists ? "YES" : "NO"} title=${g.title}`,
      );
      if (stored) {
        console.log(`  stored: ${JSON.stringify(stored)}`);
      }
    }

    // Check which fetched ids are missing in DB (if any)
    const fetchedIds = giveaways.map((g) => g.id);
    const seenDocs = await seenColl
      .find({ giveawayId: { $in: fetchedIds } })
      .project({ giveawayId: 1, _id: 0 })
      .toArray();
    const seenIdSet = new Set(seenDocs.map((d) => d.giveawayId));
    const unknownIds = fetchedIds.filter((id) => !seenIdSet.has(id));
    console.log(`\nUnknown ids among fetched: ${unknownIds.length}`);
    if (unknownIds.length > 0) {
      console.log(unknownIds.slice(0, 20).join(","));
    }

    // Inspect DB entry for giveawayId 3272 explicitly
    try {
      const inspectId = 3272;
      const doc3272 = await seenColl.findOne({ giveawayId: inspectId });
      if (doc3272) {
        console.log(`\nDB record for giveawayId=${inspectId}:`);
        console.log(
          JSON.stringify(
            {
              giveawayId: doc3272.giveawayId,
              publishedAt: doc3272.publishedAt,
              firstSeenAt: doc3272.firstSeenAt,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(`\nNo DB record found for giveawayId=3272`);
      }
    } catch (err) {
      console.log(`\nFailed to inspect DB for id=3272: ${String(err)}`);
    }

    // Find fetched giveaways with published_date newer than latest stored publishedAt
    if (latestSeen.length > 0) {
      const latestDate = new Date(latestSeen[0].publishedAt);
      const newer = giveaways.filter((g) => {
        const pd = new Date(g.published_date);
        return !Number.isNaN(pd.getTime()) && pd > latestDate;
      });
      console.log(
        `\nFetched items with published_date > latest stored: ${newer.length}`,
      );
      for (const g of newer.slice(0, 10)) {
        console.log(
          `- id=${g.id} published=${g.published_date} title=${g.title}`,
        );
      }
    }

    if (giveaways.length > 0) {
      console.log("\nFull JSON output:");
      console.log(JSON.stringify(giveaways, null, 2));
    }
  } catch (error) {
    log.error("[scripts/testFreeGames] Error:", error);
    process.exitCode = 1;
  } finally {
    await closeMongoClient().catch(() => {});
  }
})();
