import type { RpgArchetype, RpgCharacter, RpgItem, RpgItemStack } from "./types.js";
import { RPG_ARCHETYPES, RPG_ITEMS } from "./rpgContent.js";

export type Rng = () => number;

export const MAX_INVENTORY_SLOTS = 8;
export const MIN_DAMAGE = 1;

/** Deterministic PRNG (mulberry32) so runs and tests replay exactly. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function rollDie(sides: number, rng: Rng): number {
  return 1 + Math.floor(rng() * sides);
}

/** Supports "d6", "2d6", "d10+1". */
export function rollDice(notation: string, rng: Rng): number {
  const match = /^(\d*)d(\d+)(?:\+(\d+))?$/.exec(notation);
  if (!match) return 0;
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const bonus = match[3] ? Number(match[3]) : 0;
  let total = bonus;
  for (let i = 0; i < count; i += 1) total += rollDie(sides, rng);
  return total;
}

export function d20(rng: Rng): number {
  return rollDie(20, rng);
}

export function itemDef(itemId: string): RpgItem | null {
  return RPG_ITEMS[itemId] ?? null;
}

export function effectiveAtk(character: RpgCharacter): number {
  const weapon = character.equipment.weapon ? itemDef(character.equipment.weapon) : null;
  const buff = character.buffs.atk ?? 0;
  return character.atk + (weapon?.bonus ?? 0) + buff;
}

export function effectiveDef(character: RpgCharacter): number {
  const armor = character.equipment.armor ? itemDef(character.equipment.armor) : null;
  return character.def + (armor?.defBonus ?? 0);
}

export function recalcDerived(character: RpgCharacter): RpgCharacter {
  const levelBonus = character.level - 1;
  character.maxHp = 24 + character.stats.vit * 4 + levelBonus * 4;
  character.maxMp = 8 + character.stats.spi * 2 + levelBonus * 2;
  character.atk = 2 + character.stats.str;
  character.def = 1 + character.stats.vit;
  character.agi = 2 + character.stats.agi;
  character.hp = Math.max(0, Math.min(character.hp, character.maxHp));
  character.mp = Math.max(0, Math.min(character.mp, character.maxMp));
  return character;
}

export function createCharacter(
  userId: string,
  name: string,
  archetype: RpgArchetype,
): RpgCharacter {
  const def = RPG_ARCHETYPES[archetype];
  if (!def) throw new Error(`Unknown archetype: ${archetype}`);

  const character: RpgCharacter = {
    userId,
    name,
    archetype,
    level: 1,
    xp: 0,
    stats: { ...def.stats },
    hp: 1,
    maxHp: 1,
    mp: 1,
    maxMp: 1,
    atk: 0,
    def: 0,
    agi: 0,
    inventory: [{ itemId: "ramuan", qty: 2 }],
    equipment: { weapon: def.weapon, armor: def.armor },
    skills: [...def.skills],
    cooldowns: {},
    buffs: {},
    debuffs: [],
    status: "aktif",
  };

  recalcDerived(character);
  character.hp = character.maxHp;
  character.mp = character.maxMp;

  if (!hasItem(character, def.weapon)) addItem(character, def.weapon, 1);
  if (!hasItem(character, def.armor)) addItem(character, def.armor, 1);

  return character;
}

export function hasItem(character: RpgCharacter, itemId: string): boolean {
  return character.inventory.some((stack) => stack.itemId === itemId && stack.qty > 0);
}

export function addItem(
  character: RpgCharacter,
  itemId: string,
  qty = 1,
): boolean {
  if (!itemDef(itemId)) return false;
  const stack = character.inventory.find((entry) => entry.itemId === itemId);
  if (stack) {
    stack.qty += qty;
    return true;
  }
  if (character.inventory.length >= MAX_INVENTORY_SLOTS) return false;
  character.inventory.push({ itemId, qty });
  return true;
}

export function removeItem(
  character: RpgCharacter,
  itemId: string,
  qty = 1,
): boolean {
  const stack = character.inventory.find((entry) => entry.itemId === itemId);
  if (!stack || stack.qty < qty) return false;
  stack.qty -= qty;
  if (stack.qty <= 0) {
    character.inventory = character.inventory.filter((entry) => entry.qty > 0);
  }
  return true;
}

export function itemCount(stacks: RpgItemStack[], itemId: string): number {
  return stacks
    .filter((stack) => stack.itemId === itemId)
    .reduce((total, stack) => total + stack.qty, 0);
}

export function xpToNext(level: number): number {
  return Math.round(100 * level ** 1.4);
}

export function gainXp(
  character: RpgCharacter,
  amount: number,
): { levels: number; xp: number } {
  character.xp += Math.max(0, Math.round(amount));
  let levels = 0;

  while (character.xp >= xpToNext(character.level)) {
    character.xp -= xpToNext(character.level);
    character.level += 1;
    levels += 1;

    // Simple, archetype-flavoured growth; skill picks arrive in M3.
    const primary: keyof typeof character.stats =
      character.archetype === "pendekar"
        ? "str"
        : character.archetype === "dukun"
          ? "spi"
          : "agi";
    character.stats[primary] += 1;
    if (character.level % 2 === 0) character.stats.vit += 1;
  }

  if (levels > 0) {
    recalcDerived(character);
    character.hp = character.maxHp;
    character.mp = character.maxMp;
  }

  return { levels, xp: character.xp };
}

export interface AttackOutcome {
  roll: number;
  total: number;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
}

export function attackRoll(
  attackerAtk: number,
  targetDef: number,
  rng: Rng,
): AttackOutcome {
  const roll = d20(rng);
  const total = roll + attackerAtk;
  const crit = roll === 20;
  const fumble = roll === 1;
  const hit = !fumble && (crit || total >= targetDef + 10);
  return { roll, total, hit, crit, fumble };
}

export function damageFor(
  attackerAtk: number,
  dice: string,
  bonus: number,
  targetDef: number,
  crit: boolean,
  rng: Rng,
): number {
  const raw = rollDice(dice, rng) + bonus + attackerAtk - Math.floor(targetDef / 2);
  const base = Math.max(MIN_DAMAGE, raw);
  return crit ? base * 2 : base;
}

export function checkRoll(
  statValue: number,
  bonus: number,
  dc: number,
  rng: Rng,
): { roll: number; total: number; success: boolean; crit: boolean; fumble: boolean } {
  const roll = d20(rng);
  const total = roll + statValue + bonus;
  return {
    roll,
    total,
    success: roll === 20 || (roll !== 1 && total >= dc),
    crit: roll === 20,
    fumble: roll === 1,
  };
}

export function isAlive(character: RpgCharacter): boolean {
  return character.hp > 0 && character.status === "aktif";
}
