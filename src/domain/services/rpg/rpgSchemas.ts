import { z } from "zod";

/**
 * Zod contracts for the AI side of the RPG. The engine owns state; these
 * schemas only describe narration, intent parsing and world generation.
 */

export const rpgIntentSchema = z.object({
  action: z.enum([
    "move",
    "examine",
    "talk",
    "attack",
    "defend",
    "flee",
    "rest",
    "use_item",
    "skill",
    "unknown",
  ]),
  direction: z.enum(["utara", "selatan", "timur", "barat"]).nullable(),
  target: z.string().max(80).nullable(),
  note: z.string().max(160).nullable(),
});

export type RpgIntent = z.infer<typeof rpgIntentSchema>;

export const rpgSceneSchema = z.object({
  narration: z.string().min(20).max(1400),
  headline: z.string().max(80).nullable(),
  npcLine: z.string().max(240).nullable(),
  mood: z.enum(["tenang", "tegang", "mistis", "lucu"]).nullable(),
});

export type RpgSceneNarration = z.infer<typeof rpgSceneSchema>;

export const rpgWorldSchema = z.object({
  title: z.string().min(3).max(60),
  region: z.string().min(3).max(60),
  premise: z.string().min(30).max(400),
  tone: z.enum(["mistis", "petualangan", "kelam"]),
  factions: z
    .array(
      z.object({
        name: z.string().min(2).max(40),
        motive: z.string().min(5).max(120),
      }),
    )
    .min(2)
    .max(4),
  npcs: z
    .array(
      z.object({
        name: z.string().min(2).max(40),
        role: z.string().min(3).max(80),
      }),
    )
    .min(2)
    .max(5),
});

export const rpgJournalSchema = z.object({
  facts: z.array(z.string().min(4).max(160)).min(1).max(6),
});
