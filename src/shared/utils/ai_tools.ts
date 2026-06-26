import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from "fs";
import { join, resolve } from "path";
import { exec } from "child_process";
import { promises as dns } from "dns";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import NodeCache from "node-cache";
import { parse } from "node-html-parser";
import { NodeHtmlMarkdown } from "node-html-markdown";
import iconv from "iconv-lite";
import { tavily } from "@tavily/core";
import { Exa } from "exa-js";
import { BotConfig, log } from "../../infrastructure/config/config.js";
import { formatResponseForWhatsApp } from "./whatsapp_formatter.js";
import { CommandHandler } from "../../app/handlers/CommandHandler.js";
import { WebSocketInfo } from "../types/types.js";
import {
  proto,
  type AnyMessageContent,
  type MiscMessageGenerationOptions,
  type WAMessage,
} from "baileys";
import { CommandInfo } from "../../app/handlers/CommandInterface.js";
import {
  AIKnowledgeVectorService,
  type KnowledgeScope,
  type KnowledgeSearchScope,
} from "../../domain/services/AIKnowledgeVectorService.js";

// Restrict filesystem access to the current directory for safety
const ROOT_DIR = process.cwd() + "/workspaces/";

// Caches for web fetch
const responseCache = new NodeCache({ stdTTL: 300, useClones: false }); // 5 minutes TTL
const robotsCache = new NodeCache({ stdTTL: 3600, useClones: false }); // 1 hour TTL

// Minimal robots parser interface used by the agent tools
type Robots = {
  isDisallowed(href: string, userAgent?: string): boolean;
  getCrawlDelay(userAgent?: string): number | undefined;
};

const tavilyClient = tavily({
  apiKey: BotConfig.tavilyApiKey,
});
const knowledgeVectorService = AIKnowledgeVectorService.getInstance();

interface KnowledgeSearchParams {
  query: string;
  userId?: string;
  groupId?: string;
  scope?: KnowledgeSearchScope;
  limit?: number;
}

