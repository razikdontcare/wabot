import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import {
  BotConfig,
  getCurrentConfig,
  log,
} from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import {
  performTavilySearch,
  TavilySearchSource,
  TavilyTopic,
} from "../../shared/utils/tavilySearch.js";

const TOPICS: TavilyTopic[] = ["general", "news", "finance"];

export class SearchCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "search",
    aliases: ["websearch", "cariweb", "ws"],
    description: "Cari informasi di web secara langsung (Tavily).",
    helpText: `*Penggunaan:*
• ${BotConfig.prefix}search <query> — Cari informasi di web
• ${BotConfig.prefix}search <topic> <query> — Cari dengan topik khusus
• ${BotConfig.prefix}search help — Tampilkan bantuan ini

*Topic yang didukung:*
• general
• news
• finance

*Contoh:*
• ${BotConfig.prefix}search berita teknologi ai hari ini
• ${BotConfig.prefix}search news update harga bitcoin
• ${BotConfig.prefix}ws general perkembangan baterai solid state`,
    category: "general",
    commandClass: SearchCommand,
    cooldown: 5000,
    maxUses: 10,
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    _sessionService: SessionService,
    _msg: proto.IWebMessageInfo,
  ): Promise<void> {
    void user;
    void _sessionService;
    void _msg;

    const config = await getCurrentConfig().catch(() => BotConfig);

    if (args.length === 0 || args[0].toLowerCase() === "help") {
      await sock.sendMessage(jid, {
        text: `${config.emoji.info} ${SearchCommand.commandInfo.helpText}`,
      });
      return;
    }

    const firstArg = args[0]?.toLowerCase();
    const topic = isTavilyTopic(firstArg) ? firstArg : undefined;
    const queryParts = topic ? args.slice(1) : args;
    const query = queryParts.join(" ").trim();

    if (!query) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Masukkan query pencarian.
Contoh: *${BotConfig.prefix}search news update ekonomi global*`,
      });
      return;
    }

    await sock.sendMessage(jid, {
      text: `${config.emoji.info} Mencari web untuk *${query}*${topic ? ` (topic: ${topic})` : ""}...`,
    });

    try {
      const response = await performTavilySearch(query, {
        topic,
        maxResults: 5,
      });

      if (!response.answer && response.results.length === 0) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.info} Tidak ada hasil ditemukan untuk *${query}*.`,
        });
        return;
      }

      await sock.sendMessage(jid, {
        text: formatSearchMessage(
          query,
          topic,
          response.answer,
          response.results,
        ),
      });
    } catch (error) {
      log.error("Error running search command:", error);
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Terjadi kesalahan saat melakukan pencarian web. Coba lagi sebentar lagi.`,
      });
    }
  }
}

function isTavilyTopic(value?: string): value is TavilyTopic {
  return typeof value === "string" && TOPICS.includes(value as TavilyTopic);
}

function shorten(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 3)}...`;
}

function formatSearchMessage(
  query: string,
  topic: TavilyTopic | undefined,
  answer: string | null,
  sources: TavilySearchSource[],
): string {
  const lines: string[] = [];

  lines.push("🌐 *Hasil Pencarian Web*");
  lines.push(`🔎 Query: *${query}*`);
  if (topic) {
    lines.push(`🧭 Topic: *${topic}*`);
  }

  if (answer) {
    lines.push("");
    lines.push("📝 *Ringkasan:*");
    lines.push(answer);
  }

  if (sources.length > 0) {
    lines.push("");
    lines.push("📚 *Sumber:*");

    sources.forEach((source, index) => {
      lines.push(`${index + 1}. *${source.title}*`);
      lines.push(`🔗 ${source.url}`);
      if (source.content) {
        lines.push(`📄 ${shorten(source.content, 180)}`);
      }
      lines.push(`⭐ Score: ${source.score.toFixed(2)}`);
      lines.push("");
    });
  }

  return lines.join("\n").trim();
}
