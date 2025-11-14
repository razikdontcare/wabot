import {proto} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {getMongoClient} from '../../infrastructure/config/mongo.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {GameLeaderboardService} from '../../domain/services/GameLeaderboardService.js';
import {SessionService} from '../../domain/services/SessionService.js';

export class LeaderboardCommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'leaderboard',
        description: 'Show the top players for a game (e.g., hangman, rps)',
        helpText: `*Usage:*\n!leaderboard <game>\n*Example:*\n!leaderboard hangman`,
        category: 'general',
        commandClass: LeaderboardCommand,
    };

    async handleCommand(
        args: string[],
        jid: string,
        user: string,
        sock: WebSocketInfo,
        _sessionService: SessionService,
        _msg: proto.IWebMessageInfo
    ): Promise<void> {
        const game = args[0]?.toLowerCase();
        if (!game) {
            await sock.sendMessage(jid, {
                text: 'Please specify a game. Example: !leaderboard hangman',
            });
            return;
        }
        const client = await getMongoClient();
        const leaderboardService = new GameLeaderboardService(client);
        const leaderboard = await leaderboardService.getLeaderboard(game, 10);

        if (!leaderboard.length) {
            await sock.sendMessage(jid, {
                text: `No leaderboard data for *${game}*.`,
            });
            return;
        }

        const userJids = leaderboard.map((entry) => entry.user);
        const text =
            `🏆 *Leaderboard for ${game}*:\n` +
            leaderboard
                .map((entry, i) => `${i + 1}. @${entry.user.split('@')[0]} — ${entry.score ?? entry.wins ?? 0} pts`)
                .join('\n');
        await sock.sendMessage(jid, {text, mentions: userJids});
    }
}
