import { downloadMediaMessage, proto, WAMessage } from "baileys";
import { createHash } from "crypto";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import {
  BotConfig,
  getUserRoles,
  log,
  type AIProviderPreference,
} from "../../infrastructure/config/config.js";
import { getMongoClient } from "../../infrastructure/config/mongo.js";
import { AIConversationService } from "../../domain/services/AIConversationService.js";
import { AIResponseService } from "../../domain/services/AIResponseService.js";
import { UserPreferenceService } from "../../domain/services/UserPreferenceService.js";
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
  knowledge_search,
  upsert_knowledge,
  web_search,
} from "../../shared/utils/ai_tools.js";
import {
  AI_PERSONALITIES,
  loadPersonalityPrompt,
  type AIPersonality,
} from "../../shared/utils/promptLoader.js";
import {
  AIKnowledgeVectorService,
  type KnowledgeScope,
} from "../../domain/services/AIKnowledgeVectorService.js";

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
• ${BotConfig.prefix}ai provider — Lihat preferensi provider AI Anda
• ${BotConfig.prefix}ai provider <groq|google|auto|default> — Atur provider AI Anda
• ${BotConfig.prefix}ai personality — Lihat personality AI Anda
• ${BotConfig.prefix}ai personality <nexa|luna|default> — Ganti personality AI
• ${BotConfig.prefix}ai kb help — Bantuan knowledge base (vector DB)
• ${BotConfig.prefix}ai help — Tampilkan bantuan ini

