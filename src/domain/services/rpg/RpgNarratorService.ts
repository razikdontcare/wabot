import { generateText, Output } from "ai";
import { log } from "../../../infrastructure/config/config.js";
import { AIProviderRouterService } from "../AIProviderRouterService.js";
import { RPG_ITEMS, RPG_SKILLS } from "./rpgContent.js";
import {
  rpgIntentSchema,
  rpgJournalSchema,
  rpgSceneSchema,
  type RpgIntent,
  type RpgSceneNarration,
} from "./rpgSchemas.js";
import type { RpgCharacter, RpgRun } from "./types.js";

/**
 * The AI is a narrator and an intent parser only. It never decides outcomes;
 * every call receives the already-resolved situation from the engine.
 */
export class RpgNarratorService {
  private router = AIProviderRouterService.getInstance();

  async parseIntent(run: RpgRun, text: string): Promise<RpgIntent | null> {
    try {
      const route = this.router.getRoutedModel();
      const result = await generateText({
        model: route.model,
        output: Output.object({
          schema: rpgIntentSchema,
          name: "rpg_intent",
          description: "Parse a free-text RPG action into an engine intent.",
        }),
        system:
          "Kamu parser aksi game teks berbahasa Indonesia. Ubah aksi bebas pemain menjadi satu intent. " +
          "Aturan: " +
          "1) Pilih action yang paling sesuai. " +
          "2) direction hanya untuk action=move. " +
          "3) target diisi nama benda/orang yang disebut, huruf kecil. " +
          "4) Gunakan action=unknown jika aksi tidak mungkin dilakukan di lokasi ini. " +
          "5) Jangan menambah aksi yang tidak diminta.",
        prompt: this.intentPrompt(run, text),
        temperature: 0.1,
        maxOutputTokens: 160,
        abortSignal: AbortSignal.timeout(15_000),
      });

      return result.output ?? null;
    } catch (error) {
      log.debug(
        "RPG intent parse failed:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  async narrate(
    run: RpgRun,
    outcomeLines: string[],
  ): Promise<RpgSceneNarration | null> {
    try {
      const route = this.router.getRoutedModel();
      const result = await generateText({
        model: route.model,
        output: Output.object({
          schema: rpgSceneSchema,
          name: "rpg_scene",
          description:
            "Narration for one resolved RPG turn: prose plus optional headline and NPC line.",
        }),
        system:
          "Kamu narator game teks fantasi rakyat Indonesia. Tulis narasi singkat untuk satu giliran yang HASILNYA SUDAH DITENTUKAN. " +
          "Aturan: " +
          "1) 60–110 kata, orang kedua, bahasa Indonesia, suasana mistis dan tenang. " +
          "2) Jangan mengubah angka: HP, gold, damage, XP, dan hasil dadu harus sama dengan hasil yang diberikan. " +
          "3) Jangan menambah item, musuh, pintu, atau kejadian baru di luar hasil. " +
          "4) Jangan menyebut angka tersembunyi (HP musuh, DC, statistik internal). " +
          "5) Akhiri dengan suasana yang menggantung, tanpa menyuruh pemain mengetik perintah. " +
          "6) headline maksimal 8 kata. npcLine hanya jika ada NPC yang berbicara.",
        prompt: this.scenePrompt(run, outcomeLines),
        temperature: 0.75,
        maxOutputTokens: 380,
        abortSignal: AbortSignal.timeout(18_000),
      });

      return result.output ?? null;
    } catch (error) {
      log.debug(
        "RPG narration failed:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  async compressJournal(run: RpgRun): Promise<string[] | null> {
    if (run.journal.facts.length < 4) return null;

    try {
      const route = this.router.getRoutedModel();
      const result = await generateText({
        model: route.model,
        output: Output.object({
          schema: rpgJournalSchema,
          name: "rpg_journal",
          description: "Compressed durable facts for the RPG journal.",
        }),
        system:
          "Kamu perangkum jurnal game teks. Padatkan catatan menjadi maksimal 6 fakta tahan lama. " +
          "Aturan: " +
          "1) Bahasa Indonesia, satu kalimat pendek per fakta. " +
          "2) Simpan nama NPC, lokasi penting, quest, dan janji. " +
          "3) Buang kejadian sekali lewat dan detail kecil. " +
          "4) Jangan menambah fakta baru.",
        prompt:
          `Fakta saat ini:\n${run.journal.facts.map((fact) => `- ${fact}`).join("\n")}\n\n` +
          `Kejadian terakhir:\n${run.recentScenes.map((scene) => `- ${scene.headline}`).join("\n")}`,
        temperature: 0.2,
        maxOutputTokens: 220,
        abortSignal: AbortSignal.timeout(15_000),
      });

      return result.output?.facts ?? null;
    } catch (error) {
      log.debug(
        "RPG journal compression failed:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private intentPrompt(run: RpgRun, text: string): string {
    const room = run.rooms.find((entry) => entry.id === run.locationId);
    const exits = room
      ? Object.entries(room.exits)
          .map(([direction, id]) => {
            const target = run.rooms.find((entry) => entry.id === id);
            return `${direction}: ${target?.name ?? id}`;
          })
          .join(", ")
      : "-";
    const features = room?.features
      .filter((feature) => !feature.resolved)
      .map((feature) => `${feature.id} (${feature.label})`)
      .join(", ");
    const items = this.inventoryNames(run).join(", ");

    return [
      `Lokasi: ${room?.name ?? "?"}`,
      `Jalan keluar: ${exits || "-"}`,
      `Benda bisa diperiksa: ${features || "-"}`,
      `Item di tas: ${items || "-"}`,
      `Jurus: ${this.skillNames(run) || "-"}`,
      `Pemain menulis: "${text}"`,
      "",
      "Kembalikan intent sesuai schema.",
    ].join("\n");
  }

  private scenePrompt(run: RpgRun, outcomeLines: string[]): string {
    const room = run.rooms.find((entry) => entry.id === run.locationId);
    const party = run.party
      .filter((member) => member.status !== "keluar")
      .map((member) => `${member.name} (${member.archetype}, Lv ${member.level})`)
      .join(", ");
    const facts = run.journal.facts.slice(-6);
    const headlines = run.recentScenes.slice(-3);

    return [
      `Dunia: ${run.world.title} — ${run.world.region} (${run.world.tone})`,
      `Premis: ${run.world.premise}`,
      `Lokasi: ${room?.name ?? "?"} — ${room?.descriptions[0] ?? ""}`,
      `Pemain: ${party || "seorang pengembara"}`,
      `Giliran: ${run.turn} · Bab ${run.act}`,
      facts.length ? `Jurnal:\n${facts.map((fact) => `- ${fact}`).join("\n")}` : "",
      headlines.length
        ? `Kejadian terakhir:\n${headlines.map((scene) => `- ${scene.headline}`).join("\n")}`
        : "",
      "",
      "Hasil yang sudah ditentukan engine (jangan diubah):",
      ...outcomeLines.map((line) => `- ${line}`),
      "",
      "Tulis narasi untuk hasil di atas.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private inventoryNames(run: RpgRun): string[] {
    const stacks =
      run.mode === "party" ? run.shared.inventory : heroInventory(run);
    return stacks.map((stack) => RPG_ITEMS[stack.itemId]?.name ?? stack.itemId);
  }

  private skillNames(run: RpgRun): string {
    const skills = new Set<string>();
    for (const member of run.party) {
      for (const skillId of member.skills) {
        const skill = RPG_SKILLS[skillId];
        if (skill) skills.add(skill.name);
      }
    }
    return [...skills].join(", ");
  }
}

function heroInventory(run: RpgRun): RpgCharacter["inventory"] {
  return run.party[0]?.inventory ?? [];
}