interface KnowledgeUpsertParams {
  text: string;
  userId?: string;
  groupId?: string;
  scope?: KnowledgeScope;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

interface ChatActionContext {
  jid: string;
  sock: WebSocketInfo;
  msg: proto.IWebMessageInfo;
}

interface SendMediaParams {
  mediaType: "image" | "video" | "audio" | "document";
  url?: string;
  dataUrl?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  reply?: boolean;
}

const MAX_AI_MEDIA_BYTES = 20 * 1024 * 1024;

// Global variable to store CommandHandler instance
let commandHandlerInstance: CommandHandler | null = null;

export function setCommandHandler(handler: CommandHandler) {
  commandHandlerInstance = handler;
}

/**
 * Validates that a path is within the allowed ROOT_DIR
 */
function validatePath(filePath: string): string {
  const resolvedPath = resolve(ROOT_DIR, filePath);
  if (!resolvedPath.startsWith(ROOT_DIR)) {
    throw new Error(
      `Access denied: ${filePath} is outside the root directory.`,
    );
  }
  return resolvedPath;
}

// Filesystem and Environment Tools (formerly in ai_agent_tools.ts)

export async function list_files(path: string = "."): Promise<string> {
  try {
    const targetPath = validatePath(path);
    const files = readdirSync(targetPath, { withFileTypes: true });

    const fileList = files
      .map((file) => {
        return `${file.isDirectory() ? "[DIR]" : "[FILE]"} ${file.name}`;
      })
      .join("\n");

    return `Files in ${path}:\n${fileList || "(empty)"}`;
  } catch (error) {
    log.error(`Error listing files in ${path}:`, error);
    return `Error listing files: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function read_file(path: string): Promise<string> {
  try {
    const targetPath = validatePath(path);
    if (!existsSync(targetPath)) {
      return `File not found: ${path}`;
    }

    const content = readFileSync(targetPath, "utf-8");
    // Limit content size to prevent context overflow
    if (content.length > 10000) {
      return content.substring(0, 10000) + "\n\n... (content truncated)";
    }
    return content;
  } catch (error) {
    log.error(`Error reading file ${path}:`, error);
    return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function write_file(
  path: string,
  content: string,
): Promise<string> {
  try {
    const targetPath = validatePath(path);
    writeFileSync(targetPath, content, "utf-8");
    return `Successfully wrote to ${path}`;
  } catch (error) {
    log.error(`Error writing file ${path}:`, error);
    return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function delete_file(path: string): Promise<string> {
  try {
    const targetPath = validatePath(path);
    if (!existsSync(targetPath)) {
      return `File not found: ${path}`;
    }
    unlinkSync(targetPath);
    return `Successfully deleted ${path}`;
  } catch (error) {
    log.error(`Error deleting file ${path}:`, error);
    return `Error deleting file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Specialized tool for managing MEMORY.md
 */
export async function read_memory(): Promise<string> {
  const memoryFile = "MEMORY.md";
  try {
    const targetPath = validatePath(memoryFile);
    if (!existsSync(targetPath)) {
      return `Memory file not found: ${memoryFile}`;
    }
    return readFileSync(targetPath, "utf-8");
  } catch (error) {
    log.error(`Error reading memory:`, error);
    return `Error reading memory: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Specialized tool for managing MEMORY.md
 */
export async function update_memory(
  content: string,
  mode: "append" | "overwrite" = "append",
): Promise<string> {
  const memoryFile = "MEMORY.md";
  try {
    const targetPath = validatePath(memoryFile);
    if (mode === "append") {
      const existing = existsSync(targetPath)
        ? readFileSync(targetPath, "utf-8")
        : "";
      const separator = existing.length > 0 ? "\n\n---\n\n" : "";
      const timestamp = new Date().toLocaleString();
      const newContent = `${existing}${separator}### Memory Entry (${timestamp})\n${content}`;
      writeFileSync(targetPath, newContent, "utf-8");
    } else {
      writeFileSync(targetPath, content, "utf-8");
    }
    return `Successfully updated ${memoryFile}`;
  } catch (error) {
    log.error(`Error updating memory:`, error);
    return `Error updating memory: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function exec_command(command: string): Promise<string> {
  return new Promise((resolve) => {
    // We execute in the root directory
    exec(command, { cwd: ROOT_DIR }, (error, stdout, stderr) => {
      if (error) {
        resolve(
          `Command failed with error: ${error.message}\nStderr: ${stderr}`,
        );
        return;
      }
      resolve(
        stdout || stderr || "Command executed successfully with no output.",
      );
    });
  });
}

/** Helper to check if an IP is private/loopback for SSRF protection */
function isPrivateIP(ipStr: string): boolean {
  try {
    const ip = ipaddr.parse(ipStr);
    const range = ip.range();
    return (
      range === "private" ||
      range === "loopback" ||
      range === "linkLocal" ||
      range === "broadcast" ||
      range === "multicast" ||
      range === "carrierGradeNat" ||
      range === "reserved" ||
      range === "unspecified"
    );
  } catch (e) {
    return false;
  }
}

/** Helper to check SSRF by resolving hostname */
async function checkSSRF(urlObj: URL): Promise<void> {
  const hostname = urlObj.hostname;

  if (ipaddr.isValid(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`SSRF Blocked: IP ${hostname} is private/restricted.`);
    }
    return;
  }

  try {
    const records = await dns.lookup(hostname);
    if (isPrivateIP(records.address)) {
      throw new Error(
        `SSRF Blocked: Hostname ${hostname} resolves to private IP ${records.address}.`,
      );
    }
  } catch (err) {
    throw new Error(
      `Failed to resolve hostname ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Helper to fetch and check robots.txt */
async function checkRobotsTxt(
  urlObj: URL,
  userAgent: string = "WhatsAppFunBot/1.0",
): Promise<void> {
  const origin = urlObj.origin;
  const robotsUrl = `${origin}/robots.txt`;

  let robots = robotsCache.get<Robots>(origin);
  const parseRobots = robotsParser as unknown as (
    url: string,
    txt: string,
  ) => Robots;

  if (!robots) {
    try {
      const fetchOptions: RequestInit & { timeout?: number } = {
        redirect: "follow",
        timeout: 5000,
      };
      const res = await fetch(robotsUrl, fetchOptions);
      const text = res.ok ? await res.text() : "";
      robots = parseRobots(robotsUrl, text);
      robotsCache.set(origin, robots);
    } catch (err) {
      log.debug(`Failed to fetch robots.txt for ${origin}, assuming allowed.`);
      robots = parseRobots(robotsUrl, "");
      robotsCache.set(origin, robots);
    }
  }

  if (robots.isDisallowed(urlObj.href, userAgent)) {
    throw new Error(`Access denied by robots.txt for ${urlObj.href}`);
  }

  const crawlDelay = robots.getCrawlDelay(userAgent);
  if (crawlDelay) {
    if (crawlDelay > 5) {
      throw new Error(
        `Crawl-delay too long (${crawlDelay}s) for ${urlObj.href}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, crawlDelay * 1000));
  }
}

export interface WebFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  allowList?: string[];
  blockList?: string[];
}

export async function web_fetch(
  url: string,
  options: WebFetchOptions = {},
): Promise<string> {
  const {
    method = "GET",
    headers = {},
    body,
    timeout = 30000,
    allowList,
    blockList,
  } = options;

  let currentUrl = url;
  let redirectCount = 0;
  const maxRedirects = 10;
  const redirectChain = new Set<string>();

  // Check TTL Cache for GET requests
  const cacheKey = `GET:${currentUrl}`;
  if (method.toUpperCase() === "GET") {
    const cached = responseCache.get<string>(cacheKey);
    if (cached) {
      return `[CACHE HIT]\n${cached}`;
    }
  }

  let lastError: Error | null = null;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let urlObj: URL;
      try {
        urlObj = new URL(currentUrl);
      } catch (e) {
        throw new Error(`Invalid URL: ${currentUrl}`);
      }

      // Domain Allow/Block checks
      const domain = urlObj.hostname;
      if (allowList && allowList.length > 0 && !allowList.includes(domain)) {
        throw new Error(`Domain ${domain} is not in the allowList.`);
      }
      if (blockList && blockList.length > 0 && blockList.includes(domain)) {
        throw new Error(`Domain ${domain} is blocked.`);
      }

      // SSRF & Robots.txt checks
      await checkSSRF(urlObj);
      await checkRobotsTxt(urlObj);

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);

      const fetchOptions: RequestInit = {
        method,
        headers: {
          "User-Agent": "WhatsAppFunBot/1.0",
          ...headers,
        },
        body: body ?? undefined,
        signal: controller.signal,
        redirect: "manual", // Handle redirects manually
      };

      const response = await fetch(currentUrl, fetchOptions);
      clearTimeout(id);

      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(
            `Redirect status ${response.status} but no location header.`,
          );
        }

        // Resolve relative URLs
        const nextUrl = new URL(location, currentUrl).href;

        if (redirectChain.has(nextUrl)) {
          throw new Error(`Infinite redirect loop detected at ${nextUrl}`);
        }

        if (redirectCount >= maxRedirects) {
          throw new Error(`Maximum redirect limit (${maxRedirects}) reached.`);
        }

        redirectChain.add(currentUrl);
        currentUrl = nextUrl;
        redirectCount++;

        // Follow redirect by retrying the loop immediately (not an exponential backoff retry)
        attempt = -1;
        continue;
      }

      if (!response.ok) {
        // Transient errors for backoff
        if (
          [408, 429, 500, 502, 503, 504].includes(response.status) &&
          attempt < maxRetries
        ) {
          throw new Error(
            `Transient error: ${response.status} ${response.statusText}`,
          );
        }
        return `Failed to fetch ${currentUrl}: ${response.status} ${response.statusText}`;
      }

      // Binary Type Rejection
      const contentType = response.headers.get("content-type") || "";
      if (
        contentType &&
        !contentType.includes("text/") &&
        !contentType.includes("application/json") &&
        !contentType.includes("application/xml")
      ) {
        return `Error: Rejected binary content type (${contentType}).`;
      }

      // Streaming Size Cap (5MB)
      const MAX_SIZE = 5 * 1024 * 1024;
      let size = 0;
      const chunks: Uint8Array[] = [];

      if (response.body) {
        for await (const chunk of response.body) {
          chunks.push(chunk as Uint8Array);
          size += (chunk as Uint8Array).length;
          if (size > MAX_SIZE) {
            log.warn(`Response exceeded 5MB size cap. Truncating stream.`);
            break;
          }
        }
      }

      const buffer = Buffer.concat(chunks);

      // Charset decoding
      let charset = "utf-8";
      const match = contentType.match(/charset=([^;]+)/i);
      if (match) {
        charset = match[1].toLowerCase();
      } else {
        // Fallback: try to find it in the HTML meta tag
        const partialHtml = buffer.toString(
          "utf8",
          0,
          Math.min(buffer.length, 1024),
        );
        const metaMatch = partialHtml.match(
          /<meta[^>]+charset=['"]?([^>'"\s]+)['"]?/i,
        );
        if (metaMatch) charset = metaMatch[1].toLowerCase();
      }

      let text = "";
      try {
        if (iconv.encodingExists(charset)) {
          text = iconv.decode(buffer, charset);
        } else {
          text = buffer.toString("utf8");
        }
      } catch (e) {
        text = buffer.toString("utf8");
      }

      // If it's JSON, just return it directly (formatted)
      if (contentType.includes("application/json")) {
        let result = text;
        if (text.length > 20000) {
          result = text.substring(0, 20000) + "\n\n[... content truncated ...]";
        }
        if (method.toUpperCase() === "GET") responseCache.set(cacheKey, result);
        return result;
      }

      // HTML Parsing and Markdown Conversion
      const root = parse(text);

      // Extract Metadata
      const metadata: Record<string, string> = {};
      const titleNode = root.querySelector("title");
      if (titleNode) metadata["Title"] = titleNode.text.trim();

      const metas = root.querySelectorAll("meta");
      for (const meta of metas) {
        const name = meta.getAttribute("name") || meta.getAttribute("property");
        const content = meta.getAttribute("content");
        if (name && content) {
          if (
            [
              "description",
              "keywords",
              "author",
              "article:published_time",
            ].includes(name.toLowerCase()) ||
            name.toLowerCase().startsWith("og:") ||
            name.toLowerCase().startsWith("twitter:")
          ) {
            metadata[name] = content.trim();
          }
        }
      }

      const canonical = root.querySelector('link[rel="canonical"]');
      if (canonical)
        metadata["Canonical"] = canonical.getAttribute("href") || "";

      // Extract Links
      const linksNode = root.querySelectorAll("a");
      const links = linksNode
        .slice(0, 50)
        .map((a) => {
          return `[${a.text.trim() || "link"}](${a.getAttribute("href") || ""}) ${a.getAttribute("rel") ? `rel="${a.getAttribute("rel")}"` : ""}`;
        })
        .filter((l) => l !== "[link]() " && l !== "[link]()");

      // Extract Images
      const imgsNode = root.querySelectorAll("img");
      const images = imgsNode
        .slice(0, 20)
        .map((img) => {
          return `![${img.getAttribute("alt") || ""}](${img.getAttribute("src") || ""})`;
        })
        .filter((i) => i !== "![](null)" && i !== "![]()");

      // Remove scripts and styles before Markdown conversion
      root
        .querySelectorAll("script, style, noscript, iframe, svg")
        .forEach((el) => el.remove());

      // Convert to Markdown
      const nhm = new NodeHtmlMarkdown();
      let markdown = nhm.translate(root.innerHTML);

      // Token budget truncation (20k chars)
      if (markdown.length > 20000) {
        markdown =
          markdown.substring(0, 20000) + "\n\n[... content truncated ...]";
      }

      // Format output
      let finalOutput = `# Metadata\n`;
      for (const [k, v] of Object.entries(metadata)) {
        finalOutput += `- **${k}**: ${v}\n`;
      }
      finalOutput += `\n# Content\n${markdown}\n`;

      if (links.length > 0) {
        finalOutput += `\n# Extracted Links (Top ${links.length})\n${links.join("\n")}\n`;
      }
      if (images.length > 0) {
        finalOutput += `\n# Extracted Images (Top ${images.length})\n${images.join("\n")}\n`;
      }

      if (method.toUpperCase() === "GET") {
        responseCache.set(cacheKey, finalOutput);
      }

      return finalOutput;
    } catch (error: unknown) {
      if (error instanceof Error) {
        lastError = error;
        if (error.name === "AbortError") {
          lastError = new Error(`Request timed out after ${timeout}ms`);
        }
      } else {
        lastError = new Error(String(error));
      }

      const isTransient =
        lastError !== null &&
        (lastError.message.includes("Transient error") ||
          lastError.message.includes("ECONNRESET") ||
          lastError.message.includes("ETIMEDOUT") ||
          lastError.message.includes("fetch failed"));

      if (isTransient && attempt < maxRetries) {
        const baseDelay = 1000;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        log.warn(
          `Transient error fetching ${currentUrl}. Retrying in ${Math.round(delay)}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      break;
    }
  }

  return `Error fetching URL: ${lastError?.message || "Unknown error"}`;
}

// Bot Command, Knowledge Base and Messaging Tools (formerly in ai_tools.ts)

export async function get_bot_commands(query?: string): Promise<string> {
  try {
    if (!commandHandlerInstance) {
      return "Command handler not available. Please try again later.";
    }

    const allCommands = commandHandlerInstance.getAllCommands();

    let filteredCommands = allCommands;

    // Filter by query if provided
    if (query) {
      const queryLower = query.toLowerCase();
      filteredCommands = allCommands.filter(
        (cmd: CommandInfo) =>
          cmd.name.toLowerCase().includes(queryLower) ||
          cmd.description.toLowerCase().includes(queryLower) ||
          cmd.category.toLowerCase().includes(queryLower) ||
          (cmd.aliases &&
            cmd.aliases.some((alias: string) =>
              alias.toLowerCase().includes(queryLower),
            )),
      );
    }

    if (filteredCommands.length === 0) {
      return query
        ? `No commands found matching "${query}".`
        : "No commands available.";
    }

    // Group commands by category
    const commandsByCategory: Record<string, typeof filteredCommands> = {};
    filteredCommands.forEach((cmd: CommandInfo) => {
      if (!commandsByCategory[cmd.category]) {
        commandsByCategory[cmd.category] = [];
      }
      commandsByCategory[cmd.category].push(cmd);
    });

    let result = "Available Bot Commands:\n\n";

    // Format commands by category
    for (const [category, commands] of Object.entries(commandsByCategory)) {
      const categoryEmoji = {
        game: "🎮",
        general: "ℹ️",
        admin: "👑",
        utility: "🔧",
      };

      result += `${categoryEmoji[category as keyof typeof categoryEmoji] || "📝"} **${category.toUpperCase()}**:\n`;

      commands.forEach((cmd: CommandInfo) => {
        let aliasText = "";
        if (cmd.aliases && cmd.aliases.length > 0) {
          aliasText = ` (aliases: ${cmd.aliases.join(", ")})`;
        }

        let statusText = "";
        if (cmd.disabled) {
          statusText = " [DISABLED]";
        }

        result += `• *${cmd.name}*${aliasText}${statusText} - ${cmd.description}\n`;

        if (cmd.cooldown) {
          result += `  └─ Cooldown: ${cmd.cooldown / 1000}s`;
          if (cmd.maxUses && cmd.maxUses > 1) {
            result += ` (max ${cmd.maxUses} uses)`;
          }
          result += "\n";
        }
      });
      result += "\n";
    }

    result +=
      "Use get_command_help(command_name) to get detailed help for a specific command.";

    return result;
  } catch (error) {
    log.error("Error getting bot commands:", error);
    return "Error retrieving bot commands. Please try again.";
  }
}

export async function get_command_help(commandName: string): Promise<string> {
  try {
    if (!commandHandlerInstance) {
      return "Command handler not available. Please try again later.";
    }

    const command = commandHandlerInstance.getCommandByName(
      commandName.toLowerCase(),
    );

    if (!command) {
      return `Command "${commandName}" not found. Use get_bot_commands() to see available commands.`;
    }

    let helpText = `**${command.name.toUpperCase()}** Command Help:\n\n`;
    helpText += `*Description:* ${command.description}\n`;
    helpText += `*Category:* ${command.category}\n`;

    if (command.aliases && command.aliases.length > 0) {
      helpText += `*Aliases:* ${command.aliases.join(", ")}\n`;
    }

    if (command.cooldown) {
      helpText += `*Cooldown:* ${command.cooldown / 1000} seconds`;
      if (command.maxUses && command.maxUses > 1) {
        helpText += ` (max ${command.maxUses} uses)`;
      }
      helpText += "\n";
    }

    if (command.requiredRoles && command.requiredRoles.length > 0) {
      helpText += `*Required Roles:* ${command.requiredRoles.join(", ")}\n`;
    }

    if (command.disabled) {
      helpText += `*Status:* DISABLED`;
      if (command.disabledReason) {
        helpText += ` - ${command.disabledReason}`;
      }
      helpText += "\n";
    }

    if (command.helpText) {
      helpText += `\n*Detailed Help:*\n${command.helpText}`;
    }

    return helpText;
  } catch (error) {
    log.error("Error getting command help:", error);
    return "Error retrieving command help. Please try again.";
  }
}

export async function execute_bot_command(
  commandName: string,
  args: string[],
  context: {
    jid: string;
    user: string;
    sock: WebSocketInfo;
    msg: proto.IWebMessageInfo;
  },
): Promise<string> {
  try {
    if (!commandHandlerInstance) {
      return "Command handler not available. Please try again later.";
    }

    const { jid, user, sock, msg } = context;

    // Execute the command through CommandHandler
    const result = await commandHandlerInstance.executeCommandForAI(
      commandName,
      args,
      jid,
      user,
      sock,
      msg,
    );

    if (result.success) {
      return (
        result.message || `Command '${commandName}' executed successfully.`
      );
    } else {
      return `Failed to execute command '${commandName}': ${result.error}`;
    }
  } catch (error) {
    log.error("Error executing bot command:", error);
    return `Error executing command '${commandName}': ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export async function knowledge_search(
  params: KnowledgeSearchParams,
): Promise<string> {
  try {
    if (!knowledgeVectorService.isConfigured()) {
      return "Knowledge base belum dikonfigurasi.";
    }

    const results = await knowledgeVectorService.searchKnowledge(params);
    if (results.length === 0) {
      return "Tidak ada konteks relevan di knowledge base.";
    }

    const formatted = results
      .map((item, index) => {
        const score = item.score.toFixed(3);
        const text =
          item.text.length > 900 ? `${item.text.slice(0, 900)}...` : item.text;
        return `${index + 1}. [score ${score}] ${text}`;
      })
      .join("\n\n");

    return `Konteks dari knowledge base:\n${formatted}`;
  } catch (error) {
    log.error("Error searching knowledge base:", error);
    return "Terjadi kesalahan saat mengambil konteks dari knowledge base.";
  }
}

export async function upsert_knowledge(
  params: KnowledgeUpsertParams,
): Promise<number> {
  try {
    if (!knowledgeVectorService.isConfigured()) {
      return 0;
    }

    return await knowledgeVectorService.upsertKnowledge(params);
  } catch (error) {
    log.error("Error storing knowledge base item:", error);
    return 0;
  }
}

export async function send_chat_message(
  text: string,
  context: ChatActionContext,
): Promise<string> {
  const cleanText = text.trim();

  if (!cleanText) {
    return "Pesan kosong tidak dikirim.";
  }

  const formattedText = formatResponseForWhatsApp(cleanText);
  await context.sock.sendMessage(context.jid, { text: formattedText });
  return "Pesan berhasil dikirim.";
}

export async function reply_chat_message(
  text: string,
  context: ChatActionContext,
): Promise<string> {
  const cleanText = text.trim();

  if (!cleanText) {
    return "Pesan kosong tidak dikirim.";
  }

  const formattedText = formatResponseForWhatsApp(cleanText);
  await context.sock.sendMessage(
    context.jid,
    { text: formattedText },
    { quoted: context.msg as WAMessage },
  );

  return "Balasan berhasil dikirim.";
}

function inferFileExtension(mimetype: string): string {
  const normalized = mimetype.toLowerCase();

  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("pdf")) return "pdf";
  if (normalized.includes("plain")) return "txt";
  if (normalized.includes("zip")) return "zip";

  return "bin";
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mimetype: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);

  if (!match) {
    throw new Error("Data URL tidak valid.");
  }

  const mimetype = match[1] || "application/octet-stream";
  const isBase64 = match[2] === ";base64";
  const payload = match[3] || "";

  if (isBase64) {
    return {
      buffer: Buffer.from(payload, "base64"),
      mimetype,
    };
  }

  return {
    buffer: Buffer.from(decodeURIComponent(payload), "utf-8"),
    mimetype,
  };
}

async function resolveMediaSource(
  params: SendMediaParams,
): Promise<{ buffer: Buffer; mimetype: string }> {
  if (params.dataUrl) {
    const parsed = parseDataUrl(params.dataUrl);

    if (parsed.buffer.length > MAX_AI_MEDIA_BYTES) {
      throw new Error("Media terlalu besar untuk dikirim lewat tool AI.");
    }

    return parsed;
  }

  if (!params.url) {
    throw new Error("URL atau data URL media harus disediakan.");
  }

  const sourceUrl = new URL(params.url);
  if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
    throw new Error("Hanya URL http/https yang diizinkan untuk media.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(sourceUrl.toString(), {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Gagal mengambil media: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_AI_MEDIA_BYTES) {
      throw new Error("Media terlalu besar untuk dikirim lewat tool AI.");
    }

    const mimetype =
      params.mimetype ||
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_AI_MEDIA_BYTES) {
      throw new Error("Media terlalu besar untuk dikirim lewat tool AI.");
    }

    return { buffer, mimetype };
  } finally {
    clearTimeout(timeout);
  }
}

export async function send_chat_media(
  params: SendMediaParams,
  context: ChatActionContext,
): Promise<string> {
  const { buffer, mimetype } = await resolveMediaSource(params);
  const cleanFileName = params.fileName?.trim();
  const resolvedFileName =
    cleanFileName || `attachment.${inferFileExtension(mimetype)}`;
  const caption = params.caption?.trim();
  let payload: AnyMessageContent;

  switch (params.mediaType) {
    case "image":
      payload = {
        image: buffer,
        mimetype,
        fileName: resolvedFileName,
        ...(caption ? { caption } : {}),
      };
      break;
    case "video":
      payload = {
        video: buffer,
        mimetype,
        fileName: resolvedFileName,
        ...(caption ? { caption } : {}),
      };
      break;
    case "audio":
      payload = {
        audio: buffer,
        mimetype,
        fileName: resolvedFileName,
        ...(caption ? { caption } : {}),
      };
      break;
    case "document":
      payload = {
        document: buffer,
        mimetype,
        fileName: resolvedFileName,
        ...(caption ? { caption } : {}),
      };
      break;
  }

  const quoted: MiscMessageGenerationOptions | undefined = params.reply
    ? { quoted: context.msg as WAMessage }
    : undefined;
  await context.sock.sendMessage(context.jid, payload, quoted);

  return `Media ${params.mediaType} berhasil dikirim.`;
}

export async function web_search(
  query: string,
  topic?: "general" | "news" | "finance",
  options?: {
    searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
    includeAnswer?: boolean | "basic" | "advanced";
  },
): Promise<string> {
  try {
    log.info(`Performing web search for query: ${query}`);
    if (!query) return "Tidak ada query yang diberikan untuk pencarian web.";

    // Try Exa first if API key is configured
    if (BotConfig.exaApiKey) {
      try {
        log.info("Using Exa API for search...");
        const exa = new Exa(BotConfig.exaApiKey);
        
        // Map search depth to Exa search type
        const type = options?.searchDepth === "fast" || options?.searchDepth === "ultra-fast" ? "fast" : "auto";
        
        const response = await exa.search(query, {
          type,
          numResults: 5,
          contents: {
            text: true,
            highlights: true,
          },
        });

        if (response.results && response.results.length > 0) {
          const sources = response.results
            .map((result: { title?: string | null; url: string; score?: number; text?: string; highlights?: string[] }) => {
              const snippet = result.highlights && result.highlights.length > 0
                ? result.highlights.join("\n... ")
                : (result.text ? result.text.substring(0, 300) + "..." : "");
              
              return `[${result.title || "Untitled"}](${result.url}) (Score: ${result.score?.toFixed(4) ?? "N/A"})\n${snippet}`;
            })
            .join("\n\n");
            
          return `Hasil Pencarian Exa:\n\n${sources}`;
        }
      } catch (exaError) {
        log.warn(
          "Exa search failed, falling back to Tavily:",
          exaError instanceof Error ? exaError.message : String(exaError),
        );
      }
    }

    // Tavily Fallback
    log.info("Using Tavily API for search...");
    const searchDepth = options?.searchDepth ?? "advanced";
    const includeAnswer = options?.includeAnswer ?? true;

    const response = await tavilyClient.search(query, {
      searchDepth,
      includeAnswer,
      topic,
    });

    if (response.answer && response.results && response.results.length > 0) {
      const sources = response.results
        .map(
          (result) =>
            `[${result.title}](${result.url}) (Score: ${result.score})\n${result.content}`,
        )
        .join("\n\n");
      return `${response.answer}\n\nSumber:\n${sources}`;
    } else if (response.results && response.results.length > 0) {
      return response.results.map((result) => result.title).join("\n");
    } else {
      return "Tidak ada hasil yang ditemukan.";
    }
  } catch (error) {
    log.error(
      "Error fetching web search results:",
      error instanceof Error ? error : String(error),
    );
    return "Terjadi kesalahan saat melakukan pencarian.";
  }
}

interface TavilyExtractResultItem {
  url: string;
  title?: string | null;
  rawContent?: string;
  content?: string;
  raw_content?: string;
}

export async function web_extract(
  urls: string | string[],
  query?: string,
): Promise<string> {
  try {
    const urlsArray = Array.isArray(urls) ? urls : [urls];
    if (urlsArray.length === 0) {
      return "Tidak ada URL yang diberikan untuk diekstrak.";
    }

    // Try Exa first if API key is configured
    if (BotConfig.exaApiKey) {
      try {
        log.info(`Performing Exa getContents for urls: ${urlsArray.join(", ")}`);
        const exa = new Exa(BotConfig.exaApiKey);

        const response = await exa.getContents(urlsArray, {
          text: true,
          highlights: query ? { query } : true,
        });

        if (response.results && response.results.length > 0) {
          return response.results
            .map((result: { title?: string | null; url: string; text?: string; highlights?: string[] }) => {
              const snippet = result.highlights && result.highlights.length > 0
                ? `Highlights:\n${result.highlights.join("\n... ")}\n\n`
                : "";
              return `URL: ${result.url}\nTitle: ${result.title || "No Title"}\n${snippet}Content:\n${result.text}`;
            })
            .join("\n\n---\n\n");
        }
      } catch (exaError) {
        log.warn(
          "Exa extract failed, falling back to Tavily:",
          exaError instanceof Error ? exaError.message : String(exaError),
        );
      }
    }

    // Tavily Fallback
    log.info(`Performing Tavily Extract for urls: ${urlsArray.join(", ")}`);
    const response = await tavilyClient.extract(urlsArray, {
      query,
    });

    if (response.results && response.results.length > 0) {
      return response.results
        .map((result: TavilyExtractResultItem) => {
          const content = result.rawContent || result.content || result.raw_content || JSON.stringify(result);
          return `URL: ${result.url}\nTitle: ${result.title || "No Title"}\nContent:\n${content}`;
        })
        .join("\n\n---\n\n");
    } else {
      return "Gagal mengekstrak konten dari URL tersebut.";
    }
  } catch (error) {
    log.error(
      "Error in web_extract:",
      error instanceof Error ? error : String(error),
    );
    return `Terjadi kesalahan saat mengekstrak konten web: ${error instanceof Error ? error.message : String(error)}`;
  }
}

