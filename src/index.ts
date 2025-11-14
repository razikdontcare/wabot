import { config } from 'dotenv';
import { BotClient } from './app/client/BotClient.js';
// Import API after bot client is available
import './api.js';

config();

const bot = new BotClient();

// Store bot client globally before importing API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__botClient = bot;

bot.start().catch(console.error);
