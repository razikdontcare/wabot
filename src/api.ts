/**
 * WhatsApp Bot API Server
 *
 * This API provides endpoints for managing the WhatsApp bot, including:
 * - Command usage statistics
 * - Game leaderboards
 * - Bot configuration
 * - Message sending
 * - QR code authentication
 *
 * Security:
 * All API endpoints are protected with HTTP Basic Authentication.
 * Set API_USERNAME and API_PASSWORD environment variables to configure credentials.
 * Default credentials: username='admin', password='admin123'
 *
 * Usage:
 * curl -u admin:admin123 http://localhost:5000/api/status
 */

import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { basicAuth } from "hono/basic-auth";
import { getMongoClient } from "./infrastructure/config/mongo.js";
import { CommandUsageService } from "./domain/services/CommandUsageService.js";
import { GameLeaderboardService } from "./domain/services/GameLeaderboardService.js";
import { BotClient } from "./app/client/BotClient.js";
import {
  getBotConfigService,
  log,
  type UserRole,
} from "./infrastructure/config/config.js";
import {
  clearRecentLogs,
  getLogBufferStats,
  getRecentLogs,
  isLogLevel,
  LogLevel,
  subscribeToLogs,
} from "./shared/logger/logger.js";
import { renderAdminConsoleHtml } from "./infrastructure/web/adminConsolePage.js";
import { ADMIN_CONSOLE_SCRIPT } from "./infrastructure/web/adminConsoleScript.js";
import { ADMIN_CONSOLE_STYLES } from "./infrastructure/web/adminConsoleStyles.js";
import { isMongoConnected } from "./infrastructure/config/mongo.js";
import QRCode from "qrcode";
import { createReadStream } from "fs";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  getPublicDownload,
  startCleanupSchedule,
} from "./shared/utils/publicDownloadStore.js";

const app = new Hono();

// Basic Auth Configuration
const API_USERNAME = process.env.API_USERNAME || "admin";
const API_PASSWORD = process.env.API_PASSWORD || "admin123";
const authMiddleware = basicAuth({
  username: API_USERNAME,
  password: API_PASSWORD,
});

// Apply basic auth middleware to all API and admin routes
app.use("/api/*", authMiddleware);
app.use("/admin", authMiddleware);
app.use("/admin/*", authMiddleware);

// Store SSE connections for QR code updates
interface SSEConnection {
  controller: ReadableStreamDefaultController;
  send: (data: unknown) => void;
}

interface LogStreamConnection extends SSEConnection {
  unsubscribe: () => void;
  keepAliveTimer: NodeJS.Timeout;
}

const qrConnections = new Set<SSEConnection>();
const logConnections = new Set<LogStreamConnection>();

interface SocketLike {
  user?: unknown;
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
}

interface BotRuntimeView {
  currentQR?: string | null;
  sock?: SocketLike;
}

function asBotRuntime(botClient: BotClient | null): BotRuntimeView | null {
  return botClient as unknown as BotRuntimeView | null;
}

function isUserRole(value: string): value is UserRole {
  return value === "admin" || value === "moderator" || value === "vip";
}

function parseLimit(
  queryValue: string | undefined,
  fallback = 200,
  max = 2000,
): number {
  const parsed = Number.parseInt(queryValue || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, max));
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || parts.length > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function cleanupLogConnection(connection: LogStreamConnection): void {
  if (!logConnections.has(connection)) return;
  logConnections.delete(connection);
  clearInterval(connection.keepAliveTimer);
  connection.unsubscribe();
}

