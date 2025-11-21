import {MongoClient} from 'mongodb';
import {CommandUsageService} from '../../domain/services/CommandUsageService.js';
import {
    AuthenticationState,
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeWASocket,
} from 'baileys';
import {CommandHandler} from '../handlers/CommandHandler.js';
import {SessionService} from '../../domain/services/SessionService.js';
import {BotConfig, getCurrentConfig, log} from '../../infrastructure/config/config.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {Boom} from '@hapi/boom';
import {useMongoDBAuthState} from '../../infrastructure/config/auth.js';
import MAIN_LOGGER from 'baileys/lib/Utils/logger.js';
import {closeMongoClient, getMongoClient} from '../../infrastructure/config/mongo.js';
import NodeCache from 'node-cache';
import {setCommandHandler} from '../../shared/utils/ai_tools.js';

// Import the broadcast function
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let broadcastQRUpdate: ((type: 'new_qr' | 'connected' | 'disconnected', data?: any) => void) | null = null;

// Dynamically import to avoid circular dependency
import('../../api.js')
    .then((module) => {
        broadcastQRUpdate = module.broadcastQRUpdate;
    })
    .catch(() => {
        // API module not available, continue without broadcasting
    });

const logger = MAIN_LOGGER.child({});
logger.level = 'silent';

// Maximum number of reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 5;
// Delay between reconnection attempts (in ms)
const RECONNECT_INTERVAL = 3000;

export class BotClient {
    public currentQR: string | null = null; // Store current QR code
    private sock: WebSocketInfo | null = null;
    private commandHandler: CommandHandler;
    private readonly sessionService: SessionService;
    private botId: string | null = null;
    private reconnectAttempts: number = 0;
    private authState: {
        state: AuthenticationState;
        saveCreds: () => Promise<void>;
        removeCreds: () => Promise<void>;
        close: () => Promise<void>;
    } | null = null;
    private usageService: CommandUsageService | null = null;
    private mongoClient: MongoClient | null = null;
    private groupCache = new NodeCache({stdTTL: 5 * 60, useClones: false});

    constructor() {
        this.sessionService = new SessionService();
        this.commandHandler = new CommandHandler(this.sessionService);

        // Set the command handler instance for AI tools
        setCommandHandler(this.commandHandler);

        // Wait for command handler initialization
        this.commandHandler
            .waitForInitialization()
            .then(() => {
                log.info('CommandHandler initialized successfully');
            })
            .catch((error) => {
                log.error('Failed to initialize CommandHandler:', error);
            });
    }

