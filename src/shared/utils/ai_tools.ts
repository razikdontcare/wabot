import { tavily } from "@tavily/core";
import { BotConfig, log } from "../../infrastructure/config/config.js";
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

  await context.sock.sendMessage(context.jid, { text: cleanText });
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

  await context.sock.sendMessage(
    context.jid,
    { text: cleanText },
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

// web_search uses Tavily only.

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
