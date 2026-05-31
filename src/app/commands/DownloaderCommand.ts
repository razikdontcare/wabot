import { proto, AnyMessageContent, WAMediaUpload } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { BotConfig, log } from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import {
  YtDlpWrapper,
  YtDlpVideoInfo,
  DownloadProgress,
} from "../../shared/utils/ytdlp.js";
import extractUrlsFromText from "../../shared/utils/extractUrlsFromText.js";
import { createReadStream } from "fs";
import {
  registerPublicDownload,
  removePublicDownload,
} from "../../shared/utils/publicDownloadStore.js";
import {
  DownloadQueueManager,
  startDownloadQueueCleanup,
} from "../../shared/utils/downloadQueue.js";

export class DownloaderCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "downloader",
    aliases: ["dl", "download", "yt", "youtube", "dla", "d", "ytdl"],
    description:
      "Download video or audio from YouTube, TikTok, Instagram, and other supported platforms.",
    helpText: `*Usage:*
• ${BotConfig.prefix}dl <url> — Download video or audio from YouTube, TikTok, IG, or other supported platforms.
• reply pesan lain yang berisi URL dengan ${BotConfig.prefix}dl
• ${BotConfig.prefix}dl --default-ua <url> — Gunakan user-agent default yt-dlp (untuk TikTok jika curl UA gagal)

*Example:*
• ${BotConfig.prefix}dl https://vt.tiktok.com/ZSrG9QPK7/
• ${BotConfig.prefix}dl https://www.youtube.com/watch?v=dQw4w9WgXcQ`,
    category: "general",
    commandClass: DownloaderCommand,
    cooldown: 10000,
    maxUses: 5,
    vipBypassCooldown: true, // VIP users bypass cooldown
  };

  private ytdl = new YtDlpWrapper();
  private readonly SEND_TIMEOUT = 1800000; // 30 minutes timeout (for large file downloads)
  private readonly MAX_MEDIA_SIZE_MB = 100; // Limit for normal media send
  private readonly MAX_DOCUMENT_SIZE_MB = 512; // 512MB absolute limit
  private readonly TIKTOK_USER_AGENT = "curl/8.4.0";
  private queueManager = DownloadQueueManager.getInstance();

  constructor() {
    super();
    // Initialize cleanup scheduler on first instantiation
    if (!this.queueManager) {
      startDownloadQueueCleanup();
    }
  }

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    if (args.length > 0 && args[0] === "help") {
      await sock.sendMessage(jid, {
        text: `Usage: ${DownloaderCommand.commandInfo.helpText}`,
      });
      return;
    }

    let downloadMode: "audio" | "video" = "video";
    let sendAsDocument = false;
    let useDefaultUserAgent = false;

    const flags = args.map((a) => a.toLowerCase());
    if (flags.some((a) => ["audio", "a", "-a", "--audio", "mp3"].includes(a)))
      downloadMode = "audio";
    if (flags.some((a) => ["video", "v", "-v", "--video", "mp4"].includes(a)))
      downloadMode = "video";
    if (
      flags.some((a) =>
        ["document", "doc", "d", "-d", "--doc", "--document"].includes(a),
      )
    )
      sendAsDocument = true;
    if (
      flags.some((a) =>
        [
          "default-ua",
          "--default-ua",
          "native-ua",
          "--native-ua",
          "ytdlp-ua",
          "--ytdlp-ua",
        ].includes(a),
      )
    ) {
      useDefaultUserAgent = true;
    }
    log.info("Download mode set to:", downloadMode);

    let url = extractUrlsFromText(args.join(" "))[0] || null;
    if (!url && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      let quotedText = "";
      if (quoted?.conversation) quotedText = quoted.conversation;
      else if (quoted?.extendedTextMessage?.text)
        quotedText = quoted.extendedTextMessage.text;
      else if (quoted?.imageMessage?.caption)
        quotedText = quoted.imageMessage.caption;
      if (quotedText) {
        const urls = extractUrlsFromText(quotedText);
        url = urls[0] || null;
      }
    }

    const isTikTok = url ? this.isTikTokUrl(url) : false;

    if (!url) {
      await sock.sendMessage(jid, {
        text: "Silakan masukkan URL yang valid atau balas pesan yang berisi URL.",
      });
      return;
    }

    // Check download queue
    const queueEntry = this.queueManager.addToQueue({
      id: `${jid}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      url,
      jid,
      user,
      timestamp: Date.now(),
      status: "pending",
    });
    const downloadId = `${jid}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (!this.queueManager.canStart()) {
      await sock.sendMessage(jid, {
        text: `⏳ Download Anda dalam antrian.\n📍 Posisi: ${queueEntry.position + 1}/${queueEntry.queueSize}\n⏸️ Tunggu giliran Anda...`,
      });
      return;
    }

    // Mark download as started
    this.queueManager.startDownload(downloadId);

    try {
      const statusMsg = await sock.sendMessage(jid, {
        text: "🔍 Mengambil informasi media...",
      });
      const progressMessageKey = statusMsg?.key;

      let lastProgressUpdate = 0;
      const progressUpdateInterval = 3000;
      let isUpdating = false;

      const videoInfo: YtDlpVideoInfo = await this.ytdl.getVideoInfo(url, {
        proxy: isTikTok ? process.env.PROXY : undefined,
        userAgent: isTikTok && !useDefaultUserAgent ? this.TIKTOK_USER_AGENT : undefined,
      });

      const handleProgress = async (progress: DownloadProgress) => {
        if (
          !progress ||
          typeof progress.percent !== "number" ||
          typeof progress.speed !== "number"
        ) {
          return;
        }

        const now = Date.now();
        if (
          now - lastProgressUpdate > progressUpdateInterval &&
          !isUpdating &&
          progressMessageKey
        ) {
          isUpdating = true;
          lastProgressUpdate = now;

          try {
            const speedMBps = (progress.speed / (1024 * 1024)).toFixed(2);
            const percent = progress.percent.toFixed(1);
            const progressBar = this.createProgressBar(progress.percent);

            let text = `📥 *Downloading ${downloadMode.toUpperCase()}*\n\n`;
            text += `${progressBar} ${percent}%\n\n`;
            text += `⚡ Speed: ${speedMBps} MB/s\n`;

            if (
              progress.totalBytes &&
              typeof progress.totalBytes === "number"
            ) {
              const sizeMB = (progress.totalBytes / (1024 * 1024)).toFixed(1);
              const eta = progress.eta || 0;
              const etaMinutes = Math.floor(eta / 60);
              const etaSeconds = eta % 60;
              const etaText =
                etaMinutes > 0
                  ? `${etaMinutes}m ${etaSeconds}s`
                  : `${etaSeconds}s`;

              text += `📦 Size: ${sizeMB}MB\n`;
              text += `⏱️ ETA: ${etaText}`;
            }

            await sock.sendMessage(jid, {
              text: text,
              edit: progressMessageKey,
            });
          } catch (error) {
            log.warn("Failed to edit progress message:", error);
          } finally {
            isUpdating = false;
          }
        }
      };

      if (progressMessageKey) {
        await sock.sendMessage(jid, {
          text: "🔄 Memulai download...",
          edit: progressMessageKey,
        });
      }

      log.info("Using file-based download to ensure playability");
      const downloadResult = await this.ytdl.downloadToFile(url, {
        audioOnly: downloadMode === "audio",
        useAria2c: false,
        concurrentFragments: 5,
        proxy: isTikTok ? process.env.PROXY : undefined,
        onProgress: handleProgress,
        videoInfo: videoInfo,
        userAgent: isTikTok && !useDefaultUserAgent ? this.TIKTOK_USER_AGENT : undefined,
      });

      const durationText = this.formatDuration(videoInfo?.duration || 0);
      const title = videoInfo?.title || "Unknown";

      const fileSize = downloadResult.size ||
        (videoInfo?.filesize as number) ||
        (videoInfo?.filesize_approx as number) ||
        0;
      const fileSizeMB = fileSize / (1024 * 1024);

      if (fileSize > 0 && fileSizeMB > this.MAX_DOCUMENT_SIZE_MB) {
        await sock.sendMessage(jid, {
          text: `❌ File terlalu besar (${fileSizeMB.toFixed(1)}MB). Maksimal limit bot adalah ${this.MAX_DOCUMENT_SIZE_MB}MB.`,
        });
        await downloadResult.cleanup();
        return;
      }

      const normalizedTitle = this.normalizeFilename(title);
      const fileExtension = downloadMode === "audio" ? "mp3" : "mp4";
      const fileName = `${normalizedTitle}.${fileExtension}`;
      const mimeType = downloadMode === "audio" ? "audio/mpeg" : "video/mp4";

      if (fileSizeMB > this.MAX_MEDIA_SIZE_MB) {
        const entry = registerPublicDownload({
          filePath: downloadResult.filePath,
          filename: fileName,
          size: fileSize,
          mimeType,
        });
        const baseUrl = this.getPublicDownloadBaseUrl();
        const link = `${baseUrl}/downloads/${entry.token}`;
        const expiresInSeconds = Math.max(
          0,
          Math.floor((entry.expiresAt - Date.now()) / 1000),
        );
        const expiresText = this.formatDuration(expiresInSeconds);

        try {
          await sock.sendMessage(jid, {
            text: `📦 File terlalu besar untuk dikirim lewat WhatsApp.\n🔗 Link download: ${link}\n⏳ Berlaku selama ${expiresText}.`,
          });
          if (progressMessageKey) {
            await sock.sendMessage(jid, {
              text: `✅ Download selesai!\n📹 *${title}*\n⏱️ Durasi: ${durationText}\n🔗 ${link}`,
              edit: progressMessageKey,
            });
          }
          return;
        } catch (error) {
          await removePublicDownload(entry.token);
          throw error;
        }
      }

      const mediaStream = createReadStream(downloadResult.filePath);
      const mediaSource: WAMediaUpload = { stream: mediaStream };

      try {
        if (downloadMode === "audio") {
          if (sendAsDocument) {
            const message: AnyMessageContent = {
              document: mediaSource,
              mimetype: "audio/mp3",
              fileName,
            };
            await this.sendWithTimeout(sock, jid, message);
          } else {
            const message: AnyMessageContent = {
              audio: mediaSource,
              mimetype: "audio/mp4",
              fileName,
            };
            await this.sendWithTimeout(sock, jid, message);
          }
        } else {
          if (fileSizeMB > 50) {
            await sock.sendMessage(jid, {
              text: "Mengirim video besar, mohon tunggu maksimal 5 menit.",
            });
          }

          if (sendAsDocument) {
            const message: AnyMessageContent = {
              document: mediaSource,
              mimetype: "video/mp4",
              fileName,
            };
            await this.sendWithTimeout(sock, jid, message);
          } else {
            const message: AnyMessageContent = {
              video: mediaSource,
              mimetype: "video/mp4",
              fileName,
            };
            await this.sendWithTimeout(sock, jid, message);
          }
        }
      } catch (error) {
        if (downloadMode === "audio") {
          log.error("Failed to send audio:", error);
          await sock.sendMessage(jid, {
            text: "Gagal mengirim audio. File mungkin terlalu besar atau koneksi timeout.",
          });
        } else {
          log.error("Failed to send video:", error);
          if (error instanceof Error && error.message.includes("timeout")) {
            await sock.sendMessage(jid, {
              text: "Timeout saat mengirim video. File mungkin terlalu besar.",
            });
          } else {
            await sock.sendMessage(jid, {
              text: "Gagal mengirim video. File mungkin terlalu besar atau terjadi kesalahan.",
            });
          }
        }
      } finally {
        mediaStream.destroy();
        await downloadResult.cleanup();
      }

      if (progressMessageKey) {
        await sock.sendMessage(jid, {
          text: `✅ Download selesai!\n📹 *${title}*\n⏱️ Durasi: ${durationText}`,
          edit: progressMessageKey,
        });
      }
      this.queueManager.completeDownload(downloadId);
      return;
    } catch (error) {
      log.error("Download failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.queueManager.failDownload(downloadId, errorMessage);
      await this.handleDownloadError(error, sock, jid);
      return;
    }
  }

  private createProgressBar(percent: number): string {
    const size = 10;
    const progress = Math.round((size * percent) / 100);
    const emptyProgress = size - progress;
    const progressText = "█".repeat(progress);
    const emptyProgressText = "░".repeat(emptyProgress);
    return `[${progressText}${emptyProgressText}]`;
  }

  private async sendWithTimeout(
    sock: WebSocketInfo,
    jid: string,
    message: AnyMessageContent,
    timeoutMs: number = this.SEND_TIMEOUT,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Send timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      sock
        .sendMessage(jid, message)
        .then(() => {
          clearTimeout(timeout);
          resolve(true);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private normalizeFilename(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private formatDuration(seconds: number): string {
    if (seconds === 0) return "Unknown";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts: string[] = [];

    if (hours > 0) parts.push(`${hours} jam`);
    if (minutes > 0) parts.push(`${minutes} menit`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs} detik`);

    return parts.join(" ");
  }

  private getPublicDownloadBaseUrl(): string {
    const baseUrl = process.env.PUBLIC_DOWNLOAD_BASE_URL ||
      `http://${process.env.BOT_HOST || "localhost"}:${process.env.BOT_PORT || 5000}`;
    return baseUrl.replace(/\/$/, ""); // Remove trailing slash
  }

  private isTikTokUrl(input: string): boolean {
    try {
      const hostname = new URL(input).hostname.toLowerCase();
      return (
        hostname === "tiktok.com" ||
        hostname.endsWith(".tiktok.com") ||
        hostname.includes("tiktok.com")
      );
    } catch {
      return false;
    }
  }

  private async handleDownloadError(
    error: unknown,
    sock: WebSocketInfo,
    jid: string,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("timeout")) {
      await sock.sendMessage(jid, {
        text: "⏰ Timeout saat mengunduh. Coba lagi atau gunakan URL yang berbeda.",
      });
    } else if (errorMessage.includes("too long")) {
      await sock.sendMessage(jid, {
        text: `⏱️ ${errorMessage}`,
      });
    } else if (errorMessage.includes("Live streams")) {
      await sock.sendMessage(jid, {
        text: "📺 Live stream tidak didukung. Gunakan video yang sudah selesai.",
      });
    } else if (errorMessage.includes("Private video")) {
      await sock.sendMessage(jid, {
        text: "🔒 Video private tidak dapat diunduh.",
      });
    } else {
      await sock.sendMessage(jid, {
        text: "❌ Gagal mengunduh media. Periksa URL dan coba lagi.",
      });
    }
  }
}
