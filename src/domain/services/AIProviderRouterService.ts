import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { BotConfig, log } from "../../infrastructure/config/config.js";

export type AIProviderName = "groq" | "google";

export interface AIProviderRoute {
  provider: AIProviderName;
  modelId: string;
  supportsMultimodal: boolean;
  model: LanguageModel;
}

export class AIProviderRouterService {
  private static instance: AIProviderRouterService | null = null;

  private groq = createGroq({ apiKey: BotConfig.groqApiKey });
  private google = createGoogleGenerativeAI({
    apiKey: BotConfig.googleGenerativeAiApiKey,
  });

  static getInstance(): AIProviderRouterService {
    if (!AIProviderRouterService.instance) {
      AIProviderRouterService.instance = new AIProviderRouterService();
    }

    return AIProviderRouterService.instance;
  }

  getRoutedModel(options?: { requiresMultimodal?: boolean }): AIProviderRoute {
    const requiresMultimodal = options?.requiresMultimodal === true;

    if (requiresMultimodal) {
      if (!BotConfig.googleGenerativeAiApiKey) {
        throw new Error(
          "Multimodal AI requires GOOGLE_GENERATIVE_AI_API_KEY to be configured.",
        );
      }

      return {
        provider: "google",
        modelId: BotConfig.aiMultimodalModelGoogle,
        supportsMultimodal: true,
        model: this.google(BotConfig.aiMultimodalModelGoogle),
      };
    }

    const preferredProvider = BotConfig.aiProvider;

    if (preferredProvider === "google") {
      if (BotConfig.googleGenerativeAiApiKey) {
        return {
          provider: "google",
          modelId: BotConfig.aiModelGoogle,
          supportsMultimodal: true,
          model: this.google(BotConfig.aiModelGoogle),
        };
      }

      if (BotConfig.groqApiKey) {
        log.warn(
          "AI provider is set to google, but GOOGLE_GENERATIVE_AI_API_KEY is missing. Falling back to groq.",
        );
      }
    }

    if (preferredProvider === "groq") {
      if (BotConfig.groqApiKey) {
        return {
          provider: "groq",
          modelId: BotConfig.aiModelGroq,
          supportsMultimodal: false,
          model: this.groq(BotConfig.aiModelGroq),
        };
      }

      if (BotConfig.googleGenerativeAiApiKey) {
        log.warn(
          "AI provider is set to groq, but GROQ_API_KEY is missing. Falling back to google.",
        );
      }
    }

    if (preferredProvider === "auto") {
      if (BotConfig.groqApiKey) {
        return {
          provider: "groq",
          modelId: BotConfig.aiModelGroq,
          supportsMultimodal: false,
          model: this.groq(BotConfig.aiModelGroq),
        };
      }

      if (BotConfig.googleGenerativeAiApiKey) {
        return {
          provider: "google",
          modelId: BotConfig.aiModelGoogle,
          supportsMultimodal: true,
          model: this.google(BotConfig.aiModelGoogle),
        };
      }
    }

    if (BotConfig.groqApiKey) {
      return {
        provider: "groq",
        modelId: BotConfig.aiModelGroq,
        supportsMultimodal: false,
        model: this.groq(BotConfig.aiModelGroq),
      };
    }

    if (BotConfig.googleGenerativeAiApiKey) {
      return {
        provider: "google",
        modelId: BotConfig.aiModelGoogle,
        supportsMultimodal: true,
        model: this.google(BotConfig.aiModelGoogle),
      };
    }

    throw new Error(
      "No AI provider key configured. Set GROQ_API_KEY and/or GOOGLE_GENERATIVE_AI_API_KEY.",
    );
  }
}
