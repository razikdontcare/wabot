import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { BotConfig, log } from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import {
  TixApiError,
  TixCity,
  TixMovie,
  TixMovieType,
  TixScheduleResponse,
  TixService,
  TixShowtime,
  findMoviesByTitle,
  jakartaDate,
  mergeMovieLists,
  normalizeCityName,
} from "../../domain/services/TixService.js";

const MAX_NOW_PLAYING = 25;
const MAX_UPCOMING = 15;
const MAX_THEATERS = 30;
const MAX_CITIES = 40;
const MAX_CATALOG_MOVIES = 20;
const MAX_SCHEDULE_LINES = 60;
const MAX_SCHEDULE_PER_THEATER = 8;
const MAX_ADDRESS_LENGTH = 140;
const MAX_AMBIGUOUS_MOVIES = 10;

interface ParsedTixArgs {
  cityQuery?: string;
  date?: string;
  dateError?: string;
  type: TixMovieType;
  rest: string[];
}

type DateTokenResult =
  | { kind: "none" }
  | { kind: "date"; value: string }
  | { kind: "invalid" };

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of input) {
    if (quoted) {
      if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function parseDateToken(token: string): DateTokenResult {
  const value = token.trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return { kind: "invalid" };
    // Round-trip rejects impossible dates such as 2026-02-31.
    return parsed.toISOString().slice(0, 10) === value
      ? { kind: "date", value }
      : { kind: "invalid" };
  }

  if (value === "today" || value === "ini") {
    return { kind: "date", value: jakartaDate() };
  }

  if (value === "besok" || value === "tomorrow" || value === "esok") {
    return { kind: "date", value: jakartaDate(1) };
  }

  if (value === "lusa") {
    return { kind: "date", value: jakartaDate(2) };
  }

  return { kind: "none" };
}

function parseTixArgs(tokens: string[], cityFromRest: boolean): ParsedTixArgs {
  let cityQuery: string | undefined;
  let date: string | undefined;
  let dateError: string | undefined;
  let type: TixMovieType = "both";
  let rest: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();

    if (lower.startsWith("@") && lower.length > 1) {
      cityQuery = token.slice(1);
      continue;
    }

    if (
      !cityQuery &&
      (lower === "di" || lower === "in") &&
      index + 1 < tokens.length
    ) {
      cityQuery = tokens[index + 1];
      index += 1;
      continue;
    }

    if (lower === "--now" || lower === "--nowplaying" || lower === "--now_playing") {
      type = "now_playing";
      continue;
    }

    if (lower === "--upcoming" || lower === "--soon") {
      type = "upcoming";
      continue;
    }

    if (lower === "--both" || lower === "--all") {
      type = "both";
      continue;
    }

    const parsedDate = parseDateToken(token);
    if (parsedDate.kind === "date") {
      date = parsedDate.value;
      continue;
    }
    if (parsedDate.kind === "invalid") {
      dateError = token;
      continue;
    }

    rest.push(token);
  }

  // Free-form city entry for subcommands whose only positional argument is the city,
  // e.g. "!tix film kuala kapuas" or "!tix film bandung besok".
  if (cityFromRest && !cityQuery && rest.length > 0) {
    cityQuery = rest.join(" ");
    rest = [];
  }

  return { cityQuery, date, dateError, type, rest };
}

