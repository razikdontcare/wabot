/**
 * Shared types for the text RPG (see docs/TEXT_RPG_DESIGN.md).
 * Engine state is plain JSON so it can be stored in MongoDB as-is.
 */

export type RpgMode = "solo" | "party";

export type RpgRunStatus =
  | "lobby"
  | "active"
  | "combat"
  | "paused"
  | "ended"
  | "defeated";

export type RpgDifficulty = "normal" | "hardcore";

export type RpgArchetype = "pendekar" | "dukun" | "penjelajah";

export type RpgRoomKind = "village" | "filler" | "secret" | "miniboss" | "boss";

export type RpgRoomGlyph =
  | "village"
  | "houses"
  | "tents"
  | "cave"
  | "altar"
  | "stones"
  | "skull"
  | "swamp"
  | "temple";

export type RpgDirection = "utara" | "selatan" | "timur" | "barat";

export interface RpgStats {
  str: number;
  vit: number;
  agi: number;
  spi: number;
}

export type RpgItemKind = "consumable" | "weapon" | "armor" | "quest" | "material";

export interface RpgItem {
  id: string;
  name: string;
  kind: RpgItemKind;
  desc: string;
  value: number;
  dice?: string;
  bonus?: number;
  defBonus?: number;
  heal?: number;
  mp?: number;
}

export interface RpgSkill {
  id: string;
  name: string;
  desc: string;
  mpCost: number;
  cooldown: number;
  kind: "heal" | "buff_attack" | "debuff_enemy" | "reveal" | "guard";
  power?: number;
}

export interface RpgArchetypeDef {
  id: RpgArchetype;
  name: string;
  desc: string;
  stats: RpgStats;
  skills: string[];
  weapon: string;
  armor: string;
}

export interface RpgBestiaryEntry {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  hp: number;
  atk: number;
  def: number;
  agi: number;
  xp: number;
  gold: number;
  lore: string;
}

export type RpgDebuffKind = "poison" | "burn" | "stun" | "luka";

export interface RpgDebuff {
  kind: RpgDebuffKind;
  turns: number;
}

export interface RpgItemStack {
  itemId: string;
  qty: number;
}

export type RpgCharacterStatus = "aktif" | "pingsan" | "keluar";

export interface RpgCharacter {
  userId: string;
  name: string;
  archetype: RpgArchetype;
  level: number;
  xp: number;
  stats: RpgStats;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  atk: number;
  def: number;
  agi: number;
  inventory: RpgItemStack[];
  equipment: { weapon?: string; armor?: string };
  skills: string[];
  cooldowns: Record<string, number>;
  buffs: { atk?: number; turns?: number };
  debuffs: RpgDebuff[];
  status: RpgCharacterStatus;
}

export interface RpgRoomFeature {
  id: string;
  kind: "chest" | "altar" | "npc" | "trap" | "puzzle";
  label: string;
  resolved: boolean;
}

export interface RpgRoom {
  id: string;
  name: string;
  kind: RpgRoomKind;
  glyph: RpgRoomGlyph;
  pos: { x: number; y: number };
  exits: Partial<Record<RpgDirection, string>>;
  features: RpgRoomFeature[];
  encounterTable: string[];
  descriptions: string[];
  visited: boolean;
  gate?: string;
}

export interface RpgJournal {
  facts: string[];
  quests: { title: string; hint: string }[];
  npcs: { name: string; relation: string }[];
}

export interface RpgWorldBible {
  title: string;
  region: string;
  premise: string;
  tone: "mistis" | "petualangan" | "kelam";
  factions: { name: string; motive: string }[];
  npcs: { name: string; role: string }[];
}

export interface RpgCombatState {
  enemyId: string;
  enemyName: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  agi: number;
  tier: 1 | 2 | 3;
  xp: number;
  gold: number;
  turn: number;
  defending: boolean;
  atkDebuff?: { amount: number; turns: number };
  statuses: Record<string, number>;
}

export interface RpgVoteChoice {
  id: string;
  label: string;
}

export interface RpgVoteState {
  choices: RpgVoteChoice[];
  ballots: Record<string, string>;
  deadline: number;
}

export interface RpgRecentScene {
  turn: number;
  headline: string;
}

export interface RpgRun {
  runId: string;
  mode: RpgMode;
  jid: string;
  ownerUserId: string;
  status: RpgRunStatus;
  difficulty: RpgDifficulty;
  worldId: string;
  worldTitle: string;
  world: RpgWorldBible;
  act: number;
  turn: number;
  phase: "explore" | "combat" | "dialogue";
  locationId: string;
  discoveredRooms: string[];
  rooms: RpgRoom[];
  party: RpgCharacter[];
  shared: { gold: number; inventory: RpgItemStack[] };
  journal: RpgJournal;
  flags: string[];
  recentScenes: RpgRecentScene[];
  combat?: RpgCombatState;
  vote?: RpgVoteState;
  lastProcessedMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RpgChoice {
  id: string;
  label: string;
  action:
    | { kind: "move"; direction: RpgDirection }
    | { kind: "examine"; featureId: string }
    | { kind: "rest" }
    | { kind: "attack" }
    | { kind: "defend" }
    | { kind: "flee" }
    | { kind: "skill"; skillId: string }
    | { kind: "useItem"; itemId: string };
}

export interface RpgTurnResult {
  run: RpgRun;
  lines: string[];
  died?: boolean;
  victory?: boolean;
}
