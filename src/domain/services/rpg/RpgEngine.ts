import { randomUUID } from "crypto";
import type {
  RpgArchetype,
  RpgCharacter,
  RpgCombatState,
  RpgDifficulty,
  RpgDirection,
  RpgItemStack,
  RpgRoom,
  RpgRun,
  RpgTurnResult,
  RpgVoteChoice,
  RpgWorldBible,
} from "./types.js";
import {
  RPG_BESTIARY,
  RPG_ENCOUNTER_CHANCE,
  RPG_FALLBACK_BIBLE,
  RPG_ITEMS,
  RPG_LOOT,
  RPG_SKILLS,
  RPG_WORLD,
  buildStaticRooms,
} from "./rpgContent.js";
import {
  addItem,
  attackRoll,
  checkRoll,
  createCharacter,
  damageFor,
  effectiveAtk,
  effectiveDef,
  gainXp,
  hasItem,
  isAlive,
  itemCount,
  itemDef,
  mulberry32,
  recalcDerived,
  removeItem,
  rollDie,
  type Rng,
} from "./rpgRules.js";

export const RPG_TURN_CAP = 400;
const VILLAGE_ID = "balai";

export interface CreateRunOptions {
  jid: string;
  userId: string;
  name: string;
  archetype: RpgArchetype;
  difficulty?: RpgDifficulty;
  world?: RpgWorldBible;
  now?: Date;
}

