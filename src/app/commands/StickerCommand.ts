import { downloadMediaMessage, proto, WAMessage } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import {
  BotConfig,
  getCurrentConfig,
  log,
} from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import sharp from "sharp";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import extractUrlsFromText from "../../shared/utils/extractUrlsFromText.js";
import {
  createFetchClient,
  isFetchError,
} from "../../shared/utils/fetchClient.js";

export class StickerCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "sticker",
    aliases: ["s", "stiker"],
    description: "Convert gambar, video, atau GIF menjadi sticker WhatsApp.",
    helpText: `*Cara pakai:* 🎨
• Kirim gambar/video dengan caption *${BotConfig.prefix}sticker*
• Reply gambar/video/GIF dengan *${BotConfig.prefix}sticker*
• Kirim link media (contoh Giphy/Tenor) dengan *${BotConfig.prefix}sticker <url>*
• Cari GIF Giphy: *${BotConfig.prefix}sticker giphy <kata kunci>*
• Cari GIF Tenor: *${BotConfig.prefix}sticker tenor <kata kunci>*

*Opsi:*
• *${BotConfig.prefix}sticker --crop* — Crop ke tengah (512x512)
• Default: auto-fit dengan padding putih

*Batasan:*
• Ukuran file: maksimal 16MB
• Video: maksimal 10 detik (akan jadi animated sticker 🎬)

*Contoh:*
• Kirim gambar dengan caption: *${BotConfig.prefix}s*
• Reply gambar: *${BotConfig.prefix}s*
• Dari link Giphy: *${BotConfig.prefix}s https://giphy.com/gifs/...*
• Cari di Giphy: *${BotConfig.prefix}s giphy kucing lucu*
• Cari di Tenor: *${BotConfig.prefix}s tenor kucing lucu*
• Crop mode: *${BotConfig.prefix}s --crop*

👑 *VIP Members:* No cooldown!`,
    category: "utility",
    commandClass: StickerCommand,
    cooldown: 5000,
    maxUses: 3,
    vipBypassCooldown: true,
  };

  private readonly MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB
  private readonly STICKER_SIZE = 512;
  private readonly URL_FETCH_TIMEOUT = 20000;
  private fetchClient = createFetchClient({
    timeout: this.URL_FETCH_TIMEOUT,
    headers: {
      "User-Agent": "NexaBot/1.0.0",
      Accept: "*/*",
    },
  });

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    const config = await getCurrentConfig();

    try {
      // Check for crop flag
      const useCrop =
        args.includes("crop") || args.includes("c") || args.includes("kotak");

      let mediaBuffer: Buffer | null = null;
      let mediaType: "image" | "video" | null = null;
      let sourceExtension = "mp4";

      // Priority 1: Check direct media message (image/video sent with command in caption)
      if (msg.message?.imageMessage) {
        mediaType = "image";
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
        mediaBuffer = stream ? Buffer.from(stream) : null;
      } else if (msg.message?.videoMessage) {
        mediaType = "video";
        sourceExtension =
          msg.message.videoMessage.gifPlayback ||
          msg.message.videoMessage.mimetype?.toLowerCase().includes("gif")
            ? "gif"
            : "mp4";
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
        mediaBuffer = stream ? Buffer.from(stream) : null;
      }
      // Priority 2: Check for quoted/replied message
      else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quoted =
          msg.message.extendedTextMessage.contextInfo.quotedMessage;

        if (quoted.imageMessage) {
          mediaType = "image";
          const quotedMsg: proto.IWebMessageInfo = {
            key: {
              remoteJid: jid,
              fromMe:
                !msg.message?.extendedTextMessage?.contextInfo?.participant,
              id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || "",
              participant:
                msg.message?.extendedTextMessage?.contextInfo?.participant,
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
          mediaBuffer = stream ? Buffer.from(stream) : null;
        } else if (quoted.videoMessage) {
          mediaType = "video";
          sourceExtension =
            quoted.videoMessage.gifPlayback ||
            quoted.videoMessage.mimetype?.toLowerCase().includes("gif")
              ? "gif"
              : "mp4";
          const quotedMsg: proto.IWebMessageInfo = {
            key: {
              remoteJid: jid,
              fromMe:
                !msg.message?.extendedTextMessage?.contextInfo?.participant,
              id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || "",
              participant:
                msg.message?.extendedTextMessage?.contextInfo?.participant,
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
          mediaBuffer = stream ? Buffer.from(stream) : null;
        } else if (quoted.stickerMessage) {
          await sock.sendMessage(jid, {
            text: `${config.emoji.error} Gambar yang kamu quote itu udah sticker bestie! 😅\n\nCoba quote gambar/video biasa aja.`,
          });
          return;
        }
      }

      // Priority 3: Check for URL source from args or quoted text
      if (!mediaBuffer || !mediaType) {
        const giphyQuery = this.extractGiphyQuery(args);

        if (giphyQuery) {
          try {
            const giphyMediaUrl = await this.searchGiphyMediaUrl(giphyQuery);

            if (!giphyMediaUrl) {
              await sock.sendMessage(jid, {
                text: `${config.emoji.error} Gak nemu hasil Giphy buat *${giphyQuery}* 😔\n\nCoba kata kunci lain ya.`,
              });
              return;
            }

            const downloadedMedia =
              await this.downloadMediaFromUrl(giphyMediaUrl);
            mediaBuffer = downloadedMedia.buffer;
            mediaType = downloadedMedia.mediaType;
            sourceExtension = downloadedMedia.sourceExtension;
          } catch (error) {
            log.error("Failed to create sticker from Giphy query:", error);

            const errorText =
              error instanceof Error
                ? error.message
                : "Gagal cari GIF dari Giphy. Coba lagi ya.";

            await sock.sendMessage(jid, {
              text: `${config.emoji.error} ${errorText}`,
            });
            return;
          }
        }

        const tenorQuery = this.extractTenorQuery(args);

        if ((!mediaBuffer || !mediaType) && tenorQuery) {
          try {
            const tenorMediaUrl = await this.searchTenorMediaUrl(tenorQuery);

            if (!tenorMediaUrl) {
              await sock.sendMessage(jid, {
                text: `${config.emoji.error} Gak nemu hasil Tenor buat *${tenorQuery}* 😔\n\nCoba kata kunci lain ya.`,
              });
              return;
            }

            const downloadedMedia =
              await this.downloadMediaFromUrl(tenorMediaUrl);
            mediaBuffer = downloadedMedia.buffer;
            mediaType = downloadedMedia.mediaType;
            sourceExtension = downloadedMedia.sourceExtension;
          } catch (error) {
            log.error("Failed to create sticker from Tenor query:", error);

            const errorText =
              error instanceof Error
                ? error.message
                : "Gagal cari GIF dari Tenor. Coba lagi ya.";

            await sock.sendMessage(jid, {
              text: `${config.emoji.error} ${errorText}`,
            });
            return;
          }
        }

        const sourceUrl = this.extractSourceUrl(args, msg);

        if ((!mediaBuffer || !mediaType) && sourceUrl) {
          try {
            const downloadedMedia = await this.downloadMediaFromUrl(sourceUrl);
            mediaBuffer = downloadedMedia.buffer;
            mediaType = downloadedMedia.mediaType;
            sourceExtension = downloadedMedia.sourceExtension;
          } catch (error) {
            log.error("Failed to create sticker from URL source:", error);

            const errorText =
              error instanceof Error
                ? error.message
                : "Gagal ambil media dari URL. Coba link lain ya.";

            await sock.sendMessage(jid, {
              text: `${config.emoji.error} ${errorText}`,
            });
            return;
          }
        }

        if ((!mediaBuffer || !mediaType) && this.isGiphyMode(args)) {
          await sock.sendMessage(jid, {
            text: `${config.emoji.error} Kata kunci Giphy-nya mana bestie? 🤔\n\nContoh: *${config.prefix}sticker giphy kucing lucu*`,
          });
          return;
        }

        if ((!mediaBuffer || !mediaType) && this.isTenorMode(args)) {
          await sock.sendMessage(jid, {
            text: `${config.emoji.error} Kata kunci Tenor-nya mana bestie? 🤔\n\nContoh: *${config.prefix}sticker tenor kucing lucu*`,
          });
          return;
        }
      }

      if (!mediaBuffer || !mediaType) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Mana gambar/video/link media-nya bestie? 🤔\n\n*Cara pakai:*\n• Kirim gambar/video dengan caption *${config.prefix}sticker*\n• Reply gambar/video dengan *${config.prefix}sticker*\n• Kasih link media (contoh Giphy/Tenor) dengan *${config.prefix}sticker <url>*\n• Cari GIF Giphy: *${config.prefix}sticker giphy <kata kunci>*\n• Cari GIF Tenor: *${config.prefix}sticker tenor <kata kunci>*\n\nPake *--crop* buat crop mode!`,
        });
        return;
      }

      // Check file size
      if (mediaBuffer.length > this.MAX_FILE_SIZE) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Waduh, file-nya terlalu gede nih (${(mediaBuffer.length / 1024 / 1024).toFixed(2)}MB)!\n\nMaksimal 16MB ya bestie 📦`,
        });
        return;
      }

      // Process media to sticker
      let stickerBuffer: Buffer;

      if (mediaType === "video") {
        // Create animated sticker from video
        stickerBuffer = await this.createAnimatedSticker(
          mediaBuffer,
          useCrop,
          sourceExtension,
        );
      } else {
        stickerBuffer = await this.createSticker(mediaBuffer, useCrop);
      }

      // Send sticker
      await sock.sendMessage(jid, {
        sticker: stickerBuffer,
      });

      log.info(`Sticker created for user ${user} in ${jid}`);
    } catch (error) {
      log.error("Error in StickerCommand:", error);
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Yah ada error nih pas bikin sticker 😢\n\nCoba lagi atau pakai gambar yang lain!`,
      });
    }
  }

  private extractSourceUrl(
    args: string[],
    msg: proto.IWebMessageInfo,
  ): string | null {
    const commandText = args.filter((arg) => !arg.startsWith("--")).join(" ");
    const urlFromArgs = extractUrlsFromText(commandText)[0];

    if (urlFromArgs) {
      return this.normalizeUrl(urlFromArgs);
    }

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) {
      return null;
    }

    const quotedText =
      quoted.conversation ||
      quoted.extendedTextMessage?.text ||
      quoted.imageMessage?.caption ||
      quoted.videoMessage?.caption ||
      "";

    const urlFromQuoted = extractUrlsFromText(quotedText)[0];
    return urlFromQuoted ? this.normalizeUrl(urlFromQuoted) : null;
  }

  private isGiphyMode(args: string[]): boolean {
    const normalizedArgs = args
      .filter((arg) => !arg.startsWith("--"))
      .map((arg) => arg.toLowerCase());

    return normalizedArgs[0] === "giphy";
  }

  private isTenorMode(args: string[]): boolean {
    const normalizedArgs = args
      .filter((arg) => !arg.startsWith("--"))
      .map((arg) => arg.toLowerCase());

    return normalizedArgs[0] === "tenor";
  }

  private extractGiphyQuery(args: string[]): string | null {
    const normalizedArgs = args.filter((arg) => !arg.startsWith("--"));
    if (
      normalizedArgs.length < 2 ||
      normalizedArgs[0].toLowerCase() !== "giphy"
    ) {
      return null;
    }

    const query = normalizedArgs.slice(1).join(" ").trim();
    if (!query) {
      return null;
    }

    const maybeUrl = extractUrlsFromText(query)[0];
    return maybeUrl ? null : query;
  }

  private extractTenorQuery(args: string[]): string | null {
    const normalizedArgs = args.filter((arg) => !arg.startsWith("--"));
    if (
      normalizedArgs.length < 2 ||
      normalizedArgs[0].toLowerCase() !== "tenor"
    ) {
      return null;
    }

    const query = normalizedArgs.slice(1).join(" ").trim();
    if (!query) {
      return null;
    }

    const maybeUrl = extractUrlsFromText(query)[0];
    return maybeUrl ? null : query;
  }

  private async searchGiphyMediaUrl(query: string): Promise<string | null> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (!normalizedQuery) {
      return null;
    }

    const searchUrl = `https://giphy.com/search/${encodeURIComponent(normalizedQuery)}`;
    const response = await this.fetchClient.get<string>(searchUrl, {
      responseType: "text",
      timeout: this.URL_FETCH_TIMEOUT,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const giphyId = this.extractFirstGiphyIdFromHtml(response.data);
    if (!giphyId) {
      return null;
    }

    return `https://media.giphy.com/media/${giphyId}/giphy.mp4`;
  }

  private async searchTenorMediaUrl(query: string): Promise<string | null> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (!normalizedQuery) {
      return null;
    }

    type TenorResponse = {
      results?: Array<{
        media_formats?: Record<string, { url?: string }>;
      }>;
    };

    const response = await this.fetchClient.get<TenorResponse>(
      "https://g.tenor.com/v1/search",
      {
        params: {
          q: normalizedQuery,
          key: "LIVDSRZULELA",
          limit: 1,
          media_filter: "mp4,gif,webm",
          contentfilter: "medium",
        },
        responseType: "json",
        timeout: this.URL_FETCH_TIMEOUT,
        validateStatus: (status) => status >= 200 && status < 400,
      },
    );

    const mediaFormats = response.data.results?.[0]?.media_formats;
    return this.pickTenorMediaUrl(mediaFormats);
  }

  private pickTenorMediaUrl(
    mediaFormats?: Record<string, { url?: string }>,
  ): string | null {
    if (!mediaFormats) {
      return null;
    }

    const preferredFormats = [
      "mp4",
      "tinymp4",
      "nanomp4",
      "gif",
      "tinygif",
      "nanogif",
      "webm",
      "tinywebm",
    ];

    for (const formatKey of preferredFormats) {
      const url = mediaFormats[formatKey]?.url;
      if (url) {
        return url;
      }
    }

    return null;
  }

  private extractFirstGiphyIdFromHtml(html: string): string | null {
    const patterns = [
      /"id":"([a-zA-Z0-9]+)"/,
      /media\.giphy\.com\/media\/([a-zA-Z0-9]+)\/giphy\.(?:gif|mp4)/,
      /\/gifs\/[a-z0-9-]*-([a-zA-Z0-9]+)(?=["'/])/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  private normalizeUrl(url: string): string {
    return url.startsWith("www.") ? `https://${url}` : url;
  }

  private async downloadMediaFromUrl(url: string): Promise<{
    buffer: Buffer;
    mediaType: "image" | "video";
    sourceExtension: string;
  }> {
    this.validateSourceUrl(url);
    const resolvedUrl = this.resolveKnownProviderUrl(url);

    try {
      return await this.fetchMediaFromUrl(resolvedUrl, 0);
    } catch (error) {
      if (isFetchError(error)) {
        const status = error.response?.status;
        if (status === 403 || status === 404) {
          throw new Error(
            "URL ini gak bisa diakses. Coba link media langsung ya.",
          );
        }

        throw new Error(
          "Gagal ambil media dari URL. Coba link lain atau ulangi sebentar lagi.",
        );
      }

      throw error;
    }
  }

  private resolveKnownProviderUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase();

      if (!hostname.includes("giphy.com")) {
        return url;
      }

      const giphyId = this.extractGiphyId(parsedUrl.pathname);
      if (!giphyId) {
        return url;
      }

      return `https://media.giphy.com/media/${giphyId}/giphy.mp4`;
    } catch {
      return url;
    }
  }

  private extractGiphyId(pathname: string): string | null {
    const pathParts = pathname.split("/").filter(Boolean);

    const mediaIndex = pathParts.indexOf("media");
    if (mediaIndex >= 0 && pathParts[mediaIndex + 1]) {
      return pathParts[mediaIndex + 1];
    }

    const lastPathSegment = pathParts[pathParts.length - 1] || "";
    const candidate = lastPathSegment.split("-").pop() || "";

    return /^[a-zA-Z0-9]+$/.test(candidate) ? candidate : null;
  }

  private async fetchMediaFromUrl(
    url: string,
    depth: number,
  ): Promise<{
    buffer: Buffer;
    mediaType: "image" | "video";
    sourceExtension: string;
  }> {
    if (depth > 2) {
      throw new Error(
        "Terlalu banyak redirect/halaman perantara. Kasih link media langsung ya.",
      );
    }

    const response = await this.fetchClient.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: this.URL_FETCH_TIMEOUT,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

    if (contentLength > this.MAX_FILE_SIZE) {
      throw new Error("File dari URL terlalu besar. Maksimal 16MB ya.");
    }

    const buffer = Buffer.from(response.data);

    if (buffer.length > this.MAX_FILE_SIZE) {
      throw new Error("File dari URL terlalu besar. Maksimal 16MB ya.");
    }

    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .toLowerCase();

    if (
      contentType === "text/html" ||
      contentType === "application/xhtml+xml"
    ) {
      const htmlContent = buffer.toString("utf8");
      const mediaUrl = this.extractMediaUrlFromHtml(htmlContent, url);

      if (!mediaUrl) {
        throw new Error(
          "Link ini bukan media langsung. Coba link gambar/video/GIF ya.",
        );
      }

      this.validateSourceUrl(mediaUrl);
      return this.fetchMediaFromUrl(mediaUrl, depth + 1);
    }

    const detectedMedia = this.detectMediaType(contentType, url);
    if (!detectedMedia) {
      throw new Error(
        "Format media dari link ini belum didukung buat sticker.",
      );
    }

    return {
      buffer,
      mediaType: detectedMedia.mediaType,
      sourceExtension: detectedMedia.extension,
    };
  }

  private extractMediaUrlFromHtml(
    html: string,
    baseUrl: string,
  ): string | null {
    const patterns = [
      /<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<source[^>]+src=["']([^"']+)["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const mediaUrl = match[1].replace(/&amp;/g, "&");

      try {
        return new URL(mediaUrl, baseUrl).toString();
      } catch {
        continue;
      }
    }

    return null;
  }

  private detectMediaType(
    contentType: string,
    url: string,
  ): { mediaType: "image" | "video"; extension: string } | null {
    const extensionFromUrl = this.getExtensionFromUrl(url);
    const extensionFromMime = this.getExtensionFromMime(contentType);

    if (contentType.startsWith("video/")) {
      return {
        mediaType: "video",
        extension: extensionFromMime || extensionFromUrl || "mp4",
      };
    }

    if (contentType.startsWith("image/")) {
      if (contentType === "image/gif" || extensionFromUrl === "gif") {
        return {
          mediaType: "video",
          extension: "gif",
        };
      }

      return {
        mediaType: "image",
        extension: extensionFromMime || extensionFromUrl || "png",
      };
    }

    if (!contentType || contentType === "application/octet-stream") {
      if (!extensionFromUrl) {
        return null;
      }

      if (["mp4", "webm", "mov", "mkv", "gif"].includes(extensionFromUrl)) {
        return {
          mediaType: "video",
          extension: extensionFromUrl,
        };
      }

      if (
        ["jpg", "jpeg", "png", "webp", "bmp", "tiff", "avif"].includes(
          extensionFromUrl,
        )
      ) {
        return {
          mediaType: "image",
          extension: extensionFromUrl,
        };
      }
    }

    return null;
  }

  private getExtensionFromUrl(url: string): string | null {
    try {
      const path = new URL(url).pathname;
      const extension = path.split(".").pop()?.toLowerCase() || "";

      return extension && /^[a-z0-9]+$/.test(extension) ? extension : null;
    } catch {
      return null;
    }
  }

  private getExtensionFromMime(contentType: string): string | null {
    const mimeMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "video/x-matroska": "mkv",
    };

    return mimeMap[contentType] || null;
  }

  private validateSourceUrl(url: string): void {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("URL-nya gak valid. Coba cek lagi link-nya ya.");
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("URL harus pakai http atau https.");
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local")
    ) {
      throw new Error("URL lokal tidak diizinkan.");
    }

    if (this.isPrivateIPv4(hostname)) {
      throw new Error("URL private network tidak diizinkan.");
    }
  }

  private isPrivateIPv4(hostname: string): boolean {
    const parts = hostname.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
      return false;
    }

    const [a, b] = parts.map(Number);

    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  private sanitizeExtension(extension: string): string {
    const normalized = extension.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (!normalized) {
      return "mp4";
    }

    if (normalized.length > 5) {
      return normalized.slice(0, 5);
    }

    return normalized;
  }

  /**
   * Create sticker from image buffer
   */
  private async createSticker(
    imageBuffer: Buffer,
    useCrop: boolean,
  ): Promise<Buffer> {
    try {
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        throw new Error("Invalid image dimensions");
      }

      let processed: sharp.Sharp;

      if (useCrop) {
        // Crop to center (512x512)
        const minDimension = Math.min(metadata.width, metadata.height);
        processed = image
          .extract({
            left: Math.floor((metadata.width - minDimension) / 2),
            top: Math.floor((metadata.height - minDimension) / 2),
            width: minDimension,
            height: minDimension,
          })
          .resize(this.STICKER_SIZE, this.STICKER_SIZE, {
            fit: "cover",
          });
      } else {
        // Auto-fit with white padding
        processed = image.resize(this.STICKER_SIZE, this.STICKER_SIZE, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 }, // Transparent background
        });
      }

      // Convert to WebP
      return await processed
        .webp({
          quality: 100,
          lossless: false,
        })
        .toBuffer();
    } catch (error) {
      log.error("Error creating sticker:", error);
      throw new Error("Failed to create sticker");
    }
  }

  /**
   * Create animated sticker from video
   */
  private async createAnimatedSticker(
    videoBuffer: Buffer,
    useCrop: boolean,
    sourceExtension: string = "mp4",
  ): Promise<Buffer> {
    const tempDir = tmpdir();
    const sessionId = randomUUID();
    const safeExtension = this.sanitizeExtension(sourceExtension);
    const inputPath = join(tempDir, `video_${sessionId}.${safeExtension}`);
    const outputPath = join(tempDir, `sticker_${sessionId}.webp`);

    try {
      // Write video to temp file
      await fs.writeFile(inputPath, videoBuffer);

      // Build ffmpeg filter for sticker conversion.
      // GIF sources use a higher frame-rate and slight speed-up so fast motion feels closer to the original.
      const isGifSource = safeExtension === "gif";
      const targetFps = isGifSource ? 18 : 10;
      const vfParts = ["format=rgba"];

      if (isGifSource) {
        vfParts.push("setpts=PTS/1.12");
      }

      vfParts.push(`fps=${targetFps}`);

      if (useCrop) {
        // Crop to center square and resize
        vfParts.push(
          "scale=512:512:force_original_aspect_ratio=increase:flags=lanczos",
          "crop=512:512",
        );
      } else {
        // Fit within 512x512 with padding
        vfParts.push(
          "scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos",
          "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        );
      }

      vfParts.push("setsar=1");
      const vf = vfParts.join(",");

      // Convert video to animated WebP (max 10 seconds)
      // Optimized settings for smaller file size while maintaining acceptable quality
      await this.executeFFmpeg([
        "-i",
        inputPath,
        "-t",
        "10", // Limit to 10 seconds
        "-vf",
        vf,
        "-vsync",
        "0", // Preserve source frame timing without duplicating frames.
        "-c:v",
        "libwebp_anim",
        "-pix_fmt",
        "yuva420p",
        "-lossless",
        "0",
        "-compression_level",
        "6", // Increased compression (0-6, higher = more compression)
        "-q:v",
        "75", // Reduced quality from 90 to 75 for smaller size
        "-loop",
        "0", // Loop forever
        "-preset",
        "picture", // Good preset for stickers
        "-an", // Remove audio
        "-f",
        "webp",
        "-y",
        outputPath,
      ]);

      // Read and return animated sticker
      return await fs.readFile(outputPath);
    } finally {
      // Cleanup
      await Promise.allSettled([
        fs.unlink(inputPath).catch(() => {}),
        fs.unlink(outputPath).catch(() => {}),
      ]);
    }
  }

  /**
   * Execute FFmpeg command
   */
  private executeFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn("ffmpeg", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";

      process.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        }
      });

      process.on("error", (error) => {
        reject(new Error(`FFmpeg error: ${error.message}`));
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        process.kill("SIGKILL");
        reject(new Error("FFmpeg timeout"));
      }, 30000);
    });
  }
}
