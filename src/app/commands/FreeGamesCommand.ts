import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { BotConfig, getUserRoles } from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import { getMongoClient } from "../../infrastructure/config/mongo.js";
import { GroupSettingService } from "../../domain/services/GroupSettingService.js";
import {
  FreeGamesService,
  GamerPowerGiveaway,
} from "../../domain/services/FreeGamesService.js";

export class FreeGamesCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "freegames",
    aliases: ["freegame", "fg"],
    description: "Aktifkan notifikasi giveaway game gratis untuk grup ini.",
    helpText: `*Penggunaan:*
• /freegames — Aktifkan notifikasi giveaway game gratis untuk grup ini
• /freegames on — Aktifkan notifikasi
• /freegames off — Nonaktifkan notifikasi
• /freegames status — Cek status notifikasi grup
• /freegame now — Cek sekarang giveaway baru dan kirim ke grup ini
• /freegames reset confirm — Reset cache giveaway global (admin only)

*Catatan:*
• Command ini hanya bisa dipakai di grup
• Grup yang mengaktifkan akan dapat notifikasi giveaway baru dari GamerPower API
• Reset akan menghapus cache giveaway yang sudah pernah dilihat bot`,
    category: "utility",
    commandClass: FreeGamesCommand,
    cooldown: 3000,
  };

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

    if (!jid.endsWith("@g.us")) {
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.error} Command ini hanya bisa digunakan di grup.`,
      });
      return;
    }

    const client = await getMongoClient();
    const groupSettingService = new GroupSettingService(client);
    const action = args[0]?.toLowerCase() || "on";

    if (action === "status") {
      const setting = await groupSettingService.get(jid);
      const enabled = setting?.freeGamesEnabled === true;

      await sock.sendMessage(jid, {
        text: enabled
          ? `${BotConfig.emoji.success} Notifikasi free games untuk grup ini: *AKTIF*.`
          : `${BotConfig.emoji.info} Notifikasi free games untuk grup ini: *NONAKTIF*.`,
      });
      return;
    }

    if (action === "off" || action === "disable" || action === "stop") {
      await groupSettingService.setFreeGamesEnabled(jid, false, user);
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.success} Notifikasi free games dimatikan untuk grup ini.`,
      });
      return;
    }

    if (action === "reset") {
      const userRoles = await getUserRoles(user);
      if (!userRoles.includes("admin")) {
        await sock.sendMessage(jid, {
          text: `${BotConfig.emoji.error} Hanya admin bot yang dapat melakukan reset free games cache.`,
        });
        return;
      }

      const freeGamesService = await FreeGamesService.getInstance(client);
      const seenCount = await freeGamesService.getSeenGiveawaysCount();
      const confirmation = args[1]?.toLowerCase();

      if (confirmation !== "confirm") {
        await sock.sendMessage(jid, {
          text: `${BotConfig.emoji.info} Aksi ini akan menghapus *${seenCount}* data giveaway yang sudah tersimpan.
Ketik */freegames reset confirm* untuk melanjutkan.`,
        });
        return;
      }

      const deletedCount = await freeGamesService.resetSeenGiveaways();
      const bootstrapGiveaways = await freeGamesService.pollNewGiveaways({
        bootstrapIfEmpty: true,
        bootstrapLimit: 5,
      });

      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.success} Reset selesai. ${deletedCount} data giveaway terhapus dari cache.`,
      });

      if (bootstrapGiveaways.length === 0) {
        await sock.sendMessage(jid, {
          text: `${BotConfig.emoji.info} Cache sudah di-reset, tapi saat ini tidak ada giveaway bootstrap yang bisa dikirim.`,
        });
        return;
      }

      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.success} Mengirim ${bootstrapGiveaways.length} giveaway bootstrap terbaru setelah reset.`,
      });

      for (const giveaway of bootstrapGiveaways) {
        const targetUrl = await freeGamesService.resolveRedirectLocation(
          giveaway.open_giveaway_url,
        );
        await sock.sendMessage(jid, {
          text: formatFreeGamesMessage(giveaway, targetUrl),
        });
      }

      return;
    }

    if (action === "now") {
      const setting = await groupSettingService.get(jid);
      const enabled = setting?.freeGamesEnabled === true;

      if (!enabled) {
        await sock.sendMessage(jid, {
          text: `${BotConfig.emoji.info} Fitur ini belum aktif di grup ini. Aktifkan dulu dengan */freegames on*`,
        });
        return;
      }

      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.info} Mengecek giveaway baru sekarang...`,
      });

      const freeGamesService = await FreeGamesService.getInstance(client);
      const newGiveaways = await freeGamesService.pollNewGiveaways({
        bootstrapIfEmpty: true,
        bootstrapLimit: 5,
      });

      if (newGiveaways.length === 0) {
        const latestGiveaways = await freeGamesService.getLatestGiveaways(3);

        if (latestGiveaways.length === 0) {
          await sock.sendMessage(jid, {
            text: `${BotConfig.emoji.info} Tidak ada giveaway yang bisa ditampilkan saat ini.`,
          });
          return;
        }

        await sock.sendMessage(jid, {
          text: `${BotConfig.emoji.info} Tidak ada giveaway baru saat ini. Berikut giveaway terbaru yang tersedia:`,
        });

        for (const giveaway of latestGiveaways) {
          const targetUrl = await freeGamesService.resolveRedirectLocation(
            giveaway.open_giveaway_url,
          );
          await sock.sendMessage(jid, {
            text: formatFreeGamesMessage(giveaway, targetUrl),
          });
        }

        return;
      }

      for (const giveaway of newGiveaways) {
        const targetUrl = await freeGamesService.resolveRedirectLocation(
          giveaway.open_giveaway_url,
        );
        await sock.sendMessage(jid, {
          text: formatFreeGamesMessage(giveaway, targetUrl),
        });
      }

      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.success} Ditemukan ${newGiveaways.length} giveaway baru.`,
      });
      return;
    }

    if (action !== "on" && action !== "enable" && action !== "start") {
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.info} ${FreeGamesCommand.commandInfo.helpText}`,
      });
      return;
    }

    await groupSettingService.setFreeGamesEnabled(jid, true, user);

    await sock.sendMessage(jid, {
      text: `${BotConfig.emoji.success} Notifikasi free games diaktifkan untuk grup ini.\n\nGrup ini akan menerima update saat ada giveaway game baru dari GamerPower.\nGunakan */freegames off* untuk menonaktifkan.`,
    });
  }
}

function formatFreeGamesMessage(
  giveaway: GamerPowerGiveaway,
  targetUrl: string,
): string {
  const endDate = formatFreeGamesEndDate(giveaway.end_date);
  const worth =
    giveaway.worth && giveaway.worth !== "N/A" ? giveaway.worth : "Gratis";

  return [
    "🎁 *Giveaway Game Baru Terdeteksi!*",
    "",
    `🎮 *${giveaway.title}*`,
    `💰 Worth: ${worth}`,
    `🖥️ Platform: ${giveaway.platforms || "N/A"}`,
    `🧩 Type: ${giveaway.type || "N/A"}`,
    `⏳ Berakhir: ${endDate}`,
    `🔗 Link: ${targetUrl}`,
  ].join("\n");
}

function formatFreeGamesEndDate(rawEndDate?: string): string {
  if (!rawEndDate || rawEndDate === "N/A") {
    return "Tidak diketahui";
  }

  const normalized = rawEndDate.trim();

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );

  let parsedDate: Date | null = null;

  if (match) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] =
      match;
    parsedDate = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
  } else {
    const fallback = new Date(normalized);
    if (!Number.isNaN(fallback.getTime())) {
      parsedDate = fallback;
    }
  }

  if (!parsedDate) {
    return normalized;
  }

  const formatted = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    // timeZone: "Asia/Jakarta",
  }).format(parsedDate);

  return `${formatted} WIB`;
}
