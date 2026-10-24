import type { RpgChoice, RpgDirection, RpgRoom, RpgRun } from "./types.js";
import {
  canUseSkill,
  currentRoom,
  hero,
  heroCombatAtk,
  roomById,
  roomLockReason,
} from "./RpgEngine.js";
import { RPG_ITEMS, RPG_SKILLS, RPG_WORLD } from "./rpgContent.js";
import { effectiveDef, itemDef, xpToNext } from "./rpgRules.js";

const DIRECTION_LABEL: Record<RpgDirection, string> = {
  utara: "Utara",
  selatan: "Selatan",
  timur: "Timur",
  barat: "Barat",
};

const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];

export function directionLabel(direction: RpgDirection): string {
  return DIRECTION_LABEL[direction];
}

function exitChoices(run: RpgRun, room: RpgRoom): RpgChoice[] {
  return (Object.keys(room.exits) as RpgDirection[]).map((direction) => {
    const targetId = room.exits[direction];
    const target = targetId ? roomById(run, targetId) : null;
    const known = target ? run.discoveredRooms.includes(target.id) || target.visited : false;
    const locked = target ? Boolean(roomLockReason(run, target)) : false;
    return {
      id: `move:${direction}`,
      label: `${DIRECTION_LABEL[direction]} → ${
        locked ? "terkunci" : known && target ? target.name : "jalan belum diketahui"
      }`,
      action: { kind: "move", direction },
    };
  });
}

function featureChoices(room: RpgRoom): RpgChoice[] {
  return room.features
    .filter((feature) => !feature.resolved)
    .map((feature) => ({
      id: `examine:${feature.id}`,
      label: `Periksa ${feature.label}`,
      action: { kind: "examine", featureId: feature.id },
    }));
}

export function buildChoices(run: RpgRun): RpgChoice[] {
  if (run.combat) {
    const combat = run.combat;
    const choices: RpgChoice[] = [
      { id: "attack", label: `Serang ${combat.enemyName}`, action: { kind: "attack" } },
      { id: "defend", label: "Bertahan & tangkis", action: { kind: "defend" } },
    ];

    const casters =
      run.mode === "party"
        ? run.party.filter((member) => member.status === "aktif" && member.hp > 0)
        : [hero(run)];
    const skillIds = new Set<string>();
    for (const member of casters) {
      for (const skillId of member.skills) {
        if (canUseSkill(member, skillId)) skillIds.add(skillId);
      }
    }
    for (const skillId of skillIds) {
      const skill = RPG_SKILLS[skillId];
      if (!skill) continue;
      choices.push({
        id: `skill:${skillId}`,
        label: `Jurus ${skill.name} (${skill.mpCost} MP)`,
        action: { kind: "skill", skillId },
      });
    }

    const stacks = run.mode === "party" ? run.shared.inventory : hero(run).inventory;
    const potion = stacks.find((stack) => {
      const item = itemDef(stack.itemId);
      return item?.kind === "consumable" && stack.qty > 0;
    });
    if (potion) {
      choices.push({
        id: `use:${potion.itemId}`,
        label: `Pakai ${RPG_ITEMS[potion.itemId]?.name ?? potion.itemId}`,
        action: { kind: "useItem", itemId: potion.itemId },
      });
    }

    choices.push({ id: "flee", label: "Coba kabur", action: { kind: "flee" } });
    return choices.slice(0, 6);
  }

  const room = currentRoom(run);
  const choices = [...featureChoices(room), ...exitChoices(run, room)];
  choices.push({ id: "rest", label: "Istirahat sejenak", action: { kind: "rest" } });
  return choices.slice(0, 6);
}

function statLine(run: RpgRun): string {
  if (run.mode === "party") {
    const members = run.party.filter((member) => member.status !== "keluar");
    const hp = members.reduce((total, member) => total + member.hp, 0);
    const maxHp = members.reduce((total, member) => total + member.maxHp, 0);
    return `👥 ${members.length} pemain · ❤️ ${hp}/${maxHp} · 💰 ${run.shared.gold}`;
  }
  const character = hero(run);
  return `❤️ ${character.hp}/${character.maxHp} · 💧 ${character.mp}/${character.maxMp} · 💰 ${run.shared.gold}`;
}

function choiceBlock(choices: RpgChoice[]): string {
  return choices
    .map((choice, index) => `${NUMBER_EMOJI[index] ?? `${index + 1}.`} ${choice.label}`)
    .join("\n");
}

