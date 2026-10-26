import { describe, expect, it } from "bun:test";
import {
  classifyCommandOutcome,
  createCommandCapture,
  type CapturedCommandMessage,
} from "../src/shared/utils/commandCapture.js";
import type { WebSocketInfo } from "../src/shared/types/types.js";

interface SentCall {
  jid: string;
  content: Record<string, unknown>;
  options?: unknown;
}

function createFakeSocket() {
  const calls: SentCall[] = [];

  const socket = {
    user: { id: "bot@s.whatsapp.net" },
    sendMessage: async (jid: string, content: Record<string, unknown>, options?: unknown) => {
      calls.push({ jid, content, options });
      return { key: { id: `msg-${calls.length}`, remoteJid: jid, fromMe: true } };
    },
    updateMediaMessage: async () => undefined,
  };

  return { socket: socket as unknown as WebSocketInfo, calls };
}

describe("createCommandCapture", () => {
  it("records a text message and still delivers it", async () => {
    const { socket, calls } = createFakeSocket();
    const capture = createCommandCapture(socket);

    const result = await capture.socket.sendMessage("jid@s.whatsapp.net", {
      text: "Halo dari command",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].content).toEqual({ text: "Halo dari command" });
    expect(result?.key?.id).toBe("msg-1");
    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0].kind).toBe("text");
    expect(capture.messages[0].text).toBe("Halo dari command");
  });

  it("records media with its caption", async () => {
    const { socket } = createFakeSocket();
    const capture = createCommandCapture(socket);

    await capture.socket.sendMessage("jid@s.whatsapp.net", {
      sticker: Buffer.from([1, 2, 3]),
    });
    await capture.socket.sendMessage("jid@s.whatsapp.net", {
      image: Buffer.from([4, 5, 6]),
      caption: "hasil gambar",
    });

    expect(capture.messages).toHaveLength(2);
    expect(capture.messages[0].kind).toBe("sticker");
    expect(capture.messages[1].kind).toBe("image");
    expect(capture.messages[1].caption).toBe("hasil gambar");
  });

  it("merges an edit into the captured message instead of duplicating it", async () => {
    const { socket } = createFakeSocket();
    const capture = createCommandCapture(socket);

    await capture.socket.sendMessage("jid@s.whatsapp.net", {
      text: "sedang diproses",
    });
    const editKey = {
      id: "msg-1",
      remoteJid: "jid@s.whatsapp.net",
      fromMe: true,
    };
    await capture.socket.sendMessage("jid@s.whatsapp.net", {
      text: "selesai",
      edit: editKey,
    });

    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0].text).toBe("selesai");
  });

  it("keeps the rest of the socket working when a method is detached", async () => {
    const { socket } = createFakeSocket();
    const capture = createCommandCapture(socket);

    const reupload = capture.socket.updateMediaMessage;
    const value = await reupload({} as never);

    expect(value).toBeUndefined();
  });
});

describe("classifyCommandOutcome", () => {
  const messages = (
    ...items: CapturedCommandMessage[]
  ): CapturedCommandMessage[] => items;

  it("treats an ❌ error reply as a failure", () => {
    const outcome = classifyCommandOutcome(
      messages({
        kind: "text",
        text: "❌ Waduh, file-nya terlalu gede nih!",
      }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain("terlalu gede");
  });

  it("treats media-only output as success", () => {
    const outcome = classifyCommandOutcome(
      messages({ kind: "sticker" }),
    );

    expect(outcome.success).toBe(true);
  });

  it("treats an empty output as success", () => {
    expect(classifyCommandOutcome([]).success).toBe(true);
  });

  it("ignores ❌ that is not at the start of the message", () => {
    const outcome = classifyCommandOutcome(
      messages({ kind: "text", text: "Berhasil ❌ tidak ada error" }),
    );

    expect(outcome.success).toBe(true);
  });
});
