import { downloadMediaMessage, proto, WAMessage } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import {
  BotConfig,
  log,
  type AIProviderPreference,
} from "../../infrastructure/config/config.js";
import { getMongoClient } from "../../infrastructure/config/mongo.js";
import { getUserRolesConsideringAlt } from "../../shared/utils/userRoles.js";
import {
  fetchJoinedGroups,
  resolveGroup,
  sendGroupText,
} from "../../shared/utils/groupDirectory.js";
import { formatResponseForWhatsApp } from "../../shared/utils/whatsapp_formatter.js";
import { AIConversationService } from "../../domain/services/AIConversationService.js";
import { AIResponseService } from "../../domain/services/AIResponseService.js";
import { UserPreferenceService } from "../../domain/services/UserPreferenceService.js";
import { tool as createTool, type ModelMessage, ToolLoopAgent } from "ai";
import { createAskAgent, runSubagentTask } from "../agents/AskAgent.js";
import { z } from "zod";
import { AIProviderRouterService } from "../../domain/services/AIProviderRouterService.js";
import {
  execute_bot_command,
  get_bot_commands,
  get_command_help,
  reply_chat_message,
  send_chat_media,
  send_chat_message,
  web_search,
  web_extract,
  delete_file,
  exec_command,
  list_files,
  read_file,
  read_memory,
  update_memory,
  web_fetch,
  write_file,
} from "../../shared/utils/ai_tools.js";
import {
  AI_PERSONALITIES,
  getKnownUsersForPersonality,
  loadPersonalityPrompt,
  type AIPersonality,
} from "../../shared/utils/promptLoader.js";
import type { Logger } from "pino";

interface AIImageInput {
  dataUrl: string;
  mimeType: string;
}

interface AICompletionResult {
  /** Final assistant text (may be empty when the reply was sent via a tool). */
  text: string;
  /** Texts that were actually delivered to the chat during this turn. */
  sentTexts: string[];
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
• ${BotConfig.prefix}ai provider <groq|google|openrouter|deepseek|auto|default> — Atur provider AI Anda
• ${BotConfig.prefix}ai personality — Lihat personality AI Anda
• ${BotConfig.prefix}ai personality <nexa|luna|default> — Ganti personality AI
• ${BotConfig.prefix}ai help — Tampilkan bantuan ini

*Catatan:*
• Setiap pengguna memiliki sesi percakapan pribadi
• Sesi otomatis berakhir setelah 10 menit tidak aktif
• AI akan mengingat konteks percakapan selama sesi berlangsung
• Jika input berupa gambar, model vision (DeepSeek/Gemini) langsung membacanya

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
          await this.handleStatusCommand(user, jid, sock);
          return;

