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
import { Readable } from "stream";

export class DownloaderCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "downloader",
    aliases: ["dl", "download", "yt", "youtube", "dla", "d", "ytdl"],
    description:
      "Download video or audio from YouTube, TikTok, Instagram, and other supported platforms.",
    helpText: `*Usage:*
• ${BotConfig.prefix}dl <url> — Download video or audio from YouTube, TikTok, IG, or other supported platforms.
• reply pesan lain yang berisi URL dengan ${BotConfig.prefix}dl

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
  private readonly SEND_TIMEOUT = 300000; // 5 minutes timeout
  private readonly MAX_MEDIA_SIZE_MB = 100; // Limit for normal media send
  private readonly MAX_DOCUMENT_SIZE_MB = 1000; // 1GB absolute limit

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

    if (flags.some((a) => ["ad", "da", "-ad", "-da"].includes(a))) {
      downloadMode = "audio";
      sendAsDocument = true;
    }
    if (flags.some((a) => ["vd", "dv", "-vd", "-dv"].includes(a))) {
      downloadMode = "video";
      sendAsDocument = true;
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

      const bestFormat =
        videoInfo?.formats?.find((f) => f.format_id === videoInfo.format_id) ||
        videoInfo;
      const protocol = (bestFormat?.protocol as string) || "";
      const isFragmentedProtocol =
        protocol.includes("m3u8") ||
        protocol.includes("dash") ||
        protocol.includes("mhtml");
      const useBuffer =
        isFragmentedProtocol && downloadMode === "video" && !sendAsDocument;

      log.info(
        `Adaptive Strategy: protocol=${protocol}, useBuffer=${useBuffer}`,
      );

      let mediaBuffer: Buffer | null = null;
      let mediaStream: Readable | null = null;
      let waitFn: (() => Promise<void>) | null = null;

      if (useBuffer) {
        log.info(
          "Using downloadToBuffer for fragmented protocol to ensure playability",
        );
        const result = await this.ytdl.downloadToBuffer(url, {
          audioOnly: downloadMode === "audio",
          proxy: isTikTok ? process.env.PROXY : undefined,
          onProgress: handleProgress,
          videoInfo: videoInfo,
        });
        mediaBuffer = result.buffer;
      } else {
        log.info("Using downloadAsStream for direct/audio protocol");
        const result = await this.ytdl.downloadAsStream(url, {
          audioOnly: downloadMode === "audio",
          useAria2c: false,
          concurrentFragments: 5,
          proxy: isTikTok ? process.env.PROXY : undefined,
          onProgress: handleProgress,
          videoInfo: videoInfo,
        });
        mediaStream = result.stream;
        waitFn = result.wait;
      }

      const durationText = this.formatDuration(videoInfo?.duration || 0);
      const title = videoInfo?.title || "Unknown";

      const fileSize =
        (videoInfo?.filesize as number) ||
        (videoInfo?.filesize_approx as number) ||
        0;
      const fileSizeMB = fileSize / (1024 * 1024);

      if (fileSize > 0 && fileSizeMB > this.MAX_DOCUMENT_SIZE_MB) {
        await sock.sendMessage(jid, {
          text: `❌ File terlalu besar (${fileSizeMB.toFixed(1)}MB). Maksimal limit bot adalah ${this.MAX_DOCUMENT_SIZE_MB}MB.`,
        });
        if (mediaStream) mediaStream.destroy();
        return;
      }

      if (fileSizeMB > this.MAX_MEDIA_SIZE_MB && !sendAsDocument) {
        sendAsDocument = true;
        await sock.sendMessage(jid, {
          text: `ℹ️ Ukuran file (${fileSizeMB.toFixed(1)}MB) melebihi batas media WA (100MB). Mengalihkan pengiriman sebagai *dokumen*...`,
        });
      }

      await sock.sendMessage(jid, {
        text: `📤 Mengirim ${downloadMode}${fileSizeMB > 0 ? ` (${fileSizeMB.toFixed(1)}MB)` : ""}...`,
      });

      const mediaSource: WAMediaUpload = mediaBuffer || {
        stream: mediaStream!,
      };

      if (downloadMode === "audio") {
        try {
          if (sendAsDocument) {
            const message: AnyMessageContent = {
              document: mediaSource,
              mimetype: "audio/mp3",
              fileName: this.normalizeFilename(title) + ".mp3",
            };
            await this.sendWithTimeout(sock, jid, message);
          } else {
            const message: AnyMessageContent = {
              audio: mediaSource,
              mimetype: "audio/mp4",
              fileName: this.normalizeFilename(title) + ".mp3",
            };
            await this.sendWithTimeout(sock, jid, message);
          }
        } catch (error) {
          log.error("Failed to send audio:", error);
          await sock.sendMessage(jid, {
            text: "Gagal mengirim audio. File mungkin terlalu besar atau koneksi timeout.",
          });
        }
      } else {
        try {
          if (fileSizeMB > 50) {
            await sock.sendMessage(jid, {
              text: "Mengirim video besar, mohon tunggu maksimal 5 menit.",
            });
          }

          if (sendAsDocument) {
            const message: AnyMessageContent = {
              document: mediaSource,
              mimetype: "video/mp4",
              fileName: this.normalizeFilename(title) + ".mp4",
            };
            await this.sendWithTimeout(sock, jid, message);
          } else {
            const message: AnyMessageContent = {
              video: mediaSource,
              mimetype: "video/mp4",
              fileName: this.normalizeFilename(title) + ".mp4",
            };
            await this.sendWithTimeout(sock, jid, message);
          }
        } catch (error) {
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
      }

      if (waitFn) {
        await waitFn().catch((e) => log.warn("yt-dlp wait error:", e));
      }

      if (progressMessageKey) {
        await sock.sendMessage(jid, {
          text: `✅ Download selesai!\n📹 *${title}*\n⏱️ Durasi: ${durationText}`,
          edit: progressMessageKey,
        });
      }
      return;
    } catch (error) {
      log.error("Download failed:", error);
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
