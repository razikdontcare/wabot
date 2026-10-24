import { log } from "../../infrastructure/config/config.js";
import {
  createFetchClient,
  isFetchError,
} from "../../shared/utils/fetchClient.js";

const DEFAULT_TIX_BASE_URL = "https://tix.razik.id";
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const CITIES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const TIX_BASE_URL =
  process.env.TIX_BASE_URL?.trim() || DEFAULT_TIX_BASE_URL;
export const TIX_DEFAULT_CITY =
  process.env.TIX_DEFAULT_CITY?.trim().toUpperCase() || "JAKARTA";
export const TIX_TIME_ZONE = "Asia/Jakarta";

export type TixMovieType = "now_playing" | "upcoming" | "both";

export interface TixCity {
  id: string;
  name: string;
}

export interface TixShowtime {
  movieId: string;
  movieName: string;
  theaterId: string;
  theaterName: string;
  merchantName: string;
  date: string;
  studio: string;
  studioKey: string;
  category: string;
  price: number;
  priceString: string;
  startEpoch: number;
  startTime: string;
  showtimeId: string;
  seatStatus: string;
  status: number;
}

export interface TixMovie {
  eventId: string;
  movieId: string;
  title: string;
  ageCategory: string;
  durationMin: number;
  ratingScore: number;
  posterPath: string;
  genres: string[];
  presaleFlag: number;
  isCustomEvent: boolean;
  runningDates?: string[];
  showtimes?: TixShowtime[];
}

export interface TixTheater {
  id: string;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
}

export interface TixCitiesResponse {
  count: number;
  cities: TixCity[];
}

export interface TixMoviesResponse {
  city: TixCity;
  tz: number;
  date: string;
  nowPlaying: TixMovie[];
  upcoming: TixMovie[];
}

export interface TixCatalogResponse {
  cityId: string;
  cityName: string;
  tz: number;
  date: string;
  theaters: TixTheater[];
  nowPlaying: TixMovie[];
  upcoming: TixMovie[];
}

export interface TixTheatersResponse {
  city: TixCity;
  count: number;
  theaters: TixTheater[];
}

export interface TixScheduleResponse {
  city: TixCity;
  movieId: string;
  date: string;
  runningDates: string[];
  showtimes: TixShowtime[];
}

export type TixCityResolution =
  | { status: "resolved"; city: TixCity }
  | { status: "ambiguous"; candidates: TixCity[] }
  | { status: "missing" };

interface TixErrorBody {
  error?: string;
  message?: string;
}

const CITY_ALIASES: Record<string, string> = {
  JOGJA: "YOGYAKARTA",
  JOGJAKARTA: "YOGYAKARTA",
  YOGYA: "YOGYAKARTA",
  JKT: "JAKARTA",
  BDG: "BANDUNG",
  SBY: "SURABAYA",
  SMG: "SEMARANG",
  MKS: "MAKASSAR",
  MDN: "MEDAN",
  SLO: "SOLO",
};

export class TixApiError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "TixApiError";
    this.status = options.status;
    this.code = options.code;
  }
}

export function normalizeCityName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMovieTitle(value: string): string {
  return normalizeCityName(value);
}

/**
 * Today's (or a shifted) calendar date in the API's configured UTC offset (WIB).
 */