export function createSoloRun(options: CreateRunOptions): RpgRun {
  const now = options.now ?? new Date();
  const name = options.name.trim().slice(0, 24) || "Pengembara";
  const rooms = buildStaticRooms();
  const hero = createCharacter(options.userId, name, options.archetype);
  const start = rooms.find((room) => room.id === VILLAGE_ID) ?? rooms[0];
  start.visited = true;
  const world = options.world ?? RPG_FALLBACK_BIBLE;

  return {
    runId: randomUUID(),
    mode: "solo",
    jid: options.jid,
    ownerUserId: options.userId,
    status: "active",
    difficulty: options.difficulty ?? "normal",
    worldId: RPG_WORLD.id,
    worldTitle: world.title,
    world,
    act: 1,
    turn: 0,
    phase: "explore",
    locationId: start.id,
    discoveredRooms: [start.id],
    rooms,
    party: [hero],
    shared: { gold: 25, inventory: [] },
    journal: { facts: [], quests: [], npcs: [] },
    flags: [],
    recentScenes: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function hero(run: RpgRun): RpgCharacter {
  return run.party[0];
}

export function currentRoom(run: RpgRun): RpgRoom {
  return roomById(run, run.locationId) ?? run.rooms[0];
}

export function roomById(run: RpgRun, roomId: string): RpgRoom | null {
  return run.rooms.find((room) => room.id === roomId) ?? null;
}

export function hasFlag(run: RpgRun, flag: string): boolean {
  return run.flags.includes(flag);
}

export function setFlag(run: RpgRun, flag: string): void {
  if (!run.flags.includes(flag)) run.flags.push(flag);
}

export function adjacentRoom(
  run: RpgRun,
  direction: RpgDirection,
): RpgRoom | null {
  const room = currentRoom(run);
  const targetId = room.exits[direction];
  return targetId ? roomById(run, targetId) : null;
}

export function roomLockReason(run: RpgRun, room: RpgRoom): string | null {
  if (room.gate && !hasFlag(run, room.gate)) {
    return room.id === "pintu"
      ? "Pintu baja itu terkunci. Lubang kuncinya berbentuk keris—kau butuh kunci dari Makam Tua."
      : "Singgasana masih tertutup. Kau harus membuka pintu baja dulu.";
  }
  return null;
}

type Log = string[];

function touch(run: RpgRun): void {
  run.turn += 1;
  run.updatedAt = new Date();
  if (run.turn >= RPG_TURN_CAP && run.status === "active") {
    run.status = "ended";
  }
}

function headline(run: RpgRun, text: string): void {
  run.recentScenes.push({ turn: run.turn, headline: text });
  if (run.recentScenes.length > 5) run.recentScenes.shift();
}

function addFact(run: RpgRun, fact: string): void {
  if (!run.journal.facts.includes(fact)) run.journal.facts.push(fact);
  if (run.journal.facts.length > 12) run.journal.facts.shift();
}

export function heroCombatAtk(character: RpgCharacter): number {
  const wounded = character.debuffs.some((debuff) => debuff.kind === "luka");
  return Math.max(1, effectiveAtk(character) - (wounded ? 1 : 0));
}

export function tickDebuffs(character: RpgCharacter, log: Log): void {
  for (const debuff of character.debuffs) {
    if (debuff.kind === "poison") {
      character.hp = Math.max(0, character.hp - 2);
      log.push(`☠️ Racun mengalir: −2 HP.`);
    }
    if (debuff.kind === "burn") {
      character.hp = Math.max(0, character.hp - 3);
      log.push(`🔥 Luka bakar: −3 HP.`);
    }
    debuff.turns -= 1;
  }
  character.debuffs = character.debuffs.filter((debuff) => debuff.turns > 0);
}

export function startCombat(run: RpgRun, enemyId: string): RpgCombatState {
  const enemy = RPG_BESTIARY[enemyId];
  if (!enemy) throw new Error(`Unknown enemy: ${enemyId}`);

  const combat: RpgCombatState = {
    enemyId,
    enemyName: enemy.name,
    hp: enemy.hp,
    maxHp: enemy.hp,
    atk: enemy.atk,
    def: enemy.def,
    agi: enemy.agi,
    tier: enemy.tier,
    xp: enemy.xp,
    gold: enemy.gold,
    turn: 0,
    defending: false,
    statuses: {},
  };
  run.combat = combat;
  run.phase = "combat";
  run.status = "combat";
  return combat;
}

function maybeEncounter(run: RpgRun, room: RpgRoom, rng: Rng, log: Log): void {
  if (room.encounterTable.length === 0 || run.combat) return;

  const alreadyCleared = room.encounterTable.every((enemyId) =>
    hasFlag(run, `kill.${enemyId}`),
  );
  if (alreadyCleared) return;

  const chance = RPG_ENCOUNTER_CHANCE[room.kind] ?? 0.3;
  if (room.kind !== "boss" && room.kind !== "miniboss" && rng() > chance) return;

  const alive = room.encounterTable.filter(
    (enemyId) => !hasFlag(run, `kill.${enemyId}`),
  );
  if (alive.length === 0) return;

  const enemyId = alive[Math.floor(rng() * alive.length)];
  const combat = startCombat(run, enemyId);
  log.push(
    `⚔️ *${combat.enemyName}* menghadang! (${combat.hp} HP) — ${RPG_BESTIARY[enemyId].lore}`,
  );
}

export function move(
  run: RpgRun,
  direction: RpgDirection,
  rng: Rng = mulberry32(d20Seed(run)),
): RpgTurnResult {
  const log: Log = [];
  if (run.combat) {
    return { run, lines: ["Kau sedang bertarung. Selesaikan dulu, atau coba kabur."] };
  }

  const target = adjacentRoom(run, direction);
  if (!target) {
    return { run, lines: [`Tidak ada jalan ke ${direction} dari sini.`] };
  }

  const lock = roomLockReason(run, target);
  if (lock) {
    return { run, lines: [lock] };
  }

  run.locationId = target.id;
  target.visited = true;
  if (!run.discoveredRooms.includes(target.id)) {
    run.discoveredRooms.push(target.id);
  }

  log.push(`🚶 Kau berjalan ke ${direction} menuju *${target.name}*.`);
  addFact(run, `Menjelajahi ${target.name}.`);
  headline(run, target.name);
  touch(run);

  maybeEncounter(run, target, rng, log);
  return { run, lines: log };
}

function d20Seed(run: RpgRun): number {
  return (run.turn + 1) * 2654435761;
}

function enemyStrike(run: RpgRun, rng: Rng, log: Log, halve: boolean): void {
  const combat = run.combat;
  const character = hero(run);
  if (!combat || !isAlive(character)) return;

  const enemyAtk = Math.max(1, combat.atk - (combat.atkDebuff?.amount ?? 0));
  const attack = attackRoll(enemyAtk, effectiveDef(character), rng);
  if (!attack.hit) {
    log.push(`🛡️ Serangan ${combat.enemyName} meleset (${attack.total} vs ${effectiveDef(character) + 10}).`);
    return;
  }

  let damage = damageFor(
    enemyAtk,
    "d6",
    0,
    effectiveDef(character),
    attack.crit,
    rng,
  );
  if (halve || combat.defending) damage = Math.max(1, Math.floor(damage / 2));

  character.hp = Math.max(0, character.hp - damage);
  log.push(
    `💥 ${combat.enemyName} menyerang: −${damage} HP (${attack.roll}${attack.crit ? " KRT" : ""}). Sisa ${character.hp}/${character.maxHp}.`,
  );
}

function finishVictory(run: RpgRun, log: Log): void {
  const combat = run.combat;
  const character = hero(run);
  if (!combat) return;

  setFlag(run, `kill.${combat.enemyId}`);
  run.shared.gold += combat.gold;
  const gained = gainXp(character, combat.xp);
  log.push(
    `✅ *${combat.enemyName}* tumbang! +${combat.xp} XP, +${combat.gold} gold.` +
      (gained.levels > 0
        ? `\n⬆️ Naik ke level ${character.level}! HP dan MP dipulihkan.`
        : ""),
  );

  if (currentRoom(run).kind === "miniboss") {
    setFlag(run, "quest.kunci");
    addFact(run, "Kunci keris diambil dari Makam Tua.");
    log.push("🗝️ Kau menemukan *Kunci Keris* di antara nisan.");
  }

  const room = currentRoom(run);
  if (room.kind === "boss") {
    setFlag(run, "quest.selesai");
    run.status = "ended";
    log.push(
      "🏆 Kau mengalahkan penjaga Singgasana dan merebut pusaka kampung. Perjalanan ini selesai.",
    );
  } else {
    run.status = "active";
  }

  run.combat = undefined;
  run.phase = "explore";
  headline(run, `${combat.enemyName} dikalahkan`);
}

function handleDefeat(run: RpgRun, log: Log): void {
  const character = hero(run);
  const lost = Math.floor(run.shared.gold * 0.3);
  run.shared.gold -= lost;
  character.hp = Math.max(1, Math.floor(character.maxHp * 0.5));
  character.debuffs.push({ kind: "luka", turns: 3 });
  character.debuffs = character.debuffs.filter((debuff) => debuff.kind !== "stun");
  run.locationId = VILLAGE_ID;
  run.combat = undefined;
  run.phase = "explore";
  run.discoveredRooms.push(VILLAGE_ID);
  const village = roomById(run, VILLAGE_ID);
  if (village) village.visited = true;

  log.push(
    `💀 Kau tumbang. Kehilangan ${lost} gold, lalu terbangun di Balai Desa dengan luka yang perih.`,
  );
  addFact(run, "Pernah kalah dan diselamatkan warga desa.");

  if (run.difficulty === "hardcore") {
    run.status = "defeated";
    log.push("☠️ Mode hardcore: perjalananmu berakhir di sini.");
  } else {
    run.status = "active";
  }
  headline(run, "Kekalahan");
}

function enemyTurn(run: RpgRun, rng: Rng, log: Log, halvePlayerDamage = false): void {
  const combat = run.combat;
  if (!combat) return;

  combat.turn += 1;
  combat.defending = false;
  tickDebuffs(hero(run), log);

  if (hero(run).hp <= 0) {
    handleDefeat(run, log);
    return;
  }

  if (combat.hp > 0) {
    enemyStrike(run, rng, log, halvePlayerDamage);
  }

  if (combat.atkDebuff) {
    combat.atkDebuff.turns -= 1;
    if (combat.atkDebuff.turns <= 0) {
      log.push(`${combat.enemyName} pulih dari kutukan.`);
      combat.atkDebuff = undefined;
    }
  }

  const character = hero(run);
  if (character.buffs.turns != null) {
    character.buffs.turns -= 1;
    if (character.buffs.turns <= 0) character.buffs = {};
  }
  for (const skillId of Object.keys(character.cooldowns)) {
    character.cooldowns[skillId] = Math.max(0, character.cooldowns[skillId] - 1);
  }

  if (character.hp <= 0 && run.status !== "defeated") {
    handleDefeat(run, log);
  }
}

export type CombatAction =
  | { kind: "attack" }
  | { kind: "defend" }
  | { kind: "flee" }
  | { kind: "skill"; skillId: string }
  | { kind: "useItem"; itemId: string };

export function combatAction(
  run: RpgRun,
  action: CombatAction,
  rng: Rng = mulberry32(d20Seed(run)),
): RpgTurnResult {
  const log: Log = [];
  const combat = run.combat;
  const character = hero(run);

  if (!combat) {
    return { run, lines: ["Tidak ada yang perlu dilawan di sini."] };
  }
  if (!isAlive(character)) {
    handleDefeat(run, log);
    return { run, lines: log };
  }

  const weapon = character.equipment.weapon
    ? itemDef(character.equipment.weapon)
    : null;

  switch (action.kind) {
    case "attack": {
      const attack = attackRoll(heroCombatAtk(character), combat.def, rng);
      if (!attack.hit) {
        log.push(
          attack.fumble
            ? `🎲 1 — kau terpeleset, serangan meleset dan ${combat.enemyName} mendapat celah.`
            : `🎲 ${attack.roll} + ${heroCombatAtk(character)} vs DEF ${combat.def + 10} — meleset.`,
        );
        break;
      }
      const damage = damageFor(
        heroCombatAtk(character),
        weapon?.dice ?? "d4",
        weapon?.bonus ?? 0,
        combat.def,
        attack.crit,
        rng,
      );
      combat.hp = Math.max(0, combat.hp - damage);
      log.push(
        `🎲 ${attack.roll}${attack.crit ? " KRT" : ""} — kau menghantam ${combat.enemyName} untuk ${damage} damage (${combat.hp}/${combat.maxHp}).`,
      );
      break;
    }
    case "defend": {
      combat.defending = true;
      log.push("🛡️ Kau menangkis dan menahan napas.");
      break;
    }
    case "flee": {
      const escape = checkRoll(character.agi, 0, 12 + combat.tier, rng);
      if (escape.success) {
        run.combat = undefined;
        run.phase = "explore";
        run.status = "active";
        log.push(`🏃 Kau berhasil kabur dari ${combat.enemyName}.`);
        touch(run);
        return { run, lines: log };
      }
      log.push(`🎲 ${escape.roll} — gagal kabur, ${combat.enemyName} mengejarmu!`);
      break;
    }
    case "skill": {
      const skill = RPG_SKILLS[action.skillId];
      if (!skill || !character.skills.includes(skill.id)) {
        return { run, lines: ["Kau tidak menguasai jurus itu."] };
      }
      if ((character.cooldowns[skill.id] ?? 0) > 0) {
        return { run, lines: [`${skill.name} belum bisa dipakai.`] };
      }
      if (character.mp < skill.mpCost) {
        return { run, lines: ["MP tidak cukup."] };
      }

      character.mp -= skill.mpCost;
      character.cooldowns[skill.id] = skill.cooldown;
      log.push(`✨ *${skill.name}* — ${skill.desc}`);

      if (skill.kind === "heal") {
        const healed = Math.min(
          character.maxHp - character.hp,
          (skill.power ?? 10) + character.stats.spi,
        );
        character.hp += healed;
        log.push(`❤️ +${healed} HP (${character.hp}/${character.maxHp}).`);
      } else if (skill.kind === "buff_attack") {
        character.buffs = { atk: skill.power ?? 0, turns: 3 };
      } else if (skill.kind === "guard") {
        combat.defending = true;
      } else if (skill.kind === "debuff_enemy") {
        combat.atkDebuff = { amount: skill.power ?? 1, turns: 3 };
      } else if (skill.kind === "reveal") {
        const hidden = currentRoom(run).exits;
        const unknown = Object.values(hidden).filter(
          (roomId): roomId is string =>
            Boolean(roomId) && !run.discoveredRooms.includes(roomId as string),
        );
        if (unknown.length > 0) {
          const room = roomById(run, unknown[0]);
          if (room) {
            run.discoveredRooms.push(room.id);
            log.push(`👁️ Kau merasakan keberadaan *${room.name}*.`);
          }
        } else {
          log.push("👁️ Tidak ada jalan tersembunyi di dekat sini.");
        }
      }
      break;
    }
    case "useItem": {
      const stack = character.inventory.find(
        (entry) => entry.itemId === action.itemId && entry.qty > 0,
      );
      const item = itemDef(action.itemId);
      if (!stack || !item || item.kind !== "consumable") {
        return { run, lines: ["Kau tidak punya benda itu."] };
      }

      removeItem(character, item.id, 1);
      if (item.heal) {
        const healed = Math.min(character.maxHp - character.hp, item.heal);
        character.hp += healed;
        log.push(`🧪 ${item.name}: +${healed} HP (${character.hp}/${character.maxHp}).`);
      }
      if (item.mp) {
        const restored = Math.min(character.maxMp - character.mp, item.mp);
        character.mp += restored;
        log.push(`🌫️ ${item.name}: +${restored} MP.`);
      }
      break;
    }
  }

  if (run.combat && combat.hp <= 0) {
    finishVictory(run, log);
  } else if (run.combat) {
    enemyTurn(run, rng, log);
  }

  if (run.status === "active" || run.status === "combat") {
    touch(run);
  }

  return {
    run,
    lines: log,
    died: hero(run).hp <= 0,
    victory: run.status === "ended",
  };
}

export function examineFeature(
  run: RpgRun,
  featureId: string,
  rng: Rng = mulberry32(d20Seed(run)),
): RpgTurnResult {
  const log: Log = [];
  if (run.combat) {
    return { run, lines: ["Selesaikan pertarungan dulu."] };
  }

  const room = currentRoom(run);
  const feature = room.features.find((entry) => entry.id === featureId);
  if (!feature) return { run, lines: ["Tidak ada yang bisa diperiksa."] };
  if (feature.resolved) return { run, lines: [`${feature.label} sudah kau periksa.`] };

  const character = hero(run);

  switch (feature.kind) {
    case "chest": {
      const lootTable = RPG_LOOT[room.kind] ?? RPG_LOOT.filler;
      const loot = lootTable[Math.floor(rng() * lootTable.length)];
      const gold = 5 + rollDie(6, rng) + run.act * 4;
      run.shared.gold += gold;
      const item = itemDef(loot.itemId);
      const added =
        run.mode === "party"
          ? addSharedItem(run, loot.itemId, loot.qty)
          : addItem(character, loot.itemId, loot.qty);
      log.push(`🎁 ${feature.label}: +${gold} gold${added ? `, ${item?.name} ×${loot.qty}` : " (tas penuh)"}.`);
      break;
    }
    case "altar": {
      addFact(run, `${feature.label} di ${room.name} memancarkan aura tua.`);
      if (feature.id === "nisan") {
        setFlag(run, "quest.altar");
        log.push("🕯️ Ukiran nisan itu menyebut nama Singgasana. Kau mencatatnya di jurnal.");
      } else if (feature.id === "singgasana") {
        log.push("🪑 Singgasana itu dingin, seolah baru ditinggalkan.");
      } else {
        log.push(`🕯️ ${feature.label}: kau menemukan mantra lama yang belum selesai.`);
      }
      break;
    }
    case "npc": {
      addFact(run, "Kakek Marbot meminta pusaka kampung dikembalikan.");
      if (!run.journal.quests.some((quest) => quest.title === "Kembalikan Pusaka")) {
        run.journal.quests.push({
          title: "Kembalikan Pusaka",
          hint: "Telusuri rimba di balik pasar tua, lewati Makam Tua dan Pintu Baja.",
        });
      }
      setFlag(run, "quest.diterima");
      log.push(
        "👴 Kakek Marbot: \"Jangan masuk Singgasana tanpa kunci. Kunci itu disimpan di makam, di bawah nisan yang miring.\"",
      );
      break;
    }
    case "trap": {
      const check = checkRoll(character.stats.agi, 0, 12, rng);
      if (check.success) {
        log.push(`🎲 ${check.roll} + AGI — kau melewati ${feature.label} dengan aman.`);
      } else {
        const damage = rollDie(6, rng) + 2;
        character.hp = Math.max(0, character.hp - damage);
        log.push(`🎲 ${check.roll} — ${feature.label} menyambar: −${damage} HP (${character.hp}/${character.maxHp}).`);
        if (character.hp <= 0) handleDefeat(run, log);
      }
      break;
    }
    case "puzzle": {
      if (feature.id === "pintu") {
        if (!hasFlag(run, "quest.kunci")) {
          log.push("🔒 Pintu baja itu terkunci. Ukiran lubang kuncinya berbentuk keris.");
          return { run, lines: log };
        }
        setFlag(run, "quest.pintu_terbuka");
        log.push("🗝️ Kunci keris masuk sempurna. Pintu baja berderit terbuka—jalan ke Singgasana kini terbuka.");
      } else {
        const check = checkRoll(character.stats.spi, 0, 13, rng);
        if (check.success) {
          run.shared.gold += 15;
          log.push(`🎲 ${check.roll} + SPI — ${feature.label} memberi petunjuk: +15 gold.`);
        } else {
          character.hp = Math.max(0, character.hp - 3);
          log.push(`🎲 ${check.roll} — ${feature.label} membuat kepalamu berdenyut: −3 HP.`);
        }
      }
      break;
    }
  }

  feature.resolved = true;
  touch(run);
  headline(run, `Memeriksa ${feature.label}`);

  if (character.hp <= 0) handleDefeat(run, log);

  return { run, lines: log };
}

export function rest(
  run: RpgRun,
  rng: Rng = mulberry32(d20Seed(run)),
): RpgTurnResult {
  const log: Log = [];
  if (run.combat) return { run, lines: ["Tidak bisa beristirahat di tengah pertarungan."] };

  const character = hero(run);
  const healed = Math.min(character.maxHp - character.hp, rollDie(6, rng) + character.level);
  const mana = Math.min(character.maxMp - character.mp, 2 + Math.floor(character.level / 2));
  character.hp += healed;
  character.mp += mana;
  log.push(`🔥 Kau beristirahat sejenak: +${healed} HP, +${mana} MP.`);

  touch(run);
  headline(run, "Beristirahat");

  const room = currentRoom(run);
  if (room.encounterTable.length > 0 && rng() < 0.2 && !run.combat) {
    log.push("…tapi langkah kaki mendekat.");
    maybeEncounter(run, room, rng, log);
  }

  return { run, lines: log };
}

export function useItemOutsideCombat(
  run: RpgRun,
  itemId: string,
): RpgTurnResult {
  if (run.combat) return combatAction(run, { kind: "useItem", itemId });
  const log: Log = [];
  const character = hero(run);
  const item = itemDef(itemId);
  if (!item || item.kind !== "consumable" || !hasItem(character, itemId)) {
    return { run, lines: ["Kau tidak punya benda itu."] };
  }

  removeItem(character, itemId, 1);
  if (item.heal) {
    const healed = Math.min(character.maxHp - character.hp, item.heal);
    character.hp += healed;
    log.push(`🧪 ${item.name}: +${healed} HP (${character.hp}/${character.maxHp}).`);
  }
  if (item.mp) {
    const restored = Math.min(character.maxMp - character.mp, item.mp);
    character.mp += restored;
    log.push(`🌫️ ${item.name}: +${restored} MP.`);
  }
  touch(run);
  return { run, lines: log };
}

export function endRun(run: RpgRun, status: "ended" | "defeated" = "ended"): RpgTurnResult {
  run.status = status;
  run.combat = undefined;
  run.phase = "explore";
  run.updatedAt = new Date();
  return { run, lines: ["Perjalanan diakhiri. Jurnal dan cerita tetap tersimpan."] };
}

export interface RpgStateDelta {
  hp?: number;
  mp?: number;
  gold?: number;
  xp?: number;
  addItems?: { itemId: string; qty: number }[];
  removeItems?: { itemId: string; qty: number }[];
  setFlags?: string[];
  clearFlags?: string[];
  locationId?: string;
}

export interface DeltaResult {
  ok: boolean;
  notes: string[];
}

const FLAG_PATTERN = /^(quest|room|npc|kill)\./;

/** Validates and applies an AI-proposed state delta (M1). */
export function applyDelta(run: RpgRun, delta: RpgStateDelta): DeltaResult {
  const notes: string[] = [];
  const character = hero(run);

  if (typeof delta.hp === "number") {
    character.hp = Math.max(0, Math.min(character.maxHp, character.hp + Math.trunc(delta.hp)));
    notes.push(`hp ${delta.hp > 0 ? "+" : ""}${delta.hp}`);
  }
  if (typeof delta.mp === "number") {
    character.mp = Math.max(0, Math.min(character.maxMp, character.mp + Math.trunc(delta.mp)));
    notes.push(`mp ${delta.mp > 0 ? "+" : ""}${delta.mp}`);
  }
  if (typeof delta.gold === "number") {
    run.shared.gold = Math.max(0, run.shared.gold + Math.trunc(delta.gold));
    notes.push(`gold ${delta.gold > 0 ? "+" : ""}${delta.gold}`);
  }
  if (typeof delta.xp === "number") {
    const amount = Math.max(0, Math.min(500, Math.trunc(delta.xp)));
    gainXp(character, amount);
    notes.push(`xp +${amount}`);
  }

  for (const item of delta.addItems ?? []) {
    if (!itemDef(item.itemId)) continue;
    const qty = Math.max(1, Math.min(5, Math.trunc(item.qty)));
    if (addItem(character, item.itemId, qty)) notes.push(`+${item.itemId} ×${qty}`);
  }

  for (const item of delta.removeItems ?? []) {
    const qty = Math.max(1, Math.min(5, Math.trunc(item.qty)));
    if (removeItem(character, item.itemId, qty)) notes.push(`−${item.itemId} ×${qty}`);
  }

  for (const flag of delta.setFlags ?? []) {
    if (FLAG_PATTERN.test(flag)) setFlag(run, flag);
  }
  for (const flag of delta.clearFlags ?? []) {
    run.flags = run.flags.filter((entry) => entry !== flag);
  }

  if (delta.locationId) {
    const target = roomById(run, delta.locationId);
    const here = currentRoom(run);
    const reachable = Object.values(here.exits).includes(delta.locationId);
    if (target && reachable && !roomLockReason(run, target)) {
      run.locationId = target.id;
      target.visited = true;
      if (!run.discoveredRooms.includes(target.id)) run.discoveredRooms.push(target.id);
      notes.push(`lokasi ${target.name}`);
    }
  }

  recalcDerived(character);
  run.updatedAt = new Date();
  return { ok: notes.length > 0, notes };
}

export function rollLootForRoom(
  room: RpgRoom,
  rng: Rng,
): { itemId: string; qty: number }[] {
  const table = RPG_LOOT[room.kind] ?? RPG_LOOT.filler;
  const loot = table[Math.floor(rng() * table.length)];
  return loot ? [loot] : [];
}

export function inventorySummary(stacks: RpgItemStack[]): string {
  if (stacks.length === 0) return "_kosong_";
  return stacks
    .map((stack) => `${RPG_ITEMS[stack.itemId]?.name ?? stack.itemId} ×${stack.qty}`)
    .join(", ");
}

export function goldOf(run: RpgRun): number {
  return run.shared.gold;
}

export function itemQty(character: RpgCharacter, itemId: string): number {
  return itemCount(character.inventory, itemId);
}

export function canUseSkill(character: RpgCharacter, skillId: string): boolean {
  const skill = RPG_SKILLS[skillId];
  if (!skill || !character.skills.includes(skillId)) return false;
  return (character.cooldowns[skillId] ?? 0) <= 0 && character.mp >= skill.mpCost;
}

// ---------------------------------------------------------------------------
// Party mode (M2)
// ---------------------------------------------------------------------------

export const PARTY_MAX_MEMBERS = 6;
export const PARTY_VOTE_WINDOW_MS = 45_000;
const SHARED_SLOTS = 8;

export interface PartyJoinOptions {
  userId: string;
  name: string;
  archetype: RpgArchetype;
}

export function createPartyLobby(options: CreateRunOptions): RpgRun {
  const run = createSoloRun(options);
  run.mode = "party";
  run.status = "lobby";
  run.shared = { gold: 25, inventory: [{ itemId: "ramuan", qty: 2 }] };
  run.recentScenes = [];
  return run;
}

export function joinParty(
  run: RpgRun,
  options: PartyJoinOptions,
): { ok: boolean; reason?: string } {
  if (run.mode !== "party") return { ok: false, reason: "Bukan perjalanan party." };
  if (run.status !== "lobby") return { ok: false, reason: "Pendaftaran sudah ditutup." };
  if (run.party.some((member) => member.userId === options.userId)) {
    return { ok: false, reason: "Kau sudah bergabung." };
  }
  if (run.party.length >= PARTY_MAX_MEMBERS) {
    return { ok: false, reason: `Party penuh (${PARTY_MAX_MEMBERS} pemain).` };
  }

  run.party.push(
    createCharacter(
      options.userId,
      options.name.trim().slice(0, 24) || "Pengembara",
      options.archetype,
    ),
  );
  return { ok: true };
}

export function startParty(run: RpgRun): { ok: boolean; reason?: string } {
  if (run.mode !== "party") return { ok: false, reason: "Bukan perjalanan party." };
  if (run.status !== "lobby") return { ok: false, reason: "Party sudah berjalan." };
  if (activeParty(run).length < 2) {
    return { ok: false, reason: "Butuh minimal 2 pemain untuk memulai." };
  }

  run.status = "active";
  run.turn = 0;
  run.phase = "explore";
  run.recentScenes = [];
  return { ok: true };
}

export function leaveParty(
  run: RpgRun,
  userId: string,
): { ok: boolean; ended: boolean; promotedTo?: string } {
  const member = run.party.find((entry) => entry.userId === userId);
  if (!member) return { ok: false, ended: run.status === "ended" };

  if (run.status === "lobby") {
    run.party = run.party.filter((entry) => entry.userId !== userId);
    if (run.ownerUserId === userId) {
      const next = run.party[0];
      if (!next) {
        run.status = "ended";
        return { ok: true, ended: true };
      }
      run.ownerUserId = next.userId;
      return { ok: true, ended: false, promotedTo: next.userId };
    }
    return { ok: true, ended: run.party.length === 0 };
  }

  member.status = "keluar";
  member.hp = 0;

  if (run.ownerUserId === userId) {
    const next = activeParty(run)[0];
    if (next) {
      run.ownerUserId = next.userId;
      if (activeParty(run).length === 0) run.status = "ended";
      return { ok: true, ended: run.status === "ended", promotedTo: next.userId };
    }
  }

  if (activeParty(run).length === 0) {
    run.status = "ended";
    return { ok: true, ended: true };
  }

  return { ok: true, ended: false };
}

export function activeParty(run: RpgRun): RpgCharacter[] {
  return run.party.filter(
    (member) => member.status === "aktif" && member.hp > 0,
  );
}

export function partyBest(run: RpgRun): RpgCharacter | null {
  return [...activeParty(run)].sort(
    (a, b) => effectiveAtk(b) - effectiveAtk(a),
  )[0] ?? null;
}

export function partyWeakest(run: RpgRun): RpgCharacter | null {
  return [...activeParty(run)].sort((a, b) => a.hp - b.hp)[0] ?? null;
}

export function addSharedItem(run: RpgRun, itemId: string, qty = 1): boolean {
  if (!itemDef(itemId)) return false;
  const stack = run.shared.inventory.find((entry) => entry.itemId === itemId);
  if (stack) {
    stack.qty += qty;
    return true;
  }
  if (run.shared.inventory.length >= SHARED_SLOTS) return false;
  run.shared.inventory.push({ itemId, qty });
  return true;
}

export function removeSharedItem(run: RpgRun, itemId: string, qty = 1): boolean {
  const stack = run.shared.inventory.find((entry) => entry.itemId === itemId);
  if (!stack || stack.qty < qty) return false;
  stack.qty -= qty;
  if (stack.qty <= 0) {
    run.shared.inventory = run.shared.inventory.filter((entry) => entry.qty > 0);
  }
  return true;
}

export function sharedItemQty(run: RpgRun, itemId: string): number {
  return itemCount(run.shared.inventory, itemId);
}

export function openVote(
  run: RpgRun,
  choices: { id: string; label: string }[],
  now: Date = new Date(),
): void {
  run.vote = {
    choices: choices.map((choice) => ({ id: choice.id, label: choice.label })),
    ballots: {},
    deadline: now.getTime() + PARTY_VOTE_WINDOW_MS,
  };
}

export function castVote(
  run: RpgRun,
  userId: string,
  choiceId: string,
): { ok: boolean; reason?: string } {
  if (!run.vote) return { ok: false, reason: "Tidak ada pemungutan suara." };
  if (!activeParty(run).some((member) => member.userId === userId)) {
    return { ok: false, reason: "Hanya pemain aktif yang bisa memilih." };
  }
  if (!run.vote.choices.some((choice) => choice.id === choiceId)) {
    return { ok: false, reason: "Pilihan tidak dikenal." };
  }

  run.vote.ballots[userId] = choiceId;
  return { ok: true };
}

export interface VoteResolution {
  due: boolean;
  winner: RpgVoteChoice | null;
  ballots: number;
}

export function resolveVote(
  run: RpgRun,
  now: Date = new Date(),
): VoteResolution {
  const vote = run.vote;
  if (!vote) return { due: false, winner: null, ballots: 0 };

  const voters = activeParty(run).map((member) => member.userId);
  const validBallots = Object.entries(vote.ballots).filter(
    ([userId, choiceId]) =>
      voters.includes(userId) && vote.choices.some((choice) => choice.id === choiceId),
  );

  const counts = new Map<string, number>();
  for (const [, choiceId] of validBallots) {
    counts.set(choiceId, (counts.get(choiceId) ?? 0) + 1);
  }
  const leading = Math.max(0, ...counts.values());
  const needed = Math.floor(voters.length / 2) + 1;

  const allVoted = voters.length > 0 && validBallots.length >= voters.length;
  const earlyMajority = voters.length > 1 && leading >= needed;
  const timedOut = now.getTime() >= vote.deadline;
  if (!allVoted && !earlyMajority && !timedOut) {
    return { due: false, winner: null, ballots: validBallots.length };
  }

  run.vote = undefined;

  if (validBallots.length === 0) {
    return { due: true, winner: null, ballots: 0 };
  }

  let bestChoice: RpgVoteChoice | null = null;
  let bestCount = -1;
  for (const choice of vote.choices) {
    const count = counts.get(choice.id) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestChoice = choice;
    }
  }

  return { due: true, winner: bestChoice, ballots: validBallots.length };
}

function markDowned(run: RpgRun): void {
  for (const member of run.party) {
    if (member.status === "aktif" && member.hp <= 0) {
      member.hp = 0;
      member.status = "pingsan";
    }
  }
}

function tickPartyStatuses(run: RpgRun, log: Log): void {
  for (const member of run.party) {
    if (member.status !== "aktif") continue;
    tickDebuffs(member, log);
    if (member.buffs.turns != null) {
      member.buffs.turns -= 1;
      if (member.buffs.turns <= 0) member.buffs = {};
    }
    for (const skillId of Object.keys(member.cooldowns)) {
      member.cooldowns[skillId] = Math.max(0, member.cooldowns[skillId] - 1);
    }
  }
  markDowned(run);
}

function handlePartyDefeat(run: RpgRun, log: Log): void {
  const lost = Math.floor(run.shared.gold * 0.3);
  run.shared.gold -= lost;
  for (const member of run.party) {
    if (member.status === "keluar") continue;
    member.hp = Math.max(1, Math.floor(member.maxHp * 0.5));
    member.status = "aktif";
    member.debuffs.push({ kind: "luka", turns: 3 });
  }
  run.locationId = VILLAGE_ID;
  run.combat = undefined;
  run.phase = "explore";
  if (!run.discoveredRooms.includes(VILLAGE_ID)) run.discoveredRooms.push(VILLAGE_ID);

  log.push(
    `💀 Party tumbang. Kehilangan ${lost} gold; kalian terbangun di Balai Desa dengan luka.`,
  );
  addFact(run, "Party pernah kalah dan diselamatkan warga desa.");

  if (run.difficulty === "hardcore") {
    run.status = "defeated";
    log.push("☠️ Mode hardcore: perjalanan party berakhir.");
  } else {
    run.status = "active";
  }
  headline(run, "Party kalah");
}

function finishPartyVictory(run: RpgRun, log: Log): void {
  const combat = run.combat;
  if (!combat) return;

  setFlag(run, `kill.${combat.enemyId}`);
  run.shared.gold += combat.gold;

  for (const member of run.party) {
    if (member.status === "pingsan") {
      member.status = "aktif";
      member.hp = 1;
    }
  }

  const xpText: string[] = [];
  for (const member of activeParty(run)) {
    const gained = gainXp(member, combat.xp);
    xpText.push(`${member.name} +${combat.xp} XP${gained.levels > 0 ? ` (Lv ${member.level}!)` : ""}`);
  }

  log.push(
    `✅ *${combat.enemyName}* tumbang! +${combat.gold} gold.\n${xpText.join(" · ")}`,
  );

  if (currentRoom(run).kind === "miniboss") {
    setFlag(run, "quest.kunci");
    addFact(run, "Kunci keris diambil dari Makam Tua.");
    log.push("🗝️ Party menemukan *Kunci Keris* di antara nisan.");
  }

  if (currentRoom(run).kind === "boss") {
    setFlag(run, "quest.selesai");
    run.status = "ended";
    log.push(
      "🏆 Party mengalahkan penjaga Singgasana dan merebut pusaka kampung. Perjalanan selesai.",
    );
  } else {
    run.status = "active";
  }

  run.combat = undefined;
  run.phase = "explore";
  headline(run, `${combat.enemyName} dikalahkan party`);
}

function partyEnemyTurn(run: RpgRun, rng: Rng, log: Log, halve: boolean): void {
  const combat = run.combat;
  if (!combat) return;

  combat.turn += 1;
  combat.defending = false;
  tickPartyStatuses(run, log);

  if (activeParty(run).length === 0) {
    handlePartyDefeat(run, log);
    return;
  }

  if (combat.hp > 0) {
    const target = partyWeakest(run);
    if (target) {
      const enemyAtk = Math.max(1, combat.atk - (combat.atkDebuff?.amount ?? 0));
      const attack = attackRoll(enemyAtk, effectiveDef(target), rng);
      if (!attack.hit) {
        log.push(`🛡️ ${combat.enemyName} menyerang ${target.name}, tapi meleset.`);
      } else {
        let damage = damageFor(
          enemyAtk,
          "d6",
          0,
          effectiveDef(target),
          attack.crit,
          rng,
        );
        if (halve || combat.defending) damage = Math.max(1, Math.floor(damage / 2));
        target.hp = Math.max(0, target.hp - damage);
        log.push(
          `💥 ${combat.enemyName} menghantam ${target.name}: −${damage} HP (${target.hp}/${target.maxHp}).`,
        );
        if (target.hp <= 0) {
          target.status = "pingsan";
          log.push(`😵 ${target.name} tumbang!`);
        }
      }
    }
  }

  if (combat.atkDebuff) {
    combat.atkDebuff.turns -= 1;
    if (combat.atkDebuff.turns <= 0) {
      log.push(`${combat.enemyName} pulih dari kutukan.`);
      combat.atkDebuff = undefined;
    }
  }

  if (activeParty(run).length === 0) handlePartyDefeat(run, log);
}

export function partyCombatAction(
  run: RpgRun,
  action: CombatAction,
  rng: Rng = mulberry32(d20Seed(run)),
): RpgTurnResult {
  const log: Log = [];
  const combat = run.combat;
  if (!combat) return { run, lines: ["Tidak ada yang perlu dilawan."] };
  if (activeParty(run).length === 0) {
    handlePartyDefeat(run, log);
    return { run, lines: log };
  }

  const actor = partyBest(run);
  if (!actor) return { run, lines: ["Tidak ada yang bisa bertarung."] };

  switch (action.kind) {
    case "attack": {
      const weapon = actor.equipment.weapon ? itemDef(actor.equipment.weapon) : null;
      const attack = attackRoll(heroCombatAtk(actor), combat.def, rng);
      if (!attack.hit) {
        log.push(
          attack.fumble
            ? `🎲 1 — ${actor.name} terpeleset; ${combat.enemyName} mendapat celah.`
            : `🎲 ${attack.roll} + ${heroCombatAtk(actor)} vs DEF ${combat.def + 10} — ${actor.name} meleset.`,
        );
      } else {
        const damage = damageFor(
          heroCombatAtk(actor),
          weapon?.dice ?? "d4",
          weapon?.bonus ?? 0,
          combat.def,
          attack.crit,
          rng,
        );
        combat.hp = Math.max(0, combat.hp - damage);
        log.push(
          `🎲 ${attack.roll}${attack.crit ? " KRT" : ""} — ${actor.name} menghantam ${combat.enemyName} untuk ${damage} damage (${combat.hp}/${combat.maxHp}).`,
        );
      }
      break;
    }
    case "defend":
      combat.defending = true;
      log.push(`🛡️ Party menangkis bersama.`);
      break;
    case "flee": {
      const escape = checkRoll(actor.agi, 0, 12 + combat.tier, rng);
      if (escape.success) {
        run.combat = undefined;
        run.phase = "explore";
        run.status = "active";
        log.push(`🏃 Party berhasil kabur dari ${combat.enemyName}.`);
        touch(run);
        return { run, lines: log };
      }
      log.push(`🎲 ${escape.roll} — party gagal kabur!`);
      break;
    }
    case "skill": {
      const skill = RPG_SKILLS[action.skillId];
      const caster = activeParty(run).find(
        (member) =>
          member.skills.includes(action.skillId) &&
          (member.cooldowns[action.skillId] ?? 0) <= 0 &&
          member.mp >= (skill?.mpCost ?? 0),
      );
      if (!skill || !caster) return { run, lines: ["Tidak ada yang bisa memakai jurus itu sekarang."] };

      caster.mp -= skill.mpCost;
      caster.cooldowns[skill.id] = skill.cooldown;
      log.push(`✨ *${skill.name}* — ${caster.name}: ${skill.desc}`);

      if (skill.kind === "heal") {
        const target = partyWeakest(run) ?? caster;
        const healed = Math.min(
          target.maxHp - target.hp,
          (skill.power ?? 10) + caster.stats.spi,
        );
        target.hp += healed;
        log.push(`❤️ ${target.name} +${healed} HP.`);
      } else if (skill.kind === "buff_attack") {
        caster.buffs = { atk: skill.power ?? 0, turns: 3 };
      } else if (skill.kind === "guard") {
        combat.defending = true;
      } else if (skill.kind === "debuff_enemy") {
        combat.atkDebuff = { amount: skill.power ?? 1, turns: 3 };
      } else if (skill.kind === "reveal") {
        const unknown = Object.values(currentRoom(run).exits).filter(
          (roomId): roomId is string =>
            Boolean(roomId) && !run.discoveredRooms.includes(roomId as string),
        );
        const room = unknown[0] ? roomById(run, unknown[0]) : null;
        if (room) {
          run.discoveredRooms.push(room.id);
          log.push(`👁️ ${caster.name} merasakan keberadaan *${room.name}*.`);
        }
      }
      break;
    }
    case "useItem": {
      const item = itemDef(action.itemId);
      if (!item || item.kind !== "consumable" || !removeSharedItem(run, item.id, 1)) {
        return { run, lines: ["Benda itu tidak ada di tas bersama."] };
      }
      const target = partyWeakest(run) ?? actor;
      if (item.heal) {
        const healed = Math.min(target.maxHp - target.hp, item.heal);
        target.hp += healed;
        log.push(`🧪 ${item.name}: ${target.name} +${healed} HP.`);
      }
      if (item.mp) {
        const restored = Math.min(target.maxMp - target.mp, item.mp);
        target.mp += restored;
        log.push(`🌫️ ${item.name}: ${target.name} +${restored} MP.`);
      }
      break;
    }
  }

  if (run.combat && combat.hp <= 0) {
    finishPartyVictory(run, log);
  } else if (run.combat) {
    partyEnemyTurn(run, rng, log, false);
  }

  if (run.status === "active" || run.status === "combat") touch(run);

  return { run, lines: log };
}

export function partyRest(
  run: RpgRun,
  rng: Rng = mulberry32(d20Seed(run)),
): RpgTurnResult {
  if (run.combat) return { run, lines: ["Tidak bisa beristirahat di tengah pertarungan."] };
  const log: Log = [];

  for (const member of activeParty(run)) {
    const healed = Math.min(member.maxHp - member.hp, rollDie(6, rng) + member.level);
    const mana = Math.min(member.maxMp - member.mp, 2 + Math.floor(member.level / 2));
    member.hp += healed;
    member.mp += mana;
  }
  log.push("🔥 Party beristirahat: semua pemain aktif memulihkan HP dan MP.");
  touch(run);
  headline(run, "Party beristirahat");

  const room = currentRoom(run);
  if (room.encounterTable.length > 0 && rng() < 0.2 && !run.combat) {
    log.push("…tapi langkah kaki mendekat.");
    maybeEncounter(run, room, rng, log);
  }

  return { run, lines: log };
}

export function useSharedItemOutsideCombat(
  run: RpgRun,
  itemId: string,
): RpgTurnResult {
  if (run.combat) return partyCombatAction(run, { kind: "useItem", itemId });
  const item = itemDef(itemId);
  const target = partyWeakest(run);
  if (!item || item.kind !== "consumable" || !target || !removeSharedItem(run, itemId, 1)) {
    return { run, lines: ["Benda itu tidak ada di tas bersama."] };
  }

  const log: Log = [];
  if (item.heal) {
    const healed = Math.min(target.maxHp - target.hp, item.heal);
    target.hp += healed;
    log.push(`🧪 ${item.name}: ${target.name} +${healed} HP.`);
  }
  if (item.mp) {
    const restored = Math.min(target.maxMp - target.mp, item.mp);
    target.mp += restored;
    log.push(`🌫️ ${item.name}: ${target.name} +${restored} MP.`);
  }
  touch(run);
  return { run, lines: log };
}