export function renderScene(
  run: RpgRun,
  extraLines: string[] = [],
  narration?: string | null,
): string {
  const room = currentRoom(run);
  const description =
    narration ??
    room.descriptions[run.turn % Math.max(1, room.descriptions.length)] ??
    `Kau berdiri di ${room.name}.`;

  const header = [
    `🕯️ *${run.worldTitle}* · Bab ${run.act} · Giliran ${run.turn}`,
    `📍 *${room.name}* · ${statLine(run)}`,
  ].join("\n");

  const combat = run.combat;
  const combatBlock = combat
    ? `⚔️ *${combat.enemyName}* ${combat.hp}/${combat.maxHp} HP · ATK ${combat.atk} · DEF ${combat.def}`
    : "";

  const lines = extraLines.length > 0 ? extraLines.join("\n") : "";
  const choices = choiceBlock(buildChoices(run));
  const vote = run.vote ? voteBlock(run) : "";

  return [
    header,
    combatBlock,
    description,
    lines,
    choices,
    vote,
    run.mode === "party"
      ? `_Pilih dengan *!rpg vote <nomor>* — pemain lain juga boleh memilih._`
      : `_atau tulis aksi bebas: !rpg <aksi>_`,
  ]
    .filter((part) => part.trim() !== "")
    .join("\n");
}

function voteBlock(run: RpgRun): string {
  const vote = run.vote;
  if (!vote) return "";
  const seconds = Math.max(0, Math.ceil((vote.deadline - Date.now()) / 1000));
  const voters = run.party.filter(
    (member) => member.status === "aktif" && member.hp > 0,
  ).length;
  const ballots = Object.keys(vote.ballots).length;
  return `🗳️ *Vote* ${ballots}/${voters} suara · ${seconds}s tersisa`;
}

export function renderPartyStatus(run: RpgRun): string {
  const room = currentRoom(run);
  const rows = run.party
    .filter((member) => member.status !== "keluar")
    .map((member) => {
      const state = member.status === "pingsan" ? "😵 pingsan" : "aktif";
      return `• *${member.name}* — ${member.archetype} Lv ${member.level} · ❤️ ${member.hp}/${member.maxHp} · 💧 ${member.mp}/${member.maxMp} · ${state}`;
    })
    .join("\n");

  const votes = Object.entries(run.vote?.ballots ?? {})
    .map(([userId, choiceId]) => {
      const member = run.party.find((entry) => entry.userId === userId);
      const choice = run.vote?.choices.find((entry) => entry.id === choiceId);
      return member && choice ? `• ${member.name} → ${choice.label}` : null;
    })
    .filter(Boolean)
    .join("\n");

  return [
    `👥 *Party ${run.worldTitle}* · Bab ${run.act} · Giliran ${run.turn}`,
    `📍 ${room.name} · 💰 ${run.shared.gold} gold`,
    "",
    rows,
    "",
    `*Tas bersama:* ${run.shared.inventory.length > 0 ? run.shared.inventory.map((stack) => `${RPG_ITEMS[stack.itemId]?.name ?? stack.itemId} ×${stack.qty}`).join(", ") : "_kosong_"}`,
    run.vote ? `\n*Vote sekarang:*\n${votes || "_belum ada suara_"}` : "",
  ].join("\n");
}

export function renderCombatStatus(run: RpgRun): string {
  const combat = run.combat;
  const character = hero(run);
  if (!combat) return "";

  return (
    `⚔️ *${combat.enemyName}* · ${combat.hp}/${combat.maxHp} HP · ATK ${combat.atk} · DEF ${combat.def}\n` +
    `🧍 ${character.name} · ATK ${heroCombatAtk(character)} · DEF ${effectiveDef(character)} · ❤️ ${character.hp}/${character.maxHp}`
  );
}

export function renderStatus(run: RpgRun): string {
  if (run.mode === "party") return renderPartyStatus(run);

  const character = hero(run);
  const room = currentRoom(run);
  const status = run.status === "combat" ? "bertarung" : run.status === "ended" ? "selesai" : "aktif";
  const quests =
    run.journal.quests.length > 0
      ? run.journal.quests.map((quest) => `• ${quest.title} — ${quest.hint}`).join("\n")
      : "_belum ada_";
  const debuffs = character.debuffs.length
    ? character.debuffs.map((debuff) => `${debuff.kind} (${debuff.turns})`).join(", ")
    : "tidak ada";

  return [
    `🪪 *${character.name}* — ${character.archetype}`,
    `Level ${character.level} · XP ${character.xp}/${xpToNext(character.level)}`,
    `❤️ HP ${character.hp}/${character.maxHp} · 💧 MP ${character.mp}/${character.maxMp}`,
    `⚔️ ATK ${heroCombatAtk(character)} · 🛡️ DEF ${effectiveDef(character)} · 🌀 AGI ${character.agi}`,
    `💰 Gold ${run.shared.gold} · 📍 ${room.name} · status ${status}`,
    `Jurus: ${character.skills.map((id) => RPG_SKILLS[id]?.name ?? id).join(", ") || "-"}`,
    `Efek: ${debuffs}`,
    "",
    `*Quest:*\n${quests}`,
  ].join("\n");
}