    async start() {
        try {
            // Close previous auth if exists
            // if (this.authState) {
            //   await this.authState
            //     .close()
            //     .catch((err) => log.error("Error closing previous auth state:", err));
            // }

            // Connect to MongoDB and initialize auth state
            log.info('Initializing WhatsApp connection...');

            if (this.sock) {
                this.sock.end(new Error('Restarting connection'));
                this.sock = null;
            }

            try {
                // Use shared MongoClient for usage stats and auth
                this.mongoClient = await getMongoClient();
                this.usageService = new CommandUsageService(this.mongoClient);
                this.authState = await useMongoDBAuthState(
                    // process.env.MONGO_URI!,
                    process.env.NODE_ENV !== 'production' ? `${BotConfig.sessionName}_dev` : undefined,
                    process.env.NODE_ENV !== 'production' ? 'auth_dev_' : undefined
                );

                const {version} = await fetchLatestBaileysVersion();

                const {state} = this.authState;

                // Create a new socket connection
                this.sock = makeWASocket({
                    auth: state,
                    // printQRInTerminal: true,
                    logger,
                    version,
                    syncFullHistory: false,
                    connectTimeoutMs: 60000, // Allow more time for initial connection
                    keepAliveIntervalMs: 10000, // More frequent keep-alive pings
                    retryRequestDelayMs: 2000, // Retry delay for failed requests
                    browser: Browsers.macOS('Desktop'),
                    markOnlineOnConnect: true,
                    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
                    patchMessageBeforeSending: (message, _jids) => {
                        // The function should only return the modified message, not an array
                        // We'll just keep the original message unchanged
                        return message;
                    },
                    // getMessage: async (key) => {
                    //   if (this.store) {
                    //     const msg = await this.store.loadMessage(key.remoteJid!, key.id!);
                    //     return msg?.message || undefined;
                    //   }

                    //   // Only if store is present
                    //   return proto.Message.fromObject({});
                    // },
                    cachedGroupMetadata: async (jid) => this.groupCache.get(jid),
                });

                this.botId = this.sock.authState.creds.me?.id.split(':')[0] || null;
                this.commandHandler = new CommandHandler(this.sessionService, this.usageService);

                // this.store.bind(this.sock.ev);
            } catch (error) {
                log.error('Failed to initialize WhatsApp session:', error);
                // Wait before trying to reconnect
                setTimeout(() => this.start(), RECONNECT_INTERVAL);
                return;
            }

            // Handle connection updates
            this.sock.ev.on('connection.update', async (update) => {
                const {connection, lastDisconnect, qr} = update;

                // Display QR code refresh info if a new QR is generated
                if (qr) {
                    log.info('New QR code generated, please scan with WhatsApp app');
                    // Store the QR code for API access
                    this.currentQR = qr;
                    // Reset reconnect attempts when a new QR is shown
                    this.reconnectAttempts = 0;

                    // Broadcast QR update to SSE clients
                    if (broadcastQRUpdate) {
                        broadcastQRUpdate('new_qr', {hasQR: true});
                    }
                }

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    log.warn(
                        'Connection closed due to ',
                        lastDisconnect?.error?.message,
                        ', reconnection status: ',
                        shouldReconnect ? 'will reconnect' : 'permanent disconnect'
                    );

                    if (shouldReconnect) {
                        // Implement progressive reconnect with exponential backoff
                        this.reconnectAttempts++;

                        if (this.reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                            const delay = Math.min(
                                RECONNECT_INTERVAL * Math.pow(1.5, this.reconnectAttempts - 1),
                                60000 // Maximum 1 minute delay
                            );

                            log.info(
                                `Reconnecting (attempt ${
                                    this.reconnectAttempts
                                }/${MAX_RECONNECT_ATTEMPTS}) in ${Math.round(delay / 1000)}s...`
                            );

                            this.cleanupSocket();

                            setTimeout(() => this.start(), delay);
                        } else {
                            log.error(
                                `Exceeded maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}). Logging out and resetting state.`
                            );
                            this.resetAndLogout();
                        }
                    } else {
                        this.resetAndLogout();
                    }
                } else if (connection === 'open') {
                    // Reset reconnect attempts on successful connection
                    this.reconnectAttempts = 0;
                    // Clear QR code when connected
                    this.currentQR = null;

                    // Broadcast connection success to SSE clients
                    if (broadcastQRUpdate) {
                        broadcastQRUpdate('connected', {hasQR: false, connected: true});
                    }

                    log.info(`Connected to WhatsApp as ${this.botId} with session name ${BotConfig.sessionName}`);
                    log.info(`Bot Name: ${BotConfig.name}`);
                    log.info(`Prefix: ${BotConfig.prefix}`);

                    // Initialize VIP cleanup scheduler
                    const {
                        scheduleVIPCleanup,
                        scheduleReminderCheck
                    } = await import('../../infrastructure/config/scheduler.js');
                    scheduleVIPCleanup();
                    log.info('VIP cleanup scheduler initialized');

                    // Initialize reminder checker
                    scheduleReminderCheck(this.sock!);
                    log.info('Reminder checker initialized');
                }
            });

            this.sock.ev.on('creds.update', this.authState.saveCreds);

            this.sock.ev.on('messages.upsert', async ({messages, type}) => {
                try {
                    if (type != 'notify') return;
                    for (const m of messages) {
                        if (!m.message) continue;

                        const baseText = m.message.conversation
                            || m.message.extendedTextMessage?.text
                            || m.message.imageMessage?.caption
                            || m.message.videoMessage?.caption
                            || m.message.documentMessage?.caption
                            || '';
                        const baseJid = m.key.remoteJid!;
                        const baseUser = m.key.participant || baseJid;

                        // Passive PDF session ingestion: if user has active pdf session and sends image without command prefix
                        const session = await this.sessionService.getSession(baseJid, baseUser);
                        if (session && session.game === 'pdf' && m.message.imageMessage) {
                            const cfg = await getCurrentConfig().catch(() => BotConfig);
                            const startsWithPrefix = [cfg.prefix, ...cfg.alternativePrefixes].some((p) => baseText.startsWith(p));
                            if (!startsWithPrefix) {
                                try {
                                    const {PdfCommand} = await import('../commands/PdfCommand.js');
                                    const pdfCmd = new PdfCommand();
                                    await pdfCmd.handleAddImage(this.sessionService, m as any, baseUser, baseJid, this.sock!, cfg);
                                    continue; // Skip normal command handling for this message
                                } catch (err) {
                                    log.error('Passive PDF image ingestion failed:', err);
                                }
                            }
                        }

                        // Get current config for allowFromMe check
                        const config = await getCurrentConfig().catch(() => BotConfig);
                        if (m.key.fromMe && !config.allowFromMe) continue;

                        if (config.allowMentionPrefix && this.botId && baseText.includes(`@${this.botId}`)) {
                            const commandText = this.extractCommandFromMention(baseText, this.botId);
                            if (commandText) {
                                await this.commandHandler.handleCommand(config.prefix + commandText, baseJid, baseUser, this.sock!, m);
                            }
                            continue;
                        }

                        if (await this.commandHandler.isCommand(baseText)) {
                            await this.commandHandler.handleCommand(baseText, baseJid, baseUser, this.sock!, m);
                        }
                    }
                } catch (error) {
                    log.error('Error handling message: ', error);
                }
            });

            this.sock.ev.on('groups.update', async ([event]) => {
                if (this.sock && event.id) {
                    const metadata = await this.sock.groupMetadata(event.id);
                    this.groupCache.set(event.id, metadata);
                }
            });

            this.sock.ev.on('group-participants.update', async (event) => {
                if (this.sock && event.id) {
                    const metadata = await this.sock.groupMetadata(event.id);
                    this.groupCache.set(event.id, metadata);
                }
            });
        } catch (error) {
            log.error('Error in start method:', error);
            // Try to restart after a delay if not already at max attempts
            if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                this.reconnectAttempts++;
                const delay = Math.min(RECONNECT_INTERVAL * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
                log.info(
                    `Restarting after error (attempt ${
                        this.reconnectAttempts
                    }/${MAX_RECONNECT_ATTEMPTS}) in ${Math.round(delay / 1000)}s...`
                );
                setTimeout(() => this.start(), delay);
            } else {
                log.error('Too many restart attempts, giving up.');
                await closeMongoClient();
            }
        }
    }

    private extractCommandFromMention(text: string, botId: string): string | null {
        const mentionPattern = new RegExp(`@${botId}\\s+(.+)`, 'i');
        const match = text.match(mentionPattern);
        return match ? match[1].trim() : null;
    }

    private cleanupSocket() {
        if (this.sock) {
            try {
                this.sock.end(new Error('Connection cleanup'));
            } catch (error) {
                log.warn('Error during socket cleanup:', error);
            }
            this.sock = null;
        }
    }

    private async resetAndLogout() {
        if (!this.authState) return;

        try {
            const {removeCreds, close} = this.authState;

            // End WebSocket connection if it exists
            this.cleanupSocket();

            // Clean up credentials
            await Promise.all([
                removeCreds().catch((err) => log.error('Failed to remove credentials:', err)),
                close().catch((err) => log.error('Failed to close MongoDB connection:', err)),
            ]);

            log.info('Logged out and reset connection state');

            // Reset connection state
            this.authState = null;
            this.reconnectAttempts = 0;

            // Optional: exit the process or restart with fresh state
            // process.exit(0);

            // Alternatively, restart with fresh state after a delay
            setTimeout(() => this.start(), 5000);
        } catch (error) {
            log.error('Error during logout:', error);
            await closeMongoClient();
            process.exit(1); // Force exit on critical error
        }
    }
}
