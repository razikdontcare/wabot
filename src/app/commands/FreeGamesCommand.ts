import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { BotConfig } from "../../infrastructure/config/config.js";
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

*Catatan:*
• Command ini hanya bisa dipakai di grup
• Grup yang mengaktifkan akan dapat notifikasi giveaway baru dari GamerPower API`,
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
      const newGiveaways = await freeGamesService.pollNewGiveaways();

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
  const endDate =
    giveaway.end_date && giveaway.end_date !== "N/A"
      ? giveaway.end_date
      : "Tidak diketahui";
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