app.get("/", (c) => c.redirect("/admin"));
app.get("/admin", (c) => c.html(renderAdminConsoleHtml()));
app.get("/admin/", (c) => c.html(renderAdminConsoleHtml()));
app.get("/admin/styles.css", () => {
  return new Response(ADMIN_CONSOLE_STYLES, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});
app.get("/admin/app.js", () => {
  return new Response(ADMIN_CONSOLE_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});

// REST API: Get recent bot logs
app.get("/api/logs", async (c) => {
  try {
    const limit = parseLimit(c.req.query("limit"), 200, 2000);
    const levelQuery = (c.req.query("level") || "").toLowerCase();
    const query = (c.req.query("q") || "").trim().toLowerCase();

    const level = isLogLevel(levelQuery) ? levelQuery : undefined;
    const logs = getRecentLogs({ limit, level }).filter((entry) => {
      if (!query) return true;
      return entry.message.toLowerCase().includes(query);
    });

    return c.json({
      logs,
      count: logs.length,
      level: level || "all",
      query,
      activeStreams: logConnections.size,
    });
  } catch {
    return c.json({ error: "Failed to fetch logs" }, 500);
  }
});

// REST API: Clear in-memory log buffer
app.post("/api/logs/clear", async (c) => {
  try {
    clearRecentLogs();
    return c.json({ message: "Log buffer cleared" });
  } catch {
    return c.json({ error: "Failed to clear logs" }, 500);
  }
});

// REST API: Server-Sent Events for live logs
app.get("/api/logs/stream", async (c) => {
  const levelQuery = (c.req.query("level") || "").toLowerCase();
  const level: LogLevel | undefined = isLogLevel(levelQuery)
    ? levelQuery
    : undefined;
  const query = (c.req.query("q") || "").trim().toLowerCase();
  const historyLimit = parseLimit(c.req.query("historyLimit"), 150, 1000);

  let connectionRef: LogStreamConnection | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const matchesFilter = (message: string, logLevel: LogLevel): boolean => {
        if (level && logLevel !== level) return false;
        if (query && !message.toLowerCase().includes(query)) return false;
        return true;
      };

      let connection: LogStreamConnection;

      const send = (payload: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          cleanupLogConnection(connection);
        }
      };

      const initialLogs = getRecentLogs({ limit: historyLimit, level }).filter(
        (entry) => {
          if (!query) return true;
          return entry.message.toLowerCase().includes(query);
        },
      );

      send({
        type: "history",
        entries: initialLogs,
        timestamp: Date.now(),
      });

      const unsubscribe = subscribeToLogs((entry) => {
        if (!matchesFilter(entry.message, entry.level)) return;
        send({
          type: "log",
          entry,
        });
      });

      const keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          cleanupLogConnection(connection);
        }
      }, 15000);

      connection = {
        controller,
        send,
        unsubscribe,
        keepAliveTimer,
      };

      connectionRef = connection;
      logConnections.add(connection);
    },
    cancel() {
      if (connectionRef) {
        cleanupLogConnection(connectionRef);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
});

// REST API: Get all command usage stats
app.get("/api/command-usage", async (c) => {
  try {
    const client = await getMongoClient();
    const usageService = new CommandUsageService(client);
    const stats = await usageService.getAllStats();
    return c.json(stats);
  } catch {
    return c.json({ error: "Failed to fetch command usage stats" }, 500);
  }
});

// REST API: Get leaderboard for a game (e.g. /api/leaderboard?game=hangman)
app.get("/api/leaderboard", async (c) => {
  const game = c.req.query("game");
  if (!game) return c.json({ error: "Missing 'game' query param" }, 400);
  const limit = parseLimit(c.req.query("limit"), 10, 50);
  try {
    const client = await getMongoClient();
    const leaderboardService = new GameLeaderboardService(client);
    const leaderboard = await leaderboardService.getLeaderboard(game, limit);
    return c.json(leaderboard);
  } catch {
    return c.json({ error: "Failed to fetch leaderboard" }, 500);
  }
});

function getBotClient(): BotClient | null {
  // @ts-expect-error - globalThis.__botClient is dynamically set
  return typeof globalThis.__botClient === "object"
    ? // @ts-expect-error - globalThis.__botClient is dynamically set
      globalThis.__botClient
    : null;
}

// --- Send message endpoint helpers -----------------------------------------

// Longest text accepted for a single outbound message. WhatsApp itself allows
// far more, but a sane cap keeps payloads (and abuse) bounded. Overridable so
// deployments that need long messages can raise it without a code change.
const MAX_MESSAGE_TEXT_LENGTH = readPositiveInt(
  process.env.SEND_MESSAGE_MAX_LENGTH,
  4096,
);

// Per-client limit for the send-message endpoint. WhatsApp aggressively bans
// accounts that flood messages, so we throttle callers by default.
const SEND_MESSAGE_RATE_MAX = readPositiveInt(
  process.env.SEND_MESSAGE_RATE_MAX,
  60,
);
const SEND_MESSAGE_RATE_WINDOW_MS = readPositiveInt(
  process.env.SEND_MESSAGE_RATE_WINDOW_MS,
  60_000,
);

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// Accepts either a full WhatsApp JID or a bare phone number (which is expanded
// to an individual-chat JID). Returns the canonical JID, or null if invalid.
const JID_PATTERN =
  /^[0-9A-Za-z._:+-]+@(s\.whatsapp\.net|lid|g\.us|broadcast|newsletter)$/i;