function truncate(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength
    ? clean
    : `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  const label = parsed.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

  return date === jakartaDate() ? `${label} · hari ini` : label;
}

function formatRating(rating: number): string | null {
  if (!Number.isFinite(rating) || rating <= 0) return null;
  return `⭐${Number(rating.toFixed(1))}`;
}

function formatMovieMeta(movie: TixMovie): string {
  const parts: string[] = [];

  if (movie.ageCategory) parts.push(movie.ageCategory);
  if (movie.durationMin > 0) parts.push(`${movie.durationMin}m`);

  const rating = formatRating(movie.ratingScore);
  if (rating) parts.push(rating);

  if (movie.genres?.length) {
    parts.push(movie.genres.slice(0, 3).join(", "));
  }

  return parts.join(" · ");
}

function formatMovieLine(movie: TixMovie, index: number): string {
  const meta = formatMovieMeta(movie);
  return `${index + 1}. *${movie.title}*${meta ? ` — ${meta}` : ""}`;
}

function dedupeShowtimes(showtimes: TixShowtime[]): TixShowtime[] {
  const best = new Map<string, TixShowtime>();

  for (const showtime of showtimes) {
    const key = `${showtime.theaterId}|${showtime.studio}|${showtime.startTime}`;
    const existing = best.get(key);
    // status 1 marks the bookable copy when the upstream returns duplicates.
    if (!existing || (existing.status !== 1 && showtime.status === 1)) {
      best.set(key, showtime);
    }
  }

  return Array.from(best.values()).sort(
    (a, b) => a.startEpoch - b.startEpoch,
  );
}

function groupByTheater(
  showtimes: TixShowtime[],
): Array<{ theaterName: string; merchantName: string; showtimes: TixShowtime[] }> {
  const groups = new Map<string, TixShowtime[]>();

  for (const showtime of showtimes) {
    const current = groups.get(showtime.theaterId) ?? [];
    current.push(showtime);
    groups.set(showtime.theaterId, current);
  }

  return Array.from(groups.values())
    .map((list) => ({
      theaterName: list[0].theaterName,
      merchantName: list[0].merchantName,
      showtimes: list,
    }))
    .sort((a, b) => a.theaterName.localeCompare(b.theaterName));
}

export class TixCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "tix",
    description: "Jadwal film dan bioskop TIX (tix.razik.id).",
    helpText: `*Cara pakai:* 🎬
• *${BotConfig.prefix}tix kota* [kata kunci] — cari kota
• *${BotConfig.prefix}tix film* [@kota] [tanggal] [--now|--upcoming|--both] — daftar film
• *${BotConfig.prefix}tix bioskop* [@kota] — daftar bioskop + alamat
• *${BotConfig.prefix}tix jadwal* <judul film> [@kota] [tanggal] — jam tayang satu film
• *${BotConfig.prefix}tix katalog* [@kota] [tanggal] — ringkasan film, bioskop & harga

*Kota* ditulis dengan *@* di depannya, contoh: _@bandung_ atau _@jakarta_.
Kalau tidak ditulis, dipakai kota default *JAKARTA*.
Judul film lebih dari satu kata bisa diapit tanda kutip: _"avengers endgame"_.

*Tanggal:* _2026-10-25_, _besok_, _lusa_ (default: hari ini).

*Contoh:*
• ${BotConfig.prefix}tix film @bandung
• ${BotConfig.prefix}tix film @surabaya besok --now
• ${BotConfig.prefix}tix bioskop @yogyakarta
• ${BotConfig.prefix}tix jadwal pirunduk @bandung
• ${BotConfig.prefix}tix katalog @jakarta

📌 Data dari layanan tidak resmi TIX (tix.razik.id). Jadwal & harga bisa berubah.`,
    category: "utility",
    commandClass: TixCommand,
    cooldown: 5000,
    maxUses: 3,
    vipBypassCooldown: true,
  };

  private service = new TixService();

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    _sessionService: SessionService,
    _msg: proto.IWebMessageInfo,
  ): Promise<void> {
    void _sessionService;
    void _msg;

    const raw = args.join(" ").trim();
    if (!raw || /^(help|bantuan|\?)$/i.test(raw)) {
      await sock.sendMessage(jid, {
        text: TixCommand.commandInfo.helpText ?? "",
      });
      return;
    }

    const tokens = tokenize(raw.replace(/\bhari\s+ini\b/gi, "today"));
    const subcommand = (tokens.shift() ?? "").toLowerCase();

    try {
      switch (subcommand) {
        case "kota":
        case "city":
        case "cities":
          await this.handleCities(tokens, jid, sock);
          return;
        case "film":
        case "films":
        case "movie":
        case "movies":
          await this.handleMovies(tokens, jid, sock);
          return;
        case "bioskop":
        case "cinema":
        case "cinemas":
        case "theater":
        case "theaters":
          await this.handleTheaters(tokens, jid, sock);
          return;
        case "jadwal":
        case "schedule":
        case "showtime":
        case "showtimes":
          await this.handleSchedule(tokens, jid, sock);
          return;
        case "katalog":
        case "catalog":
          await this.handleCatalog(tokens, jid, sock);
          return;
        default:
          // Shorthand: "!tix bandung" behaves like "!tix film bandung".
          await this.handleMovies([subcommand, ...tokens], jid, sock);
          return;
      }
    } catch (error) {
      await this.replyError(jid, sock, error);
    }
  }

  private async handleCities(
    tokens: string[],
    jid: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    const query = tokens.join(" ").trim();
    const cities = await this.service.getCities();
    const needle = normalizeCityName(query);
    const matches = needle
      ? cities.filter((city) => normalizeCityName(city.name).includes(needle))
      : cities;

    if (matches.length === 0) {
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.error} Tidak ada kota yang cocok dengan *${query}*.\n\nCoba kata kunci lain, misal: *${BotConfig.prefix}tix kota band*`,
      });
      return;
    }

    const shown = matches.slice(0, MAX_CITIES);
    const header = query
      ? `🔎 *KOTA: ${query.toUpperCase()}*`
      : `🏙️ *DAFTAR KOTA TIX*`;
    const countLabel = query
      ? `${matches.length} hasil dari ${cities.length} kota`
      : `Menampilkan ${shown.length} dari ${cities.length} kota`;
    const lines = shown.map((city) => `• ${city.name}`);

    let text = `${header}\n_${countLabel}_\n\n${lines.join("\n")}`;

    if (matches.length > shown.length) {
      text += `\n\n_…dan ${matches.length - shown.length} kota lainnya. Persempit dengan *${BotConfig.prefix}tix kota <kata kunci>*._`;
    }

    const exampleCity = shown[0]?.name.toLowerCase() ?? "jakarta";
    text += `\n\n_Lihat film: *${BotConfig.prefix}tix film @${exampleCity}*_`;

    await sock.sendMessage(jid, { text });
  }

  private async handleMovies(
    tokens: string[],
    jid: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    const parsed = parseTixArgs(tokens, true);
    if (parsed.dateError) {
      await this.replyInvalidDate(parsed.dateError, jid, sock);
      return;
    }

    const city = await this.requireCity(parsed.cityQuery, jid, sock);
    if (!city) return;

    const listing = await this.service.getMovies(
      city,
      parsed.type,
      parsed.date,
    );
    const nowPlaying =
      parsed.type === "upcoming" ? [] : listing.nowPlaying;
    const upcoming =
      parsed.type === "now_playing" ? [] : listing.upcoming;

    if (nowPlaying.length === 0 && upcoming.length === 0) {
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.info} Belum ada data film untuk *${listing.city?.name ?? city.name}* pada ${formatDateLabel(listing.date)}.`,
      });
      return;
    }

    const sections: string[] = [];

    if (nowPlaying.length > 0) {
      const shown = nowPlaying.slice(0, MAX_NOW_PLAYING);
      const lines = shown.map(formatMovieLine);
      if (nowPlaying.length > shown.length) {
        lines.push(
          `_…dan ${nowPlaying.length - shown.length} film lainnya._`,
        );
      }
      sections.push(`*Sedang tayang (${nowPlaying.length})*\n${lines.join("\n")}`);
    }

    if (upcoming.length > 0) {
      const shown = upcoming.slice(0, MAX_UPCOMING);
      const lines = shown.map(formatMovieLine);
      if (upcoming.length > shown.length) {
        lines.push(`_…dan ${upcoming.length - shown.length} film lainnya._`);
      }
      sections.push(`*Segera hadir (${upcoming.length})*\n${lines.join("\n")}`);
    }

    const text = [
      `🎬 *FILM DI ${(listing.city?.name ?? city.name).toUpperCase()}*`,
      `📅 ${formatDateLabel(listing.date)}`,
      "",
      sections.join("\n\n"),
      "",
      `_Jam tayang: *${BotConfig.prefix}tix jadwal <judul> @${(listing.city?.name ?? city.name).toLowerCase()}*_`,
    ].join("\n");

    await sock.sendMessage(jid, { text });
  }

  private async handleTheaters(
    tokens: string[],
    jid: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    const parsed = parseTixArgs(tokens, true);
    const city = await this.requireCity(parsed.cityQuery, jid, sock);
    if (!city) return;

    const response = await this.service.getTheaters(city);

    if (response.theaters.length === 0) {
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.info} Belum ada bioskop terdaftar di *${response.city?.name ?? city.name}*.`,
      });
      return;
    }

    const shown = response.theaters.slice(0, MAX_THEATERS);
    const blocks = shown.map((theater, index) => {
      const address = theater.address
        ? `\n   📍 ${truncate(theater.address, MAX_ADDRESS_LENGTH)}`
        : "";
      return `${index + 1}. *${theater.name}*${address}`;
    });

    let text = `🏢 *BIOSKOP DI ${(response.city?.name ?? city.name).toUpperCase()}*\n_${response.theaters.length} bioskop_\n\n${blocks.join("\n")}`;

    if (response.theaters.length > shown.length) {
      text += `\n\n_…dan ${response.theaters.length - shown.length} bioskop lainnya._`;
    }

    text += `\n\n_Film yang tayang: *${BotConfig.prefix}tix film @${(response.city?.name ?? city.name).toLowerCase()}*_`;

    await sock.sendMessage(jid, { text });
  }

  private async handleCatalog(
    tokens: string[],
    jid: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    const parsed = parseTixArgs(tokens, true);
    if (parsed.dateError) {
      await this.replyInvalidDate(parsed.dateError, jid, sock);
      return;
    }

    const city = await this.requireCity(parsed.cityQuery, jid, sock);
    if (!city) return;

    const catalog = await this.service.getCatalog(city, parsed.date);
    const cityName = catalog.cityName ?? city.name;

    const withShowtimes = catalog.nowPlaying
      .map((movie) => ({
        movie,
        showtimes: dedupeShowtimes(movie.showtimes ?? []),
      }))
      .sort((a, b) => {
        if (a.showtimes.length === 0 && b.showtimes.length === 0) {
          return a.movie.title.localeCompare(b.movie.title);
        }
        if (a.showtimes.length === 0) return 1;
        if (b.showtimes.length === 0) return -1;
        return b.showtimes.length - a.showtimes.length;
      });

    if (withShowtimes.length === 0) {
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.info} Belum ada film yang tayang di *${cityName}* pada ${formatDateLabel(catalog.date)}.`,
      });
      return;
    }

    const shown = withShowtimes.slice(0, MAX_CATALOG_MOVIES);
    const lines = shown.map((entry, index) => {
      const { movie, showtimes } = entry;
      if (showtimes.length === 0) {
        return `${index + 1}. *${movie.title}* — _belum ada jadwal_`;
      }

      const theaters = new Set(showtimes.map((item) => item.theaterId)).size;
      const first = showtimes[0];
      const last = showtimes[showtimes.length - 1];
      const cheapest = Math.min(
        ...showtimes
          .map((item) => item.price)
          .filter((price) => Number.isFinite(price) && price > 0),
      );
      const timeRange =
        first.startTime === last.startTime
          ? first.startTime
          : `${first.startTime}–${last.startTime}`;
      const priceLabel = Number.isFinite(cheapest)
        ? ` · dari Rp${cheapest.toLocaleString("id-ID")}`
        : "";

      return `${index + 1}. *${movie.title}* — ${theaters} bioskop · ${timeRange}${priceLabel}`;
    });

    let text = `📊 *KATALOG ${cityName.toUpperCase()}*\n📅 ${formatDateLabel(catalog.date)} · ${catalog.theaters.length} bioskop\n\n*Sedang tayang (${withShowtimes.length})*\n${lines.join("\n")}`;

    if (withShowtimes.length > shown.length) {
      text += `\n\n_…dan ${withShowtimes.length - shown.length} film lainnya._`;
    }

    const upcoming = catalog.upcoming.slice(0, 5);
    if (upcoming.length > 0) {
      text += `\n\n*Segera hadir (${catalog.upcoming.length})*\n${upcoming
        .map((movie) => `• ${movie.title}`)
        .join("\n")}`;
    }

    text += `\n\n_Jadwal lengkap: *${BotConfig.prefix}tix jadwal <judul> @${cityName.toLowerCase()}*_`;

    await sock.sendMessage(jid, { text });
  }

  private async handleSchedule(
    tokens: string[],
    jid: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    const parsed = parseTixArgs(tokens, false);
    if (parsed.dateError) {
      await this.replyInvalidDate(parsed.dateError, jid, sock);
      return;
    }

    const title = parsed.rest.join(" ").trim();
    if (!title) {
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.error} Judul film belum diisi.\n\nContoh: *${BotConfig.prefix}tix jadwal pirunduk @bandung*`,
      });
      return;
    }

    const target = await this.resolveMovieTarget(parsed, title, jid, sock);
    if (!target) return;

    const schedule = await this.service.getMovieSchedule(
      target.movie.movieId,
      target.city,
      parsed.date,
    );

    if (schedule.showtimes.length === 0) {
      const availableDates = schedule.runningDates ?? [];
      let text = `${BotConfig.emoji.info} Belum ada jadwal *${target.movie.title}* di *${target.city.name}* pada ${formatDateLabel(schedule.date)}.`;
      if (availableDates.length > 0) {
        text += `\n\nTanggal tersedia: ${availableDates.join(", ")}`;
      }
      await sock.sendMessage(jid, { text });
      return;
    }

    await sock.sendMessage(jid, {
      text: this.formatSchedule(target.movie, target.city, schedule),
    });
  }

  private async resolveMovieTarget(
    parsed: ParsedTixArgs,
    title: string,
    jid: string,
    sock: WebSocketInfo,
  ): Promise<{ city: TixCity; movie: TixMovie } | null> {
    const explicitCity = Boolean(parsed.cityQuery);
    const city = await this.requireCity(parsed.cityQuery, jid, sock);
    if (!city) return null;

    const listing = await this.service.getMovies(city, "both", parsed.date);
    const movies = mergeMovieLists(listing.nowPlaying, listing.upcoming);
    const matches = findMoviesByTitle(movies, title);

    if (matches.length === 1) {
      return { city, movie: matches[0] };
    }

    if (matches.length > 1) {
      await this.replyAmbiguousMovies(matches, city, jid, sock);
      return null;
    }

    // No explicit city: the trailing words may be a city name, e.g.
    // "!tix jadwal pirunduk kuala kapuas".
    if (!explicitCity) {
      const words = title.split(/\s+/);
      for (let split = words.length - 1; split >= 1; split -= 1) {
        const candidateQuery = words.slice(split).join(" ");
        const resolution = await this.service.resolveCity(candidateQuery);
        if (resolution.status !== "resolved") continue;

        const otherListing = await this.service.getMovies(
          resolution.city,
          "both",
          parsed.date,
        );
        const otherMatches = findMoviesByTitle(
          mergeMovieLists(otherListing.nowPlaying, otherListing.upcoming),
          words.slice(0, split).join(" "),
        );

        if (otherMatches.length === 1) {
          return { city: resolution.city, movie: otherMatches[0] };
        }
        if (otherMatches.length > 1) {
          await this.replyAmbiguousMovies(
            otherMatches,
            resolution.city,
            jid,
            sock,
          );
          return null;
        }
      }
    }

    await sock.sendMessage(jid, {
      text: `${BotConfig.emoji.error} Film *${title}* tidak ditemukan di *${city.name}*.\n\nCoba judul yang lebih pendek, atau lihat daftar film: *${BotConfig.prefix}tix film @${city.name.toLowerCase()}*`,
    });
    return null;
  }

  private async replyAmbiguousMovies(
    matches: TixMovie[],
    city: TixCity,
    jid: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    const shown = matches.slice(0, MAX_AMBIGUOUS_MOVIES);
    const example = shown[0]?.title ?? "";
    await sock.sendMessage(jid, {
      text: `🔎 *Beberapa film cocok di ${city.name}:*\n\n${shown
        .map((movie) => `• ${movie.title}`)
        .join("\n")}\n\nTulis judul yang lebih spesifik, contoh: *${BotConfig.prefix}tix jadwal "${example}" @${city.name.toLowerCase()}*`,
    });
  }

  private async requireCity(
    query: string | undefined,
    jid: string,
    sock: WebSocketInfo,
  ): Promise<TixCity | null> {
    const resolution = await this.service.resolveCity(query);

    if (resolution.status === "resolved") {
      return resolution.city;
    }

    if (resolution.status === "ambiguous") {
      const candidates = resolution.candidates;
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.info} Kota *${query}* cocok dengan beberapa pilihan:\n\n${candidates
          .map((city) => `• ${city.name}`)
          .join("\n")}\n\nTulis lebih spesifik, contoh: *${BotConfig.prefix}tix film @${(candidates[0]?.name ?? "jakarta").toLowerCase()}*`,
      });
      return null;
    }

    const target = query?.trim() || "kota default";
    await sock.sendMessage(jid, {
      text: `${BotConfig.emoji.error} Kota *${target}* tidak ditemukan.\n\nCek daftar kota: *${BotConfig.prefix}tix kota <kata kunci>*`,
    });
    return null;
  }

  private async replyInvalidDate(
    token: string,
    jid: string,
    sock: WebSocketInfo,
  ): Promise<void> {
    await sock.sendMessage(jid, {
      text: `${BotConfig.emoji.error} Tanggal *${token}* tidak valid.\n\nGunakan format *YYYY-MM-DD* (contoh: ${jakartaDate(1)}), atau *besok* / *lusa*.`,
    });
  }

  private formatSchedule(
    movie: TixMovie,
    city: TixCity,
    schedule: TixScheduleResponse,
  ): string {
    const showtimes = dedupeShowtimes(schedule.showtimes);
    const groups = groupByTheater(showtimes);

    const blocks: string[] = [];
    let renderedLines = 0;
    let renderedShowtimes = 0;

    for (const group of groups) {
      if (renderedLines >= MAX_SCHEDULE_LINES) break;

      const header = group.merchantName
        ? `*${group.theaterName}* _${group.merchantName}_`
        : `*${group.theaterName}*`;
      const block: string[] = [header];
      let blockLines = 0;

      for (const showtime of group.showtimes) {
        if (
          renderedLines >= MAX_SCHEDULE_LINES ||
          blockLines >= MAX_SCHEDULE_PER_THEATER
        ) {
          break;
        }

        block.push(
          `• ${showtime.startTime} · ${showtime.studio} · ${showtime.category} · ${showtime.priceString}`,
        );
        renderedLines += 1;
        renderedShowtimes += 1;
        blockLines += 1;
      }

      const notShown = group.showtimes.length - blockLines;
      if (notShown > 0 && renderedLines < MAX_SCHEDULE_LINES) {
        block.push(`_+${notShown} jadwal lain_`);
      }

      blocks.push(block.join("\n"));
    }

    const meta = formatMovieMeta(movie);
    const headerLines = [
      `🎬 *${movie.title}*`,
      `📍 ${city.name} · 📅 ${formatDateLabel(schedule.date)}`,
    ];
    if (meta) headerLines.push(`ℹ️ ${meta}`);
    headerLines.push(
      `🎟️ ${showtimes.length} jadwal · ${groups.length} bioskop`,
    );

    const remaining = showtimes.length - renderedShowtimes;
    const parts = [headerLines.join("\n"), blocks.join("\n\n")];
    if (remaining > 0) {
      parts.push(
        `_…dan ${remaining} jadwal lainnya tidak ditampilkan. Coba tanggal lain atau kota lain._`,
      );
    }

    return parts.join("\n\n");
  }

  private async replyError(
    jid: string,
    sock: WebSocketInfo,
    error: unknown,
  ): Promise<void> {
    if (error instanceof TixApiError) {
      await sock.sendMessage(jid, {
        text: `${BotConfig.emoji.error} *Gagal mengambil data TIX*\n\n${error.message}`,
      });
      return;
    }

    log.error("TixCommand failed:", error);
    await sock.sendMessage(jid, {
      text: `${BotConfig.emoji.error} Terjadi kesalahan saat memproses *${BotConfig.prefix}tix*. Coba lagi nanti.`,
    });
  }
}
