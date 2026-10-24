import type {
  RpgArchetypeDef,
  RpgBestiaryEntry,
  RpgItem,
  RpgRoom,
  RpgSkill,
  RpgWorldBible,
} from "./types.js";

/**
 * Static folklore-fantasy content for Act I: "Rimba Sukma".
 * Used as the fallback world when AI generation is unavailable, and as the
 * item/bestiary/skill catalogue for generated worlds.
 */

export const RPG_ARCHETYPES: Record<string, RpgArchetypeDef> = {
  pendekar: {
    id: "pendekar",
    name: "Pendekar",
    desc: "Jago silat jalanan. Kuat memukul, tahan banting.",
    stats: { str: 4, vit: 3, agi: 3, spi: 1 },
    skills: ["tebasan", "tangkis"],
    weapon: "keris",
    armor: "jimat",
  },
  dukun: {
    id: "dukun",
    name: "Dukun",
    desc: "Hafal mantra dan ramuan. Rapuh, tapi bisa menyembuhkan.",
    stats: { str: 2, vit: 2, agi: 2, spi: 4 },
    skills: ["sembuhkan", "kutukan"],
    weapon: "golok",
    armor: "jimat",
  },
  penjelajah: {
    id: "penjelajah",
    name: "Penjelajah",
    desc: "Cepat, lincah, dan tahu jalan keluar.",
    stats: { str: 2, vit: 3, agi: 4, spi: 2 },
    skills: ["intai", "jejak"],
    weapon: "golok",
    armor: "baju_besi",
  },
};

export const RPG_SKILLS: Record<string, RpgSkill> = {
  tebasan: {
    id: "tebasan",
    name: "Tebasan",
    desc: "Serangan berikutnya +2 ATK selama 3 giliran.",
    mpCost: 3,
    cooldown: 2,
    kind: "buff_attack",
    power: 2,
  },
  tangkis: {
    id: "tangkis",
    name: "Tangkis",
    desc: "Menahan serangan: damage berikutnya dibelah dua.",
    mpCost: 2,
    cooldown: 2,
    kind: "guard",
  },
  sembuhkan: {
    id: "sembuhkan",
    name: "Sembuhkan",
    desc: "Memulihkan HP dari ramuan dan mantra.",
    mpCost: 4,
    cooldown: 2,
    kind: "heal",
    power: 12,
  },
  kutukan: {
    id: "kutukan",
    name: "Kutukan",
    desc: "Musuh kehilangan 2 ATK selama 3 giliran.",
    mpCost: 4,
    cooldown: 3,
    kind: "debuff_enemy",
    power: 2,
  },
  intai: {
    id: "intai",
    name: "Intai",
    desc: "Pemeriksaan berikutnya +3.",
    mpCost: 2,
    cooldown: 2,
    kind: "buff_attack",
    power: 0,
  },
  jejak: {
    id: "jejak",
    name: "Jejak",
    desc: "Mengungkap satu ruangan yang belum dijelajahi.",
    mpCost: 3,
    cooldown: 3,
    kind: "reveal",
  },
};

export const RPG_ITEMS: Record<string, RpgItem> = {
  ramuan: {
    id: "ramuan",
    name: "Ramuan Daun",
    kind: "consumable",
    desc: "Memulihkan 12 HP.",
    value: 15,
    heal: 12,
  },
  jamu: {
    id: "jamu",
    name: "Jamu Kuat",
    kind: "consumable",
    desc: "Memulihkan 25 HP.",
    value: 30,
    heal: 25,
  },
  dupa: {
    id: "dupa",
    name: "Dupa Wangi",
    kind: "consumable",
    desc: "Memulihkan 6 MP.",
    value: 20,
    mp: 6,
  },
  keris: {
    id: "keris",
    name: "Keris Tua",
    kind: "weapon",
    desc: "Bilah berlekuk, ringan dan cepat.",
    value: 60,
    dice: "d6",
    bonus: 1,
  },
  golok: {
    id: "golok",
    name: "Golok Pasar",
    kind: "weapon",
    desc: "Bilah tebal untuk menebas semak dan akar.",
    value: 80,
    dice: "d8",
    bonus: 0,
  },
  tombak: {
    id: "tombak",
    name: "Tombak Pusaka",
    kind: "weapon",
    desc: "Mata tombak berukir naga kecil.",
    value: 120,
    dice: "d10",
    bonus: 1,
  },
  baju_besi: {
    id: "baju_besi",
    name: "Baju Besi",
    kind: "armor",
    desc: "Pelat besi bekas jaman perang.",
    value: 70,
    defBonus: 2,
  },
  jimat: {
    id: "jimat",
    name: "Jimat Kain",
    kind: "armor",
    desc: "Kain merah berjahit doa, sedikit menahan sial.",
    value: 40,
    defBonus: 1,
  },
  pusaka: {
    id: "pusaka",
    name: "Pusaka Rimba",
    kind: "quest",
    desc: "Benda yang dijaga Singgasana. Run selesai jika kau membawanya pulang.",
    value: 0,
  },
};

