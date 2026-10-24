import { describe, expect, it } from "bun:test";
import {
  activeParty,
  applyDelta,
  castVote,
  combatAction,
  createPartyLobby,
  createSoloRun,
  currentRoom,
  examineFeature,
  hero,
  joinParty,
  leaveParty,
  move,
  openVote,
  partyCombatAction,
  partyRest,
  resolveVote,
  rest,
  startCombat,
  startParty,
} from "../src/domain/services/rpg/RpgEngine.js";
import {
  addItem,
  attackRoll,
  damageFor,
  gainXp,
  mulberry32,
  removeItem,
  rollDice,
  xpToNext,
} from "../src/domain/services/rpg/rpgRules.js";
import type { Rng } from "../src/domain/services/rpg/rpgRules.js";

const ONES: Rng = () => 0.999;
const ZEROS: Rng = () => 0;

function newRun(difficulty: "normal" | "hardcore" = "normal") {
  return createSoloRun({
    jid: "group@g.us",
    userId: "user@s.whatsapp.net",
    name: "Budi",
    archetype: "pendekar",
    difficulty,
    now: new Date("2026-10-24T12:00:00Z"),
  });
}

describe("rpg rules", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const left = [a(), a(), a()];
    const right = [b(), b(), b()];
    expect(left).toEqual(right);
  });

  it("rolls within bounds", () => {
    for (let i = 0; i < 50; i += 1) {
      const value = rollDice("2d6+1", mulberry32(i));
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(13);
    }
  });

  it("treats nat 20 as a critical hit and nat 1 as a fumble", () => {
    const crit = attackRoll(3, 5, ONES);
    expect(crit.crit).toBe(true);
    expect(crit.hit).toBe(true);

    const fumble = attackRoll(3, 5, ZEROS);
    expect(fumble.fumble).toBe(true);
    expect(fumble.hit).toBe(false);
  });

  it("never deals less than 1 damage", () => {
    const damage = damageFor(1, "d4", 0, 99, false, ZEROS);
    expect(damage).toBe(1);
  });

  it("levels up and refunds HP/MP", () => {
    const run = newRun();
    const character = hero(run);
    character.hp = 5;
    const result = gainXp(character, xpToNext(1) + 10);
    expect(result.levels).toBeGreaterThanOrEqual(1);
    expect(character.level).toBeGreaterThanOrEqual(2);
    expect(character.hp).toBe(character.maxHp);
  });

  it("respects inventory slots and quantities", () => {
    const run = newRun();
    const character = hero(run);
    expect(addItem(character, "ramuan", 2)).toBe(true);
    expect(character.inventory.find((s) => s.itemId === "ramuan")?.qty).toBe(4);
    expect(removeItem(character, "ramuan", 10)).toBe(false);
    expect(removeItem(character, "ramuan", 1)).toBe(true);
  });
});

describe("rpg party", () => {
  function lobby() {
    const run = createPartyLobby({
      jid: "group@g.us",
      userId: "a@s.whatsapp.net",
      name: "Ayu",
      archetype: "pendekar",
      now: new Date("2026-10-24T12:00:00Z"),
    });
    joinParty(run, { userId: "b@s.whatsapp.net", name: "Budi", archetype: "dukun" });
    return run;
  }

  it("opens a lobby, joins a second player, and starts", () => {
    const run = lobby();
    expect(run.status).toBe("lobby");
    expect(run.party.length).toBe(2);
    expect(startParty(run).ok).toBe(true);
    expect(run.status).toBe("active");
    expect(activeParty(run).length).toBe(2);
  });

  it("refuses to start with a single player", () => {
    const run = createPartyLobby({
      jid: "group@g.us",
      userId: "a@s.whatsapp.net",
      name: "Ayu",
      archetype: "pendekar",
    });
    const result = startParty(run);
    expect(result.ok).toBe(false);
    expect(run.status).toBe("lobby");
  });

  it("counts a majority and breaks ties by choice order", () => {
    const run = lobby();
    startParty(run);
    openVote(run, [{ id: "a", label: "A" }, { id: "b", label: "B" }], new Date(0));
    castVote(run, "a@s.whatsapp.net", "a");
    castVote(run, "b@s.whatsapp.net", "b");

    const tied = resolveVote(run, new Date(60_000));
    expect(tied.due).toBe(true);
    expect(tied.winner?.id).toBe("a");
  });

  it("resolves early once a strict majority is reached", () => {
    const run = lobby();
    joinParty(run, { userId: "c@s.whatsapp.net", name: "Citra", archetype: "penjelajah" });
    startParty(run);
    openVote(run, [{ id: "a", label: "A" }, { id: "b", label: "B" }], new Date(0));
    castVote(run, "a@s.whatsapp.net", "a");
    castVote(run, "b@s.whatsapp.net", "a");

    const early = resolveVote(run, new Date(1_000));
    expect(early.due).toBe(true);
    expect(early.winner?.id).toBe("a");
  });

  it("times out with no votes and clears the ballot", () => {
    const run = lobby();
    startParty(run);
    openVote(run, [{ id: "a", label: "A" }], new Date(0));
    const resolution = resolveVote(run, new Date(60_000));
    expect(resolution.due).toBe(true);
    expect(resolution.winner).toBeNull();
    expect(run.vote).toBeUndefined();
  });

  it("awards party combat rewards to every active member", () => {
    const run = lobby();
    startParty(run);
    const goldBefore = run.shared.gold;
    startCombat(run, "tuyul");

    const result = partyCombatAction(run, { kind: "attack" }, ONES);
    expect(result.victory).toBe(false);
    expect(run.combat).toBeUndefined();
    expect(run.shared.gold).toBe(goldBefore + 8);
    expect(hero(run).xp).toBe(12);
    expect(run.party[1].xp).toBe(12);
  });

  it("rests the whole party", () => {
    const run = lobby();
    startParty(run);
    for (const member of run.party) member.hp = 3;
    partyRest(run, () => 0.99);
    expect(run.party.every((member) => member.hp > 3)).toBe(true);
  });

  it("migrates ownership when the owner leaves", () => {
    const run = lobby();
    startParty(run);
    const result = leaveParty(run, "a@s.whatsapp.net");
    expect(result.promotedTo).toBe("b@s.whatsapp.net");
    expect(run.ownerUserId).toBe("b@s.whatsapp.net");
  });
});

