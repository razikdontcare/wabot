import sharp from "sharp";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import webpmux from "node-webpmux";
import { log } from "../../infrastructure/config/config.js";

const STICKER_SIZE = 512;

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
    return new Uint8Array(result);
  } catch (error) {
    log.warn("Failed to add EXIF to sticker:", error);
    return webpBuffer; // Return original if failed
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
    return new Uint8Array(result);
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
