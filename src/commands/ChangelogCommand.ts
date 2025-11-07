import { proto } from "baileys";
import { CommandInterface, CommandInfo } from "../core/CommandInterface.js";
import { BotConfig } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { log } from "../core/config.js";

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  author: {
    login: string;
  };
}

export class ChangelogCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "changelog",
    aliases: ["updates", "release", "version"],
    description: "Get the latest release changelog from GitHub",
    helpText: `*Usage:*
• ${BotConfig.prefix}changelog — Get the latest release changelog

*Example:*
• ${BotConfig.prefix}changelog
• ${BotConfig.prefix}updates`,
    category: "general",
    commandClass: ChangelogCommand,
    cooldown: 5000,
  };

  private readonly GITHUB_API_URL =
    "https://api.github.com/repos/razikdontcare/whatsapp-funbot/releases/latest";
  private readonly REQUEST_TIMEOUT = 10000; // 10 seconds

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    if (args.length > 0 && args[0] === "help") {
      await sock.sendMessage(jid, {
        text: ChangelogCommand.commandInfo.helpText || "No help available",
      });
      return;
    }

    try {
      await sock.sendMessage(jid, {
        text: "🔄 Fetching latest release...",
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);

      const response = await fetch(this.GITHUB_API_URL, {
        headers: {
          "User-Agent": "WhatsApp-FunBot",
          Accept: "application/vnd.github.v3+json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
      }

      const release = await response.json() as GitHubRelease;

      // Format the changelog message
      const formattedMessage = this.formatChangelogMessage(release);

      await sock.sendMessage(jid, {
        text: formattedMessage,
      });
    } catch (error) {
      log.error("Failed to fetch changelog:", error);
      await this.handleError(error, sock, jid);
    }
  }

  private formatChangelogMessage(release: GitHubRelease): string {
    const publishDate = new Date(release.published_at).toLocaleString("id-ID", {
      dateStyle: "long",
      timeStyle: "short",
    });

    let message = `*📋 Latest Release: ${release.name}*\n\n`;
    message += `🏷️ *Version:* ${release.tag_name}\n`;
    message += `📅 *Published:* ${publishDate}\n`;
    message += `👤 *Author:* ${release.author.login}\n`;
    message += `🔗 *URL:* ${release.html_url}\n\n`;
    message += `*📝 Changes:*\n${this.formatReleaseBody(release.body)}`;

    return message;
  }

  private formatReleaseBody(body: string): string {
    // Clean up the body text and format it nicely
    let formatted = body
      .replace(/^##\s+/gm, "*") // Convert ## headers to bold
      .replace(/\*\*([^*]+)\*\*/g, "*$1*") // Convert ** to *
      .replace(/\n{3,}/g, "\n\n") // Remove excessive newlines
      .trim();

    // Limit length if too long
    const maxLength = 1500;
    if (formatted.length > maxLength) {
      formatted = formatted.substring(0, maxLength) + "...\n\n_See full changelog on GitHub_";
    }

    return formatted;
  }

  private async handleError(error: any, sock: WebSocketInfo, jid: string): Promise<void> {
    let errorMessage = "❌ Failed to fetch changelog. Please try again later.";

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage = "⏰ Request timeout. GitHub API is taking too long to respond.";
      } else if (error.message.includes("404")) {
        errorMessage = "❌ No releases found for this repository.";
      } else if (error.message.includes("403")) {
        errorMessage = "❌ Rate limit exceeded. Please try again later.";
      }
    }

    await sock.sendMessage(jid, {
      text: errorMessage,
    });
  }
}

