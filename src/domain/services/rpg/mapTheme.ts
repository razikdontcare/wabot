import type { RpgRoomGlyph } from "./types.js";

/** Palette, geometry and vector glyphs for the illustrated dungeon map. */

export const MAP = {
  width: 1000,
  header: 120,
  cellW: 196,
  cellH: 122,
  gap: 34,
  pad: 46,
  legend: 96,
  colors: {
    parchment: "#efe2c6",
    light: "#f7eeda",
    ink: "#3b2c1c",
    inkSoft: "#6b563c",
    line: "#6f5333",
    road: "#b98a4a",
    roadDash: "#e3c79a",
    dashed: "#7a6242",
    seal: "#9c2f27",
    forest: "#7e8d5a",
    forestDark: "#6b7a4b",
    water: "#a9c0b9",
    stone: "#cbb68d",
  },
  kindColor: {
    village: "#b8862b",
    filler: "#5f6f63",
    secret: "#6d4f8f",
    miniboss: "#a8651c",
    boss: "#8f2f2a",
  } as Record<string, string>,
  fontSerif: "DejaVu Serif, Georgia, serif",
  fontSans: "DejaVu Sans, Segoe UI, sans-serif",
};

export const KIND_LABEL: Record<string, string> = {
  village: "Desa",
  filler: "Ruang",
  secret: "Rahasia",
  miniboss: "Mini-bos",
  boss: "Bos",
};

export function medallionGlyph(
  glyph: RpgRoomGlyph,
  ink: string,
  light: string,
  accent: string,
): string {
  switch (glyph) {
    case "village":
      return `<path d="M -11 -1 l 11 -9 l 11 9" fill="none" stroke="${ink}" stroke-width="2"/><rect x="-8" y="-1" width="16" height="11" fill="${light}" stroke="${ink}" stroke-width="2"/><rect x="-2" y="4" width="4" height="6" fill="${ink}"/>`;
    case "tents":
      return `<path d="M -12 10 L -4 -10 L 2 10 Z" fill="${light}" stroke="${ink}" stroke-width="1.8"/><path d="M 2 10 L 9 -7 L 15 10 Z" fill="${light}" stroke="${ink}" stroke-width="1.8"/><path d="M -4 -10 L -2 10" stroke="${ink}" stroke-width="1"/>`;
    case "altar":
      return `<rect x="-11" y="2" width="22" height="6" fill="${light}" stroke="${ink}" stroke-width="1.8"/><rect x="-7" y="-4" width="14" height="6" fill="${light}" stroke="${ink}" stroke-width="1.8"/><path d="M0 -16 l 5 6 l -5 6 l -5 -6 Z" fill="${accent}" stroke="${ink}" stroke-width="1.2"/>`;
    case "houses":
      return `<rect x="-13" y="0" width="9" height="9" fill="${light}" stroke="${ink}" stroke-width="1.6"/><path d="M -15 0 l 6 -6 l 6 6" fill="none" stroke="${ink}" stroke-width="1.6"/><rect x="0" y="3" width="11" height="10" fill="${light}" stroke="${ink}" stroke-width="1.6"/><path d="M -2 3 l 7 -7 l 7 7" fill="none" stroke="${ink}" stroke-width="1.6"/>`;
    case "cave":
      return `<path d="M -14 10 q 4 -20 14 -20 q 10 0 14 20 z" fill="${light}" stroke="${ink}" stroke-width="1.8"/><path d="M -4 10 q 1 -10 6 -10 q 5 0 6 10" fill="${ink}" opacity="0.75"/>`;
    case "skull":
      return `<circle cx="0" cy="-1" r="10" fill="${light}" stroke="${ink}" stroke-width="1.8"/><circle cx="-4" cy="-2" r="2.1" fill="${ink}"/><circle cx="4" cy="-2" r="2.1" fill="${ink}"/><path d="M -4 6 h 8" stroke="${ink}" stroke-width="1.6"/><path d="M -2 6 v 3 M 2 6 v 3" stroke="${ink}" stroke-width="1.4"/>`;
    case "stones":
      return `<path d="M -12 10 l 3 -16 l 7 0 l 3 16 z" fill="${light}" stroke="${ink}" stroke-width="1.6"/><path d="M 2 10 l 2 -10 l 6 0 l 2 10 z" fill="${light}" stroke="${ink}" stroke-width="1.6"/><path d="M -7 2 h 6 M -6 -3 h 5" stroke="${ink}" stroke-width="1"/>`;
    case "swamp":
      return `<path d="M -12 4 q 6 -6 12 0 t 12 0" stroke="${ink}" stroke-width="1.6" fill="none"/><path d="M -9 9 q 6 -5 12 0 t 12 0" stroke="${ink}" stroke-width="1.4" fill="none"/><path d="M -6 -10 v 10 M -3 -12 v 12 M 0 -10 v 10" stroke="${ink}" stroke-width="1.2"/>`;
    case "temple":
      return `<path d="M -15 10 h 30 M -12 10 v -6 h 24 v 6 M -8 4 v -6 h 16 v 6 M -4 -2 v -6 h 8 v 6" fill="${light}" stroke="${ink}" stroke-width="1.8"/><path d="M -3 10 v -5 h 6 v 5" fill="${ink}"/>`;
    default:
      return `<circle r="8" fill="${light}" stroke="${ink}" stroke-width="1.8"/>`;
  }
}

