import { describe, expect, it } from "bun:test";
import { normalizeStickerWebp } from "../src/shared/utils/stickerProcessor.js";

const VP8X_ALPHA_FLAG = 0x10;
const VP8X_ANIM_FLAG = 0x02;
const VP8X_EXIF_FLAG = 0x08;

function chunk(fourCC: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourCC, 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  const padding = payload.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, payload, padding]);
}

function riff(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}

function vp8xChunk(flags: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  payload.writeUIntLE(511, 4, 3);
  payload.writeUIntLE(511, 7, 3);
  return chunk("VP8X", payload);
}

function animChunk(background: [number, number, number, number]): Buffer {
  const payload = Buffer.alloc(6);
  payload.set(background, 0);
  payload.writeUInt16LE(0, 4);
  return chunk("ANIM", payload);
}

function anmfChunk({ withAlpha }: { withAlpha: boolean }): Buffer {
  const header = Buffer.alloc(16);
  header.writeUIntLE(0, 0, 3);
  header.writeUIntLE(0, 3, 3);
  header.writeUIntLE(511, 6, 3);
  header.writeUIntLE(511, 9, 3);
  header.writeUIntLE(100, 12, 3);

  const parts = [header];
  if (withAlpha) {
    parts.push(chunk("ALPH", Buffer.from([0x00, 0x01, 0x02, 0x03])));
  }
  parts.push(chunk("VP8 ", Buffer.from([0x00, 0x01, 0x02, 0x03])));
  return chunk("ANMF", Buffer.concat(parts));
}

function readVp8xFlags(data: Buffer): number {
  const index = data.indexOf(Buffer.from("VP8X", "ascii"));
  return data[index + 8];
}

function readAnimBackground(data: Buffer): Buffer {
  const index = data.indexOf(Buffer.from("ANIM", "ascii"));
  return data.subarray(index + 8, index + 12);
}

describe("normalizeStickerWebp", () => {
  it("restores the VP8X alpha flag dropped when re-muxing an animation", () => {
    const input = riff([
      vp8xChunk(VP8X_ANIM_FLAG | VP8X_EXIF_FLAG),
      animChunk([255, 255, 255, 255]),
      anmfChunk({ withAlpha: true }),
    ]);

    const result = normalizeStickerWebp(input);

    expect(readVp8xFlags(Buffer.from(result)) & VP8X_ALPHA_FLAG).toBe(
      VP8X_ALPHA_FLAG,
    );
  });

  it("clears the opaque white ANIM background colour", () => {
    const input = riff([
      vp8xChunk(VP8X_ANIM_FLAG | VP8X_ALPHA_FLAG),
      animChunk([255, 255, 255, 255]),
      anmfChunk({ withAlpha: true }),
    ]);

    const result = normalizeStickerWebp(input);

    expect([...readAnimBackground(Buffer.from(result))]).toEqual([0, 0, 0, 0]);
  });

  it("keeps the alpha flag off when no frame carries alpha", () => {
    const input = riff([
      vp8xChunk(VP8X_ANIM_FLAG),
      animChunk([255, 255, 255, 255]),
      anmfChunk({ withAlpha: false }),
    ]);

    const result = normalizeStickerWebp(input);

    expect(readVp8xFlags(Buffer.from(result)) & VP8X_ALPHA_FLAG).toBe(0);
    expect([...readAnimBackground(Buffer.from(result))]).toEqual([0, 0, 0, 0]);
  });

  it("keeps still stickers with a top-level ALPH chunk unchanged", () => {
    const input = riff([
      vp8xChunk(VP8X_ALPHA_FLAG),
      chunk("ALPH", Buffer.from([0x00, 0x01])),
      chunk("VP8 ", Buffer.from([0x00, 0x01, 0x02, 0x03])),
    ]);

    const result = normalizeStickerWebp(input);

    expect(Buffer.from(result).equals(input)).toBe(true);
  });

  it("returns files without a VP8X chunk untouched", () => {
    const input = riff([
      chunk("VP8 ", Buffer.from([0x00, 0x01, 0x02, 0x03])),
    ]);

    expect(Buffer.from(normalizeStickerWebp(input)).equals(input)).toBe(true);
  });

  it("does not mutate the input buffer", () => {
    const input = riff([
      vp8xChunk(VP8X_ANIM_FLAG),
      animChunk([255, 255, 255, 255]),
      anmfChunk({ withAlpha: true }),
    ]);
    const original = Buffer.from(input);

    normalizeStickerWebp(input);

    expect(Buffer.from(input).equals(original)).toBe(true);
  });

  it("is idempotent", () => {
    const input = riff([
      vp8xChunk(VP8X_ANIM_FLAG),
      animChunk([255, 255, 255, 255]),
      anmfChunk({ withAlpha: true }),
    ]);

    const once = normalizeStickerWebp(input);
    const twice = normalizeStickerWebp(once);

    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true);
  });

  it("ignores truncated containers", () => {
    const input = riff([
      vp8xChunk(VP8X_ANIM_FLAG),
      animChunk([255, 255, 255, 255]),
      anmfChunk({ withAlpha: true }),
    ]).subarray(0, 40);
    const original = Buffer.from(input);

    const result = normalizeStickerWebp(input);

    expect(Buffer.from(result).equals(original)).toBe(true);
  });
});