export function renderInventory(run: RpgRun): string {
  if (run.mode === "party") {
    const lines =
      run.shared.inventory.length === 0
        ? "_Tas bersama kosong._"
        : run.shared.inventory
            .map((stack) => {
              const item = RPG_ITEMS[stack.itemId];
              return `• ${item?.name ?? stack.itemId} ×${stack.qty}${item?.desc ? ` — _${item.desc}_` : ""}`;
            })
            .join("\n");
    const gear = run.party
      .filter((member) => member.status !== "keluar")
      .map((member) => {
        const weapon = member.equipment.weapon ? RPG_ITEMS[member.equipment.weapon]?.name : "-";
        const armor = member.equipment.armor ? RPG_ITEMS[member.equipment.armor]?.name : "-";
        return `• ${member.name}: ⚔️ ${weapon} · 🛡️ ${armor}`;
      })
      .join("\n");
    return [
      `🎒 *Tas bersama* · 💰 ${run.shared.gold} gold`,
      "",
      lines,
      "",
      `*Perlengkapan party:*\n${gear}`,
      "",
      `_Pakai: !rpg pakai <nama item> (memakai giliran vote)_`,
    ].join("\n");
  }

  const character = hero(run);
  const lines =
    character.inventory.length === 0
      ? "_Tas kosong._"
      : character.inventory
          .filter((stack) => stack.qty > 0)
          .map((stack) => {
            const item = RPG_ITEMS[stack.itemId];
            return `• ${item?.name ?? stack.itemId} ×${stack.qty}${
              item?.desc ? ` — _${item.desc}_` : ""
            }`;
          })
          .join("\n");

  const weapon = character.equipment.weapon
    ? RPG_ITEMS[character.equipment.weapon]?.name
    : "tangan kosong";
  const armor = character.equipment.armor
    ? RPG_ITEMS[character.equipment.armor]?.name
    : "tanpa pelindung";

  return [
    `🎒 *Tas ${character.name}* · 💰 ${run.shared.gold} gold`,
    `⚔️ ${weapon} · 🛡️ ${armor}`,
    "",
    lines,
    "",
    `_Pakai: !rpg pakai <nama item>_`,
  ].join("\n");
}

export function renderMapText(run: RpgRun): string {
  const room = currentRoom(run);
  const lines = (Object.keys(room.exits) as RpgDirection[]).map((direction) => {
    const targetId = room.exits[direction];
    const target = targetId ? roomById(run, targetId) : null;
    if (!target) return `• ${DIRECTION_LABEL[direction]}: —`;
    const known = run.discoveredRooms.includes(target.id) || target.visited;
    const locked = Boolean(roomLockReason(run, target));
    return `• ${DIRECTION_LABEL[direction]}: ${
      locked ? `${target.name} (terkunci)` : known ? `${target.name} ✅` : "belum dijelajahi"
    }`;
  });

  return [
    `🗺️ *Peta ${run.worldTitle}* · ${run.discoveredRooms.length}/${run.rooms.length} ruangan`,
    `📍 Kau di *${room.name}*.`,
    "",
    lines.join("\n"),
    "",
    "_Peta gambar tidak tersedia; ini daftar jalan._",
  ].join("\n");
}

export function renderJournal(run: RpgRun): string {
  const facts =
    run.journal.facts.length > 0
      ? run.journal.facts.map((fact) => `• ${fact}`).join("\n")
      : "_belum ada catatan_";
  const quests =
    run.journal.quests.length > 0
      ? run.journal.quests.map((quest) => `• *${quest.title}* — ${quest.hint}`).join("\n")
      : "_belum ada quest_";
  const scenes =
    run.recentScenes.length > 0
      ? run.recentScenes
          .slice(-5)
          .map((scene) => `• [${scene.turn}] ${scene.headline}`)
          .join("\n")
      : "_belum ada kejadian_";

  return [
    `📖 *Jurnal ${hero(run).name}*`,
    "",
    `*Quest:*\n${quests}`,
    "",
    `*Catatan:*\n${facts}`,
    "",
    `*Terakhir:*\n${scenes}`,
  ].join("\n");
}

export function helpText(prefix: string): string {
  return `*Text RPG — ${RPG_WORLD.title}* 🕯️

*Solo (chat pribadi):*
• *${prefix}rpg mulai [pendekar|dukun|penjelajah] [nama]* — mulai perjalanan
• *${prefix}rpg <aksi bebas>* — mis. _periksa gerobak_, _ke utara_, _serang_, _istirahat_

*Party (grup):*
• *${prefix}rpg mulai* — buka pendaftaran party
• *${prefix}rpg gabung [pendekar|dukun|penjelajah]* — ikut party
• *${prefix}rpg mulai petualangan* — mulai (pemilik, minimal 2 pemain)
• *${prefix}rpg vote 1..6* — pilih aksi (mayoritas, 45 detik)
• *${prefix}rpg keluar* — keluar dari party

*Umum:*
• *${prefix}rpg lanjut* — tampilkan adegan / selesaikan vote yang jatuh tempo
• *${prefix}rpg status* — lembar karakter / roster party
• *${prefix}rpg tas* — isi tas & perlengkapan
• *${prefix}rpg peta* — gambar peta ruangan
• *${prefix}rpg jurnal* — quest & catatan
• *${prefix}rpg batal* — akhiri perjalanan (pemilik)

_Engine menentukan hasil (dadu terlihat); AI hanya menarasikan. Run tersimpan dan bisa dilanjutkan kapan saja._`;
}