export const RPG_BESTIARY: Record<string, RpgBestiaryEntry> = {
  tuyul: {
    id: "tuyul",
    name: "Tuyul",
    tier: 1,
    hp: 14,
    atk: 3,
    def: 2,
    agi: 4,
    xp: 12,
    gold: 8,
    lore: "Kecil, licin, dan suka mencuri. Jangan biarkan ia menyentuh bekalmu.",
  },
  jenglot: {
    id: "jenglot",
    name: "Jenglot",
    tier: 1,
    hp: 18,
    atk: 4,
    def: 2,
    agi: 2,
    xp: 14,
    gold: 10,
    lore: "Boneka bertaring yang dijaga di rumah tua.",
  },
  genderuwo: {
    id: "genderuwo",
    name: "Genderuwo",
    tier: 2,
    hp: 34,
    atk: 6,
    def: 4,
    agi: 2,
    xp: 30,
    gold: 25,
    lore: "Besar, berbulu, dan menunggu di balik nisan.",
  },
  kuntilanak: {
    id: "kuntilanak",
    name: "Kuntilanak",
    tier: 2,
    hp: 28,
    atk: 7,
    def: 3,
    agi: 5,
    xp: 32,
    gold: 22,
    lore: "Suaranya mengejar dari satu pohon ke pohon lain.",
  },
  buto_ijo: {
    id: "buto_ijo",
    name: "Buto Ijo",
    tier: 3,
    hp: 58,
    atk: 9,
    def: 6,
    agi: 3,
    xp: 70,
    gold: 60,
    lore: "Raksasa hijau penjaga Singgasana, lapar dan sabar.",
  },
  naga: {
    id: "naga",
    name: "Naga Siluman",
    tier: 3,
    hp: 70,
    atk: 11,
    def: 7,
    agi: 2,
    xp: 90,
    gold: 90,
    lore: "Ular raksasa yang tidur di bawah candi.",
  },
};

export const RPG_LOOT: Record<string, { itemId: string; qty: number }[]> = {
  village: [{ itemId: "ramuan", qty: 1 }],
  filler: [{ itemId: "ramuan", qty: 1 }, { itemId: "dupa", qty: 1 }, { itemId: "jamu", qty: 1 }],
  secret: [{ itemId: "jimat", qty: 1 }, { itemId: "golok", qty: 1 }],
  miniboss: [{ itemId: "keris", qty: 1 }],
  boss: [{ itemId: "tombak", qty: 1 }],
};

export const RPG_ENCOUNTER_CHANCE: Record<string, number> = {
  village: 0,
  filler: 0.35,
  secret: 0.5,
  miniboss: 1,
  boss: 1,
};

export const RPG_WORLD = {
  id: "rimba_sukma",
  title: "Rimba Sukma",
  region: "Kampung Sukamaju",
  intro:
    "Kabar buruk datang dari balai desa: pusaka kampung hilang, dan rimba di ujung sawah " +
    "terdengar seperti bernapas. Kakek Marbot menyodorkan sebilah keris tanpa tangkai dan " +
    "berkata, \"Singgasana lama sudah terbangun lagi. Kau yang harus menutupnya.\"",
};

