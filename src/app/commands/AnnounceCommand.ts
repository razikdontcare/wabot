import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import {
  BotConfig,
  getCurrentConfig,
  log,
} from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import {
  fetchJoinedGroups,
  resolveGroup,
  sendGroupText,
  type GroupSummary,
} from "../../shared/utils/groupDirectory.js";
import { isAdminConsideringAlt } from "../../shared/utils/userRoles.js";
import { formatResponseForWhatsApp } from "../../shared/utils/whatsapp_formatter.js";

const MAX_ANNOUNCEMENT_LENGTH = 4000;
const MAX_LISTED_GROUPS = 40;

export function formatGroupDirectory(
  groups: readonly GroupSummary[],
): string {
  const listed = groups.slice(0, MAX_LISTED_GROUPS);
  const lines = listed.map((group, index) => {
    const flags = group.announce ? " · hanya admin" : "";
    return `${index + 1}. *${group.subject}* — ${group.participants} anggota${flags}\n   \`${group.jid}\``;
  });

  const remaining = groups.length - listed.length;
  const suffix = remaining > 0 ? `\n\n_…dan ${remaining} grup lainnya._` : "";

  return `${lines.join("\n")}${suffix}`;
}

/**
 * Accepts:
 * - `<grup> | <pesan>` (spaces allowed on both sides)
 * - `<jid@g.us> <pesan>`
 * - `<grup>` with the announcement taken from a replied message
 */
export function parseAnnouncementArgs(
  args: readonly string[],
  quotedText = "",
): { groupQuery: string; message: string } {
  const raw = args.join(" ").trim();
  const quoted = quotedText.trim();

  if (!raw) {
    return { groupQuery: "", message: quoted };
  }

  const pipeIndex = raw.indexOf("|");
  if (pipeIndex >= 0) {
    return {
      groupQuery: raw.slice(0, pipeIndex).trim(),
      message: raw.slice(pipeIndex + 1).trim() || quoted,
    };
  }

  const [first, ...rest] = args;
  if (first && /@g\.us$/i.test(first)) {
    return { groupQuery: first, message: rest.join(" ").trim() || quoted };
  }

  return { groupQuery: raw, message: quoted };
}

function extractQuotedText(msg: proto.IWebMessageInfo): string {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return "";

  return (
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption ||
    ""
  ).trim();
}

export class AnnounceCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "announce",
    aliases: ["pengumuman", "groupmsg"],
    description:
      "Kirim pengumuman ke grup lain yang diikuti bot (admin only).",
    helpText: `*Kirim pengumuman ke grup (admin):*
• *${BotConfig.prefix}announce list* — lihat semua grup yang diikuti bot
• *${BotConfig.prefix}announce <nama grup> | <pesan>* — kirim ke grup
• *${BotConfig.prefix}announce <JID@g.us> <pesan>* — kirim langsung via JID
• Reply sebuah pesan lalu *${BotConfig.prefix}announce <nama grup>* — isi pesan yang di-reply jadi pengumuman

*Contoh:*
• ${BotConfig.prefix}announce Info Bot | Bot maintenance pukul 22.00 WIB.
• ${BotConfig.prefix}announce 1203630xxxxx@g.us Halo semua!

_Nama grup harus unik; kalau ambigu, pakai JID dari \`announce list\`._`,
    category: "admin",
    commandClass: AnnounceCommand,
    requiredRoles: ["admin"],
    cooldown: 3000,
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    _sessionService: SessionService,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    const config = await getCurrentConfig();

    if (!(await isAdminConsideringAlt(user, msg))) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Hanya admin yang dapat menggunakan command ini.`,
      });
      return;
    }

    const action = args[0]?.toLowerCase();

    if (args.length === 0 || action === "help") {
      await sock.sendMessage(jid, {
        text: AnnounceCommand.commandInfo.helpText || "",
      });
      return;
    }

    if (action === "list" || action === "groups" || action === "daftar") {
      await this.sendGroupList(jid, sock);
      return;
    }

    const isSendPrefix = action === "send" || action === "kirim";
    const parsedArgs = isSendPrefix ? args.slice(1) : args;
    const { groupQuery, message } = parseAnnouncementArgs(
      parsedArgs,
      extractQuotedText(msg),
    );

    if (!groupQuery) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Nama grup belum diisi.\n\nContoh: *${config.prefix}announce Info Bot | Pesan pengumuman*`,
      });
      return;
    }

    if (!message) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Isi pengumumannya belum ada.\n\nGunakan *${config.prefix}announce ${groupQuery} | <pesan>*, atau reply pesan yang mau dikirim.`,
      });
      return;
    }

    if (message.length > MAX_ANNOUNCEMENT_LENGTH) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Pesan terlalu panjang (${message.length}/${MAX_ANNOUNCEMENT_LENGTH} karakter).`,
      });
      return;
    }

    try {
      const groups = await fetchJoinedGroups(sock);
      const resolution = resolveGroup(groups, groupQuery);

      if (resolution.status === "ambiguous") {
        const candidates = resolution.candidates
          .map((group) => `• *${group.subject}* — \`${group.jid}\``)
          .join("\n");
        await sock.sendMessage(jid, {
          text: `⚠️ Nama grup *${groupQuery}* ambigu. Pilih salah satu:\n\n${candidates}\n\nKirim ulang dengan JID di atas.`,
        });
        return;
      }

      if (resolution.status === "not_found") {
        const suggestions =
          resolution.suggestions.length > 0
            ? `\n\nMungkin maksudnya:\n${resolution.suggestions
                .map((group) => `• *${group.subject}* — \`${group.jid}\``)
                .join("\n")}`
            : "";
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Grup *${groupQuery}* tidak ditemukan.${suggestions}\n\nLihat daftar lengkap dengan *${config.prefix}announce list*.`,
        });
        return;
      }

      const target = resolution.group;
      const formatted = formatResponseForWhatsApp(message);
      const messageId = await sendGroupText(sock, target.jid, formatted);

      log.info(
        `Announcement sent by ${user} to ${target.jid} (${target.subject})`,
      );

      await sock.sendMessage(jid, {
        text: `✅ Pengumuman terkirim ke *${target.subject}*\n${target.jid}\n\nID pesan: ${messageId || "-"}`,
      });
    } catch (error) {
      log.error("Failed to send announcement:", error);
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Gagal mengirim pengumuman: ${
          error instanceof Error ? error.message : "kesalahan tidak diketahui"
        }`,
      });
    }
  }

  private async sendGroupList(
    jid: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    const config = await getCurrentConfig();

    try {
      const groups = await fetchJoinedGroups(sock);

      if (groups.length === 0) {
        await sock.sendMessage(jid, {
          text: "Bot belum bergabung di grup mana pun.",
        });
        return;
      }

      await sock.sendMessage(jid, {
        text:
          `*Grup yang diikuti bot (${groups.length}):*\n\n` +
          `${formatGroupDirectory(groups)}\n\n` +
          `_Kirim pengumuman: *${config.prefix}announce <nama grup> | <pesan>*_`,
      });
    } catch (error) {
      log.error("Failed to list joined groups:", error);
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Gagal mengambil daftar grup: ${
          error instanceof Error ? error.message : "kesalahan tidak diketahui"
        }`,
      });
    }
  }
}
