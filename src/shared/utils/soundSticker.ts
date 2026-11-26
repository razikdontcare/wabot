import {
  generateWAMessage,
  prepareWAMessageMedia,
  proto,
} from "baileys";
import { log } from "../../infrastructure/config/config.js";
import type { WebSocketInfo } from "../types/types.js";

type SoundStickerMessage = proto.IMessage & { soundStickerAudio?: string };

const SOUND_STICKER_FIELD = 134;
const WRAPPED_MESSAGE_FIELD = 1;
const STICKER_FIELD = 26;
const STICKER_FLAG_FIELD = 24;
const STICKER_AUDIO_FIELD = 26;

let encoderInstalled = false;

export function installSoundStickerEncoder(): void {
  if (encoderInstalled) return;
  const originalEncode = proto.Message.encode;

  proto.Message.encode = (message: SoundStickerMessage, writer) => {
    const { stickerMessage, soundStickerAudio } = message;
    if (!stickerMessage || !soundStickerAudio) return originalEncode(message, writer);

    // Baileys routes the original object as sticker media. Only the wire
    // representation puts the sticker inside the sound-sticker envelope.
    const output = originalEncode({ ...message, stickerMessage: undefined }, writer);
    const sticker = output
      .uint32((SOUND_STICKER_FIELD << 3) | 2).fork()
      .uint32((WRAPPED_MESSAGE_FIELD << 3) | 2).fork()
      .uint32((STICKER_FIELD << 3) | 2).fork();

    return proto.Message.StickerMessage.encode(stickerMessage, sticker)
      .uint32(STICKER_FLAG_FIELD << 3).uint32(0)
      .uint32((STICKER_AUDIO_FIELD << 3) | 2).bytes(soundStickerAudio)
      .ldelim().ldelim().ldelim();
  };
  encoderInstalled = true;
}

export async function sendSoundSticker(
  sock: WebSocketInfo,
  jid: string,
  sticker: Buffer,
  audio: Buffer,
): Promise<void> {
  const userJid = sock.authState.creds.me?.id;
  if (!userJid) throw new Error("WhatsApp socket is not authenticated");

  installSoundStickerEncoder();
  const { audioMessage } = await prepareWAMessageMedia(
    { audio, mimetype: "audio/ogg; codecs=opus", ptt: false },
    { upload: sock.waUploadToServer },
  );
  const outgoing = await generateWAMessage(
    jid,
    { sticker, isAnimated: true },
    { userJid, upload: sock.waUploadToServer },
  );
  if (!audioMessage || !outgoing.message?.stickerMessage || !outgoing.key.id) {
    throw new Error("Failed to prepare sound sticker media");
  }

  const message: SoundStickerMessage = outgoing.message;
  message.soundStickerAudio = Buffer.from(
    proto.Message.AudioMessage.encode(audioMessage).finish(),
  ).toString("base64");

  await sock.relayMessage(jid, message, { messageId: outgoing.key.id });
  await sock.upsertMessage(outgoing, "append").catch((error) => {
    log.warn("Failed to store sent sound sticker:", error);
  });
}
