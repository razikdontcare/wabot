import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import {
  BotConfig,
  getCurrentConfig,
} from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import {
  IGRSGame,
  IGRSMostViewedGame,
  IGRSService,
} from "../../domain/services/IGRSService.js";

interface IGRSInteractiveState {
  resultIds: number[];
  createdAt: number;
}

const IGRS_SELECTION_TTL_MS = 10 * 60 * 1000;
const igrsSelectionCache = new Map<string, IGRSInteractiveState>();

export class IGRSCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "igrs",
    aliases: ["ratinggim", "ratinggame"],
    description: "Cari rating game dari IGRS (Indonesian Game Rating System).",
    helpText: `*Penggunaan:*
• /igrs <nama game> — Cari game berdasarkan nama
• /igrs search <nama game> — Cari game (explicit search)
• /igrs detail <id> — Lihat detail game dari ID IGRS
• /igrs <id> — Shortcut untuk detail berdasarkan ID
• /igrs mostviewed — Daftar game yang paling sering dilihat
• /igrs most viewed — Alias dengan 2 kata
• /igrs top — Alias untuk mostviewed

*Contoh:*
• /igrs resident evil
• /igrs detail 5338
• /igrs mostviewed
• /igrs most viewed
• /igrs 1 (pilih nomor dari hasil terakhir)

*Catatan:*
• Data bersumber dari API publik IGRS (api.igrs.id)
• Setelah melakukan pencarian/mostviewed, gunakan */igrs <nomor>* untuk flow interaktif`,
    category: "general",
    commandClass: IGRSCommand,
    cooldown: 5000,
    maxUses: 10,
  };

  private igrsService = new IGRSService();

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    _sessionService: SessionService,
    _msg: proto.IWebMessageInfo,
  ): Promise<void> {
    void _sessionService;
    void _msg;

    const config = await getCurrentConfig();

    if (args.length === 0 || args[0].toLowerCase() === "help") {
      await sock.sendMessage(jid, {
        text: `${config.emoji.info} ${IGRSCommand.commandInfo.helpText}`,
      });
      return;
    }

    const firstArg = args[0].toLowerCase();
    const secondArg = args[1]?.toLowerCase();

    if (
      (firstArg === "most" && secondArg === "viewed") ||
      firstArg === "mostviewed" ||
      firstArg === "top" ||
      firstArg === "popular" ||
      firstArg === "trending"
    ) {
      await this.handleMostViewed(jid, user, sock, config);
      return;
    }

    if (firstArg === "detail" || firstArg === "id") {
      await this.handleDetail(args.slice(1), jid, sock, config);
      return;
    }

    if (firstArg === "search") {
      await this.handleSearch(args.slice(1), jid, user, sock, config);
      return;
    }

    const numericArg = Number(args[0]);
    if (
      !Number.isNaN(numericArg) &&
      Number.isInteger(numericArg) &&
      numericArg > 0
    ) {
      const resolved = this.resolveNumericTarget(jid, user, numericArg);
      if (resolved.source === "selection") {
        await sock.sendMessage(jid, {
          text: `${config.emoji.info} Memilih nomor *${resolved.index}* dari daftar IGRS terakhir...`,
        });
      }

      await this.sendDetailById(resolved.id, jid, sock, config);
      return;
    }

    await this.handleSearch(args, jid, user, sock, config);
  }

  private async handleSearch(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    config: typeof BotConfig,
  ): Promise<void> {
    const query = args.join(" ").trim();

    if (!query) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Masukkan nama game yang ingin dicari.\nContoh: */igrs resident evil*`,
      });
      return;
    }

    await sock.sendMessage(jid, {
      text: `${config.emoji.info} Mencari data IGRS untuk *${query}*...`,
    });

    try {
      const games = await this.igrsService.searchGames(query, 5);

      if (games.length === 0) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.info} Tidak ada game yang ditemukan untuk kata kunci *${query}*.`,
        });
        return;
      }

      this.setInteractiveState(
        jid,
        user,
        games.map((game) => game.id),
      );

      let message = `🎮 *Hasil Pencarian IGRS*\n🔎 Kata kunci: *${query}*\n\n`;

      games.forEach((game, index) => {
        const ratingName = game.ratings?.[0]?.name || "Belum ada";
        const publisher = game.publisherName?.trim() || "Tidak diketahui";
        const platforms = this.formatPlatforms(game.platformsName);
        const releaseYear = game.releaseYear || "-";

        message += `*${index + 1}. ${game.name}*\n`;
        message += `🆔 ID: ${game.id}\n`;
        message += `🔞 Rating: ${ratingName}\n`;
        message += `🏢 Publisher: ${publisher}\n`;
        message += `🕹️ Platform: ${platforms}\n`;
        message += `📅 Tahun Rilis: ${releaseYear}\n\n`;
      });

      message += `Flow interaktif: */igrs 1* sampai */igrs ${games.length}*\n`;
      message += `Atau pakai ID: */igrs detail ${games[0].id}*`;

      await sock.sendMessage(jid, { text: message });
    } catch {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Gagal mengambil data IGRS saat ini. Coba lagi sebentar lagi ya.`,
      });
    }
  }

  private async handleMostViewed(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    config: typeof BotConfig,
  ): Promise<void> {
    await sock.sendMessage(jid, {
      text: `${config.emoji.info} Mengambil daftar game IGRS paling banyak dilihat...`,
    });

    try {
      const games = await this.igrsService.getMostViewedGames(10);

      if (games.length === 0) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.info} Data most viewed dari IGRS sedang kosong.`,
        });
        return;
      }

      this.setInteractiveState(
        jid,
        user,
        games.map((game) => game.id),
      );

      const message = this.formatMostViewedMessage(games);
      await sock.sendMessage(jid, { text: message });
    } catch {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Gagal mengambil data most viewed dari IGRS. Coba lagi nanti.`,
      });
    }
  }

  private async handleDetail(
    args: string[],
    jid: string,
    sock: WebSocketInfo,
    config: typeof BotConfig,
  ): Promise<void> {
    if (args.length === 0) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Masukkan ID game IGRS.\nContoh: */igrs detail 5338*`,
      });
      return;
    }

    const id = Number(args[0]);
    if (Number.isNaN(id) || !Number.isInteger(id) || id <= 0) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} ID game tidak valid. Gunakan angka ID dari hasil pencarian.`,
      });
      return;
    }

    await this.sendDetailById(id, jid, sock, config);
  }

  private async sendDetailById(
    id: number,
    jid: string,
    sock: WebSocketInfo,
    config: typeof BotConfig,
  ): Promise<void> {
    await sock.sendMessage(jid, {
      text: `${config.emoji.info} Mengambil detail IGRS untuk ID *${id}*...`,
    });

    try {
      const game = await this.igrsService.getGameDetailById(id);

      if (!game) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.info} Data game dengan ID *${id}* tidak ditemukan di IGRS.`,
        });
        return;
      }

      const detail = this.formatDetailMessage(game);
      await sock.sendMessage(jid, { text: detail });
    } catch {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Gagal mengambil detail IGRS. Coba lagi nanti.`,
      });
    }
  }

  private formatDetailMessage(game: IGRSGame): string {
    const ratingNames =
      game.ratings?.map((item) => item.name).join(", ") || "Belum ada";
    const descriptors =
      game.descriptors
        ?.map((item) => item.nameId || item.nameEn)
        .filter((item) => item && item.trim().length > 0)
        .join(", ") || "Tidak ada";

    const primaryRating = game.ratings?.[0];
    const ratingTitle = primaryRating?.titleId || primaryRating?.titleEn || "-";
    const ratingContentRaw =
      primaryRating?.contentId || primaryRating?.contentEn || "";
    const ratingContent = this.truncate(this.singleLine(ratingContentRaw), 500);

    const description = this.truncate(
      this.singleLine(game.description || ""),
      500,
    );

    const platforms = this.formatPlatforms(game.platformsName);

    const lines = [
      `🎮 *${game.name}*`,
      `🆔 ID IGRS: ${game.id}`,
      `📅 Tahun Rilis: ${game.releaseYear || "-"}`,
      `🏢 Publisher: ${game.publisherName?.trim() || "Tidak diketahui"}`,
      `🕹️ Platform: ${platforms}`,
      `🔞 Rating: ${ratingNames}`,
      `🏷️ Label Rating: ${ratingTitle}`,
      `🧩 Deskriptor: ${descriptors}`,
    ];

    if (description) {
      lines.push(`📝 Deskripsi: ${description}`);
    }

    if (ratingContent) {
      lines.push(`📚 Ringkasan Konten Rating: ${ratingContent}`);
    }

    if (game.videoUrl) {
      lines.push(`🎬 Video: ${game.videoUrl}`);
    }

    if (game.inGameUrl) {
      lines.push(`🎯 In-Game: ${game.inGameUrl}`);
    }

    return lines.join("\n");
  }

  private formatMostViewedMessage(games: IGRSMostViewedGame[]): string {
    let message = "🔥 *IGRS Most Viewed Games*\n\n";

    games.forEach((game, index) => {
      message += `*${index + 1}. ${game.name}*\n`;
      message += `🆔 ID: ${game.id}\n\n`;
    });

    message += `Flow interaktif: */igrs 1* sampai */igrs ${games.length}*\n`;
    message += `Atau gunakan ID langsung: */igrs detail <id>*`;

    return message;
  }

  private resolveNumericTarget(
    jid: string,
    user: string,
    value: number,
  ): { id: number; source: "selection" | "id"; index?: number } {
    const interactiveState = this.getInteractiveState(jid, user);
    if (
      interactiveState &&
      value >= 1 &&
      value <= interactiveState.resultIds.length
    ) {
      return {
        id: interactiveState.resultIds[value - 1],
        source: "selection",
        index: value,
      };
    }

    return {
      id: value,
      source: "id",
    };
  }

  private setInteractiveState(jid: string, user: string, resultIds: number[]) {
    const key = this.getInteractiveStateKey(jid, user);
    igrsSelectionCache.set(key, {
      resultIds,
      createdAt: Date.now(),
    });
  }

  private getInteractiveState(
    jid: string,
    user: string,
  ): IGRSInteractiveState | null {
    const key = this.getInteractiveStateKey(jid, user);
    const state = igrsSelectionCache.get(key);

    if (!state) {
      return null;
    }

    if (Date.now() - state.createdAt > IGRS_SELECTION_TTL_MS) {
      igrsSelectionCache.delete(key);
      return null;
    }

    return state;
  }

  private getInteractiveStateKey(jid: string, user: string): string {
    return `${jid}::${user}`;
  }

  private formatPlatforms(platforms?: string[]): string {
    if (!platforms || platforms.length === 0) {
      return "Tidak diketahui";
    }

    const cleaned = platforms
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return cleaned.length > 0 ? cleaned.join(", ") : "Tidak diketahui";
  }

  private singleLine(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 3)}...`;
  }
}
