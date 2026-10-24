import type { Collection } from "mongodb";
import { BotConfig } from "../../../infrastructure/config/config.js";
import { getActiveMongoClient } from "../../../infrastructure/config/mongo.js";
import { RPG_FALLBACK_BIBLE } from "./rpgContent.js";
import type { RpgRun, RpgRunStatus } from "./types.js";

type RpgRunDoc = RpgRun & { _id: string };

const ACTIVE_STATUSES: RpgRunStatus[] = ["lobby", "active", "combat"];

function toRun(doc: RpgRunDoc | null): RpgRun | null {
  if (!doc) return null;
  const { _id, ...run } = doc;
  // Tolerate documents written before M1 (no world bible / flags yet).
  return {
    ...run,
    runId: run.runId || String(_id),
    world: run.world ?? RPG_FALLBACK_BIBLE,
    flags: Array.isArray(run.flags) ? run.flags : [],
  };
}

/** Drops BSON-incompatible `undefined` members before a write. */
function toDoc(run: RpgRun): RpgRunDoc {
  const doc: Record<string, unknown> = { _id: run.runId };
  for (const [key, value] of Object.entries(run)) {
    if (value !== undefined) doc[key] = value;
  }
  return doc as unknown as RpgRunDoc;
}

/**
 * MongoDB persistence for RPG runs. One document per run, keyed by runId.
 * Engine state is plain JSON, so the document is the state.
 */
export class RpgRunService {
  private dbName: string;
  private collectionName: string;

  constructor(dbName = BotConfig.sessionName, collectionName = "rpg_runs") {
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  private get collection(): Collection<RpgRunDoc> {
    return getActiveMongoClient()
      .db(this.dbName)
      .collection<RpgRunDoc>(this.collectionName);
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { jid: 1, ownerUserId: 1, mode: 1, status: 1 },
      { name: "rpg_active_lookup" },
    );
    await this.collection.createIndex({ updatedAt: 1 }, { name: "rpg_updated" });
  }

  async findActiveSolo(jid: string, userId: string): Promise<RpgRun | null> {
    const doc = await this.collection.findOne(
      { jid, ownerUserId: userId, mode: "solo", status: { $in: ACTIVE_STATUSES } },
      { sort: { updatedAt: -1 } },
    );
    return toRun(doc);
  }

  async findActiveParty(jid: string): Promise<RpgRun | null> {
    const doc = await this.collection.findOne(
      { jid, mode: "party", status: { $in: ACTIVE_STATUSES } },
      { sort: { updatedAt: -1 } },
    );
    return toRun(doc);
  }

  async get(runId: string): Promise<RpgRun | null> {
    const doc = await this.collection.findOne({ _id: runId });
    return toRun(doc);
  }

  async create(run: RpgRun): Promise<void> {
    await this.collection.insertOne(toDoc(run));
  }

  async save(run: RpgRun): Promise<void> {
    run.updatedAt = new Date();
    // Replace the whole document: clears stale `vote`/`combat` keys instead of
    // leaving them behind (an expired ballot must not survive), and avoids
    // writing BSON `undefined`.
    const { _id: _ignored, ...fields } = toDoc(run);
    void _ignored;
    await this.collection.replaceOne({ _id: run.runId }, fields, { upsert: true });
  }

  async listStale(days: number, now = new Date()): Promise<RpgRun[]> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const docs = await this.collection
      .find({ status: { $in: ACTIVE_STATUSES }, updatedAt: { $lt: cutoff } })
      .limit(200)
      .toArray();
    return docs.map((doc) => toRun(doc)).filter((run): run is RpgRun => run !== null);
  }

  async archiveStale(days: number): Promise<number> {
    const stale = await this.listStale(days);
    for (const run of stale) {
      await this.collection.updateOne(
        { _id: run.runId },
        { $set: { status: "ended", updatedAt: new Date() } },
      );
    }
    return stale.length;
  }
}
