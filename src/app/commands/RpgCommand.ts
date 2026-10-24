import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { BotConfig, log } from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import { RpgRunService } from "../../domain/services/rpg/RpgRunService.js";
import {
  activeParty,
  castVote,
  combatAction,
  createPartyLobby,
  createSoloRun,
  currentRoom,
  endRun,
  examineFeature,
  hero,
  joinParty,
  leaveParty,
  move,
  openVote,
  partyCombatAction,
  partyRest,
  rest,
  resolveVote,
  startParty,
  useItemOutsideCombat,
  useSharedItemOutsideCombat,
  type CombatAction,
} from "../../domain/services/rpg/RpgEngine.js";
import {
  buildChoices,
  helpText,
  renderInventory,
  renderJournal,
  renderMapText,
  renderPartyStatus,
  renderScene,
  renderStatus,
} from "../../domain/services/rpg/RpgPresenter.js";
import { RpgNarratorService } from "../../domain/services/rpg/RpgNarratorService.js";
import { RpgWorldService } from "../../domain/services/rpg/RpgWorldService.js";
import { renderMapPng } from "../../domain/services/rpg/RpgMapRenderer.js";
import { RPG_ARCHETYPES, RPG_ITEMS, RPG_SKILLS } from "../../domain/services/rpg/rpgContent.js";
import type {
  RpgArchetype,
  RpgDirection,
  RpgRun,
  RpgTurnResult,
} from "../../domain/services/rpg/types.js";

const DIRECTION_WORDS: Record<string, RpgDirection> = {
  utara: "utara", u: "utara", north: "utara", atas: "utara",
  selatan: "selatan", s: "selatan", south: "selatan", bawah: "selatan",
  timur: "timur", t: "timur", east: "timur", kanan: "timur",
  barat: "barat", b: "barat", west: "barat", kiri: "barat",
};

const ARCHETYPE_ALIASES: Record<string, RpgArchetype> = {
  pendekar: "pendekar", warrior: "pendekar", ksatria: "pendekar",
  dukun: "dukun", shaman: "dukun", tabib: "dukun",
  penjelajah: "penjelajah", explorer: "penjelajah", pemburu: "penjelajah",
};

type TurnAction =
  | { kind: "move"; direction: RpgDirection }
  | { kind: "examine"; featureId: string }
  | { kind: "rest" }
  | { kind: "attack" }
  | { kind: "defend" }
  | { kind: "flee" }
  | { kind: "skill"; skillId: string }
  | { kind: "useItem"; itemId: string };

