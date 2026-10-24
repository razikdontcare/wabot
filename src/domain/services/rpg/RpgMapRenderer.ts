import { createHash } from "crypto";
import NodeCache from "node-cache";
import sharp from "sharp";
import { MAP, KIND_LABEL, medallionGlyph, terrainGlyph } from "./mapTheme.js";
import type { RpgRoom, RpgRun } from "./types.js";

const cache = new NodeCache({ stdTTL: 900, useClones: false });

export function mapStateKey(run: RpgRun): string {
  const hash = createHash("sha1");
  hash.update(run.runId);
  hash.update(`|${run.act}|${run.worldTitle}|${run.locationId}`);
  hash.update(`|${[...run.discoveredRooms].sort().join(",")}`);
  hash.update(`|${run.rooms.map((room) => (room.features.some((f) => f.resolved) ? "1" : "0")).join("")}`);
  return hash.digest("hex");
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function buildMapSvg(run: RpgRun): string {
  const { pad, header, cellW, cellH, gap, legend, colors, fontSerif, fontSans } = MAP;
  const width = MAP.width;
  const discovered = new Set(run.discoveredRooms);
  const rooms = run.rooms.filter((room) => discovered.has(room.id));

  const xs = rooms.map((room) => room.pos.x);
  const ys = rooms.map((room) => room.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;

  const gridW = cols * cellW + (cols - 1) * gap;
  const gridX = (width - gridW) / 2;
  const gridY = header + 28;
  const gridBottom = gridY + rows * cellH + (rows - 1) * gap;
  const height = gridBottom + 30 + legend + pad;

  const cx = (room: RpgRoom) => gridX + (room.pos.x - minX) * (cellW + gap) + cellW / 2;
  const cy = (room: RpgRoom) => gridY + (room.pos.y - minY) * (cellH + gap) + cellH / 2;
  const byId = new Map(run.rooms.map((room) => [room.id, room]));

  // Deterministic jitter for texture, never for room positions.
  let seed = 0;
  for (const char of mapStateKey(run)) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  out.push(`<defs>
    <radialGradient id="vig" cx="50%" cy="46%" r="72%">
      <stop offset="55%" stop-color="#8a6a3f" stop-opacity="0"/>
      <stop offset="100%" stop-color="#6b4a25" stop-opacity="0.38"/>
    </radialGradient>
    <pattern id="fiber" width="46" height="46" patternUnits="userSpaceOnUse">
      <path d="M4 12 h14 M27 6 h9 M10 33 h18 M33 39 h7" stroke="#c9b184" stroke-opacity="0.30" stroke-width="1"/>
      <path d="M8 24 h6 M22 18 h12 M30 27 h8" stroke="#a98f63" stroke-opacity="0.16" stroke-width="1"/>
    </pattern>
    <pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="10" stroke="#7a6242" stroke-opacity="0.35" stroke-width="1.4"/>
    </pattern>
  </defs>`);
  out.push(`<rect width="${width}" height="${height}" fill="${colors.parchment}"/>`);
  out.push(`<rect width="${width}" height="${height}" fill="url(#fiber)"/>`);

  for (let i = 0; i < 6; i += 1) {
    const bx = 40 + rnd() * (width - 80);
    const by = 40 + rnd() * (height - 80);
    const rx = 60 + rnd() * 120;
    const ry = 30 + rnd() * 60;
    out.push(
      `<ellipse cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="#c9b184" opacity="0.15"/>`,
    );
  }

  // Roads: solid when both ends are discovered, dotted stub otherwise.
  for (const room of rooms) {
    for (const targetId of Object.values(room.exits)) {
      const target = targetId ? byId.get(targetId) : null;
      if (!target) continue;
      if (room.pos.x > target.pos.x || (room.pos.x === target.pos.x && room.pos.y > target.pos.y)) {
        continue;
      }
      const known = discovered.has(target.id);
      if (known) {
        const x1 = cx(room);
        const y1 = cy(room);
        const x2 = cx(target);
        const y2 = cy(target);
        out.push(
          `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${colors.line}" stroke-width="7" stroke-linecap="round" opacity="0.5"/>`,
          `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${colors.road}" stroke-width="3.4" stroke-linecap="round"/>`,
          `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${colors.roadDash}" stroke-width="1" stroke-dasharray="7 9" stroke-linecap="round"/>`,
        );
      } else {
        const dx = cx(target) - cx(room);
        const dy = cy(target) - cy(room);
        const len = Math.hypot(dx, dy) || 1;
        const sx = cx(room) + (dx / len) * 34;
        const sy = cy(room) + (dy / len) * 34;
        const ex = sx + (dx / len) * 50;
        const ey = sy + (dy / len) * 50;
        out.push(
          `<path d="M ${sx} ${sy} L ${ex} ${ey}" stroke="${colors.dashed}" stroke-width="2.4" stroke-dasharray="2 8" stroke-linecap="round" opacity="0.7"/>`,
          `<circle cx="${ex + (dx / len) * 12}" cy="${ey + (dy / len) * 12}" r="11" fill="url(#hatch)" stroke="${colors.dashed}" stroke-width="1.1" opacity="0.8"/>`,
          `<text x="${ex + (dx / len) * 12}" y="${ey + (dy / len) * 17}" text-anchor="middle" font-family="${fontSerif}" font-size="13" fill="${colors.ink}">?</text>`,
        );
      }
    }
  }

  // Terrain decoration.
  for (const room of rooms) {
    const offsetX = room.pos.x % 2 === 0 ? -1 : 1;
    out.push(
      terrainGlyph(
        room.glyph,
        cx(room) + offsetX * 70,
        cy(room) + 26,
        0.85 + rnd() * 0.3,
      ),
    );
  }

  // Medallions.
  for (const room of rooms) {
    const x = cx(room);
    const y = cy(room);
    const accent = MAP.kindColor[room.kind] ?? MAP.kindColor.filler;
    const isCurrent = room.id === run.locationId;
    out.push(
      `<circle cx="${x}" cy="${y}" r="30" fill="${colors.light}" stroke="${accent}" stroke-width="${isCurrent ? 3.4 : 2.2}"/>`,
      `<circle cx="${x}" cy="${y}" r="24" fill="none" stroke="${accent}" stroke-width="0.9" stroke-dasharray="2 4" opacity="0.8"/>`,
      `<g transform="translate(${x} ${y})">${medallionGlyph(room.glyph, colors.ink, colors.light, accent)}</g>`,
      `<text x="${x}" y="${y + 52}" text-anchor="middle" font-family="${fontSerif}" font-size="14.5" font-weight="700" letter-spacing="0.6" fill="${colors.ink}" stroke="${colors.parchment}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${escapeXml(room.name.toUpperCase())}</text>`,
    );

    if (isCurrent) {
      out.push(
        `<circle cx="${x + 26}" cy="${y - 26}" r="12" fill="${colors.seal}" stroke="${colors.light}" stroke-width="2"/>`,
        `<path d="M ${x + 26} ${y - 31} l 1.8 3.7 l 4.1 0.6 l -3 2.9 l 0.7 4.1 l -3.6 -1.9 l -3.6 1.9 l 0.7 -4.1 l -3 -2.9 l 4.1 -0.6 z" fill="${colors.light}" opacity="0.95"/>`,
        `<text x="${x}" y="${y + 68}" text-anchor="middle" font-family="${fontSerif}" font-size="10.5" font-weight="700" letter-spacing="1.6" fill="${colors.seal}">KAMU DI SINI</text>`,
      );
    }
  }

  // Title cartouche (titles longer than the ribbon are shortened, not overflowed).
  const rawTitle = run.worldTitle.toUpperCase();
  const displayTitle = rawTitle.length > 26 ? `${rawTitle.slice(0, 25)}…` : rawTitle;
  const titleSize = displayTitle.length > 20 ? 23 : displayTitle.length > 14 ? 27 : 30;
  out.push(`<g>
    <path d="M 210 54 h 580 l -16 22 l 16 22 h -580 l 16 -22 Z" fill="#e6d3ac" stroke="${colors.ink}" stroke-width="1.6"/>
    <path d="M 226 62 h 548 l -10 14 l 10 14 h -548 l 10 -14 Z" fill="none" stroke="${colors.inkSoft}" stroke-width="0.8" opacity="0.7"/>
    <text x="500" y="86" text-anchor="middle" font-family="${fontSerif}" font-size="${titleSize}" font-weight="700" letter-spacing="2.5" fill="${colors.ink}">${escapeXml(displayTitle)}</text>
    <text x="500" y="108" text-anchor="middle" font-family="${fontSerif}" font-size="13" font-style="italic" fill="${colors.inkSoft}">Bab ${run.act} · Giliran ${run.turn} · ${run.discoveredRooms.length}/${run.rooms.length} ruangan</text>
  </g>`);

  // Compass.
  const compassX = width - 118;
  const compassY = header + 90;
  out.push(`<g transform="translate(${compassX} ${compassY})" opacity="0.9">
    <circle r="42" fill="${colors.light}" stroke="${colors.inkSoft}" stroke-width="1.4"/>
    <circle r="34" fill="none" stroke="${colors.inkSoft}" stroke-width="0.8" stroke-dasharray="2 4"/>
    <path d="M0 -30 L7 -7 L30 0 L7 7 L0 30 L-7 7 L-30 0 L-7 -7 Z" fill="${colors.inkSoft}" opacity="0.85"/>
    <path d="M0 -30 L4 0 L0 4 L-4 0 Z" fill="${colors.ink}"/>
    <text y="-46" text-anchor="middle" font-family="${fontSerif}" font-size="15" font-weight="700" fill="${colors.ink}">U</text>
  </g>`);

  // Legend.
  const legendTop = height - legend - pad + 12;
  out.push(`<g>
    <rect x="${pad}" y="${legendTop}" width="430" height="${legend - 4}" rx="10" fill="${colors.light}" stroke="${colors.inkSoft}" stroke-width="1.4" opacity="0.96"/>
    <text x="${pad + 18}" y="${legendTop + 22}" font-family="${fontSerif}" font-size="11.5" letter-spacing="2" fill="${colors.inkSoft}">KETERANGAN</text>
  </g>`);

  let legendX = pad + 18;
  for (const [kind, label] of Object.entries(KIND_LABEL)) {
    const color = MAP.kindColor[kind] ?? MAP.kindColor.filler;
    out.push(
      `<circle cx="${legendX + 10}" cy="${legendTop + 44}" r="10" fill="${colors.light}" stroke="${color}" stroke-width="2"/>`,
      `<text x="${legendX + 28}" y="${legendTop + 48}" font-family="${fontSans}" font-size="12" fill="${colors.ink}">${label}</text>`,
    );
    legendX += 28 + label.length * 7 + 16;
  }

  out.push(
    `<path d="M ${pad + 18} ${legendTop + 70} h 26" stroke="${colors.dashed}" stroke-width="2.4" stroke-dasharray="2 7"/>`,
    `<text x="${pad + 52}" y="${legendTop + 74}" font-family="${fontSans}" font-size="12" fill="${colors.ink}">belum dijelajahi</text>`,
    `<circle cx="${pad + 200}" cy="${legendTop + 70}" r="7" fill="url(#hatch)" stroke="${colors.dashed}" stroke-width="1"/>`,
    `<text x="${pad + 214}" y="${legendTop + 74}" font-family="${fontSans}" font-size="12" fill="${colors.ink}">jalan tak diketahui</text>`,
  );

  // Scale bar.
  out.push(`<g>
    <text x="${width - 300}" y="${legendTop + 44}" font-family="${fontSans}" font-size="11" fill="${colors.inkSoft}">SKALA</text>
    <path d="M ${width - 300} ${legendTop + 56} h 120" stroke="${colors.inkSoft}" stroke-width="1.6"/>
    <path d="M ${width - 300} ${legendTop + 50} v 12 M ${width - 240} ${legendTop + 52} v 8 M ${width - 180} ${legendTop + 50} v 12" stroke="${colors.inkSoft}" stroke-width="1.4"/>
    <text x="${width - 300}" y="${legendTop + 78}" font-family="${fontSans}" font-size="11" fill="${colors.inkSoft}">0</text>
    <text x="${width - 252}" y="${legendTop + 78}" font-family="${fontSans}" font-size="11" fill="${colors.inkSoft}">100</text>
    <text x="${width - 196}" y="${legendTop + 78}" font-family="${fontSans}" font-size="11" fill="${colors.inkSoft}">200 langkah</text>
  </g>`);

  // Border and vignette.
  out.push(
    `<rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="none" stroke="#5b4426" stroke-width="2.4"/>`,
    `<rect x="28" y="28" width="${width - 56}" height="${height - 56}" fill="none" stroke="#5b4426" stroke-width="0.9" opacity="0.65"/>`,
  );
  for (const [cornerX, cornerY, sx, sy] of [
    [28, 28, 1, 1],
    [width - 28, 28, -1, 1],
    [28, height - 28, 1, -1],
    [width - 28, height - 28, -1, -1],
  ] as [number, number, number, number][]) {
    out.push(
      `<path d="M ${cornerX + 6 * sx} ${cornerY} h ${26 * sx} M ${cornerX} ${cornerY + 6 * sy} v ${26 * sy} M ${cornerX + 14 * sx} ${cornerY + 14 * sy} l ${14 * sx} ${14 * sy}" stroke="#5b4426" stroke-width="1.6" fill="none" opacity="0.85"/>`,
    );
  }
  out.push(`<rect width="${width}" height="${height}" fill="url(#vig)"/>`);
  out.push(`</svg>`);

  return out.join("\n");
}

export async function renderMapPng(run: RpgRun): Promise<Buffer> {
  const key = mapStateKey(run);
  const cached = cache.get<Buffer>(key);
  if (cached) return cached;

  const png = await sharp(Buffer.from(buildMapSvg(run)))
    .png({ compressionLevel: 9 })
    .toBuffer();

  cache.set(key, png);
  return png;
}
