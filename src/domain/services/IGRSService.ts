import { log } from "../../infrastructure/config/config.js";
import {
  createFetchClient,
  isFetchError,
} from "../../shared/utils/fetchClient.js";

export interface IGRSRating {
  id: number;
  name: string;
  weight: number;
  titleEn: string;
  titleId: string;
  contentEn: string;
  contentId: string;
  imageUrl: string;
  enabled: boolean;
}

export interface IGRSDescriptor {
  id: number;
  nameId: string;
  nameEn: string;
  imageUrl: string;
  enabled: boolean;
  description: string;
}

export interface IGRSGame {
  id: number;
  name: string;
  releaseYear?: number;
  publisherName?: string;
  platformsName?: string[];
  description?: string;
  videoUrl?: string;
  inGameUrl?: string;
  ratings?: IGRSRating[];
  descriptors?: IGRSDescriptor[];
}

export interface IGRSMostViewedGame {
  id: number;
  name: string;
}

interface IGRSSearchResponse {
  _embedded?: {
    publicGameResultList?: IGRSGame[];
  };
}

export class IGRSService {
  private client = createFetchClient({
    baseURL: "https://api.igrs.id/public",
    timeout: 15000,
    headers: {
      Accept: "application/json",
      "User-Agent": "WhatsApp-FunBot",
    },
  });

  async searchGames(query: string, limit = 5): Promise<IGRSGame[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const response = await this.client.get<IGRSSearchResponse>("/games", {
      params: {
        nameLike: normalizedQuery,
      },
    });

    const games = response.data?._embedded?.publicGameResultList ?? [];

    return games.slice(0, Math.max(1, limit));
  }

  async getGameDetailById(id: number): Promise<IGRSGame | null> {
    try {
      const response = await this.client.get<IGRSGame>(`/games/${id}`);
      return response.data;
    } catch (error) {
      if (isFetchError(error) && error.response?.status === 404) {
        return null;
      }

      log.error("Failed to fetch IGRS game detail:", error);
      throw error;
    }
  }

  async getMostViewedGames(limit = 10): Promise<IGRSMostViewedGame[]> {
    const response =
      await this.client.get<IGRSMostViewedGame[]>("/most-viewed-games");

    if (!Array.isArray(response.data)) {
      return [];
    }

    return response.data.slice(0, Math.max(1, limit));
  }
}