const PHONE_PATTERN = /^\+?[0-9](?:[0-9\s().-]*[0-9])?$/;

function normalizeJid(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.includes("@")) {
    return JID_PATTERN.test(raw) ? raw : null;
  }

  if (!PHONE_PATTERN.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return `${digits}@s.whatsapp.net`;
}

const sendMessageSchema = z.object({
  jid: z
    .string()
    .trim()
    .min(1, "'jid' is required")
    .max(128, "'jid' is too long"),
  text: z
    .string()
    .trim()
    .min(1, "'text' must not be empty")
    .max(
      MAX_MESSAGE_TEXT_LENGTH,
      `'text' must not exceed ${MAX_MESSAGE_TEXT_LENGTH} characters`,
    ),
});

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitBuckets = new Map<string, RateLimitEntry>();

function consumeRateLimit(key: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();

  // Opportunistic cleanup so the map cannot grow without bound.
  if (rateLimitBuckets.size > 1000) {
    for (const [bucketKey, entry] of rateLimitBuckets) {
      if (entry.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }

  const entry = rateLimitBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + SEND_MESSAGE_RATE_WINDOW_MS,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= SEND_MESSAGE_RATE_MAX) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function getClientKey(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  try {
    return getConnInfo(c).remote.address || "unknown";
  } catch {
    return "unknown";
  }
}

// REST API: Send a WhatsApp message
app.post("/api/send-message", async (c) => {
  const requestId = randomUUID();
  c.header("X-Request-Id", requestId);

  // Reject explicitly non-JSON bodies early, but stay lenient when the client
  // omits Content-Type (e.g. curl -d) and still attempt to parse JSON.
  const contentType = (c.req.header("content-type") || "").toLowerCase();
  if (contentType && !contentType.includes("application/json")) {
    return c.json(
      {
        error: "Content-Type must be application/json",
        requestId,
      },
      415,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "Request body must be valid JSON", requestId },
      400,
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json(
      { error: "Request body must be a JSON object", requestId },
      400,
    );
  }

  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid request body",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.length ? issue.path.join(".") : "(body)",
          message: issue.message,
        })),
        requestId,
      },
      400,
    );
  }

  const jid = normalizeJid(parsed.data.jid);
  if (!jid) {
    return c.json(
      {
        error:
          "Invalid 'jid'. Provide a WhatsApp JID (e.g. 628123456789@s.whatsapp.net) or an E.164 phone number",
        requestId,
      },
      400,
    );
  }

  const { text } = parsed.data;

  const clientKey = getClientKey(c);
  const rate = consumeRateLimit(clientKey);
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfterSeconds));
    log.warn(
      `[api] send-message rate limit hit by ${clientKey} (requestId=${requestId})`,
    );
    return c.json(
      {
        error: "Rate limit exceeded. Please retry later.",
        retryAfterSeconds: rate.retryAfterSeconds,
        requestId,
      },
      429,
    );
  }

  const botRuntime = asBotRuntime(getBotClient());
  const sock = botRuntime?.sock;

  if (!sock) {
    return c.json(
      { error: "Bot is not ready or not connected", requestId },
      503,
    );
  }

  try {
    const result = (await sock.sendMessage(jid, { text })) as
      | { key?: { id?: string } }
      | undefined;
    const messageId = result?.key?.id;

    log.info(
      `[api] sent message ${messageId ?? "(unknown id)"} to ${jid} (requestId=${requestId})`,
    );

    return c.json(
      {
        success: true,
        messageId: messageId ?? null,
        jid,
        requestId,
      },
      200,
    );
  } catch (error) {
    // Log full details server-side; never leak internals to the caller.
    log.error(
      `[api] failed to send message to ${jid} (requestId=${requestId}):`,
      error,
    );
    return c.json(
      { error: "Failed to send message", requestId },
      502,
    );
  }
});

// REST API: Get bot configuration
app.get("/api/config", async (c) => {
  try {
    const configService = await getBotConfigService();
    const config = await configService.getMergedConfig();

    // Remove sensitive data from response
    const safeConfig = {
      ...config,
      groqApiKey: config.groqApiKey ? "***" : undefined,
    };

    return c.json(safeConfig);
  } catch {
    return c.json({ error: "Failed to fetch bot configuration" }, 500);
  }
});

