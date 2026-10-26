import type { WebSocketInfo } from "../types/types.js";

export type CapturedMessageKind =
  | "text"
  | "sticker"
  | "image"
  | "video"
  | "audio"
  | "document";

export interface CapturedCommandMessage {
  kind: CapturedMessageKind;
  /** Plain text payload for `text` messages. */
  text?: string;
  /** Caption for media messages. */
  caption?: string;
  /** WhatsApp message id, used to merge edits of the same bubble. */
  messageId?: string;
}

export interface CapturedCommandSocket {
  /**
   * Socket proxy that forwards every call to the real socket while recording
   * the user-visible messages a command sends.
   */
  socket: WebSocketInfo;
  messages: CapturedCommandMessage[];
}

export interface CommandOutcome {
  success: boolean;
  error?: string;
}

// Bot commands report handled failures by prefixing the chat message with an
// error emoji. They usually catch their own errors, so an exception alone is
// not enough to detect failure.
const FAILURE_PREFIXES = ["❌", "⛔", "🚫"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function describeMessageContent(
  content: unknown,
): Omit<CapturedCommandMessage, "messageId"> | null {
  const record = asRecord(content);
  if (!record) return null;

  const text = typeof record.text === "string" ? record.text : undefined;
  const caption =
    typeof record.caption === "string" ? record.caption : undefined;

  if (text && text.trim()) {
    return { kind: "text", text };
  }

  if (record.sticker) return { kind: "sticker", caption };
  if (record.image) return { kind: "image", caption };
  if (record.video) return { kind: "video", caption };
  if (record.audio) return { kind: "audio", caption };
  if (record.document) return { kind: "document", caption };

  return null;
}

function editedMessageId(content: unknown): string | undefined {
  const edit = asRecord(asRecord(content)?.edit);
  return typeof edit?.id === "string" ? edit.id : undefined;
}

/**
 * Wraps a socket so every message a bot command sends to the chat is recorded,
 * while still being delivered normally. This lets the AI see what a command
 * actually did (and whether it reported an error) instead of assuming success.
 */
export function createCommandCapture(
  sock: WebSocketInfo,
): CapturedCommandSocket {
  const messages: CapturedCommandMessage[] = [];
  const sendMessage = sock.sendMessage.bind(sock);

  const capturedSocket = new Proxy(sock, {
    get(target, property) {
      if (property === "sendMessage") {
        return async (
          ...args: Parameters<WebSocketInfo["sendMessage"]>
        ): Promise<
          Awaited<ReturnType<WebSocketInfo["sendMessage"]>>
        > => {
          const content = args[1];
          const result = await sendMessage(...args);
          const described = describeMessageContent(content);

          if (described) {
            const messageId =
              editedMessageId(content) ?? result?.key?.id ?? undefined;
            const existing = messageId
              ? messages.find((message) => message.messageId === messageId)
              : undefined;

            if (existing) {
              existing.kind = described.kind;
              existing.text = described.text ?? existing.text;
              existing.caption = described.caption ?? existing.caption;
            } else {
              messages.push({ ...described, messageId });
            }
          }

          return result;
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as WebSocketInfo;

  return { socket: capturedSocket, messages };
}

/**
 * Derives a command's outcome from the messages it sent. Commands that hit a
 * handled error reply with an ❌-prefixed message; anything else is a success.
 */
export function classifyCommandOutcome(
  messages: readonly CapturedCommandMessage[],
): CommandOutcome {
  for (const message of messages) {
    if (message.kind !== "text" || !message.text) continue;

    const trimmed = message.text.trim();
    if (FAILURE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
      return { success: false, error: trimmed };
    }
  }

  return { success: true };
}
