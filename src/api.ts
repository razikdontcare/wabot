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

import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {basicAuth} from 'hono/basic-auth';
import {getMongoClient} from './infrastructure/config/mongo.js';
import {CommandUsageService} from './domain/services/CommandUsageService.js';
import {GameLeaderboardService} from './domain/services/GameLeaderboardService.js';
import {BotClient} from './app/client/BotClient.js';
import {getBotConfigService} from './infrastructure/config/config.js';
import QRCode from 'qrcode';

const app = new Hono();

// Basic Auth Configuration
const API_USERNAME = process.env.API_USERNAME || 'admin';
const API_PASSWORD = process.env.API_PASSWORD || 'admin123';

// Apply basic auth middleware to all API routes
app.use('/api/*', basicAuth({
    username: API_USERNAME,
    password: API_PASSWORD,
}));

// Store SSE connections for QR code updates
interface SSEConnection {
    controller: ReadableStreamDefaultController;
    encoder: TextEncoder;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: (data: any) => void;
}

const qrConnections = new Set<SSEConnection>();

// REST API: Get all command usage stats
app.get('/api/command-usage', async (c) => {
    try {
        const client = await getMongoClient();
        const usageService = new CommandUsageService(client);
        const stats = await usageService.getAllStats();
        return c.json(stats);
    } catch (_err) {
        return c.json({error: 'Failed to fetch command usage stats'}, 500);
    }
});

// REST API: Get leaderboard for a game (e.g. /api/leaderboard?game=hangman)
app.get('/api/leaderboard', async (c) => {
    const game = c.req.query('game');
    if (!game) return c.json({error: "Missing 'game' query param"}, 400);
    try {
        const client = await getMongoClient();
        const leaderboardService = new GameLeaderboardService(client);
        const leaderboard = await leaderboardService.getLeaderboard(game, 10);
        return c.json(leaderboard);
    } catch (_err) {
        return c.json({error: 'Failed to fetch leaderboard'}, 500);
    }
});

function getBotClient(): BotClient | null {
    // @ts-expect-error - globalThis.__botClient is dynamically set
    return typeof globalThis.__botClient === 'object'
        ? // @ts-expect-error - globalThis.__botClient is dynamically set
        globalThis.__botClient
        : null;
}

// REST API: Send a WhatsApp message
app.post('/api/send-message', async (c) => {
    const {text, jid} = await c.req.json();
    if (!jid || !text) {
        return c.json({error: "Missing 'jid' or 'text' in request body"}, 400);
    }
    try {
        const botClient = getBotClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!botClient || !(botClient as any)['sock'] || !(botClient as any)['sock']) {
            return c.json({error: 'Bot is not ready or not connected'}, 503);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sock = (botClient as any)['sock'];
        await sock.sendMessage(jid, {text});
        return c.json({success: true});
    } catch (_err) {
        return c.json({error: 'Failed to send message', details: String(_err)}, 500);
    }
});

// REST API: Get bot configuration
app.get('/api/config', async (c) => {
    try {
        const configService = await getBotConfigService();
        const config = await configService.getMergedConfig();

        // Remove sensitive data from response
        const safeConfig = {
            ...config,
            groqApiKey: config.groqApiKey ? '***' : undefined,
        };

        return c.json(safeConfig);
    } catch (_err) {
        return c.json({error: 'Failed to fetch bot configuration'}, 500);
    }
});

// REST API: Update bot configuration
app.post('/api/config', async (c) => {
    try {
        const updates = await c.req.json();
        const configService = await getBotConfigService();

        // Remove sensitive fields that shouldn't be updated via API
        delete updates.groqApiKey;
        delete updates.sessionName;

        const success = await configService.updateConfig(updates, 'api');

        if (success) {
            return c.json({message: 'Configuration updated successfully'});
        } else {
            return c.json({error: 'Failed to update configuration'}, 500);
        }
    } catch (_err) {
        return c.json({error: 'Failed to update bot configuration'}, 500);
    }
});

// REST API: Reset bot configuration
app.post('/api/config/reset', async (c) => {
    try {
        const configService = await getBotConfigService();
        const success = await configService.resetToDefaults('api');

        if (success) {
            return c.json({
                message: 'Configuration reset to defaults successfully',
            });
        } else {
            return c.json({error: 'Failed to reset configuration'}, 500);
        }
    } catch (_err) {
        return c.json({error: 'Failed to reset bot configuration'}, 500);
    }
});