// REST API: Update bot configuration
app.post("/api/config", async (c) => {
  try {
    const updates = await c.req.json();
    const configService = await getBotConfigService();

    // Remove sensitive fields that shouldn't be updated via API
    delete updates.groqApiKey;
    delete updates.sessionName;

    const success = await configService.updateConfig(updates, "api");

    if (success) {
      return c.json({ message: "Configuration updated successfully" });
    } else {
      return c.json({ error: "Failed to update configuration" }, 500);
    }
  } catch {
    return c.json({ error: "Failed to update bot configuration" }, 500);
  }
});

// REST API: Reset bot configuration
app.post("/api/config/reset", async (c) => {
  try {
    const configService = await getBotConfigService();
    const success = await configService.resetToDefaults("api");

    if (success) {
      return c.json({
        message: "Configuration reset to defaults successfully",
      });
    } else {
      return c.json({ error: "Failed to reset configuration" }, 500);
    }
  } catch {
    return c.json({ error: "Failed to reset bot configuration" }, 500);
  }
});

// REST API: Manage user roles
app.post("/api/config/roles/:action", async (c) => {
  try {
    const action = c.req.param("action"); // add or remove
    const { userJid, role } = await c.req.json<{
      userJid?: string;
      role?: string;
    }>();

    if (!userJid || !role) {
      return c.json({ error: "Missing userJid or role in request body" }, 400);
    }

    if (!isUserRole(role)) {
      return c.json(
        { error: "Invalid role. Must be admin, moderator, or vip" },
        400,
      );
    }

    const configService = await getBotConfigService();
    let success = false;

    if (action === "add") {
      success = await configService.addUserToRole(userJid, role, "api");
    } else if (action === "remove") {
      success = await configService.removeUserFromRole(userJid, role, "api");
    } else {
      return c.json(
        { error: "Invalid action. Must be 'add' or 'remove'" },
        400,
      );
    }

    if (success) {
      return c.json({
        message: `User ${action === "add" ? "added to" : "removed from"} ${role} role successfully`,
      });
    } else {
      return c.json(
        {
          error: `Failed to ${action} user ${action === "add" ? "to" : "from"} ${role} role`,
        },
        500,
      );
    }
  } catch {
    return c.json({ error: "Failed to manage user role" }, 500);
  }
});

