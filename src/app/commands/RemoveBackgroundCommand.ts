import { downloadMediaMessage, proto, WAMessage } from "baileys";
import { removeBackground } from "@imgly/background-removal-node";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import {
  BotConfig,
  getCurrentConfig,
  log,
} from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import sharp from "sharp";

export class RemoveBackgroundCommand extends CommandInterface {
  private static isModelReady = false;
  private static hasShownFirstRunNotice = false;

  static commandInfo: CommandInfo = {
    name: "removebg",
    aliases: ["nobg", "rmbg", "bgremove"],
    description: "Hapus background gambar dan kirim hasil PNG transparan.",
    helpText: `*Cara pakai:* 🪄
• Kirim gambar dengan caption *${BotConfig.prefix}removebg*
• Reply gambar dengan *${BotConfig.prefix}removebg*

*Alias:*
• *${BotConfig.prefix}nobg*
• *${BotConfig.prefix}rmbg*

*Opsi:*
• *${BotConfig.prefix}removebg --sticker* — kirim hasil sebagai sticker
• *${BotConfig.prefix}removebg -s* — alias singkat sticker mode

*Catatan:*
• Hasil dikirim sebagai dokumen PNG biar transparansi tetap aman
• Proses pertama akan download model *medium* dan bisa lebih lama

👑 *VIP command:* hanya untuk user VIP`,
    category: "utility",
    commandClass: RemoveBackgroundCommand,
    cooldown: 15000,
    maxUses: 3,
    vipOnly: true,
    vipBypassCooldown: true,
  };

  private readonly MAX_FILE_SIZE = 12 * 1024 * 1024; // 12MB

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    void sessionService;

    const config = await getCurrentConfig();
    const normalizedArgs = args.map((arg) => arg.toLowerCase());

