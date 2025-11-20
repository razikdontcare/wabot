import {proto} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {SessionService} from '../../domain/services/SessionService.js';
import {BotConfig, log} from '../../infrastructure/config/config.js';
import {AIConversationService} from '../../domain/services/AIConversationService.js';
import {AIResponseService} from '../../domain/services/AIResponseService.js';
import Groq from 'groq-sdk';
import {
    execute_bot_command,
    get_bot_commands,
    get_command_help,
    tools,
    web_search,
} from '../../shared/utils/ai_tools.js';
import {loadNexaPrompt} from '../../shared/utils/promptLoader.js';

export class AskAICommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'ai',
        aliases: ['ask'],
        description: 'Tanyakan sesuatu kepada AI dengan dukungan percakapan multi-turn.',
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
        category: 'general',
        commandClass: AskAICommand,
        cooldown: 5000,
        maxUses: 10,
        vipBypassCooldown: true, // VIP users bypass cooldown
    };

    private ai = new Groq({apiKey: BotConfig.groqApiKey});
    private conversationService = AIConversationService.getInstance();
    private responseService = AIResponseService.getInstance();
    private MODEL = 'moonshotai/kimi-k2-instruct-0905';

    async handleCommand(
        args: string[],
        jid: string,
        user: string,
        sock: WebSocketInfo,
        sessionService: SessionService,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        // Handle subcommands
        if (args.length > 0) {
            const subcommand = args[0].toLowerCase();

            switch (subcommand) {
                case 'help':
                    await sock.sendMessage(jid, {
                        text: AskAICommand.commandInfo.helpText || 'Bantuan tidak tersedia.',
                    });
                    return;

                case 'status':
                    await this.handleStatusCommand(user, jid, sock, msg);
                    return;

                case 'end':
                    await this.handleEndCommand(user, jid, sock, msg);
                    return;
            }
        }

        // Get the prompt from args or quoted message
        let quotedText = '';
        let prompt = args.join(' ').trim();
        const userPushName = msg.pushName;

        if (msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage && args.length === 0) {
            const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
            if (quoted?.conversation) quotedText = quoted.conversation;
            else if (quoted?.extendedTextMessage?.text) quotedText = quoted.extendedTextMessage.text;
            else if (quoted?.imageMessage?.caption) quotedText = quoted.imageMessage.caption;

            if (quotedText) {
                prompt = 'The user is replied to message:\n"' + quotedText.trim() + '"\n\nThe user\'s question:\n' + prompt;
            }
        }

        if (!prompt) {
            await sock.sendMessage(
                jid,
                {
                    text: 'Silakan berikan pertanyaan yang ingin diajukan kepada AI.\n\nGunakan `!ai help` untuk melihat semua opsi yang tersedia.',
                },
            );
            return;
        }

        try {
            // Check if this is a group chat
            const isGroupChat = jid.endsWith('@g.us');

            // Add user message to conversation history
            await this.conversationService.addMessage(user, 'user', prompt);

            // Get conversation history for context
            const history = await this.conversationService.getConversationHistory(user);

            // Get group context if this is a group chat
            let groupContext = '';
            if (isGroupChat) {
                const groupResponses = await this.responseService.getGroupResponses(jid, 10);
                if (groupResponses.length > 0) {
                    groupContext = this.buildGroupContext(groupResponses);
                }
            }

            // Get AI response with conversation context and group context
            const response = await this.getGroqCompletion(history, user, userPushName, groupContext, jid, sock, msg);

            // Add AI response to conversation history
            await this.conversationService.addMessage(user, 'assistant', response);

            // Save response to group context if this is a group chat
            if (isGroupChat) {
                await this.responseService.saveResponse(jid, user, userPushName || undefined, prompt, response);
            }

            // Send response
            await sock.sendMessage(
                jid,
                {
                    text: response,
                },
            );
        } catch (error) {
            console.error('Error in AI conversation:', error);
            await sock.sendMessage(
                jid,
                {
                    text: 'Terjadi kesalahan saat berkomunikasi dengan AI. Silakan coba lagi.',
                },
            );
        }
    }

    async getGroqCompletion(
        conversationHistory: import('../../domain/services/AIConversationService.js').AIMessage[],
        user: string,
        userPushName: string | null | undefined,
        groupContext?: string,
        jid?: string,
        sock?: WebSocketInfo,
        msg?: proto.IWebMessageInfo
    ): Promise<string> {
        try {
            // Load the base prompt from markdown file
            const base_prompt = loadNexaPrompt({
                groupContext,
                currentDate: new Date().toString(),
            });
            // Build messages array for Groq API
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const messages: any[] = [
                {
                    role: 'system',
                    content: base_prompt,
                },
            ];

            if (userPushName) {
                messages.push({
                    role: 'user',
                    content: `You are currently chatting with : ${userPushName}`,
                });
            }

            // Add conversation history
            for (const message of conversationHistory) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const messageObj: any = {
                    role: message.role,
                    content: message.content,
                };

                // Add tool_call_id for tool messages
                if (message.role === 'tool' && message.tool_call_id) {
                    messageObj.tool_call_id = message.tool_call_id;
                }

                messages.push(messageObj);
            }

            const response = await this.ai.chat.completions.create({
                messages,
                model: this.MODEL,
                temperature: 0.4,
                max_completion_tokens: 1024,
                top_p: 0.95,
                stream: false,
                stop: null,
                tools,
                tool_choice: 'auto',
                seed: 28112004,
            });

            const responseMessage = response.choices[0].message;
            const toolCalls = responseMessage.tool_calls;

            if (toolCalls && toolCalls.length > 0) {
                log.info(`Tool calls detected: ${toolCalls.map((call) => call.function.name).join(', ')}`);
                const availableFunctions = {
                    web_search: web_search,
                    get_bot_commands: get_bot_commands,
                    get_command_help: get_command_help,
                    execute_bot_command:
                        jid && sock && msg
                            ? (commandName: string, args: string[]) =>
                                execute_bot_command(commandName, args, {
                                    jid,
                                    user,
                                    sock,
                                    msg,
                                })
                            : undefined,
                };

                // Add the assistant message with tool calls (not content)
                messages.push({
                    role: 'assistant',
                    content: responseMessage.content,
                    tool_calls: toolCalls,
                });

                // Add assistant message to conversation history if it has content
                if (responseMessage.content) {
                    await this.conversationService.addMessage(user, 'assistant', responseMessage.content);
                }

                for (const toolCall of toolCalls) {
                    try {
                        const functionName = toolCall.function.name;
                        const functionToCall = availableFunctions[functionName as keyof typeof availableFunctions];

                        if (!functionToCall) {
                            throw new Error(`Function ${functionName} not found`);
                        }

                        // Validate and parse tool arguments
                        let functionArgs;
                        try {
                            functionArgs = JSON.parse(toolCall.function.arguments);
                        } catch (parseError) {
                            throw new Error(`Invalid JSON in tool arguments: ${parseError}`);
                        }

                        // Execute function based on its type
                        let functionResponse: string;

                        if (functionName === 'web_search') {
                            if (!functionArgs.query) {
                                throw new Error('Missing required parameter: query');
                            }
                            functionResponse = await (functionToCall as typeof web_search)(functionArgs.query);
                        } else if (functionName === 'get_bot_commands') {
                            functionResponse = await (functionToCall as typeof get_bot_commands)(functionArgs.query);
                        } else if (functionName === 'get_command_help') {
                            if (!functionArgs.commandName) {
                                throw new Error('Missing required parameter: commandName');
                            }
                            functionResponse = await (functionToCall as typeof get_command_help)(functionArgs.commandName);
                        } else if (functionName === 'execute_bot_command') {
                            if (!functionArgs.commandName || !functionArgs.args) {
                                throw new Error('Missing required parameters: commandName and args');
                            }
                            if (!functionToCall) {
                                throw new Error('Command execution not available in this context');
                            }
                            functionResponse = await (functionToCall as (cmd: string, args: string[]) => Promise<string>)(
                                functionArgs.commandName,
                                functionArgs.args
                            );
                        } else {
                            throw new Error(`Unknown function: ${functionName}`);
                        }

                        messages.push({
                            role: 'tool',
                            content: functionResponse,
                            tool_call_id: toolCall.id,
                        });

                        await this.conversationService.addMessage(user, 'tool', functionResponse, toolCall.id);
                    } catch (toolError) {
                        console.error(`Error executing tool ${toolCall.function.name}:`, toolError);

                        // Add error message to tool response
                        const errorMessage = `Error executing ${toolCall.function.name}: ${
                            toolError instanceof Error ? toolError.message : 'Unknown error'
                        }`;

                        messages.push({
                            role: 'tool',
                            content: errorMessage,
                            tool_call_id: toolCall.id,
                        });

                        await this.conversationService.addMessage(user, 'tool', errorMessage, toolCall.id);
                    }
                }

                const secondResponse = await this.ai.chat.completions.create({
                    messages,
                    model: this.MODEL,
                    temperature: 0.4,
                    max_completion_tokens: 1024,
                    top_p: 0.95,
                    stream: false,
                    stop: null,
                    seed: 28112004,
                });

                return secondResponse.choices[0].message.content || 'Tidak ada jawaban yang diberikan oleh AI.';
            }

            if (responseMessage.content) {
                return responseMessage.content;
            }

            return 'Tidak ada jawaban yang diberikan oleh AI.';
        } catch (error) {
            console.error('Error fetching Groq completion:', error);
            return 'Terjadi kesalahan saat menghubungi AI.';
        }
    }

    private async handleStatusCommand(
        user: string,
        jid: string,
        sock: WebSocketInfo,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        const sessionInfo = this.conversationService.getSessionInfo(user);

        if (!sessionInfo.hasSession) {
            await sock.sendMessage(
                jid,
                {
                    text: 'Anda tidak memiliki sesi percakapan aktif.\n\nMulai percakapan dengan mengirim pertanyaan ke AI menggunakan `!ai <pertanyaan>`.',
                },
            );
            return;
        }

        const timeRemainingMinutes = Math.ceil(sessionInfo.timeRemaining / (60 * 1000));
        const statusText =
            `*Status Sesi Percakapan AI*\n\n` +
            `📊 Total pesan: ${sessionInfo.messageCount}\n` +
            `⏱️ Waktu tersisa: ${timeRemainingMinutes} menit\n` +
            `🔄 Sesi akan diperpanjang otomatis setiap kali Anda mengirim pesan\n\n` +
            `_Ketik \`!ai end\` untuk mengakhiri sesi_`;

        await sock.sendMessage(jid, {text: statusText});
    }

    private async handleEndCommand(
        user: string,
        jid: string,
        sock: WebSocketInfo,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        const hadSession = await this.conversationService.endSession(user);

        if (hadSession) {
            await sock.sendMessage(
                jid,
                {
                    text: '✅ Sesi percakapan AI Anda telah diakhiri.\n\nTerima kasih telah menggunakan layanan AI! Anda dapat memulai percakapan baru kapan saja.',
                },
            );
        } else {
            await sock.sendMessage(
                jid,
                {
                    text: 'Anda tidak memiliki sesi percakapan aktif yang dapat diakhiri.',
                },
            );
        }
    }

    private buildGroupContext(
        groupResponses: import('../../domain/services/AIResponseService.js').AIGroupResponse[]
    ): string {
        if (groupResponses.length === 0) return '';

        const contextLines = groupResponses.map((response) => {
            const userName = response.userPushName || 'Unknown User';
            const timeAgo = this.formatTimeAgo(response.timestamp);
            return `[${timeAgo}] ${userName} asked: "${response.userQuestion}"\nNexa responded: "${response.aiResponse}"\n`;
        });

        return `\n\n### Previous AI Responses in This Group:\n${contextLines.join(
            '\n'
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
        return 'just now';
    }
}
