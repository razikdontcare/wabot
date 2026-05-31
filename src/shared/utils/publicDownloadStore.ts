import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import { log } from "../../infrastructure/config/config.js";

export interface PublicDownloadEntry {
  token: string;
  filePath: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour cleanup check

const downloadStore = new Map<string, PublicDownloadEntry>();

export function generateToken(): string {
  return randomBytes(16).toString("hex");
}

export function registerPublicDownload(options: {
  filePath: string;
  filename: string;
  size: number;
  mimeType: string;
  ttlMs?: number;
}): PublicDownloadEntry {
  const token = generateToken();
  const now = Date.now();
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;

  const entry: PublicDownloadEntry = {
    token,
    filePath: options.filePath,
    filename: options.filename,
    size: options.size,
    mimeType: options.mimeType,
    createdAt: now,
    expiresAt: now + ttl,
  };

  downloadStore.set(token, entry);
  log.info(`Registered public download: ${token} (expires in ${ttl}ms)`);

  return entry;
}

export function getPublicDownload(token: string): PublicDownloadEntry | null {
  const entry = downloadStore.get(token);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    removePublicDownload(token);
    return null;
  }

  return entry;
}

export async function removePublicDownload(token: string): Promise<void> {
  const entry = downloadStore.get(token);
  if (!entry) return;

  try {
    await fs.unlink(entry.filePath).catch(() => {});
    downloadStore.delete(token);
    log.info(`Removed public download: ${token}`);
  } catch (error) {
    log.warn(`Failed to cleanup download file ${token}:`, error);
  }
}

export function listPublicDownloads(): PublicDownloadEntry[] {
  return Array.from(downloadStore.values()).filter(
    (entry) => Date.now() <= entry.expiresAt,
  );
}

async function cleanupExpiredDownloads(): Promise<void> {
  const now = Date.now();
  const expired: string[] = [];

  for (const [token, entry] of downloadStore.entries()) {
    if (now > entry.expiresAt) {
      expired.push(token);
    }
  }

  for (const token of expired) {
    await removePublicDownload(token);
  }

  if (expired.length > 0) {
    log.info(`Cleaned up ${expired.length} expired downloads`);
  }
}

export function startCleanupSchedule(): NodeJS.Timeout {
  return setInterval(() => {
    cleanupExpiredDownloads().catch((error) => {
      log.error("Error during cleanup:", error);
    });
  }, CLEANUP_INTERVAL_MS);
}
