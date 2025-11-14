import { makeWASocket } from 'baileys';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Session<T = any> {
  game: string;
  data: T;
  timestamp: number;
}

export type WebSocketInfo = ReturnType<typeof makeWASocket>;