    if (
      normalizedArgs.includes("help") ||
      normalizedArgs.includes("--help") ||
      normalizedArgs.includes("-h")
    ) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.info} ${RemoveBackgroundCommand.commandInfo.helpText}`,
      });
      return;
    }

    const sendAsSticker =
      normalizedArgs.includes("--sticker") ||
      normalizedArgs.includes("-s") ||
      normalizedArgs.includes("sticker");

    try {
      const imageBuffer = await this.extractImageBuffer(msg, jid, sock);

      if (!imageBuffer) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Kirim atau reply gambar dulu ya bestie 🖼️\n\n*Contoh:*\n• ${config.prefix}removebg\n• ${config.prefix}nobg`,
        });
        return;
      }

      if (imageBuffer.length > this.MAX_FILE_SIZE) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Gambar kamu terlalu besar (${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB).\n\nMaksimal *12MB* ya biar prosesnya lancar ✂️`,
        });
        return;
      }

      await sock.sendMessage(jid, {
        text: `${config.emoji.info} Lagi hapus background gambarnya... tunggu sebentar ya ✨`,
      });

      const shouldMonitorDownload = !RemoveBackgroundCommand.isModelReady;

      if (
        shouldMonitorDownload &&
        !RemoveBackgroundCommand.hasShownFirstRunNotice
      ) {
        RemoveBackgroundCommand.hasShownFirstRunNotice = true;
        await sock.sendMessage(jid, {
          text: `${config.emoji.info} Konfirmasi first run: model *medium* untuk remove background perlu didownload dulu (~80MB).\n\nProgress download akan aku update di chat ini ya.`,
        });
      }

      const progressCallback = shouldMonitorDownload
        ? this.createDownloadProgressReporter(jid, sock, config.emoji.info)
        : undefined;

      const resultBlob = await removeBackground(imageBuffer, {
        model: "medium",
        output: {
          format: "image/png",
          quality: 0.95,
        },
        progress: progressCallback,
      });

      const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

      if (resultBuffer.length === 0) {
        throw new Error("Empty remove-background result");
      }

      const timestamp = Date.now();
      const outputFileName = `removebg-${timestamp}.png`;

      if (sendAsSticker) {
        const stickerBuffer = await this.convertPngToSticker(resultBuffer);
        await sock.sendMessage(jid, {
          sticker: stickerBuffer,
        });
        await sock.sendMessage(jid, {
          text: `${config.emoji.success} Background berhasil dihapus dan dikirim sebagai sticker ✅`,
        });
      } else {
        await sock.sendMessage(jid, {
          document: resultBuffer,
          mimetype: "image/png",
          fileName: outputFileName,
          caption: `${config.emoji.success} Background berhasil dihapus!\n\nSimpan file PNG ini buat dapetin transparansi penuh ✅`,
        });
      }

      if (!RemoveBackgroundCommand.isModelReady) {
        RemoveBackgroundCommand.isModelReady = true;
        await sock.sendMessage(jid, {
          text: `${config.emoji.success} Model remove background sudah siap. Request berikutnya bakal lebih cepat 🚀`,
        });
      }

      log.info(`Background removed for user ${user} in ${jid}`);
    } catch (error) {
      log.error("Error in RemoveBackgroundCommand:", error);

      let errorMessage = `${config.emoji.error} Gagal hapus background gambar 😢\n\nCoba lagi pake gambar lain ya!`;

      if (error instanceof Error) {
        if (error.message.toLowerCase().includes("unsupported")) {
          errorMessage = `${config.emoji.error} Format gambar belum didukung.\n\nCoba kirim JPG/PNG/WebP ya.`;
        } else if (error.message.toLowerCase().includes("fetch")) {
          errorMessage = `${config.emoji.error} Gagal menyiapkan model remove background.\n\nCoba lagi sebentar lagi ya.`;
        }
      }

      await sock.sendMessage(jid, {
        text: errorMessage,
      });
    }
  }

  private createDownloadProgressReporter(
    jid: string,
    sock: WebSocketInfo,
    infoEmoji: string,
  ): (key: string, current: number, total: number) => void {
    const progressByKey = new Map<string, { current: number; total: number }>();
    let lastNotifiedMilestone = 0;
    let lastNotifyTime = 0;

    return (key: string, current: number, total: number) => {
      if (total <= 0) {
        return;
      }

      progressByKey.set(key, {
        current: Math.max(0, Math.min(current, total)),
        total,
      });

      let totalCurrent = 0;
      let totalSize = 0;

      for (const value of progressByKey.values()) {
        totalCurrent += value.current;
        totalSize += value.total;
      }

      if (totalSize <= 0) {
        return;
      }

      const percent = Math.floor((totalCurrent / totalSize) * 100);
      const milestone = Math.floor(percent / 10) * 10;
      const now = Date.now();

      if (milestone < 10 || milestone <= lastNotifiedMilestone) {
        return;
      }

      // Prevent rapid-fire updates when callback fires too frequently.
      if (now - lastNotifyTime < 2000 && milestone < 100) {
        return;
      }

      lastNotifiedMilestone = milestone;
      lastNotifyTime = now;

      const currentMB = (totalCurrent / 1024 / 1024).toFixed(1);
      const totalMB = (totalSize / 1024 / 1024).toFixed(1);

      void sock.sendMessage(jid, {
        text: `${infoEmoji} Download model removebg: ${milestone}% (${currentMB}/${totalMB} MB)`,
      });
    };
  }

  private async convertPngToSticker(pngBuffer: Buffer): Promise<Buffer> {
    return sharp(pngBuffer)
      .resize(512, 512, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .webp({
        quality: 95,
      })
      .toBuffer();
  }

  private async extractImageBuffer(
    msg: proto.IWebMessageInfo,
    jid: string,
    sock: WebSocketInfo,
  ): Promise<Buffer | null> {
    // Priority 1: image attached directly with command caption
    if (msg.message?.imageMessage) {
      const stream = await downloadMediaMessage(
        <WAMessage>msg,
        "buffer",
        {},
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          logger: log as any,
          reuploadRequest: sock.updateMediaMessage,
        },
      );
      return stream ? Buffer.from(stream) : null;
    }

    // Priority 2: image from quoted/replied message
    if (
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage
    ) {
      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;

      const quotedMsg: proto.IWebMessageInfo = {
        key: {
          remoteJid: jid,
          fromMe: !msg.message.extendedTextMessage.contextInfo.participant,
          id: msg.message.extendedTextMessage.contextInfo.stanzaId || "",
          participant: msg.message.extendedTextMessage.contextInfo.participant,
        },
        message: quoted,
      };

      const stream = await downloadMediaMessage(
        <WAMessage>quotedMsg,
        "buffer",
        {},
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          logger: log as any,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      return stream ? Buffer.from(stream) : null;
    }

    return null;
  }
}