*Catatan:*
• Setiap pengguna memiliki sesi percakapan pribadi
• Sesi otomatis berakhir setelah 10 menit tidak aktif
• AI akan mengingat konteks percakapan selama sesi berlangsung
• Jika input berupa gambar, request otomatis dirutekan ke Gemini

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
  private knowledgeVectorService = AIKnowledgeVectorService.getInstance();
  private conversationService = AIConversationService.getInstance();
  private responseService = AIResponseService.getInstance();
  private userPreferenceService: UserPreferenceService | null = null;

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

        case "provider":
          await this.handleProviderCommand(user, jid, sock, args.slice(1));
          return;

        case "personality":
        case "persona":
          await this.handlePersonalityCommand(user, jid, sock, args.slice(1));
          return;

        case "kb":
        case "knowledge":
          await this.handleKnowledgeCommand(
            user,
            jid,
            sock,
            args.slice(1),
            msg,
          );
          return;
      }
    }

    // Get the prompt from args or quoted message
    let quotedText = "";
    let prompt = args.join(" ").trim();
    const userPushName = msg.pushName;
    const imageInput = await this.extractImageInput(msg, jid, sock);

    if (msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const contextInfo = msg.message.extendedTextMessage.contextInfo;
      const quoted = contextInfo.quotedMessage;
      const participant = contextInfo.participant;
      const isGroupChat = jid.endsWith("@g.us");

      if (quoted?.conversation) quotedText = quoted.conversation;
      else if (quoted?.extendedTextMessage?.text)
        quotedText = quoted.extendedTextMessage.text;
      else if (quoted?.imageMessage?.caption)
        quotedText = quoted.imageMessage.caption;

      if (quotedText) {
        let replyContext = "The user replied to a message";
        if (isGroupChat && participant) {
          const participantNumber = participant.split("@")[0];

          // Cek apakah pesan yang di-reply adalah pesan dari bot sendiri
          const botId = sock?.user?.id?.split(":")[0];
          if (botId && participantNumber === botId) {
            replyContext = "The user replied to YOUR message";
          } else {
            replyContext += ` by @${participantNumber}`;
          }
        }

        if (prompt) {
          prompt =
            `${replyContext}:\n"` +
            quotedText.trim() +
            "\"\n\nThe user's question:\n" +
            prompt;
        } else {
          prompt = `${replyContext}:\n"` + quotedText.trim() + '"';
        }
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
      const userProviderPreference = await this.getUserProviderPreference(user);
      const userPersonalityPreference =
        await this.getUserPersonalityPreference(user);

      const response = await this.getAICompletion(
        history,
        user,
        userPushName,
        groupContext,
        jid,
        sock,
        msg,
        imageInput,
        userProviderPreference,
        userPersonalityPreference,
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

      // Persist turn-level semantic memory to vector DB when configured.
      try {
        const sourceId = this.buildDeterministicChatTurnSourceId(
          user,
          jid,
          prompt,
          msg,
        );

        await upsert_knowledge({
          text: `User: ${prompt}\nAssistant: ${response}`,
          userId: user,
          groupId: isGroupChat ? jid : undefined,
          scope: isGroupChat ? "group" : "user",
          sourceType: "chat_turn",
          sourceId,
        });
      } catch (error) {
        log.error("Failed to store vector knowledge for AI turn:", error);
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
    userProviderPreference?: AIProviderPreference | null,
    userPersonalityPreference?: AIPersonality | null,
  ): Promise<string> {
    try {
      // Load the base prompt from markdown file
      const base_prompt = loadPersonalityPrompt(
        userPersonalityPreference || "nexa",
        {
          groupContext,
          currentDate: new Date().toString(),
        },
      );

      const route = this.providerRouter.getRoutedModel({
        requiresMultimodal: Boolean(imageInput),
        preferredProvider: userProviderPreference || undefined,
      });

      if (imageInput && userProviderPreference === "groq") {
        log.info(
          "AI provider preference is groq, but image input detected. Routing to google for multimodal support.",
        );
      }

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
        knowledge_search: createTool({
          description:
            "Search internal knowledge base (Qdrant) for relevant context from stored conversations/documents.",
          inputSchema: z.object({
            query: z.string().min(1),
            scope: z.enum(["auto", "user", "group", "global"]).optional(),
            limit: z.number().int().min(1).max(10).optional(),
          }),
          execute: async ({ query, scope, limit }) =>
            knowledge_search({
              query,
              scope,
              limit,
              userId: user,
              groupId: jid?.endsWith("@g.us") ? jid : undefined,
            }),
        }),
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
        temperature: 0.6,
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

  private async getUserPreferenceService(): Promise<UserPreferenceService> {
    if (this.userPreferenceService) {
      return this.userPreferenceService;
    }

    const mongoClient = await getMongoClient();
    this.userPreferenceService = new UserPreferenceService(mongoClient);
    return this.userPreferenceService;
  }

  private async getUserProviderPreference(
    user: string,
  ): Promise<AIProviderPreference | null> {
    try {
      const preferenceService = await this.getUserPreferenceService();
      return await preferenceService.getAIProviderPreference(user);
    } catch (error) {
      log.error("Failed to load user AI provider preference:", error);
      return null;
    }
  }

  private async getUserPersonalityPreference(
    user: string,
  ): Promise<AIPersonality | null> {
    try {
      const preferenceService = await this.getUserPreferenceService();
      return await preferenceService.getAIPersonalityPreference(user);
    } catch (error) {
      log.error("Failed to load user AI personality preference:", error);
      return null;
    }
  }

  private async handleProviderCommand(
    user: string,
    jid: string,
    sock: WebSocketInfo,
    args: string[],
  ): Promise<void> {
    const requested = args[0]?.toLowerCase();

    if (!requested || requested === "status") {
      const userPreference = await this.getUserProviderPreference(user);
      const effectivePreference = userPreference || BotConfig.aiProvider;
      let textRouteText = "tidak tersedia";
      try {
        const textRoute = this.providerRouter.getRoutedModel({
          preferredProvider: effectivePreference,
        });
        textRouteText = `${textRoute.provider} (${textRoute.modelId})`;
      } catch (_error) {
        textRouteText = "tidak tersedia (API key provider belum diatur)";
      }

      let imageRouteText = "google (Gemini)";
      try {
        const imageRoute = this.providerRouter.getRoutedModel({
          preferredProvider: effectivePreference,
          requiresMultimodal: true,
        });
        imageRouteText = `${imageRoute.provider} (${imageRoute.modelId})`;
      } catch (_error) {
        imageRouteText =
          "tidak tersedia (GOOGLE_GENERATIVE_AI_API_KEY belum diatur)";
      }

      await sock.sendMessage(jid, {
        text:
          `*AI Provider Anda*\n\n` +
          `• Preferensi pribadi: ${userPreference || "default bot"}\n` +
          `• Default bot: ${BotConfig.aiProvider}\n` +
          `• Rute teks aktif: ${textRouteText}\n` +
          `• Rute gambar aktif: ${imageRouteText}\n\n` +
          `Gunakan ${BotConfig.prefix}ai provider <groq|google|auto|default> untuk mengubah preferensi.`,
      });
      return;
    }

    try {
      const preferenceService = await this.getUserPreferenceService();

      if (requested === "default" || requested === "reset") {
        await preferenceService.clearAIProviderPreference(user);

        const textRoute = this.providerRouter.getRoutedModel({
          preferredProvider: BotConfig.aiProvider,
        });

        await sock.sendMessage(jid, {
          text:
            `✅ Preferensi AI provider Anda direset ke default bot (${BotConfig.aiProvider}).\n` +
            `Rute teks saat ini: ${textRoute.provider} (${textRoute.modelId}).`,
        });
        return;
      }

      if (
        requested !== "groq" &&
        requested !== "google" &&
        requested !== "auto"
      ) {
        await sock.sendMessage(jid, {
          text:
            `❌ Provider tidak valid: ${requested}\n` +
            `Gunakan: ${BotConfig.prefix}ai provider <groq|google|auto|default>`,
        });
        return;
      }

      await preferenceService.setAIProviderPreference(
        user,
        requested as AIProviderPreference,
      );

      const textRoute = this.providerRouter.getRoutedModel({
        preferredProvider: requested,
      });

      const fallbackNote =
        requested !== "auto" && textRoute.provider !== requested
          ? `\nCatatan: provider ${requested} belum siap (API key tidak tersedia), jadi sistem fallback ke ${textRoute.provider}.`
          : "";

      await sock.sendMessage(jid, {
        text:
          `✅ Preferensi AI provider Anda diset ke *${requested}*.\n` +
          `Rute teks saat ini: ${textRoute.provider} (${textRoute.modelId}).\n` +
          `Untuk input gambar, sistem otomatis memakai Gemini jika tersedia.` +
          fallbackNote,
      });
    } catch (error) {
      log.error("Failed to update user AI provider preference:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi kesalahan saat menyimpan preferensi provider AI.",
      });
    }
  }

  private async handlePersonalityCommand(
    user: string,
    jid: string,
    sock: WebSocketInfo,
    args: string[],
  ): Promise<void> {
    const requested = args[0]?.toLowerCase();

    if (!requested || requested === "status") {
      const userPreference = await this.getUserPersonalityPreference(user);
      const activePersonality = userPreference || "nexa";

      await sock.sendMessage(jid, {
        text:
          `*AI Personality Anda*\n\n` +
          `• Personality aktif: ${activePersonality}\n` +
          `• Preferensi pribadi: ${userPreference || "default (nexa)"}\n` +
          `• Pilihan tersedia: ${AI_PERSONALITIES.join(", ")}\n\n` +
          `Gunakan ${BotConfig.prefix}ai personality <${AI_PERSONALITIES.join("|")}|default> untuk mengubah personality.`,
      });
      return;
    }

    try {
      const preferenceService = await this.getUserPreferenceService();

      if (requested === "default" || requested === "reset") {
        await preferenceService.clearAIPersonalityPreference(user);

        await sock.sendMessage(jid, {
          text: "✅ Personality AI Anda direset ke default (nexa).",
        });
        return;
      }

      if (!AI_PERSONALITIES.includes(requested as AIPersonality)) {
        await sock.sendMessage(jid, {
          text:
            `❌ Personality tidak valid: ${requested}\n` +
            `Gunakan: ${BotConfig.prefix}ai personality <${AI_PERSONALITIES.join("|")}|default>`,
        });
        return;
      }

      await preferenceService.setAIPersonalityPreference(
        user,
        requested as AIPersonality,
      );

      await sock.sendMessage(jid, {
        text: `✅ Personality AI Anda diset ke *${requested}*.`,
      });
    } catch (error) {
      log.error("Failed to update user AI personality preference:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi kesalahan saat menyimpan preferensi personality AI.",
      });
    }
  }

  private async handleKnowledgeCommand(
    user: string,
    jid: string,
    sock: WebSocketInfo,
    args: string[],
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    const action = args[0]?.toLowerCase() || "help";
    const isGroupChat = jid.endsWith("@g.us");
    const defaultScope = this.getDefaultKnowledgeScope(jid);

    if (action === "help") {
      await sock.sendMessage(jid, {
        text:
          `*Knowledge Base (Vector DB)*\n\n` +
          `• ${BotConfig.prefix}ai kb status\n` +
          `• ${BotConfig.prefix}ai kb list [user|group|global] [limit]\n` +
          `• ${BotConfig.prefix}ai kb add [user|group|global] <teks>\n` +
          `• ${BotConfig.prefix}ai kb addurl [user|group|global] <url>\n` +
          `• ${BotConfig.prefix}ai kb delete [user|group|global] <sourceId>\n` +
          `• ${BotConfig.prefix}ai kb reindex [user|group|global] <sourceId>\n\n` +
          `Catatan:\n` +
          `- Scope default: *${defaultScope}*\n` +
          `- Scope group hanya bisa dipakai di chat grup\n` +
          `- Operasi tulis scope group/global butuh role admin atau moderator bot`,
      });
      return;
    }

    if (action === "status") {
      try {
        const status = await this.knowledgeVectorService.getStatus({
          scope: defaultScope,
          userId: user,
          groupId: isGroupChat ? jid : undefined,
        });

        if (!status.configured) {
          await sock.sendMessage(jid, {
            text:
              `❌ Knowledge base belum aktif.\n` +
              `Pastikan env berikut sudah diisi: QDRANT_URL, QDRANT_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY.`,
          });
          return;
        }

        await sock.sendMessage(jid, {
          text:
            `*Status Knowledge Base*\n\n` +
            `• Collection: ${status.collection}\n` +
            `• Embedding model: ${status.embeddingModel}\n` +
            `• Vector size: ${status.vectorSize ?? "unknown"}\n` +
            `• Top K default: ${status.topK}\n` +
            `• Min score default: ${status.minScore}\n` +
            `• Total points: ${status.totalPoints ?? "unknown"}\n` +
            `• Scope aktif: ${status.scope || defaultScope}\n` +
            `• Points scope aktif: ${status.scopedPoints ?? "unknown"}`,
        });
      } catch (error) {
        log.error("Failed to get knowledge base status:", error);
        await sock.sendMessage(jid, {
          text: "Terjadi kesalahan saat membaca status knowledge base.",
        });
      }

      return;
    }

    if (!this.knowledgeVectorService.isConfigured()) {
      await sock.sendMessage(jid, {
        text:
          `❌ Knowledge base belum aktif.\n` +
          `Isi dulu QDRANT_URL, QDRANT_API_KEY, dan GOOGLE_GENERATIVE_AI_API_KEY.`,
      });
      return;
    }

    if (action === "list") {
      const { scope, consumed } = this.parseKnowledgeScope(args[1], jid);
      const scopeContext = this.resolveKnowledgeScopeContext(scope, user, jid);
      if (scopeContext.error) {
        await sock.sendMessage(jid, { text: scopeContext.error });
        return;
      }

      const rawLimit = args[consumed ? 2 : 1];
      const parsedLimit = Number(rawLimit);
      const limit = Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(parsedLimit, 20))
        : 8;

      try {
        const items = await this.knowledgeVectorService.listKnowledge({
          scope,
          limit,
          ...scopeContext,
        });

        if (items.length === 0) {
          await sock.sendMessage(jid, {
            text: `Tidak ada data knowledge pada scope *${scope}* saat ini.`,
          });
          return;
        }

        const lines = items.map((item, index) => {
          const createdAtText = item.createdAt
            ? new Date(item.createdAt).toLocaleString("id-ID")
            : "unknown-time";
          const sourceIdText = item.sourceId || "(tanpa sourceId)";
          return (
            `${index + 1}. [${item.scope}] ${item.sourceType} | ${sourceIdText}\n` +
            `   id: ${item.id}\n` +
            `   at: ${createdAtText}\n` +
            `   preview: ${item.preview}`
          );
        });

        await sock.sendMessage(jid, {
          text:
            `*Daftar Knowledge (${scope})*\n\n${lines.join("\n\n")}` +
            `\n\nGunakan sourceId untuk delete/reindex.`,
        });
      } catch (error) {
        log.error("Failed to list knowledge items:", error);
        await sock.sendMessage(jid, {
          text: "Terjadi kesalahan saat mengambil daftar knowledge.",
        });
      }

      return;
    }

    if (action === "add") {
      const { scope, consumed } = this.parseKnowledgeScope(args[1], jid);
      const hasPermission = await this.canWriteKnowledgeScope(scope, user);
      if (!hasPermission) {
        await sock.sendMessage(jid, {
          text: "❌ Anda tidak punya izin untuk menulis knowledge pada scope group/global.",
        });
        return;
      }

      const scopeContext = this.resolveKnowledgeScopeContext(scope, user, jid);
      if (scopeContext.error) {
        await sock.sendMessage(jid, { text: scopeContext.error });
        return;
      }

      const textFromArgs = args
        .slice(consumed ? 2 : 1)
        .join(" ")
        .trim();
      const quotedText = this.extractQuotedText(msg);
      const rawText = textFromArgs || quotedText || "";
      const normalizedText = rawText.replace(/\s+/g, " ").trim();

      if (!normalizedText) {
        await sock.sendMessage(jid, {
          text:
            `Gunakan: ${BotConfig.prefix}ai kb add [user|group|global] <teks>\n` +
            `Atau reply pesan lalu kirim: ${BotConfig.prefix}ai kb add`,
        });
        return;
      }

      try {
        const sourceId = `manual:${Date.now()}`;
        const inserted = await this.knowledgeVectorService.upsertKnowledge({
          text: normalizedText,
          scope,
          sourceType: "manual_text",
          sourceId,
          metadata: {
            ingestedBy: user,
            ingestedAt: Date.now(),
          },
          ...scopeContext,
        });

        await sock.sendMessage(jid, {
          text:
            `✅ Knowledge berhasil ditambahkan.\n` +
            `• Scope: ${scope}\n` +
            `• Source ID: ${sourceId}\n` +
            `• Chunks tersimpan: ${inserted}`,
        });
      } catch (error) {
        log.error("Failed to add manual knowledge:", error);
        await sock.sendMessage(jid, {
          text: "Terjadi kesalahan saat menyimpan knowledge manual.",
        });
      }

      return;
    }

    if (action === "addurl" || action === "add-url") {
      const { scope, consumed } = this.parseKnowledgeScope(args[1], jid);
      const hasPermission = await this.canWriteKnowledgeScope(scope, user);
      if (!hasPermission) {
        await sock.sendMessage(jid, {
          text: "❌ Anda tidak punya izin untuk menulis knowledge pada scope group/global.",
        });
        return;
      }

      const scopeContext = this.resolveKnowledgeScopeContext(scope, user, jid);
      if (scopeContext.error) {
        await sock.sendMessage(jid, { text: scopeContext.error });
        return;
      }

      const urlCandidate = (args[consumed ? 2 : 1] || "").trim();
      if (!urlCandidate) {
        await sock.sendMessage(jid, {
          text: `Gunakan: ${BotConfig.prefix}ai kb addurl [user|group|global] <url>`,
        });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(urlCandidate);
      } catch (_error) {
        await sock.sendMessage(jid, {
          text: `URL tidak valid: ${urlCandidate}`,
        });
        return;
      }

      try {
        const { title, text } = await this.fetchUrlAsPlainText(
          parsedUrl.toString(),
        );

        if (!text || text.length < 40) {
          await sock.sendMessage(jid, {
            text: "Konten URL terlalu pendek atau tidak bisa diekstrak. Coba URL lain.",
          });
          return;
        }

        const sourceId = `url:${parsedUrl.toString()}`;

        // Replace previous index for the same URL in the same scope/context.
        await this.knowledgeVectorService.deleteKnowledgeBySource({
          sourceId,
          scope,
          ...scopeContext,
        });

        const payloadText =
          `Source URL: ${parsedUrl.toString()}\n` +
          (title ? `Title: ${title}\n\n` : "") +
          text;

        const inserted = await this.knowledgeVectorService.upsertKnowledge({
          text: payloadText,
          scope,
          sourceType: "url",
          sourceId,
          metadata: {
            ingestedBy: user,
            ingestedAt: Date.now(),
            url: parsedUrl.toString(),
            title: title || "",
          },
          ...scopeContext,
        });

        await sock.sendMessage(jid, {
          text:
            `✅ URL berhasil diindeks ke knowledge base.\n` +
            `• Scope: ${scope}\n` +
            `• Source ID: ${sourceId}\n` +
            `• Chunks tersimpan: ${inserted}`,
        });
      } catch (error) {
        log.error("Failed to ingest URL knowledge:", error);
        await sock.sendMessage(jid, {
          text: "Terjadi kesalahan saat mengindeks URL ke knowledge base.",
        });
      }

      return;
    }

    if (action === "delete") {
      const { scope, consumed } = this.parseKnowledgeScope(args[1], jid);
      const hasPermission = await this.canWriteKnowledgeScope(scope, user);
      if (!hasPermission) {
        await sock.sendMessage(jid, {
          text: "❌ Anda tidak punya izin untuk menghapus knowledge pada scope group/global.",
        });
        return;
      }

      const scopeContext = this.resolveKnowledgeScopeContext(scope, user, jid);
      if (scopeContext.error) {
        await sock.sendMessage(jid, { text: scopeContext.error });
        return;
      }

      const sourceId = args
        .slice(consumed ? 2 : 1)
        .join(" ")
        .trim();
      if (!sourceId) {
        await sock.sendMessage(jid, {
          text: `Gunakan: ${BotConfig.prefix}ai kb delete [user|group|global] <sourceId>`,
        });
        return;
      }

      try {
        const deleted =
          await this.knowledgeVectorService.deleteKnowledgeBySource({
            sourceId,
            scope,
            ...scopeContext,
          });

        if (deleted <= 0) {
          await sock.sendMessage(jid, {
            text: `Tidak ada data dengan sourceId '${sourceId}' pada scope ${scope}.`,
          });
          return;
        }

        await sock.sendMessage(jid, {
          text:
            `✅ Knowledge dihapus.\n` +
            `• Scope: ${scope}\n` +
            `• Source ID: ${sourceId}\n` +
            `• Points terhapus: ${deleted}`,
        });
      } catch (error) {
        log.error("Failed to delete knowledge by source:", error);
        await sock.sendMessage(jid, {
          text: "Terjadi kesalahan saat menghapus knowledge.",
        });
      }

      return;
    }

    if (action === "reindex") {
      const { scope, consumed } = this.parseKnowledgeScope(args[1], jid);
      const hasPermission = await this.canWriteKnowledgeScope(scope, user);
      if (!hasPermission) {
        await sock.sendMessage(jid, {
          text: "❌ Anda tidak punya izin untuk reindex knowledge pada scope group/global.",
        });
        return;
      }

      const scopeContext = this.resolveKnowledgeScopeContext(scope, user, jid);
      if (scopeContext.error) {
        await sock.sendMessage(jid, { text: scopeContext.error });
        return;
      }

      const sourceId = args
        .slice(consumed ? 2 : 1)
        .join(" ")
        .trim();
      if (!sourceId) {
        await sock.sendMessage(jid, {
          text: `Gunakan: ${BotConfig.prefix}ai kb reindex [user|group|global] <sourceId>`,
        });
        return;
      }

      try {
        const updated =
          await this.knowledgeVectorService.reindexKnowledgeBySource({
            sourceId,
            scope,
            ...scopeContext,
          });

        if (updated <= 0) {
          await sock.sendMessage(jid, {
            text: `Tidak ada data yang direindex untuk sourceId '${sourceId}' pada scope ${scope}.`,
          });
          return;
        }

        await sock.sendMessage(jid, {
          text:
            `✅ Reindex selesai.\n` +
            `• Scope: ${scope}\n` +
            `• Source ID: ${sourceId}\n` +
            `• Points direindex: ${updated}`,
        });
      } catch (error) {
        log.error("Failed to reindex knowledge by source:", error);
        await sock.sendMessage(jid, {
          text: "Terjadi kesalahan saat reindex knowledge.",
        });
      }

      return;
    }

    await sock.sendMessage(jid, {
      text:
        `Subcommand knowledge tidak dikenal: ${action}\n` +
        `Gunakan: ${BotConfig.prefix}ai kb help`,
    });
  }

  private getDefaultKnowledgeScope(jid: string): KnowledgeScope {
    return jid.endsWith("@g.us") ? "group" : "user";
  }

  private parseKnowledgeScope(
    raw: string | undefined,
    jid: string,
  ): {
    scope: KnowledgeScope;
    consumed: boolean;
  } {
    const normalized = raw?.toLowerCase();
    if (
      normalized === "user" ||
      normalized === "group" ||
      normalized === "global"
    ) {
      return { scope: normalized, consumed: true };
    }

    return {
      scope: this.getDefaultKnowledgeScope(jid),
      consumed: false,
    };
  }

  private resolveKnowledgeScopeContext(
    scope: KnowledgeScope,
    user: string,
    jid: string,
  ): {
    userId?: string;
    groupId?: string;
    error?: string;
  } {
    if (scope === "user") {
      return { userId: user };
    }

    if (scope === "group") {
      if (!jid.endsWith("@g.us")) {
        return {
          error:
            "Scope group hanya bisa dipakai dari chat grup. Gunakan scope user/global di private chat.",
        };
      }

      return { groupId: jid };
    }

    return {};
  }

  private async canWriteKnowledgeScope(
    scope: KnowledgeScope,
    user: string,
  ): Promise<boolean> {
    if (scope === "user") {
      return true;
    }

    const roles = await getUserRoles(user);
    return roles.includes("admin") || roles.includes("moderator");
  }

  private extractQuotedText(msg: proto.IWebMessageInfo): string | null {
    const quoted =
      msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) {
      return null;
    }

    if (quoted.conversation) {
      return quoted.conversation;
    }

    if (quoted.extendedTextMessage?.text) {
      return quoted.extendedTextMessage.text;
    }

    if (quoted.imageMessage?.caption) {
      return quoted.imageMessage.caption;
    }

    return null;
  }

  private async fetchUrlAsPlainText(
    url: string,
  ): Promise<{ title: string | null; text: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WhatsApp-Funbot/1.0)",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || null;

      const stripped = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();

      return {
        title,
        text: stripped.slice(0, 20000),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildDeterministicChatTurnSourceId(
    user: string,
    jid: string,
    prompt: string,
    msg: proto.IWebMessageInfo,
  ): string {
    const scope = jid.endsWith("@g.us") ? "group" : "user";
    const scopeId = scope === "group" ? jid : user;
    const messageId = msg?.key?.id?.trim();

    if (messageId) {
      return `chat_turn:${scope}:${scopeId}:${messageId}`;
    }

    const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
    const timestampPart = JSON.stringify(msg?.messageTimestamp || "");
    const hashInput = `${scope}|${scopeId}|${timestampPart}|${normalizedPrompt}`;
    const digest = createHash("sha256")
      .update(hashInput)
      .digest("hex")
      .slice(0, 24);

    return `chat_turn:${scope}:${scopeId}:${digest}`;
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
