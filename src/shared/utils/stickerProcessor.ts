import sharp from "sharp";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import webpmux from "node-webpmux";
import { log } from "../../infrastructure/config/config.js";

const STICKER_SIZE = 512;

const RIFF_HEADER_SIZE = 12;
const ANMF_HEADER_SIZE = 16;
const VP8X_FLAG_ALPHA = 0x10;
const ANIM_BACKGROUND_SIZE = 4;

interface RiffChunk {
  fourCC: string;
  payloadOffset: number;
  size: number;
}

function parseRiffChunks(data: Buffer): RiffChunk[] | null {
  if (
    data.length < RIFF_HEADER_SIZE ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunks: RiffChunk[] = [];
  let offset = RIFF_HEADER_SIZE;

  while (offset + 8 <= data.length) {
    const fourCC = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    // Truncated or malformed container: stop instead of guessing.
    if (payloadOffset + size > data.length) {
      return null;
    }

    chunks.push({ fourCC, payloadOffset, size });
    offset = payloadOffset + size + (size % 2);
  }

  return chunks;
}

/** VP8L bitstream: alpha_is_used is bit 28 of the 32-bit header. */
function vp8lHasAlpha(data: Buffer, payloadOffset: number): boolean {
  return (
    payloadOffset + 5 <= data.length && (data[payloadOffset + 4] & 0x10) !== 0
  );
}

function animatedFrameHasAlpha(
  data: Buffer,
  payloadOffset: number,
  size: number,
): boolean {
  const end = payloadOffset + size;
  let offset = payloadOffset + ANMF_HEADER_SIZE;

  while (offset + 8 <= end) {
    const fourCC = data.toString("ascii", offset, offset + 4);
    const subSize = data.readUInt32LE(offset + 4);
    const subPayload = offset + 8;

    if (subPayload + subSize > end) return false;
    if (fourCC === "ALPH") return true;
    if (fourCC === "VP8L" && vp8lHasAlpha(data, subPayload)) return true;

    offset = subPayload + subSize + (subSize % 2);
  }

  return false;
}

/**
 * Keep the WebP container flags in sync with the actual pixel data.
 *
 * WhatsApp Web (Chromium's WebP decoder) trusts the VP8X flags, while the
 * mobile apps decode the frame payloads directly. Two things therefore need
 * fixing for the animated stickers this bot produces:
 *
 * 1. `node-webpmux` re-writes the animation without the VP8X alpha flag
 *    because the alpha lives inside the ANMF frames, not in a top-level ALPH
 *    chunk. Chromium then decodes every frame as opaque, which produces white
 *    blocks inside the sticker on WhatsApp Web.
 * 2. ffmpeg writes an opaque white ANIM background colour. Decoders that
 *    honour it fill the canvas with white, so transparent areas (padding and
 *    holes in the artwork) turn into white squares on WhatsApp Web.
 */
export function normalizeStickerWebp(input: Uint8Array): Uint8Array {
  const data = Buffer.from(input);
  const chunks = parseRiffChunks(data);
  if (!chunks) return input;

  const vp8x = chunks.find(({ fourCC }) => fourCC === "VP8X");
  if (!vp8x || vp8x.size < 10) return input;

  const hasAlpha = chunks.some(({ fourCC, payloadOffset, size }) => {
    if (fourCC === "ALPH") return true;
    if (fourCC === "VP8L") return vp8lHasAlpha(data, payloadOffset);
    if (fourCC === "ANMF") {
      return animatedFrameHasAlpha(data, payloadOffset, size);
    }
    return false;
  });

  if (hasAlpha) {
    data[vp8x.payloadOffset] |= VP8X_FLAG_ALPHA;
  }

  const anim = chunks.find(({ fourCC }) => fourCC === "ANIM");
  if (anim && anim.size >= ANIM_BACKGROUND_SIZE) {
    data.fill(0, anim.payloadOffset, anim.payloadOffset + ANIM_BACKGROUND_SIZE);
  }

  return data;
}

/**
 * Add EXIF metadata to WebP buffer for WhatsApp Sticker packname and authorname.
 */
export async function addExif(
  webpBuffer: Uint8Array,
  packname: string,
  author: string,
): Promise<Uint8Array> {
  try {
    const img = new webpmux.Image();
    await img.load(Buffer.from(webpBuffer));

    const json = {
      "sticker-pack-id": "whatsapp-funbot",
      "sticker-pack-name": packname,
      "sticker-pack-publisher": author,
      emojis: ["✨"],
    };

    const exifAttr = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
      0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);
    const jsonBuf = Buffer.from(JSON.stringify(json), "utf-8");
    const exif = Buffer.concat([exifAttr, jsonBuf]);
    exif.writeUInt32LE(jsonBuf.length, 14);

    img.exif = exif;

    const result = await img.save(null);
    // Re-muxing drops the VP8X alpha flag of animations, restore it before
    // the sticker is sent (WhatsApp Web needs it to keep transparency).
    return normalizeStickerWebp(new Uint8Array(result));
  } catch (error) {
    log.warn("Failed to add EXIF to sticker:", error);
    return normalizeStickerWebp(webpBuffer); // Return original if failed
  }
}

