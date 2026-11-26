import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "bun:test";
import { proto } from "baileys";
import { BSON } from "mongodb";
import webpmux from "node-webpmux";
import protobuf from "protobufjs/minimal.js";
import type { WebSocketInfo } from "../src/shared/types/types.js";
import { installSoundStickerEncoder, sendSoundSticker } from "../src/shared/utils/soundSticker.js";
import { addExif, createAnimatedSticker, extractStickerAudio } from "../src/shared/utils/stickerProcessor.js";

const originalEncode = proto.Message.encode;

const sticker = { mimetype: "image/webp", isAnimated: true };
const audio = { mimetype: "audio/ogg; codecs=opus", seconds: 2 };
const audioBytes = proto.Message.AudioMessage.encode(audio).finish();
const soundSticker = {
  stickerMessage: sticker,
  soundStickerAudio: Buffer.from(audioBytes).toString("base64"),
};

// Hand-encode the field tags from Baileys #2932 independently of the adapter.
const stickerBytes = Buffer.concat([
  proto.Message.StickerMessage.encode(sticker).finish(),
  Buffer.from([0xc0, 0x01, 0, 0xd2, 0x01, audioBytes.length]),
  audioBytes,
]);
const stickerMessage = Buffer.concat([
  Buffer.from([0xd2, 0x01, stickerBytes.length]),
  stickerBytes,
]);
const envelope = Buffer.concat([
  Buffer.from([0xb2, 0x08, stickerMessage.length + 2, 0x0a, stickerMessage.length]),
  stickerMessage,
]);

it("encodes the sound-sticker envelope and preserves other message fields", () => {
  installSoundStickerEncoder();
  installSoundStickerEncoder();
  const messageContextInfo = { deviceListMetadataVersion: 2 };
  const context = originalEncode({ messageContextInfo }).finish();

  expect(Buffer.from(proto.Message.encode({ ...soundSticker, messageContextInfo }).finish()))
    .toEqual(Buffer.concat([context, envelope]));
  expect(proto.Message.encode({ stickerMessage: sticker }).finish())
    .toEqual(originalEncode({ stickerMessage: sticker }).finish());
});

it("encodes the sound-sticker envelope inside a linked-device message", () => {
  installSoundStickerEncoder();
  const sent = proto.Message.encode({
    deviceSentMessage: { message: soundSticker },
  }).finish();

  expect(Buffer.from(sent)).toEqual(Buffer.concat([
    Buffer.from([0xfa, 0x01, envelope.length + 2, 0x12, envelope.length]),
    envelope,
  ]));
});

function readBytesField(input: Uint8Array, number: number): Uint8Array {
  const reader = protobuf.Reader.create(input);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    if ((tag >>> 3) === number && (tag & 7) === 2) return reader.bytes();
    reader.skipType(tag & 7);
  }
  throw new Error(`Missing length-delimited protobuf field ${number}`);
}

function makeVideoFixture(withAudio: boolean): Buffer {
  return execFileSync("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "color=blue:size=128x128:rate=10",
    ...(withAudio ? ["-f", "lavfi", "-i", "sine=frequency=440"] : []),
    "-t", withAudio ? "12" : "1",
    "-c:v", "mpeg4",
    "-c:a", "aac",
    "-f", "matroska", "pipe:1",
  ]);
}

it("converts a standalone MP3 to a sticker audio track", async () => {
  const mp3 = execFileSync("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", "sine=frequency=880", "-t", "1",
    "-f", "mp3", "pipe:1",
  ]);
  const sound = await extractStickerAudio(mp3);
  if (!sound) throw new Error("Expected audio in the MP3 fixture");

  const codec = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
    "-of", "csv=p=0", "pipe:0",
  ], { input: sound, encoding: "utf8" });
  expect(codec.trim()).toBe("opus");
});

it("relays a video with identical frames as an animated sticker with matching Opus audio", async () => {
  expect(await extractStickerAudio(makeVideoFixture(false))).toBeNull();
  const video = makeVideoFixture(true);
  const sound = await extractStickerAudio(video);
  if (!sound) throw new Error("Expected audio in the video fixture");
  const probe = JSON.parse(execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_name,channels,sample_rate",
    "-of", "json", "pipe:0",
  ], { input: sound, encoding: "utf8" }));
  expect(probe.streams).toEqual([{ codec_name: "opus", sample_rate: "48000", channels: 1 }]);

  const hash = createHash("sha256").update(sound).digest("base64");
  const visual = await createAnimatedSticker(video, false, "mkv");
  const tagged = Buffer.from(await addExif(visual, "Pack", "Author", hash));
  const webp = new webpmux.Image();
  await webp.load(tagged);
  expect(webp.hasAnim).toBe(true);
  expect(JSON.parse(webp.exif!.subarray(22).toString())["sound-sha256"]).toBe(hash);

  const uploads: string[] = [];
  let sent: Uint8Array | undefined;
  let stored: proto.IMessage | undefined;
  const sock = {
    authState: { creds: { me: { id: "123@s.whatsapp.net" } } },
    waUploadToServer: async (path, { mediaType }) => {
      expect((await readFile(path)).length).toBeGreaterThan(0);
      uploads.push(mediaType);
      return { mediaUrl: `https://example.invalid/${mediaType}`, directPath: `/${mediaType}` };
    },
    relayMessage: async (_jid, message, options) => {
      expect(message.stickerMessage?.isAnimated).toBe(true);
      sent = proto.Message.encode(message).finish();
      return options.messageId!;
    },
    upsertMessage: async (message) => {
      stored = message.message ?? undefined;
    },
  } satisfies Pick<WebSocketInfo, "waUploadToServer" | "relayMessage" | "upsertMessage"> & {
    authState: { creds: { me: { id: string } } };
  };

  await sendSoundSticker(sock as unknown as WebSocketInfo, "456@g.us", tagged, Buffer.from(sound));

  expect(uploads).toEqual(["audio", "sticker"]);
  if (!sent || !stored) throw new Error("Expected a relayed message and its retry copy");
  const saved = BSON.deserialize(BSON.serialize({ message: stored }), { promoteBuffers: true });
  expect(proto.Message.encode(saved.message).finish()).toEqual(sent);
  const stickerWire = readBytesField(readBytesField(readBytesField(sent, 134), 1), 26);
  const audioMetadata = proto.Message.AudioMessage.decode(readBytesField(stickerWire, 26));
  expect(audioMetadata.mimetype).toBe("audio/ogg; codecs=opus");
  expect(audioMetadata.seconds).toBe(10);
  expect(Buffer.from(audioMetadata.fileSha256).toString("base64")).toBe(hash);
  expect(proto.Message.StickerMessage.decode(stickerWire).directPath).toBe("/sticker");
}, 15_000);
