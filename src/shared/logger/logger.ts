import chalk from "chalk";
import { format } from "util";

export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LogMethod = (message: any, ...args: any[]) => void;

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
}

interface LoggerOptions {
  level?: LogLevel;
  displayTimestamp?: boolean;
  displayLevel?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

const DEFAULT_BUFFER_SIZE = 1000;
const MAX_ALLOWED_BUFFER_SIZE = 10000;

const configuredBufferSize = Number.parseInt(
  process.env.LOG_BUFFER_SIZE || "",
  10,
);
const LOG_BUFFER_SIZE =
  Number.isFinite(configuredBufferSize) && configuredBufferSize > 0
    ? Math.min(configuredBufferSize, MAX_ALLOWED_BUFFER_SIZE)
    : DEFAULT_BUFFER_SIZE;

let logCounter = 0;
const logBuffer: LogEntry[] = [];
const logSubscribers = new Set<(entry: LogEntry) => void>();

const REDACTION_PATTERNS: RegExp[] = [
  /(bearer\s+)[a-z0-9._-]+/gi,
  /((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)([^\s,;]+)/gi,
  /((?:api[_-]?key|token|secret|password|authorization)\s+[a-z0-9._-]+\s*)([^\s,;]+)/gi,
];

function redactSensitiveText(raw: string): string {
  return REDACTION_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, "$1***"),
    raw,
  );
}

function storeLog(level: LogLevel, message: string): void {
  const entry: LogEntry = {
    id: ++logCounter,
    timestamp: new Date().toISOString(),
    level,
    message: redactSensitiveText(message),
  };

  logBuffer.push(entry);

  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_SIZE);
  }

  logSubscribers.forEach((listener) => {
    try {
      listener(entry);
    } catch {
      // Ignore subscriber exceptions to keep logging path safe
    }
  });
}

export function isLogLevel(value: string): value is LogLevel {
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, value);
}

export function getRecentLogs(
  options: { limit?: number; level?: LogLevel } = {},
): LogEntry[] {
  const requestedLimit = Math.floor(options.limit ?? 200);
  const safeLimit = Math.max(1, Math.min(requestedLimit, LOG_BUFFER_SIZE));

  const filtered = options.level
    ? logBuffer.filter((entry) => entry.level === options.level)
    : logBuffer;

  if (filtered.length <= safeLimit) {
    return [...filtered];
  }

  return filtered.slice(filtered.length - safeLimit);
}

export function subscribeToLogs(
  listener: (entry: LogEntry) => void,
): () => void {
  logSubscribers.add(listener);

  return () => {
    logSubscribers.delete(listener);
  };
}

export function clearRecentLogs(): void {
  logBuffer.length = 0;
}

export class Logger {
  protected readonly level: LogLevel;
  protected readonly displayTimestamp: boolean;
  protected readonly displayLevel: boolean;

  private readonly colors = {
    error: chalk.red.bold,
    warn: chalk.yellow,
    info: chalk.blue,
    debug: chalk.magenta,
    verbose: chalk.cyan,
    timestamp: chalk.gray,
  };

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || "info";
    this.displayTimestamp = options.displayTimestamp ?? true;
    this.displayLevel = options.displayLevel ?? true;
  }

  public error: LogMethod = (message, ...args) =>
    this.log("error", message, ...args);

  public warn: LogMethod = (message, ...args) =>
    this.log("warn", message, ...args);

  public info: LogMethod = (message, ...args) =>
    this.log("info", message, ...args);

  public debug: LogMethod = (message, ...args) =>
    this.log("debug", message, ...args);

  public verbose: LogMethod = (message, ...args) =>
    this.log("verbose", message, ...args);

  public json(data: unknown, title?: string): void {
    if (!this.shouldLog("debug")) return;

    if (title) {
      this.debug(chalk.underline(title));
    }

    this.debug(JSON.stringify(data, null, 2));
  }

  public createChild(prefix: string): Logger {
    return new PrefixedLogger(prefix, {
      level: this.level,
      displayTimestamp: this.displayTimestamp,
      displayLevel: this.displayLevel,
    });
  }

  protected shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
  }

  protected formatTimestamp(): string {
    return this.colors.timestamp(new Date().toISOString());
  }

  protected formatLevel(level: LogLevel): string {
    return this.colors[level](`[${level.toUpperCase()}]`.padEnd(7));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected log(level: LogLevel, message: any, ...args: any[]): void {
    if (!this.shouldLog(level)) return;

    const parts: string[] = [];

    if (this.displayTimestamp) {
      parts.push(this.formatTimestamp());
    }

    if (this.displayLevel) {
      parts.push(this.formatLevel(level));
    }

    const formattedMessage = format(message, ...args);
    storeLog(level, formattedMessage);
    parts.push(formattedMessage);

    const output = parts.join(" ");

    // Send errors to stderr, others to stdout
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(output + "\n");
  }
}

class PrefixedLogger extends Logger {
  constructor(
    private readonly prefix: string,
    options: LoggerOptions,
  ) {
    super(options);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public override log(level: LogLevel, message: any, ...args: any[]): void {
    if (!this.shouldLog(level)) return;

    const parts: string[] = [];

    if (this.displayTimestamp) {
      parts.push(this.formatTimestamp());
    }

    parts.push(this.formatPrefix());

    if (this.displayLevel) {
      parts.push(this.formatLevel(level));
    }

    const formattedMessage = format(message, ...args);
    storeLog(level, `[${this.prefix}] ${formattedMessage}`);
    parts.push(formattedMessage);

    const output = parts.join(" ");

    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(output + "\n");
  }

  private formatPrefix(): string {
    return chalk.green(`[${this.prefix}]`);
  }
}