export class RpgCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "rpg",
    aliases: ["petualangan"],
    description: "Text RPG rimba: solo atau party, dungeon, makhluk halus, pusaka.",
    category: "game",
    commandClass: RpgCommand,
    cooldown: 2000,
    maxUses: 30,
    vipBypassCooldown: true,
  };

  private runs = new RpgRunService();
  private narrator = new RpgNarratorService();
  private worlds = new RpgWorldService();

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    _sessionService: SessionService,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    void _sessionService;
    const raw = args.join(" ").trim();
    const sub = (args[0] ?? "").toLowerCase();
    const isGroup = jid.endsWith("@g.us");

    try {
      if (!raw || sub === "help" || sub === "bantuan") {
        await sock.sendMessage(jid, { text: helpText(BotConfig.prefix) });
        return;
      }

      if (sub === "mulai" || sub === "start") {
        await this.handleStart(args.slice(1), jid, user, sock, msg, isGroup);
        return;
      }

      if (sub === "gabung" || sub === "join") {
        await this.handleJoin(args.slice(1), jid, user, sock, msg, isGroup);
        return;
      }

      if (sub === "keluar" || sub === "leave") {
        await this.handleLeave(jid, user, sock, isGroup);
        return;
      }

      let run = isGroup
        ? await this.runs.findActiveParty(jid)
        : await this.runs.findActiveSolo(jid, user);
      if (!run && isGroup) {
        run = await this.runs.findActiveSolo(jid, user);
      }

      if (!run) {
        await sock.sendMessage(jid, {
          text: isGroup
            ? `Belum ada party aktif di grup ini.\n\nMulai dengan *${BotConfig.prefix}rpg mulai*.`
            : `Kau belum punya perjalanan aktif.\n\nMulai dengan *${BotConfig.prefix}rpg mulai [pendekar|dukun|penjelajah]*.`,
        });
        return;
      }

      if (run.mode === "solo" && run.ownerUserId !== user) {
        await sock.sendMessage(jid, {
          text: `Run ini milik ${hero(run).name}. Hanya pemiliknya yang bisa mengambil giliran.`,
        });
        return;
      }

      if (run.mode === "party" && run.status === "lobby") {
        await this.handleLobbyViews(run, sub, jid, user, sock);
        return;
      }

      const messageId = msg?.key?.id ?? undefined;
      if (messageId && run.lastProcessedMessageId === messageId) return;

      if (sub === "batal" || sub === "akhiri" || sub === "stop") {
        await this.handleAbort(run, jid, user, sock);
        return;
      }

      if (await this.handleView(run, sub, jid, sock)) return;

      if (run.mode === "party") {
        await this.handlePartyTurn(run, args, jid, user, sock, messageId);
        return;
      }

      await this.handleSoloTurn(run, args, jid, user, sock, messageId);
    } catch (error) {
      log.error("RpgCommand failed:", error);
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.error} Dunia sedang tidak stabil. Coba lagi sebentar lagi.`,
      });
    }
  }

  // ---------------------------------------------------------------- start / join

  private async handleStart(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo,
    isGroup: boolean,
  ): Promise<void> {
    const first = (args[0] ?? "").toLowerCase();

    if (isGroup && first !== "solo") {
      if (first === "petualangan" || first === "party" || first === "perjalanan") {
        const run = await this.runs.findActiveParty(jid);
        if (!run || run.status !== "lobby") {
          await sock.sendMessage(jid, { text: "Tidak ada lobby party untuk dimulai." });
          return;
        }
        if (run.ownerUserId !== user) {
          await sock.sendMessage(jid, {
            text: "Hanya pemilik party yang bisa memulai petualangan.",
          });
          return;
        }
        const started = startParty(run);
        if (!started.ok) {
          await sock.sendMessage(jid, { text: started.reason ?? "Party belum bisa dimulai." });
          return;
        }
        await this.runs.save(run);
        await sock.sendMessage(jid, {
          text: `🕯️ Party berangkat! ${activeParty(run).length} pemain masuk ke *${run.worldTitle}*.`,
        });
        await this.postPartyScene(run, jid, sock, []);
        return;
      }

      const existing = await this.runs.findActiveParty(jid);
      if (existing) {
        await sock.sendMessage(jid, {
          text:
            existing.status === "lobby"
              ? `Lobby party sudah terbuka (${existing.party.length} pemain).\n\n• *${BotConfig.prefix}rpg gabung* untuk ikut\n• *${BotConfig.prefix}rpg mulai petualangan* untuk berangkat`
              : `Party sudah berjalan (giliran ${existing.turn}). Gunakan *${BotConfig.prefix}rpg lanjut* atau *${BotConfig.prefix}rpg vote <n>*.`,
        });
        return;
      }

      await sock.sendMessage(jid, { text: "🌫️ Menyiapkan dunia…" });
      const world = await this.worlds.generate(this.seedFor(jid, user));
      const run = createPartyLobby({
        jid,
        userId: user,
        name: (msg.pushName || "Pengembara").slice(0, 24),
        archetype: this.archetypeFrom(args.slice(1)),
        world,
      });
      await this.runs.ensureIndexes().catch(() => undefined);
      await this.runs.create(run);

      await sock.sendMessage(jid, {
        text:
          `🕯️ *${world.title}* — ${world.region}\n_${world.premise}_\n\n` +
          `Party dibuka oleh *${hero(run).name}*. Minimal 2 pemain.\n\n` +
          `• *${BotConfig.prefix}rpg gabung [pendekar|dukun|penjelajah]*\n` +
          `• *${BotConfig.prefix}rpg mulai petualangan*`,
      });
      return;
    }

    const existing = await this.runs.findActiveSolo(jid, user);
    if (existing) {
      await sock.sendMessage(jid, {
        text:
          `Kau sudah punya perjalanan aktif (${hero(existing).name}, giliran ${existing.turn}).\n\n` +
          `• *${BotConfig.prefix}rpg lanjut* — lihat adegan terakhir\n` +
          `• *${BotConfig.prefix}rpg batal* — akhiri dan mulai baru`,
      });
      return;
    }

    const soloArgs = first === "solo" ? args.slice(1) : args;
    const archetype = this.archetypeFrom(soloArgs);
    const nameFirst = (soloArgs[0] ?? "").toLowerCase();
    const nameArgs = ARCHETYPE_ALIASES[nameFirst] ? soloArgs.slice(1) : soloArgs;
    const name = (nameArgs.join(" ").trim() || msg.pushName || "Pengembara").slice(0, 24);

    await sock.sendMessage(jid, { text: "🌫️ Menyiapkan dunia…" });
    const world = await this.worlds.generate(this.seedFor(jid, user));
    const run = createSoloRun({ jid, userId: user, name, archetype, world });
    await this.runs.ensureIndexes().catch(() => undefined);
    await this.runs.create(run);

    const archetypeDef = RPG_ARCHETYPES[archetype];
    await sock.sendMessage(jid, {
      text:
        `🕯️ *${world.title}* dimulai.\n` +
        `Kau, *${name}* si ${archetypeDef.name}, berjalan masuk ke ${world.region}.\n\n` +
        `_${world.premise}_\n\n` +
        `❤️ ${hero(run).hp}/${hero(run).maxHp} · 💧 ${hero(run).mp}/${hero(run).maxMp} · 💰 ${run.shared.gold}\n\n` +
        `_Ketik ${BotConfig.prefix}rpg 1 untuk memilih aksi, atau tulis aksi bebas._`,
    });
    await sock.sendMessage(jid, { text: renderScene(run) });
  }

  private async handleJoin(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo,
    isGroup: boolean,
  ): Promise<void> {
    if (!isGroup) {
      await sock.sendMessage(jid, { text: "Party hanya bisa dimainkan di grup." });
      return;
    }

    const run = await this.runs.findActiveParty(jid);
    if (!run || run.status !== "lobby") {
      await sock.sendMessage(jid, { text: "Tidak ada lobby party yang terbuka di grup ini." });
      return;
    }

    const result = joinParty(run, {
      userId: user,
      name: (msg.pushName || "Pengembara").slice(0, 24),
      archetype: this.archetypeFrom(args),
    });
    if (!result.ok) {
      await sock.sendMessage(jid, { text: result.reason ?? "Gagal bergabung." });
      return;
    }

    await this.runs.save(run);
    const member = run.party.find((entry) => entry.userId === user);
    await sock.sendMessage(jid, {
      text:
        `✅ *${member?.name ?? "Pemain"}* bergabung sebagai ${member?.archetype}.\n` +
        `Party: ${run.party.length} pemain. Pemilik mengetik *${BotConfig.prefix}rpg mulai petualangan* untuk berangkat.`,
    });
  }

  private async handleLeave(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    isGroup: boolean,
  ): Promise<void> {
    if (!isGroup) {
      await sock.sendMessage(jid, { text: "Gunakan *!rpg batal* untuk mengakhiri run solo." });
      return;
    }

    const run = await this.runs.findActiveParty(jid);
    if (!run) {
      await sock.sendMessage(jid, { text: "Tidak ada party aktif." });
      return;
    }

    const result = leaveParty(run, user);
    if (!result.ok) {
      await sock.sendMessage(jid, { text: "Kau bukan anggota party ini." });
      return;
    }

    if (result.ended) {
      await this.runs.save(run);
      await sock.sendMessage(jid, { text: "📕 Party bubar." });
      return;
    }

    await this.runs.save(run);
    await sock.sendMessage(jid, {
      text: result.promotedTo
        ? "👋 Kau keluar. Kepemilikan party dialihkan ke pemain lain."
        : "👋 Kau keluar dari party.",
    });
  }

  private async handleLobbyViews(
    run: RpgRun,
    sub: string,
    jid: string,
    user: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    if (sub === "status" || sub === "tas") {
      const roster = run.party
        .map((member) => `• ${member.name} — ${member.archetype}`)
        .join("\n");
      await sock.sendMessage(jid, {
        text:
          `👥 *Lobby ${run.worldTitle}*\n${run.world.region}\n\n${roster}\n\n` +
          `Pemilik: ${run.party.find((member) => member.userId === run.ownerUserId)?.name ?? "-"}\n` +
          `_Minimal 2 pemain. Pemilik: ${BotConfig.prefix}rpg mulai petualangan_`,
      });
      return;
    }

    await sock.sendMessage(jid, {
      text:
        `Lobby masih terbuka.\n\n` +
        `• *${BotConfig.prefix}rpg gabung* untuk ikut\n` +
        (run.ownerUserId === user
          ? `• *${BotConfig.prefix}rpg mulai petualangan* untuk berangkat`
          : "• Tunggu pemilik memulai."),
    });
  }

  private async handleAbort(
    run: RpgRun,
    jid: string,
    user: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    if (run.mode === "party" && run.ownerUserId !== user) {
      await sock.sendMessage(jid, { text: "Hanya pemilik party yang bisa mengakhiri run." });
      return;
    }
    endRun(run);
    run.vote = undefined;
    await this.runs.save(run);
    await sock.sendMessage(jid, {
      text: `📕 Perjalanan *${run.worldTitle}* diakhiri pada giliran ${run.turn}.`,
    });
  }

  // ---------------------------------------------------------------- views

  private async handleView(
    run: RpgRun,
    sub: string,
    jid: string,
    sock: WebSocketInfo,
  ): Promise<boolean> {
    if (sub === "status") {
      await sock.sendMessage(jid, {
        text: run.mode === "party" ? renderPartyStatus(run) : renderStatus(run),
      });
      return true;
    }
    if (sub === "tas" || sub === "inventory" || sub === "inv") {
      await sock.sendMessage(jid, { text: renderInventory(run) });
      return true;
    }
    if (sub === "jurnal" || sub === "journal" || sub === "quest") {
      await sock.sendMessage(jid, { text: renderJournal(run) });
      return true;
    }
    if (sub === "peta" || sub === "map") {
      await this.sendMap(run, jid, sock);
      return true;
    }
    return false;
  }

  private async sendMap(run: RpgRun, jid: string, sock: WebSocketInfo): Promise<void> {
    const room = currentRoom(run);
    const hp =
      run.mode === "party"
        ? run.party
            .filter((member) => member.status !== "keluar")
            .map((member) => `${member.name} ${member.hp}/${member.maxHp}`)
            .join(" · ")
        : `❤️ ${hero(run).hp}/${hero(run).maxHp}`;

    try {
      const image = await renderMapPng(run);
      await sock.sendMessage(jid, {
        image,
        caption: `🗺️ *Peta ${run.worldTitle}* · ${room.name}\n${hp} · 💰 ${run.shared.gold}`,
      });
    } catch (error) {
      log.warn(
        "RPG map render failed; sending text map:",
        error instanceof Error ? error.message : String(error),
      );
      await sock.sendMessage(jid, { text: renderMapText(run) });
    }
  }

  // ---------------------------------------------------------------- solo turn

  private async handleSoloTurn(
    run: RpgRun,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    messageId?: string,
  ): Promise<void> {
    const joined = args.join(" ").trim();
    const numeric = Number(joined);
    let action: TurnAction | null = null;

    if (Number.isInteger(numeric) && numeric >= 1) {
      const choices = buildChoices(run);
      const choice = choices[numeric - 1];
      if (!choice) {
        await sock.sendMessage(jid, { text: `Pilihan ${numeric} tidak ada.` });
        return;
      }
      action = choice.action;
    } else if (joined.toLowerCase() === "lanjut") {
      await sock.sendMessage(jid, { text: renderScene(run) });
      return;
    } else {
      action = await this.resolveTextAction(run, args, jid, sock);
      if (!action) return;
    }

    const result = this.executeAction(run, action);
    const narration = await this.narrator.narrate(run, result.lines);
    if (messageId) result.run.lastProcessedMessageId = messageId;

    if (run.turn > 0 && run.turn % 5 === 0) {
      const compressed = await this.narrator.compressJournal(run);
      if (compressed) run.journal.facts = compressed;
    }

    await this.runs.save(result.run);
    const text = renderScene(result.run, result.lines, narration?.narration ?? null);
    await sock.sendMessage(jid, {
      text: result.run.status === "ended" ? `${text}\n\n🏁 _Perjalanan selesai._` : text,
    });
    void user;
  }

  private async resolveTextAction(
    run: RpgRun,
    args: string[],
    jid: string,
    sock: WebSocketInfo,
  ): Promise<TurnAction | null> {
    const joined = args.join(" ").trim();
    const intent = this.parseIntent(joined);
    if (intent) return this.finalizeIntent(run, intent, jid, sock);

    const aiIntent = await this.narrator.parseIntent(run, joined);
    if (aiIntent) {
      const mapped = this.mapAiIntent(run, aiIntent);
      if (mapped) return this.finalizeIntent(run, mapped, jid, sock);
    }

    await this.showHint(run, jid, sock);
    return null;
  }

  private async finalizeIntent(
    run: RpgRun,
    intent: TurnAction | { kind: "examine"; featureId: string },
    jid: string,
    sock: WebSocketInfo,
  ): Promise<TurnAction | null> {
    if (intent.kind === "useItem") {
      const itemId = this.resolveTarget(run, intent.itemId, "item");
      if (!itemId) {
        await sock.sendMessage(jid, {
          text: `Kau tidak punya *${intent.itemId}* di tas.`,
        });
        return null;
      }
      return { kind: "useItem", itemId };
    }

    if (intent.kind === "skill") {
      const skillId = this.resolveTarget(run, intent.skillId, "skill");
      if (!skillId) {
        await sock.sendMessage(jid, {
          text: `Kau belum menguasai jurus *${intent.skillId}*.`,
        });
        return null;
      }
      return { kind: "skill", skillId };
    }

    if (intent.kind !== "examine") return intent;
    if (intent.featureId === "__list__") {
      await this.showHint(run, jid, sock);
      return null;
    }
    const featureId = this.resolveTarget(run, intent.featureId, "feature");
    if (!featureId) {
      await sock.sendMessage(jid, {
        text: `Tidak ada *${intent.featureId}* yang bisa diperiksa di sini.`,
      });
      return null;
    }
    return { kind: "examine", featureId };
  }

  private executeAction(run: RpgRun, action: TurnAction): RpgTurnResult {
    const party = run.mode === "party";
    if (action.kind === "move") return move(run, action.direction);
    if (action.kind === "examine") return examineFeature(run, action.featureId);
    if (action.kind === "rest") return party ? partyRest(run) : rest(run);
    if (action.kind === "useItem") {
      return party
        ? useSharedItemOutsideCombat(run, action.itemId)
        : useItemOutsideCombat(run, action.itemId);
    }

    const combatInput: CombatAction =
      action.kind === "skill"
        ? { kind: "skill", skillId: action.skillId }
        : action.kind === "attack"
          ? { kind: "attack" }
          : action.kind === "defend"
            ? { kind: "defend" }
            : { kind: "flee" };

    return party ? partyCombatAction(run, combatInput) : combatAction(run, combatInput);
  }

  // ---------------------------------------------------------------- party turn

  private async handlePartyTurn(
    run: RpgRun,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    messageId?: string,
  ): Promise<void> {
    const sub = (args[0] ?? "").toLowerCase();

    if (sub === "lanjut" || sub === "resume") {
      const resolved = await this.tryResolveVote(run, jid, sock, messageId, false);
      if (resolved) return;
      await this.postPartyScene(run, jid, sock, []);
      return;
    }

    const voteArg =
      sub === "vote" || sub === "pilih" ? args[1] : args[0];
    const numeric = Number(voteArg);

    if (!Number.isInteger(numeric) || numeric < 1) {
      await sock.sendMessage(jid, {
        text:
          run.vote
            ? `Pilih aksi dengan *${BotConfig.prefix}rpg vote <nomor>* (1–${run.vote.choices.length}).`
            : `Tidak ada vote terbuka. Ketik *${BotConfig.prefix}rpg lanjut* untuk melihat adegan.`,
      });
      return;
    }

    const ensure = await this.ensureVote(run);
    if (!ensure || !run.vote) {
      await sock.sendMessage(jid, { text: "Tidak ada pilihan untuk divote saat ini." });
      return;
    }

    const choice = run.vote.choices[numeric - 1];
    if (!choice) {
      await sock.sendMessage(jid, {
        text: `Pilihan ${numeric} tidak ada (1–${run.vote.choices.length}).`,
      });
      return;
    }

    const cast = castVote(run, user, choice.id);
    if (!cast.ok) {
      await sock.sendMessage(jid, { text: cast.reason ?? "Vote gagal." });
      return;
    }

    await this.runs.save(run);
    await this.tryResolveVote(run, jid, sock, messageId);
  }

  private async ensureVote(run: RpgRun): Promise<boolean> {
    if (run.mode !== "party" || run.status === "ended" || run.status === "defeated") {
      return false;
    }
    if (run.vote) return true;
    if (run.status === "lobby") return false;

    const choices = buildChoices(run).map((choice) => ({
      id: choice.id,
      label: choice.label,
    }));
    if (choices.length === 0) return false;
    openVote(run, choices);
    return true;
  }

  private async tryResolveVote(
    run: RpgRun,
    jid: string,
    sock: WebSocketInfo,
    messageId?: string,
    announceWait = true,
  ): Promise<boolean> {
    if (!run.vote) return false;

    const resolution = resolveVote(run, new Date());
    if (!resolution.due) {
      if (!announceWait) return false;
      const ballots = Object.keys(run.vote?.ballots ?? {}).length;
      await this.runs.save(run);
      await sock.sendMessage(jid, {
        text: `🗳️ Suara tercatat (${ballots}/${activeParty(run).length}). Menunggu pemain lain…`,
      });
      return true;
    }

    if (!resolution.winner) {
      await sock.sendMessage(jid, {
        text: "🕳️ Tidak ada yang bergerak. Pilih lagi sebelum waktu habis.",
      });
      await this.postPartyScene(run, jid, sock, []);
      return true;
    }

    const choices = buildChoices(run);
    const selected = choices.find((choice) => choice.id === resolution.winner?.id);
    if (!selected) {
      await this.postPartyScene(run, jid, sock, []);
      return true;
    }

    const result = this.executeAction(run, selected.action);
    const narration = await this.narrator.narrate(run, result.lines);
    if (messageId) result.run.lastProcessedMessageId = messageId;

    await this.runs.save(result.run);
    await this.postPartyScene(result.run, jid, sock, [
      `🗳️ ${resolution.ballots} suara → *${selected.label}*`,
      ...result.lines,
    ], narration?.narration ?? null);
    return true;
  }

  private async postPartyScene(
    run: RpgRun,
    jid: string,
    sock: WebSocketInfo,
    extraLines: string[],
    narration?: string | null,
  ): Promise<void> {
    if (run.status === "ended" || run.status === "defeated") {
      run.vote = undefined;
      await this.runs.save(run);
      await sock.sendMessage(jid, {
        text: `${renderScene(run, extraLines, narration)}\n\n🏁 _Perjalanan party selesai._`,
      });
      return;
    }

    if (!run.vote) {
      const choices = buildChoices(run).map((choice) => ({
        id: choice.id,
        label: choice.label,
      }));
      if (choices.length > 0) openVote(run, choices);
    }

    await this.runs.save(run);
    await sock.sendMessage(jid, {
      text: renderScene(run, extraLines, narration),
    });
  }

  // ---------------------------------------------------------------- helpers

  private archetypeFrom(args: string[]): RpgArchetype {
    const first = (args[0] ?? "").toLowerCase();
    return ARCHETYPE_ALIASES[first] ?? "pendekar";
  }

  private seedFor(jid: string, user: string): string {
    return `${jid}:${user}:${Date.now().toString(36)}`;
  }

  private parseIntent(text: string): TurnAction | null {
    const normalized = text.toLowerCase().replace(/[!?.,]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return null;

    const words = normalized.split(" ");
    const head = words[0];
    const restText = words.slice(1).join(" ").trim();

    if (DIRECTION_WORDS[head] && words.length === 1) {
      return { kind: "move", direction: DIRECTION_WORDS[head] };
    }
    if (["pergi", "jalan", "masuk", "ke", "menuju"].includes(head) && restText) {
      const direction = DIRECTION_WORDS[words[1]];
      if (direction) return { kind: "move", direction };
    }
    if (["serang", "attack", "hantam", "tabrak", "pukul", "tebas"].includes(head)) {
      return { kind: "attack" };
    }
    if (["bertahan", "defend", "tangkis", "jaga", "tahan"].includes(head)) {
      return { kind: "defend" };
    }
    if (["kabur", "lari", "flee", "mundur"].includes(head)) {
      return { kind: "flee" };
    }
    if (["istirahat", "rest", "tidur", "beristirahat"].includes(head)) {
      return { kind: "rest" };
    }
    if (["pakai", "gunakan", "minum", "makan"].includes(head) && restText) {
      return { kind: "useItem", itemId: restText };
    }
    if (["periksa", "lihat", "amati", "examine", "buka", "cek"].includes(head)) {
      return { kind: "examine", featureId: restText || "__list__" };
    }
    if (["skill", "jurus", "mantra"].includes(head) && restText) {
      return { kind: "skill", skillId: restText };
    }
    return null;
  }

  private mapAiIntent(
    run: RpgRun,
    intent: {
      action: string;
      direction: RpgDirection | null;
      target: string | null;
    },
  ): TurnAction | null {
    if (intent.action === "move" && intent.direction) {
      return { kind: "move", direction: intent.direction };
    }

    const target = (intent.target ?? "").trim();
    switch (intent.action) {
      case "examine":
      case "talk": {
        const featureId = this.resolveTarget(run, target || "npc", "feature");
        return featureId ? { kind: "examine", featureId } : null;
      }
      case "attack":
        return { kind: "attack" };
      case "defend":
        return { kind: "defend" };
      case "flee":
        return { kind: "flee" };
      case "rest":
        return { kind: "rest" };
      case "use_item": {
        const itemId = this.resolveTarget(run, target, "item");
        return itemId ? { kind: "useItem", itemId } : null;
      }
      case "skill": {
        const skillId = this.resolveTarget(run, target, "skill");
        return skillId ? { kind: "skill", skillId } : null;
      }
      default:
        return null;
    }
  }

  /** Resolves a fuzzy item/skill/feature name against the current run. */
  private resolveTarget(
    run: RpgRun,
    raw: string,
    kind: "item" | "skill" | "feature",
  ): string | null {
    const needle = raw.toLowerCase().trim();
    if (!needle) return null;

    if (kind === "item") {
      const stacks = run.mode === "party" ? run.shared.inventory : hero(run).inventory;
      const stack = stacks.find((entry) => {
        const item = RPG_ITEMS[entry.itemId];
        return entry.itemId === needle || (item?.name.toLowerCase().includes(needle) ?? false);
      });
      return stack?.itemId ?? null;
    }

    if (kind === "skill") {
      for (const member of run.party) {
        const skillId = member.skills.find((id) => {
          const skill = RPG_SKILLS[id];
          return id === needle || (skill?.name.toLowerCase().includes(needle) ?? false);
        });
        if (skillId) return skillId;
      }
      return null;
    }

    const feature = currentRoom(run).features.find(
      (entry) =>
        entry.id === needle ||
        entry.label.toLowerCase().includes(needle) ||
        needle.includes(entry.id),
    );
    return feature?.id ?? null;
  }

  private async showHint(run: RpgRun, jid: string, sock: WebSocketInfo): Promise<void> {
    const room = currentRoom(run);
    const features = room.features
      .filter((feature) => !feature.resolved)
      .map((feature) => `*${feature.label}*`)
      .join(", ");
    const hint = features
      ? `Ada yang bisa diperiksa: ${features}.`
      : "Tidak ada yang menonjol di sini.";
    await sock.sendMessage(jid, {
      text:
        `Aku belum paham aksi itu.\n\n${hint}\n\n` +
        `Coba: *${BotConfig.prefix}rpg periksa <benda>*, *${BotConfig.prefix}rpg ke utara*, *${BotConfig.prefix}rpg istirahat*, atau pilih nomor dari daftar.`,
    });
  }
}