describe("rpg engine", () => {
  it("creates a run at the village with a full-health hero", () => {
    const run = newRun();
    expect(run.status).toBe("active");
    expect(run.turn).toBe(0);
    expect(currentRoom(run).id).toBe("balai");
    expect(hero(run).hp).toBe(hero(run).maxHp);
    expect(run.shared.gold).toBe(25);
  });

  it("moves between rooms and reveals them", () => {
    const run = newRun();
    const result = move(run, "timur", () => 0.99);
    expect(currentRoom(run).id).toBe("pasar");
    expect(run.discoveredRooms).toContain("pasar");
    expect(run.turn).toBe(1);
    expect(result.lines.join(" ")).toContain("Pasar Tua");
  });

  it("refuses to enter a gated room without the key", () => {
    const run = newRun();
    run.locationId = "batu";
    run.discoveredRooms.push("batu");
    const result = move(run, "timur", () => 0.99);
    expect(currentRoom(run).id).toBe("batu");
    expect(result.lines.join(" ").toLowerCase()).toContain("terkunci");
  });

  it("opens the gate after the key flag is set", () => {
    const run = newRun();
    run.locationId = "batu";
    run.flags.push("quest.kunci");
    move(run, "timur", () => 0.99);
    expect(currentRoom(run).id).toBe("pintu");
  });

  it("loots a chest exactly once", () => {
    const run = newRun();
    run.locationId = "pasar";
    const goldBefore = run.shared.gold;

    const first = examineFeature(run, "gerobak", ONES);
    expect(first.lines.join(" ")).toContain("gold");
    expect(run.shared.gold).toBeGreaterThan(goldBefore);
    expect(run.rooms.find((r) => r.id === "pasar")?.features[0].resolved).toBe(true);

    const goldAfter = run.shared.gold;
    const second = examineFeature(run, "gerobak", ONES);
    expect(second.lines.join(" ")).toContain("sudah");
    expect(run.shared.gold).toBe(goldAfter);
  });

  it("wins a fight, awards gold/xp, and clears combat", () => {
    const run = newRun();
    startCombat(run, "tuyul");
    const goldBefore = run.shared.gold;
    const xpBefore = hero(run).xp;

    const result = combatAction(run, { kind: "attack" }, ONES);
    expect(result.victory).toBe(false);
    expect(run.combat).toBeUndefined();
    expect(run.shared.gold).toBe(goldBefore + 8);
    expect(hero(run).xp).toBe(xpBefore + 12);
    expect(run.flags).toContain("kill.tuyul");
  });

  it("defeats the hero, relocates to the village, and keeps the run alive", () => {
    const run = newRun();
    hero(run).hp = 1;
    run.shared.gold = 100;
    startCombat(run, "buto_ijo");

    combatAction(run, { kind: "attack" }, ONES);

    expect(hero(run).hp).toBeGreaterThan(0);
    expect(run.locationId).toBe("balai");
    expect(run.status).toBe("active");
    expect(run.shared.gold).toBe(70);
    expect(hero(run).debuffs.some((d) => d.kind === "luka")).toBe(true);
  });

  it("ends the run permanently in hardcore mode on defeat", () => {
    const run = newRun("hardcore");
    hero(run).hp = 1;
    startCombat(run, "buto_ijo");
    combatAction(run, { kind: "attack" }, ONES);
    expect(run.status).toBe("defeated");
  });

  it("rests without exceeding max HP/MP", () => {
    const run = newRun();
    hero(run).hp = hero(run).maxHp - 3;
    hero(run).mp = hero(run).maxMp;
    rest(run, () => 0.99);
    expect(hero(run).hp).toBe(hero(run).maxHp);
    expect(hero(run).mp).toBe(hero(run).maxMp);
  });

  it("applies deltas with clamps and rejects invalid writes", () => {
    const run = newRun();
    hero(run).hp = 10;

    applyDelta(run, { hp: 999, gold: -9999, xp: 900 });
    expect(hero(run).hp).toBe(hero(run).maxHp);
    expect(run.shared.gold).toBe(0);

    applyDelta(run, {
      addItems: [{ itemId: "tidak_ada", qty: 3 }],
      setFlags: ["bukan.flag", "quest.valid"],
      locationId: "singgasana",
    });
    expect(run.flags).toContain("quest.valid");
    expect(run.flags).not.toContain("bukan.flag");
    expect(run.locationId).toBe("balai");
    expect(hero(run).inventory.some((s) => s.itemId === "tidak_ada")).toBe(false);
  });
});