// REST API: Manage user roles
app.post('/api/config/roles/:action', async (c) => {
    try {
        const action = c.req.param('action'); // add or remove
        const {userJid, role} = await c.req.json();

        if (!userJid || !role) {
            return c.json({error: 'Missing userJid or role in request body'}, 400);
        }

        if (!['admin', 'moderator', 'vip'].includes(role)) {
            return c.json({error: 'Invalid role. Must be admin, moderator, or vip'}, 400);
        }

        const configService = await getBotConfigService();
        let success = false;

        if (action === 'add') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            success = await configService.addUserToRole(userJid, role as any, 'api');
        } else if (action === 'remove') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            success = await configService.removeUserFromRole(userJid, role as any, 'api');
        } else {
            return c.json({error: "Invalid action. Must be 'add' or 'remove'"}, 400);
        }

        if (success) {
            return c.json({
                message: `User ${action === 'add' ? 'added to' : 'removed from'} ${role} role successfully`,
            });
        } else {
            return c.json(
                {
                    error: `Failed to ${action} user ${action === 'add' ? 'to' : 'from'} ${role} role`,
                },
                500
            );
        }
    } catch (_err) {
        return c.json({error: 'Failed to manage user role'}, 500);
    }
});

// REST API: Get current QR code as image for WhatsApp authentication
app.get('/api/qr', async (c) => {
    try {
        const botClient = getBotClient();
        if (!botClient) {
            return c.json({error: 'Bot client not available'}, 503);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qr = (botClient as any).currentQR;
        if (!qr) {
            return c.json(
                {
                    error: 'No QR code available',
                    message: 'Bot may already be connected or QR code expired',
                },
                404
            );
        }

        // Generate QR code as PNG buffer
        const qrBuffer = await QRCode.toBuffer(qr, {
            type: 'png',
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF',
            },
        });

        // Return image response
        c.header('Content-Type', 'image/png');
        c.header('Cache-Control', 'no-cache');
        return c.body(qrBuffer);
    } catch (_err) {
        return c.json({error: 'Failed to generate QR code', details: String(_err)}, 500);
    }
});

// REST API: Get current QR code as JSON (alternative endpoint)
app.get('/api/qr/json', async (c) => {
    try {
        const botClient = getBotClient();
        if (!botClient) {
            return c.json({error: 'Bot client not available'}, 503);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qr = (botClient as any).currentQR;
        if (!qr) {
            return c.json(
                {
                    error: 'No QR code available',
                    message: 'Bot may already be connected or QR code expired',
                },
                404
            );
        }

        return c.json({qr, timestamp: Date.now()});
    } catch (_err) {
        return c.json({error: 'Failed to get QR code', details: String(_err)}, 500);
    }
});

// REST API: Server-Sent Events for QR code updates
app.get('/api/qr/stream', async (_c) => {
    const stream = new ReadableStream({
        start(controller) {
            // Send initial connection message
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

            // Store connection for QR updates
            const connection: SSEConnection = {
                controller,
                encoder,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                send: (data: any) => {
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                    } catch (_err) {
                        // Connection closed, remove from set
                        qrConnections.delete(connection);
                    }
                },
            };

            qrConnections.add(connection);

            // Send current QR status
            const botClient = getBotClient();
            if (botClient) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const qr = (botClient as any).currentQR;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const sock = (botClient as any)['sock'];
                const connected = !!(sock && sock.user);

                connection.send({
                    type: 'status',
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
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control',
        },
    });
});

// Function to broadcast QR updates to all SSE connections
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function broadcastQRUpdate(type: 'new_qr' | 'connected' | 'disconnected', data?: any) {
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
app.get('/api/status', async (c) => {
    try {
        const botClient = getBotClient();
        if (!botClient) {
            return c.json({status: 'unavailable', connected: false});
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sock = (botClient as any)['sock'];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasQR = !!(botClient as any).currentQR;
        const connected = !!(sock && sock.user);

        return c.json({
            status: connected ? 'connected' : hasQR ? 'qr_ready' : 'disconnected',
            connected,
            hasQR,
            user: connected ? sock.user : null,
        });
    } catch (_err) {
        return c.json({status: 'error', connected: false}, 500);
    }
});

serve({
    fetch: app.fetch,
    port: process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT, 10) : 5000,
});

console.log('API running on port ' + (process.env.DASHBOARD_PORT || 5000));