/**
 * Create sticker from image buffer
 */
export async function createSticker(
  imageBuffer: Uint8Array,
  useCrop: boolean,
): Promise<Uint8Array> {
  try {
    const image = sharp(Buffer.from(imageBuffer));
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
        .resize(STICKER_SIZE, STICKER_SIZE, {
          fit: "cover",
        });
    } else {
      // Auto-fit with white padding
      processed = image.resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 }, // Transparent background
      });
    }

    // Convert to WebP
    const result = await processed
      .webp({
        quality: 100,
        lossless: false,
      })
      .toBuffer();
      
    return new Uint8Array(result);
  } catch (error) {
    log.error("Error creating sticker:", error);
    throw new Error("Failed to create sticker");
  }
}

/**
 * Create animated sticker from video
 */
export async function createAnimatedSticker(
  videoBuffer: Uint8Array,
  useCrop: boolean,
  sourceExtension: string = "mp4",
): Promise<Uint8Array> {
  const tempDir = tmpdir();
  const sessionId = randomUUID();
  const safeExtension = sourceExtension.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(tempDir, `video_${sessionId}.${safeExtension}`);
  const outputPath = join(tempDir, `sticker_${sessionId}.webp`);

  try {
    // Write video to temp file
    await fs.writeFile(inputPath, Buffer.from(videoBuffer));

    // Build ffmpeg filter for sticker conversion.
    const isGifSource = safeExtension === "gif";
    const targetFps = isGifSource ? 18 : 10;
    const vfParts = ["format=rgba"];

    if (isGifSource) {
      vfParts.push("setpts=PTS/1.12");
    }

    vfParts.push(`fps=${targetFps}`);

    if (useCrop) {
      vfParts.push(
        "scale=512:512:force_original_aspect_ratio=increase:flags=lanczos",
        "crop=512:512",
      );
    } else {
      vfParts.push(
        "scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos",
        "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
      );
    }

    vfParts.push("setsar=1");
    const vf = vfParts.join(",");

    await executeFFmpeg([
      "-i",
      inputPath,
      "-t",
      "10",
      "-vf",
      vf,
      "-vsync",
      "0",
      "-c:v",
      "libwebp_anim",
      "-pix_fmt",
      "rgba",
      "-lossless",
      "0",
      "-compression_level",
      "6",
      "-q:v",
      "75",
      "-loop",
      "0",
      "-preset",
      "picture",
      "-an",
      "-f",
      "webp",
      "-y",
      outputPath,
    ]);

    const result = await fs.readFile(outputPath);
    return normalizeStickerWebp(new Uint8Array(result));
  } finally {
    await Promise.allSettled([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {}),
    ]);
  }
}

function executeFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    process.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
    });

    process.on("error", (error) => {
      reject(new Error(`FFmpeg error: ${error.message}`));
    });

    setTimeout(() => {
      process.kill("SIGKILL");
      reject(new Error("FFmpeg timeout"));
    }, 30000);
  });
}
