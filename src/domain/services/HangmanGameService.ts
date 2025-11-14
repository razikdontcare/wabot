import { getRandomKBBI } from '../../shared/utils/randomKBBI.js';
import { randomBytes } from 'crypto';
import { GameLeaderboardService } from './GameLeaderboardService.js';
import { getMongoClient } from '../../infrastructure/config/mongo.js';

export const MAX_ATTEMPTS = 6;
export const MASK_CHAR = '#';

export interface HangmanSession {
  gameId: string;
  word: string;
  hint: string;
  guessedLetters: string[];
  attemptsLeft: number;
  maskedWord: string;
  players: string[];
  playerScores: Record<string, number>;
  hostUser: string;
}

export class HangmanGameService {
  private static activeGames: Map<string, HangmanSession> = new Map();

  static generateGameId(): string {
    return randomBytes(3).toString('hex');
  }

  static async createGame(hostUser: string): Promise<HangmanSession> {
    let gameId = this.generateGameId();
    while (this.activeGames.has(gameId)) {
      gameId = this.generateGameId();
    }

    const { lemma: word, definition } = await getRandomKBBI();
    const newSession: HangmanSession = {
      gameId,
      word,
      hint: definition,
      guessedLetters: [],
      attemptsLeft: MAX_ATTEMPTS,
      maskedWord: MASK_CHAR.repeat(word.length),
      players: [hostUser],
      playerScores: { [hostUser]: 0 },
      hostUser,
    };

    this.activeGames.set(gameId, newSession);
    return newSession;
  }

  static getGame(gameId: string): HangmanSession | undefined {
    return this.activeGames.get(gameId);
  }

  static updateGame(gameId: string, session: HangmanSession): void {
    this.activeGames.set(gameId, session);
  }

  static deleteGame(gameId: string): boolean {
    return this.activeGames.delete(gameId);
  }

  static async processGuess(
    gameId: string,
    letter: string,
    user: string
  ): Promise<{
    correct: boolean;
    gameOver: boolean;
    winner?: string;
    finalWord?: string;
    scoreUpdate?: number;
  }> {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    if (!game.players.includes(user)) throw new Error('User not in game');

    if (game.guessedLetters.includes(letter)) throw new Error('Letter already guessed');

    game.guessedLetters.push(letter);

    let correct = false;
    let scoreUpdate = 0;

    if (game.word.includes(letter)) {
      correct = true;
      let newMasked = '';
      for (let i = 0; i < game.word.length; i++) {
        const char = game.word[i];
        if (char === letter && !game.maskedWord[i].includes(MASK_CHAR)) {
          // Already revealed
        } else if (char === letter) {
          scoreUpdate++;
        }
        newMasked += game.guessedLetters.includes(char) ? char : MASK_CHAR;
      }
      game.playerScores[user] = (game.playerScores[user] || 0) + scoreUpdate;
      game.maskedWord = newMasked;

      if (!newMasked.includes(MASK_CHAR)) {
        // Game won
        await this.updateLeaderboard(game);
        this.deleteGame(gameId);
        const winner = Object.entries(game.playerScores).sort((a, b) => b[1] - a[1])[0][0];
        return { correct: true, gameOver: true, winner, finalWord: game.word, scoreUpdate };
      }
    } else {
      game.attemptsLeft--;
      if (game.attemptsLeft <= 0) {
        // Game lost
        await this.updateLeaderboard(game);
        this.deleteGame(gameId);
        return { correct: false, gameOver: true, finalWord: game.word };
      }
    }

    this.updateGame(gameId, game);
    return { correct, gameOver: false, scoreUpdate };
  }

  static joinGame(gameId: string, user: string): void {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    if (game.players.includes(user)) return;

    game.players.push(user);
    game.playerScores[user] = 0;
    this.updateGame(gameId, game);
  }

  static leaveGame(gameId: string, user: string): void {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    game.players = game.players.filter((p) => p !== user);
    delete game.playerScores[user];

    if (game.players.length === 0) {
      this.deleteGame(gameId);
    } else if (game.hostUser === user) {
      game.hostUser = game.players[0];
      this.updateGame(gameId, game);
    } else {
      this.updateGame(gameId, game);
    }
  }

  static stopGame(gameId: string, user: string): void {
    const game = this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    if (game.hostUser !== user) throw new Error('Only host can stop game');

    this.deleteGame(gameId);
  }

  private static async updateLeaderboard(game: HangmanSession): Promise<void> {
    const mongoClient = await getMongoClient();
    const leaderboardService = new GameLeaderboardService(mongoClient);

    for (const player of game.players) {
      const currentStat = await leaderboardService.getUserStat(player, 'hangman');
      await leaderboardService.updateUserStat(player, 'hangman', {
        score: (currentStat?.score || 0) + (game.playerScores[player] || 0),
        wins: (currentStat?.wins || 0) + (game.maskedWord.includes(MASK_CHAR) ? 0 : 1),
        losses: (currentStat?.losses || 0) + (game.maskedWord.includes(MASK_CHAR) ? 1 : 0),
      });
    }
  }
}