        case "end":
          await this.handleEndCommand(user, jid, sock);
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
          await sock.sendMessage(jid, {
            text: "Fitur knowledge base (vector DB) sudah dihapus. Gunakan AI seperti biasa, atau ketik *!ai help*.",
          });
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
            `[${replyContext}]:\n` +
            `"${quotedText.trim()}"\n\n` +
            `[User's Reply]:\n` +
            `"${prompt}"`;
        } else {
          prompt = `[${replyContext}]:\n"${quotedText.trim()}"`;
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

      // Get user profile traits graph
      let profileGraphContext = "";
      try {
        const preferenceService = await this.getUserPreferenceService();
        const traits = await preferenceService.getProfileGraph(user);
        const entries = Object.entries(traits);
        if (entries.length > 0) {
          profileGraphContext = entries
            .map(([key, value]) => `- ${key}: ${value}`)
            .join("\n");
          log.info(`Loaded user profile graph with ${entries.length} trait(s).`);
        }
      } catch (error) {
        log.error("Failed to load user profile graph:", error);
      }

      const completion = await this.getAICompletion(
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
        profileGraphContext,
      );

      // Persist the assistant turn from the text the user actually received.
      // Replies delivered through reply_message/send_message never appear in
      // the final model text, which previously made the bot forget its own
      // answers on the next turn.
      const assistantReply =
        completion.sentTexts.length > 0
          ? completion.sentTexts.join("\n\n")
          : completion.text;

      if (assistantReply.trim()) {
        await this.conversationService.addMessage(
          user,
          "assistant",
          assistantReply.trim(),
        );

        // Save response to group context if this is a group chat
        if (isGroupChat) {
          await this.responseService.saveResponse(
            jid,
            user,
            userPushName || undefined,
            prompt,
            assistantReply.trim(),
          );
        }
      }

      // Do not send the model text directly; the model should respond via tools.
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
    profileGraphContext?: string,
  ): Promise<AICompletionResult> {
    let statusMsgKey: proto.IMessageKey | undefined;
    const sentTexts: string[] = [];

    const recordSentText = (text?: string | null) => {
      const clean = text?.trim();
      if (!clean) return;
      if (sentTexts[sentTexts.length - 1] === clean) return;
      sentTexts.push(clean);
    };

    try {
      const activePersonality = userPersonalityPreference || "nexa";
      const isGroupChat = Boolean(jid?.endsWith("@g.us"));
      const userRoles = await getUserRolesConsideringAlt(user, msg);
      const isPrivilegedUser = userRoles.includes("admin");
      const knownUserContextInstruction = this.buildKnownUserContextInstruction(
        userPushName,
        activePersonality,
      );
      const runtimeUserContextInstruction =
        this.buildRuntimeUserContextInstruction({
          userId: user,
          displayName: userPushName,
          jid,
          isGroupChat,
          activePersonality,
          providerPreference: userProviderPreference || null,
          userRoles,
        });

      // Load the base prompt from markdown file
      const base_prompt = loadPersonalityPrompt(activePersonality, {
        groupContext,
        currentDate: new Date().toString(),
        privileged: isPrivilegedUser,
        additionalInstructions: [
          knownUserContextInstruction,
          runtimeUserContextInstruction,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });

      const lastUserMessage =
        conversationHistory.findLast((m) => m.role === "user")?.content || "";

      // Vision-capable providers (DeepSeek, Gemini) read the image directly;
      // a text-only provider is only used when no vision key is configured.
      const route = this.providerRouter.getRoutedModel({
        requiresMultimodal: Boolean(imageInput),
        preferredProvider: userProviderPreference || undefined,
      });

      let finalSystemPrompt = base_prompt;
      if (userPushName) {
        finalSystemPrompt += `\n\nYou are currently chatting with user: ${userPushName}`;
      }

      if (imageInput && !route.supportsMultimodal) {
        finalSystemPrompt += `\n\n### IMAGE ATTACHED BUT NOT PROCESSABLE\n` +
          `The user attached an image, but the active model (${route.provider}/${route.modelId}) cannot read images.\n` +
          `Tell the user briefly that the current AI provider cannot process images and that they can switch provider (DeepSeek or Google) to get the image analyzed. Then answer any text part of their request.`;
      }

      if (profileGraphContext) {
        finalSystemPrompt += `\n\n### USER structured PROFILE GRAPH (CORE FACT MEMORY)\n` +
          `These are structured, verified facts you know about the user:\n` +
          `${profileGraphContext}\n` +
          `Refer to this to customize nickname, greeting, preferences, or personal details.`;
      }

      finalSystemPrompt +=
        `\n\nUser-facing output rule: You can only communicate back to the user through \`reply_message()\`, \`send_message()\`, and \`send_media()\`` +
        ` Always deliver the actual response using reply_message() or send_message().` +
        ` If you need to send a file, image, video, audio, or document, use send_media().`;

      // --- Memory & Context Protocol ---
      finalSystemPrompt += `\n\n### MEMORY & CONTEXT PROTOCOL
1. **Global Memory Access**: Use \`read_memory()\` to check \`MEMORY.md\` for high-level personal details, global facts, or persistent instructions about the user.
2. **Contextual Awareness**: Use the information found to personalize your response and maintain consistency.
3. **Memory Updates**: If the user shares important personal details (e.g., their name, preferences, or significant life events), use \`update_memory()\` to store this for future reference.
4. **Durable Facts Only**: Store stable preferences, identities, recurring instructions, and long-lived decisions; skip transient chatter.`;

      // --- Deep Research Enhancement ---
      const isResearchIntent = this.detectResearchIntent(lastUserMessage);

      let stopWhenSteps = 30;
      if (isResearchIntent) {
        stopWhenSteps = 60;
        finalSystemPrompt += `\n\n### DEEP RESEARCH PROTOCOL ACTIVATED
You have identified a research-heavy request. Follow these steps for maximum accuracy:
1. **Multi-Source Verification**: Do not rely on a single search result. Compare information from at least 3 different sources.
2. **Deep Reading**: Use \`web_fetch()\` on at least 2-3 high-quality URLs from search results to understand the context beyond search snippets.
3. **Fact Checking**: Check for contradictory information. If found, present both sides.
4. **Structured Report**: Synthesize your findings into a comprehensive, well-structured report. Use bolding and lists for readability.
5. **Citations**: Always include the source URLs you used at the end of your report.
6. **Efficiency**: You have an increased step limit (60 steps) to complete this investigation.`;

        log.info("Deep Research Mode activated for this request (60 steps)");
      }
      // ---------------------------------

      // Build conversation messages for AI SDK.
      const messages: ModelMessage[] = [];

      // Limit to last 40 messages to prevent context window overflow
      const MAX_CONTEXT_TURNS = 40;
      const recentHistory = conversationHistory.slice(-MAX_CONTEXT_TURNS);

      const latestUserMessageIndex = imageInput
        ? this.findLatestUserMessageIndex(recentHistory)
        : -1;

      // Add conversation history
      for (const [index, message] of recentHistory.entries()) {
        // Do not replay stored tool messages from previous turns.
        // They may lack required metadata (tool name + paired tool_calls context)
        // and can break provider-side validation.
        if (message.role === "tool") {
          continue;
        }

        // Also skip assistant messages that have empty content (likely tool call triggers without text)
        if (message.role === "assistant" && !message.content?.trim()) {
          continue;
        }

        if (
          route.supportsMultimodal &&
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

        messages.push({
          role: message.role as "user" | "assistant" | "system",
          content: message.content,
        });
      }

      let responseToolUsed = false;

      let aiTools: ConstructorParameters<typeof ToolLoopAgent>[0]["tools"];
      aiTools = {
        update_profile_trait: createTool({
          description: "Update a structured trait/fact in the user's profile graph memory (e.g. name, preferences, favorite things). Set value to empty/remove/delete to delete.",
          inputSchema: z.object({
            key: z.string().min(1).describe("The profile fact key, e.g. 'petName' or 'preferredProgrammingLanguage'"),
            value: z.string().describe("The profile fact value to save, or empty string to delete"),
          }),
          execute: async ({ key, value }) => {
            try {
              const preferenceService = await this.getUserPreferenceService();
              if (!value || value.trim() === "" || value.trim() === "delete" || value.trim() === "remove") {
                await preferenceService.deleteProfileTrait(user, key);
                return `Successfully deleted trait '${key}' for user.`;
              }
              await preferenceService.updateProfileTrait(user, key, value);
              return `Successfully updated trait '${key}' to '${value}' in user's profile graph memory.`;
            } catch (err) {
              log.error("Failed to update profile trait:", err);
              return `Error updating profile trait: ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        }),
        delegate_task: createTool({
          description: "Delegate a complex sub-task to a specialized subagent (researcher, coder, writer) to offload work.",
          inputSchema: z.object({
            agentType: z.enum(["researcher", "coder", "writer"]),
            task: z.string().min(1).describe("Specific detailed task description for the subagent to execute"),
          }),
          execute: async ({ agentType, task }) => {
            try {
              log.info(`Executing delegated task to subagent '${agentType}': ${task}`);
              return await runSubagentTask(route, agentType, task, aiTools);
            } catch (err) {
              log.error(`Error in subagent delegation:`, err);
              return `Error executing delegated task: ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        }),
        web_search: createTool({
          description: "Search the web for information",
          inputSchema: z.object({
            query: z.string().min(1),
            topic: z.enum(["general", "news", "finance"]).optional(),
            searchDepth: z
              .enum(["basic", "advanced", "fast", "ultra-fast"])
              .optional(),
            includeAnswer: z
              .union([z.boolean(), z.enum(["basic", "advanced"])])
              .optional(),
          }),
          execute: async ({ query, topic, searchDepth, includeAnswer }) =>
              web_search(query, topic, { searchDepth, includeAnswer }),
        }),
        web_extract: createTool({
          description: "Extract clean content from one or more URLs using Tavily Extract API",
          inputSchema: z.object({
            urls: z.union([z.string(), z.array(z.string())]),
            query: z.string().optional().describe("Optional query to search/filter the page content for relevance"),
          }),
          execute: async ({ urls, query }) => web_extract(urls, query),
        }),
        send_message: createTool({
          description:
            "Send a plain text follow-up message to the current chat.",
          inputSchema: z.object({
            text: z.string().min(1),
          }),
          execute: async ({ text }) => {
            const result = await send_chat_message(text, {
              jid: jid!,
              sock: sock!,
              msg: msg!,
            });
            recordSentText(text);
            return result;
          },
        }),
        reply_message: createTool({
          description:
            "Send a plain text reply that quotes the current user message.",
          inputSchema: z.object({
            text: z.string().min(1),
          }),
          execute: async ({ text }) => {
            const result = await reply_chat_message(text, {
              jid: jid!,
              sock: sock!,
              msg: msg!,
            });
            recordSentText(text);
            return result;
          },
        }),
        send_media: createTool({
          description:
            "Send media or a document to the current chat from a URL or data URL.",
          inputSchema: z
            .object({
              mediaType: z.enum(["image", "video", "audio", "document"]),
              url: z.string().url().optional(),
              dataUrl: z.string().optional(),
              caption: z.string().optional(),
              fileName: z.string().optional(),
              mimetype: z.string().optional(),
              reply: z.boolean().optional().default(false),
            })
            .refine((value) => Boolean(value.url || value.dataUrl), {
              message: "Either url or dataUrl must be provided.",
            }),
          execute: async (input) => {
            const result = await send_chat_media(input, {
              jid: jid!,
              sock: sock!,
              msg: msg!,
            });
            recordSentText(input.caption);
            return result;
          },
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
        get_current_time: createTool({
          description: "Get the current date and time",
          inputSchema: z.object({}),
          execute: async () => new Date().toString(),
        }),
        // Admin-only tools: filesystem, shell, and the shared MEMORY.md.
        // Non-admins get none of them, so a prompt-injected message cannot
        // read secrets or execute commands on the bot host.
        ...(isPrivilegedUser
          ? {
              list_files: createTool({
                description: "List files in a directory",
                inputSchema: z.object({
                  path: z.string().optional().default("."),
                }),
                execute: async ({ path }) => list_files(path),
              }),
              read_file: createTool({
                description: "Read the content of a file",
                inputSchema: z.object({
                  path: z.string(),
                }),
                execute: async ({ path }) => read_file(path),
              }),
              write_file: createTool({
                description: "Write content to a file (overwrites if exists)",
                inputSchema: z.object({
                  path: z.string(),
                  content: z.string(),
                }),
                execute: async ({ path, content }) => write_file(path, content),
              }),
              delete_file: createTool({
                description: "Delete a file",
                inputSchema: z.object({
                  path: z.string(),
                }),
                execute: async ({ path }) => delete_file(path),
              }),
              update_memory: createTool({
                description: "Update persistent memory in MEMORY.md",
                inputSchema: z.object({
                  content: z.string(),
                  mode: z
                    .enum(["append", "overwrite"])
                    .optional()
                    .default("append"),
                }),
                execute: async ({ content, mode }) =>
                  update_memory(content, mode),
              }),
              read_memory: createTool({
                description: "Read the entire content of MEMORY.md",
                inputSchema: z.object({}),
                execute: async () => read_memory(),
              }),
              exec_command: createTool({
                description: "Execute a shell command in the bot's workspace",
                inputSchema: z.object({
                  command: z.string(),
                }),
                execute: async ({ command }) => exec_command(command),
              }),
              list_groups: createTool({
                description:
                  "List the WhatsApp groups this bot has joined (name, JID, member count, admin-only posting). Admin only. Use this before sending an announcement when the group name is unclear.",
                inputSchema: z.object({
                  refresh: z.boolean().optional().default(false),
                }),
                execute: async ({ refresh }) => {
                  if (!sock) return "Status: FAILED\nError: socket belum siap.";

                  try {
                    const groups = await fetchJoinedGroups(sock, {
                      forceRefresh: refresh,
                    });

                    if (groups.length === 0) {
                      return "Bot belum bergabung di grup mana pun.";
                    }

                    const lines = groups.map(
                      (group, index) =>
                        `${index + 1}. ${group.subject} · ${group.participants} anggota${
                          group.announce ? " · hanya admin" : ""
                        }\n   JID: ${group.jid}`,
                    );

                    return `Total ${groups.length} grup:\n\n${lines.join("\n")}`;
                  } catch (error) {
                    log.error("Failed to list joined groups:", error);
                    return `Status: FAILED\nError: gagal mengambil daftar grup (${
                      error instanceof Error ? error.message : String(error)
                    }).`;
                  }
                },
              }),
              send_group_message: createTool({
                description:
                  "Send a text message or announcement to one of the WhatsApp groups the bot has joined. Admin only. Call list_groups first if the group name is ambiguous. Set dryRun=true to preview the resolved group and message without sending.",
                inputSchema: z.object({
                  group: z
                    .string()
                    .min(1)
                    .describe(
                      "Group JID (e.g. 1203630...@g.us) or (part of) the group name",
                    ),
                  text: z.string().min(1).max(4000),
                  dryRun: z.boolean().optional().default(false),
                }),
                execute: async ({ group, text, dryRun }) => {
                  if (!sock) return "Status: FAILED\nError: socket belum siap.";

                  try {
                    const groups = await fetchJoinedGroups(sock);
                    const resolution = resolveGroup(groups, group);

                    if (resolution.status === "ambiguous") {
                      return `Status: FAILED\nError: nama grup "${group}" ambigu. Kandidat:\n${resolution.candidates
                        .map((item) => `- ${item.subject} (${item.jid})`)
                        .join("\n")}\nMinta admin memilih salah satu JID di atas.`;
                    }

                    if (resolution.status === "not_found") {
                      const suggestions =
                        resolution.suggestions.length > 0
                          ? `\nMungkin maksudnya:\n${resolution.suggestions
                              .map((item) => `- ${item.subject} (${item.jid})`)
                              .join("\n")}`
                          : "";
                      return `Status: FAILED\nError: grup "${group}" tidak ditemukan di daftar grup bot.${suggestions}`;
                    }

                    const target = resolution.group;
                    const formatted = formatResponseForWhatsApp(text);

                    if (dryRun) {
                      return `Status: PREVIEW (belum dikirim)\nGroup: ${target.subject}\nJID: ${target.jid}\nMessage:\n${formatted}`;
                    }

                    const messageId = await sendGroupText(
                      sock,
                      target.jid,
                      formatted,
                    );

                    log.info(
                      `AI sent a group message to ${target.jid} (${target.subject}) as ${user}`,
                    );

                    return `Status: SENT\nGroup: ${target.subject}\nJID: ${target.jid}\nMessage ID: ${messageId || "-"}`;
                  } catch (error) {
                    log.error("Failed to send group message:", error);
                    return `Status: FAILED\nError: ${
                      error instanceof Error ? error.message : String(error)
                    }`;
                  }
                },
              }),
            }
          : {}),
        web_fetch: createTool({
          description: "Fetch content from a URL",
          inputSchema: z.object({
            url: z.string().url(),
            options: z
              .object({
                method: z.string().optional(),
                headers: z.record(z.string(), z.string()).optional(),
                body: z.string().optional(),
                timeout: z.number().optional(),
                allowList: z.array(z.string()).optional(),
                blockList: z.array(z.string()).optional(),
              })
              .optional(),
          }),
          execute: async ({ url, options }) => web_fetch(url, options),
        }),
        ...(jid && sock && msg
          ? {
              execute_bot_command: createTool({
                description:
                  "Execute a bot command with given arguments. The result reports whether the command succeeded (Status) and includes the messages it already sent to the chat. Check Status before telling the user the action worked.",
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

      const agent = createAskAgent(
        route,
        finalSystemPrompt,
        aiTools,
        stopWhenSteps,
        isResearchIntent,
      );

      const toolEmojis: Record<string, string> = {
        update_profile_trait: "👤",
        delegate_task: "👥",
        web_search: "🌐",
        web_extract: "📥",
        send_message: "📤",
        reply_message: "💬",
        send_media: "🖼️",
        get_bot_commands: "🤖",
        get_command_help: "❓",
        list_files: "📂",
        read_file: "📄",
        write_file: "📝",
        delete_file: "🗑️",
        update_memory: "🧠",
        read_memory: "📖",
        exec_command: "💻",
        list_groups: "👥",
        send_group_message: "📢",
        web_fetch: "🌐",
        execute_bot_command: "⚙️",
      };

      const result = await agent.generate({
        messages,
        onStepFinish: async ({ toolCalls, text }) => {
          log.debug(
            `AI step finished using provider=${route.provider}, model=${route.modelId}`,
          );

          const calledTools = (toolCalls || [])
            .map((call) => call?.toolName)
            .filter((name): name is string => Boolean(name));

          if (
            calledTools.includes("reply_message") ||
            calledTools.includes("send_message") ||
            calledTools.includes("send_media")
          ) {
            responseToolUsed = true;
          }

          if (calledTools.length > 0) {
            log.info(`Tool calls detected: ${calledTools.join(", ")}`);

            if (jid && sock) {
              const toolDescriptions = (toolCalls || []).map((call) => {
                const name = call?.toolName || "unknown";
                const emoji = toolEmojis[name] || "🛠️";
                const readableName = name
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase());
                return `${emoji} *${readableName}*`;
              });

              const statusText = `🛠️ *AI sedang bekerja:*\n\n${toolDescriptions.join("\n")}`;

              if (!statusMsgKey) {
                const sent = await sock.sendMessage(jid, { text: statusText });
                statusMsgKey = sent?.key || undefined;
              } else {
                await sock.sendMessage(jid, {
                  text: statusText,
                  edit: statusMsgKey,
                });
              }

              if (text?.trim()) {
                if (msg) {
                  await reply_chat_message(text.trim(), { jid, sock, msg });
                } else {
                  await sock.sendMessage(jid, { text: text.trim() });
                }
                recordSentText(text);
              }
            }
          }
        },
      });

      if (!responseToolUsed) {
        const fallbackResponse = result.text?.trim();

        if (fallbackResponse && jid && sock && msg) {
          await reply_chat_message(fallbackResponse, {
            jid,
            sock,
            msg,
          });
          recordSentText(fallbackResponse);
        }
      }

      return {
        text: result.text?.trim() ?? "",
        sentTexts,
      };
    } catch (error) {
      console.error("Error fetching AI completion:", error);

      try {
        const userFacing =
          "Maaf, terjadi kesalahan saat menghubungi penyedia AI. Silakan coba lagi nanti.";

        if (jid && sock && msg) {
          await reply_chat_message(userFacing, { jid, sock, msg });
        } else if (jid && sock) {
          await sock.sendMessage(jid, { text: userFacing });
        }
        recordSentText(userFacing);
      } catch (sendErr) {
        log.error("Failed to notify user about AI provider error:", sendErr);
      }

      return { text: "", sentTexts };
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

  private buildKnownUserContextInstruction(
    userPushName: string | null | undefined,
    personality: AIPersonality,
  ): string | undefined {
    if (!userPushName?.trim()) {
      return undefined;
    }

    const match = this.findKnownUserMatch(userPushName, personality);
    if (match) {
      return (
        `Known-user verification (runtime): user display name "${userPushName}" matches known user "${match.canonicalName}" via alias "${match.matchedAlias}". ` +
        `Treat this user as Known User for nickname and familiarity rules.`
      );
    }

    return (
      `Known-user verification (runtime): user display name "${userPushName}" does not match the KNOWN USERS alias list for the active personality. ` +
      `Treat this user as unknown user unless user provides additional proof/context.`
    );
  }

  private buildRuntimeUserContextInstruction(input: {
    userId: string;
    displayName?: string | null;
    jid?: string;
    isGroupChat: boolean;
    activePersonality: AIPersonality;
    providerPreference: AIProviderPreference | null;
    userRoles: string[];
  }): string {
    const lines = ["Runtime user context:"];

    lines.push(`- User ID: ${input.userId}`);
    lines.push(`- Chat type: ${input.isGroupChat ? "group" : "private"}`);

    if (input.jid) {
      lines.push(`- Chat JID: ${input.jid}`);
    }

    if (input.displayName?.trim()) {
      lines.push(`- Display name: ${input.displayName.trim()}`);
    }

    lines.push(`- Active personality: ${input.activePersonality}`);
    lines.push(
      `- AI provider preference: ${input.providerPreference || "default bot"}`,
    );

    if (input.userRoles.length > 0) {
      lines.push(`- User roles: ${input.userRoles.join(", ")}`);
    }

    lines.push(
      "Use these details to adjust tone, depth, and follow-up behavior. Do not mention them unless directly relevant.",
    );

    return lines.join("\n");
  }

  private findKnownUserMatch(
    userPushName: string,
    personality: AIPersonality,
  ): { canonicalName: string; matchedAlias: string } | null {
    const normalizedName = this.normalizeIdentity(userPushName);
    if (!normalizedName) {
      return null;
    }

    const nameTokens = new Set(
      normalizedName
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean),
    );

    const knownUsers = getKnownUsersForPersonality(personality);
    for (const knownUser of knownUsers) {
      for (const alias of knownUser.aliases) {
        const normalizedAlias = this.normalizeIdentity(alias);
        if (!normalizedAlias) {
          continue;
        }

        if (
          normalizedName === normalizedAlias ||
          nameTokens.has(normalizedAlias)
        ) {
          return {
            canonicalName: knownUser.canonicalName,
            matchedAlias: alias,
          };
        }
      }
    }

    return null;
  }

  private normalizeIdentity(value: string): string {
    return value
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
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
      } catch {
        textRouteText = "tidak tersedia (API key provider belum diatur)";
      }

      let imageRouteText = "tidak tersedia (API key DeepSeek/Gemini belum diatur)";
      try {
        const imageRoute = this.providerRouter.getRoutedModel({
          preferredProvider: effectivePreference,
          requiresMultimodal: true,
        });
        if (imageRoute.supportsMultimodal) {
          imageRouteText = `${imageRoute.provider} (${imageRoute.modelId})`;
        }
      } catch {
        imageRouteText =
          "tidak tersedia (API key DeepSeek/Gemini belum diatur)";
      }

      await sock.sendMessage(jid, {
        text:
          `*AI Provider Anda*\n\n` +
          `• Preferensi pribadi: ${userPreference || "default bot"}\n` +
          `• Default bot: ${BotConfig.aiProvider}\n` +
          `• Rute teks aktif: ${textRouteText}\n` +
          `• Rute gambar aktif: ${imageRouteText}\n\n` +
          `Gunakan ${BotConfig.prefix}ai provider <groq|google|openrouter|deepseek|auto|default> untuk mengubah preferensi.`,
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
        requested !== "openrouter" &&
        requested !== "deepseek" &&
        requested !== "auto"
      ) {
        await sock.sendMessage(jid, {
          text:
            `❌ Provider tidak valid: ${requested}\n` +
            `Gunakan: ${BotConfig.prefix}ai provider <groq|google|openrouter|deepseek|auto|default>`,
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
          `Untuk input gambar, dipakai model vision (DeepSeek/Gemini) bila API key-nya tersedia.` +
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
        const endedSession = await this.conversationService.endSession(user);

        await sock.sendMessage(jid, {
          text:
            `✅ Personality AI Anda direset ke default (nexa).` +
            (endedSession
              ? `\nSesi percakapan AI lama juga sudah diakhiri supaya persona baru mulai bersih.`
              : ""),
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
      const endedSession = await this.conversationService.endSession(user);

      await sock.sendMessage(jid, {
        text:
          `✅ Personality AI Anda diset ke *${requested}*.` +
          (endedSession
            ? `\nSesi percakapan AI lama sudah direset agar persona baru tidak mewarisi gaya jawaban sebelumnya.`
            : ""),
      });
    } catch (error) {
      log.error("Failed to update user AI personality preference:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi kesalahan saat menyimpan preferensi personality AI.",
      });
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
          logger: log as unknown as Logger,
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

  private detectResearchIntent(text: string): boolean {
    if (!text) return false;

    const normalizedText = text.toLowerCase();

    // 1. Core Keywords (Indonesian & English)
    const researchKeywords = [
      // Indonesian
      "research",
      "teliti",
      "investigasi",
      "analisis",
      "mendalam",
      "cari tahu",
      "seluk beluk",
      "ulas tuntas",
      "bedah materi",
      "pelajari lebih lanjut",
      "cek fakta",
      "berita terbaru",
      "perkembangan terkini",
      "sejarah",
      "asal usul",
      "latar belakang",
      "studi kasus",
      "ekstrak",
      "sintesis",
      "rangkuman mendalam",

      // English
      "deep dive",
      "comprehensive",
      "investigate",
      "thorough",
      "detailed explanation",
      "fact check",
      "latest news",
      "recent developments",
      "scientific",
      "academic",
      "background",
      "origin",
      "history of",
      "extract",
      "scrap",
      "scrape",
    ];

    const hasKeyword = researchKeywords.some((keyword) =>
      normalizedText.includes(keyword),
    );

    if (hasKeyword) return true;

    // 2. Structural Clues (How/Why questions that imply depth)
    const structuralPatterns = [
      /^bagaimana cara kerja/i,
      /^jelaskan secara detail/i,
      /^apa perbedaan antara/i,
      /^explain the difference between/i,
      /^how does .* work/i,
      /^what is the history of/i,
      /^ekstrak konten/i,
      /^extract content/i,
      /^scrape/i,
      /^web scraping/i,
    ];

    const hasPattern = structuralPatterns.some((pattern) =>
      pattern.test(normalizedText),
    );

    if (hasPattern) return true;

    // 3. Length heuristic (Very long questions often imply complex research needs)
    if (text.length > 250) return true;

    return false;
  }
}
