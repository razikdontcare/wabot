import { createHash } from "node:crypto";
import { areJidsSameUser, downloadMediaMessage, type WAMessage } from "baileys";
import NodeCache from "node-cache";
import type { Logger } from "pino";
import { log } from "../../infrastructure/config/config.js";
import type { WebSocketInfo } from "../../shared/types/types.js";
import {
  MAX_SOUND_STICKER_BYTES,
  sendSoundSticker,
} from "../../shared/utils/soundSticker.js";
import { resolveSourceModule } from "../../shared/utils/sourcePaths.js";
import { getEffectiveUserIds } from "../../shared/utils/userRoles.js";
import { WorkerPool } from "../../shared/utils/WorkerPool.js";

const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const drafts = new NodeCache({
  stdTTL: 120,
  checkperiod: 30,
  useClones: false,
});

interface StickerAudioOptions {
  useCrop: boolean;
  packName: string;
  authorName: string;
  errorEmoji: string;
}

interface StickerAudioDraft extends StickerAudioOptions {
  jid: string;
  userIds: string[];
  visual: WAMessage;
}

export async function requestStickerAudio(
  sock: WebSocketInfo,
  jid: string,
  user: string,
  command: WAMessage,
  options: StickerAudioOptions,
): Promise<boolean> {
  const content = command.message?.ephemeralMessage?.message ?? command.message;
  if (content?.videoMessage) return false;

  const reply = content?.extendedTextMessage?.contextInfo;
  const quoted = reply?.quotedMessage;
  const imageMessage = content?.imageMessage ?? quoted?.imageMessage;
  const stickerMessage = quoted?.stickerMessage;
  if (!imageMessage && !stickerMessage && !quoted?.lottieStickerMessage)
    return false;
  if (
    !imageMessage &&
    (quoted?.lottieStickerMessage ||
      stickerMessage?.isLottie ||
      (stickerMessage?.mimetype && stickerMessage.mimetype !== "image/webp"))
  ) {
    await sock.sendMessage(jid, {
      text: `${options.errorEmoji} Pilih gambar atau sticker WebP untuk ditambahkan audio.`,
    });
    return true;
  }

  const visual: WAMessage = {
    key: content?.imageMessage
      ? command.key
      : {
          remoteJid: jid,
          id: reply?.stanzaId,
          participant: reply?.participant,
          fromMe: Boolean(
            reply?.participant &&
              (areJidsSameUser(reply.participant, sock.user?.id) ||
                areJidsSameUser(reply.participant, sock.user?.lid)),
          ),
        },
    message: imageMessage ? { imageMessage } : { stickerMessage },
  };

  const prompt = await sock.sendMessage(jid, {
    text: "Balas pesan ini dengan voice note atau file audio dalam 2 menit. Bot akan mengambil maksimal 10 detik pertama.",
  });
  if (!prompt?.key.id) throw new Error("Missing sticker audio prompt ID");

  drafts.set<StickerAudioDraft>(prompt.key.id, {
    ...options,
    useCrop: Boolean(imageMessage && options.useCrop),
    jid,
    userIds: getEffectiveUserIds(user, command),
    visual,
  });
  return true;
}

export function takeStickerAudioDraft(
  jid: string,
  user: string,
  message: WAMessage,
): StickerAudioDraft | undefined {
  const incoming =
    message.message?.ephemeralMessage?.message ?? message.message;
  const content = incoming?.documentWithCaptionMessage?.message ?? incoming;
  const document = content?.documentMessage;
  const audio =
    content?.audioMessage ??
    (document?.mimetype?.toLowerCase().startsWith("audio/")
      ? document
      : undefined);
  const promptId = audio?.contextInfo?.stanzaId;
  if (!promptId) return;

  const draft = drafts.get<StickerAudioDraft>(promptId);
  if (
    draft?.jid !== jid ||
    !getEffectiveUserIds(user, message).some((id) => draft.userIds.includes(id))
  ) {
    return;
  }
  // Claim before awaiting any media work so duplicate events cannot send twice.
  drafts.del(promptId);
  return draft;
}

class StickerInputTooLargeError extends Error {}

async function downloadDraftMedia(
  sock: WebSocketInfo,
  message: WAMessage,
): Promise<Buffer> {
  const stream = await downloadMediaMessage(
    message,
    "stream",
    {},
    {
      logger: log as unknown as Logger,
      reuploadRequest: sock.updateMediaMessage,
    },
  );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) throw new StickerInputTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function handleStickerAudioReply(
  sock: WebSocketInfo,
  jid: string,
  user: string,
  message: WAMessage,
): Promise<boolean> {
  const draft = takeStickerAudioDraft(jid, user, message);
  if (!draft) return false;

  try {
    const audioInput = await downloadDraftMedia(sock, message);
    const pool = WorkerPool.getInstance();
    const processor = resolveSourceModule(
      "shared",
      "utils",
      "stickerProcessor.ts",
    );
    const audio = await pool.run<Uint8Array | null>(
      processor,
      "extractStickerAudio",
      [audioInput],
    );
    if (!audio?.length) {
      await sock.sendMessage(jid, {
        text: `${draft.errorEmoji} File itu tidak berisi audio yang bisa dipakai. Buat draft sticker baru dan coba audio lain.`,
      });
      return true;
    }

    const visualInput = await downloadDraftMedia(sock, draft.visual);
    const existingSticker = Boolean(draft.visual.message?.stickerMessage);
    const webp = existingSticker
      ? visualInput
      : await pool.run<Uint8Array>(processor, "createSticker", [
          visualInput,
          draft.useCrop,
        ]);
    const hash = createHash("sha256").update(audio).digest("base64");
    const sticker = await pool.run<Uint8Array>(processor, "addExif", [
      webp,
      draft.packName,
      draft.authorName,
      hash,
      existingSticker,
    ]);
    if (sticker.length > MAX_SOUND_STICKER_BYTES) {
      await sock.sendMessage(jid, {
        text: `${draft.errorEmoji} Sticker bersuaranya terlalu besar. Coba lagi dengan gambar atau sticker yang lebih kecil.`,
      });
      return true;
    }

    await sendSoundSticker(sock, jid, Buffer.from(sticker), Buffer.from(audio));
  } catch (error) {
    if (error instanceof StickerInputTooLargeError) {
      await sock.sendMessage(jid, {
        text: `${draft.errorEmoji} Ukuran tiap file maksimal 16 MB. Buat draft sticker baru dan coba file yang lebih kecil.`,
      });
    } else {
      log.error("Error creating sound sticker from an audio reply:", error);
      await sock.sendMessage(jid, {
        text: `${draft.errorEmoji} Gagal membuat sticker bersuara. Buat draft sticker baru dan coba lagi.`,
      });
    }
  }
  return true;
}
