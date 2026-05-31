import { log } from "../../infrastructure/config/config.js";

export interface QueuedDownload {
  id: string;
  url: string;
  jid: string;
  user: string;
  timestamp: number;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

/**
 * DownloadQueueManager - Manages concurrent downloads to prevent resource exhaustion
 * Limits the number of simultaneous downloads and queues the rest
 */
export class DownloadQueueManager {
  private static instance: DownloadQueueManager;
  private queue: Map<string, QueuedDownload> = new Map();
  private activeDownloads = new Set<string>();
  private readonly MAX_CONCURRENT = 2; // Limit to 2 concurrent downloads
  private readonly QUEUE_TIMEOUT = 3600000; // 1 hour timeout for queued items

  private constructor() {}

  static getInstance(): DownloadQueueManager {
    if (!DownloadQueueManager.instance) {
      DownloadQueueManager.instance = new DownloadQueueManager();
    }
    return DownloadQueueManager.instance;
  }

  /**
   * Add a download to the queue
   */
  addToQueue(download: QueuedDownload): { position: number; queueSize: number } {
    const id = `${download.jid}-${download.timestamp}-${Math.random().toString(36).slice(2, 9)}`;
    const queuedItem = { ...download, id, status: "pending" as const };
    this.queue.set(id, queuedItem);

    log.info(`Added download to queue: ${id} (Queue size: ${this.queue.size})`);

    const position = this.getQueuePosition(id);
    return { position, queueSize: this.queue.size };
  }

  /**
   * Check if a download can start (under concurrent limit)
   */
  canStart(): boolean {
    return this.activeDownloads.size < this.MAX_CONCURRENT;
  }

  /**
   * Get the position of a download in the queue
   */
  getQueuePosition(id: string): number {
    if (!this.queue.has(id)) return -1;

    let position = 0;
    for (const [key, item] of this.queue.entries()) {
      if (key === id) break;
      if (item.status === "pending") position++;
    }
    return position;
  }

  /**
   * Get queue size (pending items)
   */
  getQueueSize(): number {
    return Array.from(this.queue.values()).filter(
      (item) => item.status === "pending",
    ).length;
  }

  /**
   * Start processing a download (mark as active)
   */
  startDownload(id: string): void {
    const item = this.queue.get(id);
    if (item) {
      item.status = "processing";
      this.activeDownloads.add(id);
      log.info(
        `Download started: ${id} (Active: ${this.activeDownloads.size}/${this.MAX_CONCURRENT})`,
      );
    }
  }

  /**
   * Mark a download as completed
   */
  completeDownload(id: string): void {
    const item = this.queue.get(id);
    if (item) {
      item.status = "completed";
      this.activeDownloads.delete(id);
      // Keep in queue for a bit for status tracking, auto-cleanup handled by janitor
      log.info(`Download completed: ${id} (Active: ${this.activeDownloads.size})`);
    }
  }

  /**
   * Mark a download as failed
   */
  failDownload(id: string, error: string): void {
    const item = this.queue.get(id);
    if (item) {
      item.status = "failed";
      item.error = error;
      this.activeDownloads.delete(id);
      log.warn(
        `Download failed: ${id} - ${error} (Active: ${this.activeDownloads.size})`,
      );
    }
  }

  /**
   * Get download details by ID
   */
  getDownload(id: string): QueuedDownload | undefined {
    return this.queue.get(id);
  }

  /**
   * Get all pending downloads for a user
   */
  getUserDownloads(jid: string): QueuedDownload[] {
    return Array.from(this.queue.values()).filter(
      (item) => item.jid === jid && item.status === "pending",
    );
  }

  /**
   * Get all active downloads
   */
  getActiveDownloads(): QueuedDownload[] {
    return Array.from(this.queue.values()).filter(
      (item) => item.status === "processing",
    );
  }

  /**
   * Cleanup old/completed entries (called periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, item] of this.queue.entries()) {
      const age = now - item.timestamp;

      // Remove completed items older than 5 minutes
      if (item.status === "completed" && age > 5 * 60 * 1000) {
        expired.push(id);
      }
      // Remove failed items older than 5 minutes
      else if (item.status === "failed" && age > 5 * 60 * 1000) {
        expired.push(id);
      }
      // Remove pending items older than 1 hour (likely abandoned)
      else if (item.status === "pending" && age > this.QUEUE_TIMEOUT) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      this.queue.delete(id);
    }

    if (expired.length > 0) {
      log.info(`Cleaned up ${expired.length} old download queue entries`);
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    active: number;
    completed: number;
    failed: number;
    queueLength: number;
  } {
    const items = Array.from(this.queue.values());
    return {
      pending: items.filter((i) => i.status === "pending").length,
      active: items.filter((i) => i.status === "processing").length,
      completed: items.filter((i) => i.status === "completed").length,
      failed: items.filter((i) => i.status === "failed").length,
      queueLength: items.length,
    };
  }
}

/**
 * Start automatic cleanup scheduler
 */
export function startDownloadQueueCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    DownloadQueueManager.getInstance().cleanup();
  }, 5 * 60 * 1000); // Every 5 minutes
}