// REST API: Get current QR code as image for WhatsApp authentication
app.get("/api/qr", async (c) => {
  try {
    const botRuntime = asBotRuntime(getBotClient());
    if (!botRuntime) {
      return c.json({ error: "Bot client not available" }, 503);
    }

    const qr = botRuntime.currentQR;
    if (!qr) {
      return c.json(
        {
          error: "No QR code available",
          message: "Bot may already be connected or QR code expired",
        },
        404,
      );
    }

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(qr, {
      type: "png",
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    // Return image response
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "no-cache");
    return c.body(qrBuffer);
  } catch (error) {
    return c.json(
      { error: "Failed to generate QR code", details: String(error) },
      500,
    );
  }
});

// REST API: Get current QR code as JSON (alternative endpoint)
app.get("/api/qr/json", async (c) => {
  try {
    const botRuntime = asBotRuntime(getBotClient());
    if (!botRuntime) {
      return c.json({ error: "Bot client not available" }, 503);
    }

    const qr = botRuntime.currentQR;
    if (!qr) {
      return c.json(
        {
          error: "No QR code available",
          message: "Bot may already be connected or QR code expired",
        },
        404,
      );
    }

    return c.json({ qr, timestamp: Date.now() });
  } catch (error) {
    return c.json(
      { error: "Failed to get QR code", details: String(error) },
      500,
    );
  }
});

// REST API: Server-Sent Events for QR code updates
app.get("/api/qr/stream", async () => {
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      // Store connection for QR updates
      const connection: SSEConnection = {
        controller,
        send: (data: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            // Connection closed, remove from set
            qrConnections.delete(connection);
          }
        },
      };

      qrConnections.add(connection);

      // Send current QR status
      const botRuntime = asBotRuntime(getBotClient());
      if (botRuntime) {
        const qr = botRuntime.currentQR;
        const connected = Boolean(botRuntime.sock?.user);

        connection.send({
          type: "status",
          connected,
          hasQR: !!qr,
          timestamp: Date.now(),
        });
      }
    },
    cancel() {
      // Remove connection when stream is cancelled
      qrConnections.forEach((conn) => {
        if (conn.controller === this) {
          qrConnections.delete(conn);
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
});

// Function to broadcast QR updates to all SSE connections
export function broadcastQRUpdate(
  type: "new_qr" | "connected" | "disconnected",
  data?: Record<string, unknown>,
) {
  const message = {
    type,
    timestamp: Date.now(),
    ...data,
  };

  qrConnections.forEach((connection) => {
    connection.send(message);
  });
}

// REST API: Get bot connection status
app.get("/api/status", async (c) => {
  try {
    const botRuntime = asBotRuntime(getBotClient());
    if (!botRuntime) {
      return c.json({ status: "unavailable", connected: false });
    }

    const sock = botRuntime.sock;
    const hasQR = Boolean(botRuntime.currentQR);
    const connected = Boolean(sock?.user);

    return c.json({
      status: connected ? "connected" : hasQR ? "qr_ready" : "disconnected",
      connected,
      hasQR,
      user: connected ? sock?.user : null,
    });
  } catch {
    return c.json({ status: "error", connected: false }, 500);
  }
});

app.get("/api/ops", async (c) => {
  try {
    const botRuntime = asBotRuntime(getBotClient());
    const botSock = botRuntime?.sock;
    const hasQR = Boolean(botRuntime?.currentQR);
    const connected = Boolean(botSock?.user);
    const status = botRuntime
      ? connected
        ? "connected"
        : hasQR
          ? "qr_ready"
          : "disconnected"
      : "unavailable";

    const configService = await getBotConfigService();
    const [mergedConfig, storedConfig] = await Promise.all([
      configService.getMergedConfig(),
      configService.getConfig(),
    ]);

    const logStats = getLogBufferStats();
    const processMemory = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());

    return c.json({
      timestamp: Date.now(),
      process: {
        pid: process.pid,
        uptimeSeconds,
        uptimeText: formatUptime(uptimeSeconds),
        nodeVersion: process.version,
        memory: {
          rss: processMemory.rss,
          heapUsed: processMemory.heapUsed,
          heapTotal: processMemory.heapTotal,
          external: processMemory.external,
        },
      },
      bot: {
        status,
        connected,
        hasQR,
        user: connected ? botSock?.user : null,
      },
      mongo: {
        connected: isMongoConnected(),
      },
      streams: {
        qr: qrConnections.size,
        logs: logConnections.size,
      },
      logs: {
        buffered: logStats.currentSize,
        capacity: logStats.maxSize,
        subscribers: logStats.subscriberCount,
      },
      config: {
        name: mergedConfig.name,
        prefix: mergedConfig.prefix,
        maintenanceMode: mergedConfig.maintenanceMode,
        lastUpdated: storedConfig.lastUpdated || null,
        updatedBy: storedConfig.updatedBy || null,
        roleCounts: {
          admins: mergedConfig.admins.length,
          moderators: mergedConfig.moderators.length,
          vips: mergedConfig.vips.length,
        },
      },
    });
  } catch {
    return c.json({ error: "Failed to fetch ops summary" }, 500);
  }
});

// Public endpoint: Download media by token (no auth required)
app.get("/downloads/:token", async (c) => {
  try {
    const token = c.req.param("token");

    if (!token || typeof token !== "string" || token.length !== 32) {
      return c.json({ error: "Invalid token format" }, 400);
    }

    const entry = getPublicDownload(token);

    if (!entry) {
      return c.json(
        {
          error: "Download not found or expired",
          message: "The download link may have expired. Downloads are valid for 5 hours.",
        },
        404,
      );
    }

    // Set response headers for file download
    c.header("Content-Type", entry.mimeType);
    c.header("Content-Length", entry.size.toString());
    c.header("Content-Disposition", `attachment; filename="${entry.filename}"`);
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");

    // Use ReadableStream to properly handle file streaming without closing the stream prematurely
    const readable = createReadStream(entry.filePath);

    return new Promise((resolve) => {
      const chunks: Buffer[] = [];

      readable.on("data", (chunk) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else {
          chunks.push(Buffer.from(chunk));
        }
      });

      readable.on("end", () => {
        resolve(c.body(Buffer.concat(chunks)));
      });

      readable.on("error", (error) => {
        readable.destroy();
        resolve(
          c.json(
            { error: "Failed to read file", details: String(error) },
            500,
          ),
        );
      });
    });
  } catch (error) {
    return c.json(
      { error: "Failed to serve download", details: String(error) },
      500,
    );
  }
});

// Start cleanup scheduler on API startup
startCleanupSchedule();

serve({
  fetch: app.fetch,
  port: process.env.DASHBOARD_PORT
    ? parseInt(process.env.DASHBOARD_PORT, 10)
    : 5000,
});

console.log("API running on port " + (process.env.DASHBOARD_PORT || 5000));