/** Small terrain decoration drawn near a room, never under its label. */
export function terrainGlyph(
  glyph: RpgRoomGlyph,
  x: number,
  y: number,
  scale: number,
): string {
  const { forest, forestDark, stone, dashed } = MAP.colors;
  const treeAt = (tx: number, ty: number, size: number) =>
    `<g transform="translate(${tx} ${ty}) scale(${size.toFixed(2)})" opacity="0.62">
    <path d="M0 0 v 9" stroke="#6b563c" stroke-width="1.6"/><circle cx="0" cy="-3" r="7" fill="${forest}"/><circle cx="-4" cy="1" r="5" fill="${forestDark}"/><circle cx="4" cy="1" r="5" fill="#879669"/></g>`;

  switch (glyph) {
    case "swamp":
      return `<g opacity="0.55" stroke="${MAP.colors.water}" fill="none" stroke-width="1.4">
        <path d="M ${x - 26} ${y + 10} q 8 -5 16 0 t 16 0"/>
        <path d="M ${x - 18} ${y + 18} q 8 -5 16 0 t 16 0"/></g>`;
    case "skull":
      return `<g opacity="0.55" fill="${stone}" stroke="${dashed}" stroke-width="1.3">
        <path d="M ${x - 24} ${y + 16} v -10 a 4 4 0 0 1 8 0 v 10 z"/>
        <path d="M ${x - 10} ${y + 18} v -7 a 3 3 0 0 1 6 0 v 7 z"/></g>`;
    case "stones":
      return `<g opacity="0.55" stroke="${dashed}" stroke-width="1.6" fill="${stone}">
        <path d="M ${x + 18} ${y + 16} l 2 -14 l 6 0 l 2 14 z"/>
        <path d="M ${x + 30} ${y + 17} l 2 -9 l 5 0 l 2 9 z"/></g>`;
    case "temple":
      return `<g opacity="0.5" fill="#d8c49b" stroke="#a58c5f" stroke-width="1.4">
        <path d="M ${x + 14} ${y + 18} q 14 -18 28 0 z"/>
        <path d="M ${x + 30} ${y + 22} q 16 -20 32 0 z"/></g>`;
    case "altar":
      return `<g opacity="0.6" fill="${stone}" stroke="${dashed}" stroke-width="1.2">
        <circle cx="${x + 22}" cy="${y + 14}" r="3"/><circle cx="${x + 32}" cy="${y + 18}" r="2.2"/></g>`;
    case "village":
    case "houses":
    case "tents":
      return treeAt(x - 4, y + 4, scale) + treeAt(x + 16, y + 10, scale * 0.8);
    default:
      return treeAt(x, y, scale);
  }
}
