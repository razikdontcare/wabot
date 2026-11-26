import { expect, it, spyOn } from "bun:test";
import type { WAMessage } from "baileys";
import type { WebSocketInfo } from "../src/shared/types/types.js";
import {
  requestStickerAudio,
  takeStickerAudioDraft,
} from "../src/app/handlers/stickerAudioReplies.js";

const chat = "123@g.us";
const user = "456@s.whatsapp.net";
const promptId = "audio-request";
const settings = {
  useCrop: true,
  packName: "Pack",
  authorName: "Author",
  errorEmoji: "❌",
};

function makeSocket() {
  const sent: string[] = [];
  const socket = {
    sendMessage: async (_jid: string, content: { text: string }) => {
      sent.push(content.text);
      return { key: { id: promptId, remoteJid: chat, fromMe: true } };
    },
  } as unknown as WebSocketInfo;
  return { socket, sent };
}

function replyWithAudio(stanzaId: string): WAMessage {
  return {
    key: { remoteJid: chat, participant: user, id: "audio" },
    message: { audioMessage: { ptt: true, contextInfo: { stanzaId } } },
  };
}

it("pairs a quoted image only with the original user's reply to the bot prompt", async () => {
  const { socket, sent } = makeSocket();
  const image = { mimetype: "image/jpeg", directPath: "/image" };
  const command: WAMessage = {
    key: { remoteJid: chat, participant: user, id: "command" },
    message: {
      extendedTextMessage: {
        contextInfo: {
          stanzaId: "original-image",
          participant: user,
          quotedMessage: { imageMessage: image },
        },
      },
    },
  };

  expect(await requestStickerAudio(socket, chat, user, command, settings)).toBe(
    true,
  );
  expect(sent[0]).toContain("voice note");
  expect(
    takeStickerAudioDraft(
      chat,
      "other@s.whatsapp.net",
      replyWithAudio(promptId),
    ),
  ).toBeUndefined();
  expect(
    takeStickerAudioDraft("other@g.us", user, replyWithAudio(promptId)),
  ).toBeUndefined();
  expect(
    takeStickerAudioDraft(chat, user, replyWithAudio("wrong-prompt")),
  ).toBeUndefined();

  const draft = takeStickerAudioDraft(chat, user, replyWithAudio(promptId));
  expect(draft?.visual.key.id).toBe("original-image");
  expect(draft?.visual.message?.imageMessage).toEqual(image);
  expect(draft?.useCrop).toBe(true);
  expect(
    takeStickerAudioDraft(chat, user, replyWithAudio(promptId)),
  ).toBeUndefined();
});

it("keeps an existing animated WebP as the visual and accepts an audio document", async () => {
  const { socket } = makeSocket();
  const stickerMessage = { mimetype: "image/webp", isAnimated: true };
  const command: WAMessage = {
    key: { remoteJid: chat, participant: user, id: "command" },
    message: {
      extendedTextMessage: {
        contextInfo: {
          stanzaId: "original-sticker",
          quotedMessage: { stickerMessage },
        },
      },
    },
  };

  expect(await requestStickerAudio(socket, chat, user, command, settings)).toBe(
    true,
  );
  const draft = takeStickerAudioDraft(chat, user, {
    key: { remoteJid: chat, participant: user, id: "audio-file" },
    message: {
      documentMessage: {
        mimetype: "audio/mpeg",
        contextInfo: { stanzaId: promptId },
      },
    },
  });
  expect(draft?.visual.message?.stickerMessage).toEqual(stickerMessage);
  expect(draft?.useCrop).toBe(false);
});

it("leaves a captioned video on the existing video-to-sound-sticker path", async () => {
  const { socket, sent } = makeSocket();
  expect(
    await requestStickerAudio(
      socket,
      chat,
      user,
      {
        key: { remoteJid: chat, participant: user, id: "video" },
        message: { videoMessage: { caption: "!sticker --audio" } },
      },
      settings,
    ),
  ).toBe(false);
  expect(sent).toEqual([]);
});

it("expires a draft even when the requested audio replies to the correct prompt", async () => {
  const { socket } = makeSocket();
  const now = Date.now();
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    expect(
      await requestStickerAudio(
        socket,
        chat,
        user,
        {
          key: { remoteJid: chat, participant: user, id: "image" },
          message: { imageMessage: { caption: "!sticker --audio" } },
        },
        settings,
      ),
    ).toBe(true);
    clock.mockReturnValue(now + 120_001);

    expect(
      takeStickerAudioDraft(chat, user, replyWithAudio(promptId)),
    ).toBeUndefined();
  } finally {
    clock.mockRestore();
  }
});