export function jakartaDate(offsetDays = 0): string {
  return new Date(Date.now() + JAKARTA_OFFSET_MS + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function findMoviesByTitle(
  movies: TixMovie[],
  query: string,
  limit = 10,
): TixMovie[] {
  const needle = normalizeMovieTitle(query);
  if (!needle) return [];

  const best = new Map<string, { movie: TixMovie; score: number }>();
  for (const movie of movies) {
    const title = normalizeMovieTitle(movie.title);
    let score = 0;
    if (title === needle) score = 3;
    else if (title.startsWith(needle)) score = 2;
    else if (title.includes(needle)) score = 1;
    if (score === 0) continue;

    const existing = best.get(movie.movieId);
    if (!existing || existing.score < score) {
      best.set(movie.movieId, { movie, score });
    }
  }

  return Array.from(best.values())
    .sort(
      (a, b) =>
        b.score - a.score || a.movie.title.localeCompare(b.movie.title),
    )
    .slice(0, limit)
    .map((entry) => entry.movie);
}

export function mergeMovieLists(
  nowPlaying: TixMovie[] = [],
  upcoming: TixMovie[] = [],
): TixMovie[] {
  const merged = new Map<string, TixMovie>();
  for (const movie of [...nowPlaying, ...upcoming]) {
    if (!merged.has(movie.movieId)) merged.set(movie.movieId, movie);
  }
  return Array.from(merged.values());
}

/**
 * Client for the unofficial TIX catalog service (tix.razik.id).
 * The service fans out to api.tix.id and returns plain TIX showtime data.
 */
export class TixService {
  private static citiesCache: { fetchedAt: number; cities: TixCity[] } | null =
    null;

  private client = createFetchClient({
    baseURL: TIX_BASE_URL,
    timeout: 20000,
    headers: {
      Accept: "application/json",
      "User-Agent": "WhatsApp-FunBot",
    },
  });

  async getCities(forceRefresh = false): Promise<TixCity[]> {
    const cached = TixService.citiesCache;
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.fetchedAt < CITIES_CACHE_TTL_MS
    ) {
      return cached.cities;
    }

    const response = await this.request<TixCitiesResponse>("/v1/cities");
    const cities = Array.isArray(response.cities) ? response.cities : [];
    TixService.citiesCache = { fetchedAt: Date.now(), cities };
    return cities;
  }

  async resolveCity(query?: string): Promise<TixCityResolution> {
    const raw = (query ?? TIX_DEFAULT_CITY).trim();
    const cities = await this.getCities();

    if (!raw) {
      return { status: "missing" };
    }

    if (/^\d+$/.test(raw)) {
      const byId = cities.find((city) => city.id === raw);
      return { status: "resolved", city: byId ?? { id: raw, name: raw } };
    }

    const aliased = CITY_ALIASES[raw.toUpperCase()] ?? raw;
    const needle = normalizeCityName(aliased);

    if (!needle) {
      return { status: "missing" };
    }

    const normalized = cities.map((city) => ({
      city,
      name: normalizeCityName(city.name),
    }));

    const exact = normalized.find((entry) => entry.name === needle);
    if (exact) {
      return { status: "resolved", city: exact.city };
    }

    const prefixed = normalized.filter((entry) =>
      entry.name.startsWith(needle),
    );
    if (prefixed.length === 1) {
      return { status: "resolved", city: prefixed[0].city };
    }

    const contained = normalized.filter((entry) =>
      entry.name.includes(needle),
    );
    if (contained.length === 1) {
      return { status: "resolved", city: contained[0].city };
    }

    const candidates = prefixed.length > 0 ? prefixed : contained;
    if (candidates.length > 1) {
      return {
        status: "ambiguous",
        candidates: candidates.slice(0, 8).map((entry) => entry.city),
      };
    }

    return { status: "missing" };
  }

  async getMovies(
    city: TixCity,
    type: TixMovieType = "both",
    date?: string,
  ): Promise<TixMoviesResponse> {
    const params: Record<string, string> = {
      city: city.id,
      type,
    };
    if (date) params.date = date;

    const response = await this.request<TixMoviesResponse>("/v1/movies", params);
    return {
      ...response,
      nowPlaying: response.nowPlaying ?? [],
      upcoming: response.upcoming ?? [],
    };
  }

  async getCatalog(city: TixCity, date?: string): Promise<TixCatalogResponse> {
    const params: Record<string, string> = { city: city.id };
    if (date) params.date = date;

    const response = await this.request<TixCatalogResponse>(
      "/v1/catalog",
      params,
    );
    return {
      ...response,
      theaters: response.theaters ?? [],
      nowPlaying: response.nowPlaying ?? [],
      upcoming: response.upcoming ?? [],
    };
  }

  async getTheaters(city: TixCity): Promise<TixTheatersResponse> {
    const response = await this.request<TixTheatersResponse>("/v1/theaters", {
      city: city.id,
    });
    return {
      ...response,
      theaters: response.theaters ?? [],
    };
  }

  async getMovieSchedule(
    movieId: string,
    city: TixCity,
    date?: string,
  ): Promise<TixScheduleResponse> {
    const params: Record<string, string> = { city: city.id };
    if (date) params.date = date;

    const response = await this.request<TixScheduleResponse>(
      `/v1/movies/${encodeURIComponent(movieId)}/schedule`,
      params,
    );
    return {
      ...response,
      runningDates: response.runningDates ?? [],
      showtimes: response.showtimes ?? [],
    };
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    try {
      const response = await this.client.get<T>(path, { params });
      return response.data;
    } catch (error) {
      throw this.toTixError(path, error);
    }
  }

  private toTixError(path: string, error: unknown): TixApiError {
    if (isFetchError(error)) {
      const body = error.response?.data as TixErrorBody | string | undefined;
      const message =
        typeof body === "string"
          ? body
          : (body?.message ?? body?.error ?? error.message);
      const code =
        typeof body === "object" && body?.error ? body.error : undefined;

      log.error(`TIX API request failed (${path}): ${message}`);
      return new TixApiError(message, {
        status: error.response?.status,
        code,
      });
    }

    const message =
      error instanceof Error ? error.message : "Permintaan ke TIX gagal";
    log.error(`TIX API request error (${path}): ${message}`);
    return new TixApiError(message);
  }
}
