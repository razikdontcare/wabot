import { downloadMediaMessage, proto, WAMessage } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import { BotConfig, log } from "../../infrastructure/config/config.js";
import { AIConversationService } from "../../domain/services/AIConversationService.js";
import { AIResponseService } from "../../domain/services/AIResponseService.js";
import {
  generateText,
  stepCountIs,
  tool as createTool,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import { AIProviderRouterService } from "../../domain/services/AIProviderRouterService.js";
import {
  execute_bot_command,
  get_bot_commands,
  get_command_help,
  web_search,
} from "../../shared/utils/ai_tools.js";
import { loadNexaPrompt } from "../../shared/utils/promptLoader.js";

interface AIImageInput {
  dataUrl: string;
  mimeType: string;
}

export class AskAICommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "ai",
    aliases: ["ask"],
    description:
      "Tanyakan sesuatu kepada AI dengan dukungan percakapan multi-turn.",
    helpText: `*Penggunaan:*
• ${BotConfig.prefix}ai <pertanyaan> — Tanyakan sesuatu kepada AI
• ${BotConfig.prefix}ai status — Lihat status sesi percakapan
• ${BotConfig.prefix}ai end — Akhiri sesi percakapan
• ${BotConfig.prefix}ai help — Tampilkan bantuan ini

*Catatan:*
• Setiap pengguna memiliki sesi percakapan pribadi
• Sesi otomatis berakhir setelah 10 menit tidak aktif
• AI akan mengingat konteks percakapan selama sesi berlangsung

👑 *VIP Members:* Unlimited uses tanpa cooldown!

*Contoh:*
• ${BotConfig.prefix}ai Siapa kamu?
• ${BotConfig.prefix}ai status
• ${BotConfig.prefix}ai end`,
    category: "general",
    commandClass: AskAICommand,
    cooldown: 5000,
    maxUses: 10,
    vipBypassCooldown: true, // VIP users bypass cooldown
  };

  private providerRouter = AIProviderRouterService.getInstance();
  private conversationService = AIConversationService.getInstance();
  private responseService = AIResponseService.getInstance();

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    // Handle subcommands
    if (args.length > 0) {
      const subcommand = args[0].toLowerCase();

      switch (subcommand) {
        case "help":
          await sock.sendMessage(jid, {
            text:
              AskAICommand.commandInfo.helpText || "Bantuan tidak tersedia.",
          });
          return;

        case "status":
          await this.handleStatusCommand(user, jid, sock, msg);
          return;

        case "end":
          await this.handleEndCommand(user, jid, sock, msg);
          return;
      }
    }

    // Get the prompt from args or quoted message
    let quotedText = "";
    let prompt = args.join(" ").trim();
    const userPushName = msg.pushName;
    const imageInput = await this.extractImageInput(msg, jid, sock);

    if (
      msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage &&
      args.length === 0
    ) {
      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      if (quoted?.conversation) quotedText = quoted.conversation;
      else if (quoted?.extendedTextMessage?.text)
        quotedText = quoted.extendedTextMessage.text;
      else if (quoted?.imageMessage?.caption)
        quotedText = quoted.imageMessage.caption;

      if (quotedText) {
        prompt =
          'The user is replied to message:\n"' +
          quotedText.trim() +
          "\"\n\nThe user's question:\n" +
          prompt;
      }
    }

    if (!prompt && imageInput) {
      prompt = "Tolong jelaskan isi gambar ini dengan jelas dan ringkas.";
    }

    if (!prompt) {
      await sock.sendMessage(jid, {
        text: "Silakan berikan pertanyaan yang ingin diajukan kepada AI.\n\nGunakan `!ai help` untuk melihat semua opsi yang tersedia.",
      });
      return;
    }

    try {
      // Check if this is a group chat
      const isGroupChat = jid.endsWith("@g.us");

      // Add user message to conversation history
      await this.conversationService.addMessage(user, "user", prompt);

      // Get conversation history for context
      const history =
        await this.conversationService.getConversationHistory(user);

      // Get group context if this is a group chat
      let groupContext = "";
      if (isGroupChat) {
        const groupResponses = await this.responseService.getGroupResponses(
          jid,
          10,
        );
        if (groupResponses.length > 0) {
          groupContext = this.buildGroupContext(groupResponses);
        }
      }

      // Get AI response with conversation context and group context
      const response = await this.getAICompletion(
        history,
        user,
        userPushName,
        groupContext,
        jid,
        sock,
        msg,
        imageInput,
      );

      // Add AI response to conversation history
      await this.conversationService.addMessage(user, "assistant", response);

      // Save response to group context if this is a group chat
      if (isGroupChat) {
        await this.responseService.saveResponse(
          jid,
          user,
          userPushName || undefined,
          prompt,
          response,
        );
      }

      // Send response
      await sock.sendMessage(jid, {
        text: response,
      });
    } catch (error) {
      console.error("Error in AI conversation:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi kesalahan saat berkomunikasi dengan AI. Silakan coba lagi.",
      });
    }
  }

  async getAICompletion(
    conversationHistory: import("../../domain/services/AIConversationService.js").AIMessage[],
    user: string,
    userPushName: string | null | undefined,
    groupContext?: string,
    jid?: string,
    sock?: WebSocketInfo,
    msg?: proto.IWebMessageInfo,
    imageInput?: AIImageInput | null,
  ): Promise<string> {
    try {
      // Load the base prompt from markdown file
      const base_prompt = loadNexaPrompt({
        groupContext,
        currentDate: new Date().toString(),
      });

      const route = this.providerRouter.getRoutedModel({
        requiresMultimodal: Boolean(imageInput),
      });

      // Build conversation messages for AI SDK.
      const messages: ModelMessage[] = [];

      const latestUserMessageIndex = imageInput
        ? this.findLatestUserMessageIndex(conversationHistory)
        : -1;

      if (userPushName) {
        messages.push({
          role: "user",
          content: `You are currently chatting with : ${userPushName}`,
        });
      }

      // Add conversation history
      for (const [index, message] of conversationHistory.entries()) {
        // Do not replay stored tool messages from previous turns.
        // They may lack required metadata (tool name + paired tool_calls context)
        // and can break provider-side validation.
        if (message.role === "tool") {
          continue;
        }

        if (
          route.provider === "google" &&
          imageInput &&
          message.role === "user" &&
          index === latestUserMessageIndex
        ) {
          messages.push({
            role: "user",
            content: [
              {
                type: "text",
                text: message.content,
              },
              {
                type: "image",
                image: imageInput.dataUrl,
                mediaType: imageInput.mimeType,
              },
            ],
          });

          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messageObj: any = {
          role: message.role,
          content: message.content,
        };

        messages.push(messageObj);
      }

      const aiTools = {
        web_search: createTool({
          description: "Search the web for information",
          inputSchema: z.object({
            query: z.string().min(1),
            topic: z.enum(["general", "news", "finance"]).optional(),
          }),
          execute: async ({ query, topic }) => web_search(query, topic),
        }),
        get_bot_commands: createTool({
          description:
            "Get a list of available bot commands, optionally filtered by query",
          inputSchema: z.object({
            query: z.string().optional(),
          }),
          execute: async ({ query }) => get_bot_commands(query),
        }),
        get_command_help: createTool({
          description:
            "Get detailed help information for a specific bot command",
          inputSchema: z.object({
            commandName: z.string().min(1),
          }),
          execute: async ({ commandName }) => get_command_help(commandName),
        }),
        ...(jid && sock && msg
          ? {
              execute_bot_command: createTool({
                description:
                  "Execute a bot command with given arguments. Use this when the user wants to perform an action that requires running a bot command.",
                inputSchema: z.object({
                  commandName: z.string().min(1),
                  args: z.array(z.string()),
                }),
                execute: async ({ commandName, args }) =>
                  execute_bot_command(commandName, args, {
                    jid: jid!,
                    user,
                    sock: sock!,
                    msg: msg!,
                  }),
              }),
            }
          : {}),
      };

      const result = await generateText({
        model: route.model,
        system: base_prompt,
        messages,
        temperature: 0.3,
        maxOutputTokens: 1024,
        providerOptions:
          route.provider === "google"
            ? {
                google: {
                  thinkingConfig: {
                    thinkingLevel: "minimal",
                  },
                },
              }
            : undefined,
        stopWhen: stepCountIs(5),
        tools: aiTools,
        onStepFinish: ({ toolCalls }) => {
          log.debug(
            `AI step finished using provider=${route.provider}, model=${route.modelId}`,
          );

          const calledTools = toolCalls
            .map((call) => call?.toolName)
            .filter((name): name is string => Boolean(name));

          if (calledTools.length > 0) {
            log.info(`Tool calls detected: ${calledTools.join(", ")}`);
          }
        },
      });

      return result.text || "Tidak ada jawaban yang diberikan oleh AI.";
    } catch (error) {
      console.error("Error fetching AI completion:", error);
      return "Terjadi kesalahan saat menghubungi AI.";
    }
  }

  private findLatestUserMessageIndex(
    conversationHistory: import("../../domain/services/AIConversationService.js").AIMessage[],
  ): number {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === "user") {
        return i;
      }
    }

    return -1;
  }

  private async extractImageInput(
    msg: proto.IWebMessageInfo,
    jid: string,
    sock: WebSocketInfo,
  ): Promise<AIImageInput | null> {
    try {
      if (msg.message?.imageMessage) {
        const imageBuffer = await this.downloadImageBuffer(msg, sock);
        if (!imageBuffer) return null;

        const mimeType = msg.message.imageMessage.mimetype || "image/jpeg";
        return {
          dataUrl: this.toDataUrl(imageBuffer, mimeType),
          mimeType,
        };
      }

      const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
      const quoted = contextInfo?.quotedMessage;

      if (!quoted?.imageMessage) {
        return null;
      }

      const quotedMsg: proto.IWebMessageInfo = {
        key: {
          remoteJid: jid,
          fromMe: !contextInfo?.participant,
          id: contextInfo?.stanzaId || "",
          participant: contextInfo?.participant,
        },
        message: quoted,
      };

      const imageBuffer = await this.downloadImageBuffer(quotedMsg, sock);
      if (!imageBuffer) return null;

      const mimeType = quoted.imageMessage.mimetype || "image/jpeg";
      return {
        dataUrl: this.toDataUrl(imageBuffer, mimeType),
        mimeType,
      };
    } catch (error) {
      log.error("Failed to extract image for AI multimodal input:", error);
      return null;
    }
  }

  private async downloadImageBuffer(
    msg: proto.IWebMessageInfo,
    sock: WebSocketInfo,
  ): Promise<Buffer | null> {
    try {
      const stream = await downloadMediaMessage(
        msg as WAMessage,
        "buffer",
        {},
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          logger: log as any,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      return stream ? Buffer.from(stream) : null;
    } catch (error) {
      log.error("Failed to download image for multimodal AI:", error);
      return null;
    }
  }

  private toDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }

  private async handleStatusCommand(
    user: string,
    jid: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    const sessionInfo = this.conversationService.getSessionInfo(user);

    if (!sessionInfo.hasSession) {
      await sock.sendMessage(jid, {
        text: "Anda tidak memiliki sesi percakapan aktif.\n\nMulai percakapan dengan mengirim pertanyaan ke AI menggunakan `!ai <pertanyaan>`.",
      });
      return;
    }

    const timeRemainingMinutes = Math.ceil(
      sessionInfo.timeRemaining / (60 * 1000),
    );
    const statusText =
      `*Status Sesi Percakapan AI*\n\n` +
      `📊 Total pesan: ${sessionInfo.messageCount}\n` +
      `⏱️ Waktu tersisa: ${timeRemainingMinutes} menit\n` +
      `🔄 Sesi akan diperpanjang otomatis setiap kali Anda mengirim pesan\n\n` +
      `_Ketik \`!ai end\` untuk mengakhiri sesi_`;

    await sock.sendMessage(jid, { text: statusText });
  }

  private async handleEndCommand(
    user: string,
    jid: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    const hadSession = await this.conversationService.endSession(user);

    if (hadSession) {
      await sock.sendMessage(jid, {
        text: "✅ Sesi percakapan AI Anda telah diakhiri.\n\nTerima kasih telah menggunakan layanan AI! Anda dapat memulai percakapan baru kapan saja.",
      });
    } else {
      await sock.sendMessage(jid, {
        text: "Anda tidak memiliki sesi percakapan aktif yang dapat diakhiri.",
      });
    }
  }

  private buildGroupContext(
    groupResponses: import("../../domain/services/AIResponseService.js").AIGroupResponse[],
  ): string {
    if (groupResponses.length === 0) return "";

    const contextLines = groupResponses.map((response) => {
      const userName = response.userPushName || "Unknown User";
      const timeAgo = this.formatTimeAgo(response.timestamp);
      return `[${timeAgo}] ${userName} asked: "${response.userQuestion}"\nNexa responded: "${response.aiResponse}"\n`;
    });

    return `\n\n### Previous AI Responses in This Group:\n${contextLines.join(
      "\n",
    )}\n\nYou can reference these previous responses when answering the current question if relevant.`;
  }

  private formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (60 * 1000));
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "just now";
  }
}