export const RPG_FALLBACK_BIBLE: RpgWorldBible = {
  title: "Rimba Sukma",
  region: "Kampung Sukamaju",
  premise:
    "Pusaka kampung hilang dari balai desa. Di ujung sawah, rimba tua mulai bernapas lagi, " +
    "dan Singgasana yang lama tertutup kembali berdenyut.",
  tone: "mistis",
  factions: [
    { name: "Warga Sukamaju", motive: "ingin pusaka kembali dan rimba tenang" },
    { name: "Penunggu Rimba", motive: "menjaga Singgasana dari tangan manusia" },
  ],
  npcs: [
    { name: "Kakek Marbot", role: "penjaga cerita kampung" },
    { name: "Mbok Sari", role: "penjual jamu di pasar tua" },
  ],
};

const ROOM_TEMPLATES: Omit<RpgRoom, "visited">[] = [
  {
    id: "balai",
    name: "Balai Desa",
    kind: "village",
    glyph: "village",
    pos: { x: 0, y: 0 },
    exits: { timur: "pasar", selatan: "gang" },
    features: [
      { id: "kakek", kind: "npc", label: "Kakek Marbot", resolved: false },
    ],
    encounterTable: [],
    descriptions: [
      "Dinding balai desa basah oleh kabut pagi. Kakek Marbot duduk di bangku panjang, " +
        "memutar-mutar sebutir tasbih kayu, matanya mengikuti setiap gerakmu.",
      "Di balai desa, lampu minyak masih menyala meski hari sudah terang. Bau dupa dan " +
        "kopi bercampur jadi satu, seperti pagi-pagi lain yang tak pernah benar-benar tenang.",
    ],
  },
  {
    id: "pasar",
    name: "Pasar Tua",
    kind: "filler",
    glyph: "tents",
    pos: { x: 1, y: 0 },
    exits: { barat: "balai", timur: "altar", selatan: "gua" },
    features: [
      { id: "gerobak", kind: "chest", label: "Gerobak Tua", resolved: false },
    ],
    encounterTable: ["tuyul", "jenglot"],
    descriptions: [
      "Pasar tua sudah sepi, tapi kain-kain warung masih bergelantungan seperti layar " +
        "kapal karam. Sebuah gerobak terbalik di tengah jalan, isinya berserakan.",
      "Tenda-tenda pasar mengembang tertiup angin, menutupi lapak yang sudah lama " +
        "ditinggal. Bau kemenyan menempel di setiap balok kayu.",
    ],
  },
  {
    id: "altar",
    name: "Altar Batu",
    kind: "secret",
    glyph: "altar",
    pos: { x: 2, y: 0 },
    exits: { barat: "pasar", selatan: "makam" },
    features: [
      { id: "altar", kind: "altar", label: "Altar Batu", resolved: false },
    ],
    encounterTable: ["kuntilanak"],
    descriptions: [
      "Altar batu berdiri di tengah rimbunan ilalang. Ukirannya sudah aus, hanya bentuk " +
        "naga yang masih bisa ditebak di sisinya.",
      "Batu-batu tersusun melingkar, ditumbuhi lumut tebal. Di tengahnya, bekas abu dan " +
        "sesajen yang belum lama ditinggal.",
    ],
  },
  {
    id: "gang",
    name: "Gang Sempit",
    kind: "filler",
    glyph: "houses",
    pos: { x: 0, y: 1 },
    exits: { utara: "balai", timur: "gua", selatan: "rawa" },
    features: [
      { id: "jebakan", kind: "trap", label: "Tali Jerat", resolved: false },
    ],
    encounterTable: ["tuyul", "jenglot"],
    descriptions: [
      "Gang sempit diapit dua rumah kayu yang miring ke dalam. Jemuran kosong bergoyang, " +
        "dan di tanah basah ada jejak kaki kecil yang tidak wajar.",
      "Dinding gang dipenuhi coretan arang. Sesuatu bergerak di atas genting, terlalu " +
        "cepat untuk dilihat langsung.",
    ],
  },
  {
    id: "gua",
    name: "Gua Akar",
    kind: "filler",
    glyph: "cave",
    pos: { x: 1, y: 1 },
    exits: { utara: "pasar", barat: "gang", timur: "makam", selatan: "batu" },
    features: [
      { id: "peti", kind: "chest", label: "Peti Lapuk", resolved: false },
    ],
    encounterTable: ["tuyul", "jenglot"],
    descriptions: [
      "Akar-akar besar menembus langit gua seperti jari raksasa. Di sudut, sebuah peti " +
        "lapuk tertutup lumut dan sisa kain.",
      "Gua ini lembap dan hangat, seperti tenggorokan makhluk hidup. Tetes air terdengar " +
        "beraturan, hampir seperti detak.",
    ],
  },
  {
    id: "makam",
    name: "Makam Tua",
    kind: "miniboss",
    glyph: "skull",
    pos: { x: 2, y: 1 },
    exits: { utara: "altar", barat: "gua", selatan: "pintu" },
    features: [
      { id: "nisan", kind: "altar", label: "Nisan Berukir", resolved: false },
    ],
    encounterTable: ["genderuwo"],
    descriptions: [
      "Makam tua itu tidak terawat, batu nisannya miring dan berlumut. Tanah di atas " +
        "kuburan baru saja digali—dari dalam.",
      "Di antara nisan-nisan, angin berhenti. Bau tanah basah dan kemenyan mengepul " +
        "dari celah batu.",
    ],
  },
  {
    id: "rawa",
    name: "Rawa Berlumpur",
    kind: "filler",
    glyph: "swamp",
    pos: { x: 0, y: 2 },
    exits: { utara: "gang", timur: "batu" },
    features: [
      { id: "genangan", kind: "puzzle", label: "Genangan Hitam", resolved: false },
    ],
    encounterTable: ["kuntilanak"],
    descriptions: [
      "Rawa berbau besi dan lumpur. Di permukaan air, gelembung muncul satu per satu, " +
        "seperti ada yang bernapas di bawah.",
      "Pohon-pohon rawa berdiri seperti orang berjajar. Sebagian batangnya bersisik, " +
        "sebagian lagi berlumut tebal.",
    ],
  },
  {
    id: "batu",
    name: "Batu Bertulis",
    kind: "filler",
    glyph: "stones",
    pos: { x: 1, y: 2 },
    exits: { utara: "gua", barat: "rawa", timur: "pintu" },
    features: [
      { id: "prasasti", kind: "altar", label: "Batu Bertulis", resolved: false },
    ],
    encounterTable: ["jenglot"],
    descriptions: [
      "Batu bertulis setinggi dada, huruf-hurufnya nyaris hilang dimakan lumut. Di " +
        "sekitarnya berdiri batu-batu kecil seperti penjaga.",
      "Di tengah lapangan batu, prasasti tua itu masih tegak. Angin membawa suara " +
        "berbisik yang tidak jelas asalnya.",
    ],
  },
  {
    id: "pintu",
    name: "Pintu Baja",
    kind: "filler",
    glyph: "cave",
    pos: { x: 2, y: 2 },
    exits: { utara: "makam", barat: "batu", timur: "singgasana" },
    features: [
      { id: "pintu", kind: "puzzle", label: "Pintu Baja Berukir", resolved: false },
    ],
    encounterTable: ["jenglot"],
    descriptions: [
      "Sebuah pintu baja berukir berdiri di tengah hutan, tanpa dinding di kiri dan " +
        "kanannya. Ukirannya mirip wajah yang sedang menahan tawa.",
      "Pintu itu terlalu rapi untuk tempat seperti ini. Di permukaannya ada lubang " +
        "kunci berbentuk keris.",
    ],
    gate: "quest.kunci",
  },
  {
    id: "singgasana",
    name: "Singgasana",
    kind: "boss",
    glyph: "temple",
    pos: { x: 3, y: 1 },
    exits: { barat: "makam", selatan: "pintu" },
    features: [
      { id: "singgasana", kind: "altar", label: "Singgasana Batu", resolved: false },
    ],
    encounterTable: ["buto_ijo"],
    descriptions: [
      "Singgasana batu menjulang di tengah ruang terbuka. Di atasnya, pusaka kampung " +
        "berkilau samar, dijaga sesuatu yang bernapas berat.",
      "Ruang itu sunyi, kecuali napas panjang dari kegelapan di balik singgasana. " +
        "Bau tanah dan darah mengisi udara.",
    ],
    gate: "quest.pintu_terbuka",
  },
];

export function buildStaticRooms(): RpgRoom[] {
  return ROOM_TEMPLATES.map((room) => ({
    ...room,
    features: room.features.map((feature) => ({ ...feature })),
    exits: { ...room.exits },
    descriptions: [...room.descriptions],
    encounterTable: [...room.encounterTable],
    visited: false,
  }));
}
