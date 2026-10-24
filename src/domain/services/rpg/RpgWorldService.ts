import { generateText, Output } from "ai";
import { log } from "../../../infrastructure/config/config.js";
import { AIProviderRouterService } from "../AIProviderRouterService.js";
import { RPG_FALLBACK_BIBLE } from "./rpgContent.js";
import { rpgWorldSchema } from "./rpgSchemas.js";
import type { RpgWorldBible } from "./types.js";

const REGION_FLAVOURS = [
  "kampung di tepi hutan jati, dengan pasar tua dan balai desa yang lembap",
  "desa nelayan di pantai selatan, kabut garam dan gua karang",
  "lereng gunung dengan sawah bertingkat dan candi kecil yang terlupakan",
  "kampung penambang di tepi rawa, rumah panggung dan jalan tanah",
  "kota kecil lama dengan pasar malam, bioskop usang, dan gang sempit",
];

/**
 * Generates the run's world bible once per run. Falls back to the static
 * "Rimba Sukma" bible when the provider is unavailable or returns bad JSON.
 */
export class RpgWorldService {
  private router = AIProviderRouterService.getInstance();

  async generate(seed: string): Promise<RpgWorldBible> {
    const flavour = REGION_FLAVOURS[Math.abs(hash(seed)) % REGION_FLAVOURS.length];

    try {
      const route = this.router.getRoutedModel();
      const result = await generateText({
        model: route.model,
        output: Output.object({
          schema: rpgWorldSchema,
          name: "rpg_world_bible",
          description:
            "World bible for an Indonesian folklore-fantasy text RPG: title, region, premise, tone, factions, NPCs.",
        }),
        system:
          "Kamu penulis dunia untuk game teks fantasi rakyat Indonesia. " +
          "Buat dunia baru yang terasa lokal dan sedikit mistis (rimba, pasar tua, candi, pusaka, dukun, makhluk halus). " +
          "Aturan: " +
          "1) Bahasa Indonesia. " +
          "2) Jangan memakai tokoh agama nyata, orang nyata, atau ritual nyata sebagai mekanik. " +
          "3) Nada mistis-tanpa-gore, aman untuk remaja. " +
          "4) 2–3 faksi dengan motif yang saling bertentangan. " +
          "5) 3 NPC dengan peran jelas (bukan sekadar nama). " +
          "6) premise maksimal 2 kalimat. " +
          "7) title dan region singkat dan mudah diingat.",
        prompt:
          `Benih dunia: ${seed}\n` +
          `Suasana wilayah yang diinginkan: ${flavour}\n\n` +
          "Kembalikan world bible sesuai schema.",
        temperature: 0.95,
        maxOutputTokens: 520,
        abortSignal: AbortSignal.timeout(20_000),
      });

      const bible = result.output;
      if (!bible) return RPG_FALLBACK_BIBLE;
      return bible;
    } catch (error) {
      log.warn(
        "RPG world generation failed; using fallback world:",
        error instanceof Error ? error.message : String(error),
      );
      return RPG_FALLBACK_BIBLE;
    }
  }
}

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = (result * 31 + value.charCodeAt(i)) | 0;
  }
  return result;
}
