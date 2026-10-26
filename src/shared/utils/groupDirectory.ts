import type { WebSocketInfo } from "../types/types.js";

export interface GroupSummary {
  jid: string;
  subject: string;
  participants: number;
  /** true when only group admins may post */
  announce: boolean;
  isCommunity: boolean;
}

export type GroupResolution =
  | { status: "found"; group: GroupSummary }
  | { status: "ambiguous"; candidates: GroupSummary[] }
  | { status: "not_found"; suggestions: GroupSummary[] };

const CACHE_TTL_MS = 60_000;
const MAX_CANDIDATES = 5;

const groupCache = new WeakMap<
  WebSocketInfo,
  { fetchedAt: number; groups: GroupSummary[] }
>();

function toSummary(metadata: {
  id: string;
  subject?: string;
  size?: number;
  participants?: unknown[];
  announce?: boolean;
  isCommunity?: boolean;
}): GroupSummary {
  const subject = metadata.subject?.trim() || "(tanpa nama)";
  const participants =
    metadata.size ?? metadata.participants?.length ?? 0;

  return {
    jid: metadata.id,
    subject,
    participants,
    announce: metadata.announce === true,
    isCommunity: metadata.isCommunity === true,
  };
}

function sortGroups(groups: GroupSummary[]): GroupSummary[] {
  return [...groups].sort((a, b) =>
    a.subject.localeCompare(b.subject, "id", { sensitivity: "base" }),
  );
}

/**
 * Groups this bot is currently a participant of. Results are cached briefly
 * because fetching all participating groups is a network round-trip.
 */
export async function fetchJoinedGroups(
  sock: WebSocketInfo,
  options: { forceRefresh?: boolean } = {},
): Promise<GroupSummary[]> {
  const cached = groupCache.get(sock);
  if (
    !options.forceRefresh &&
    cached &&
    Date.now() - cached.fetchedAt < CACHE_TTL_MS
  ) {
    return cached.groups;
  }

  const metadata = await sock.groupFetchAllParticipating();
  const groups = sortGroups(Object.values(metadata).map(toSummary));

  groupCache.set(sock, { fetchedAt: Date.now(), groups });
  return groups;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve a user-supplied group reference (JID, partial JID, exact or partial
 * name) against the joined groups.
 */
export function resolveGroup(
  groups: readonly GroupSummary[],
  query: string,
): GroupResolution {
  const trimmed = query.trim();
  if (!trimmed) {
    return { status: "not_found", suggestions: [] };
  }

  const byJid = groups.find(
    (group) =>
      group.jid === trimmed ||
      group.jid.split("@")[0] === trimmed.replace(/@.*$/, ""),
  );
  if (byJid) {
    return { status: "found", group: byJid };
  }

  const normalizedQuery = normalize(trimmed);

  const exact = groups.filter(
    (group) => normalize(group.subject) === normalizedQuery,
  );
  if (exact.length === 1) {
    return { status: "found", group: exact[0] };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", candidates: exact.slice(0, MAX_CANDIDATES) };
  }

  const partial = groups.filter((group) =>
    normalize(group.subject).includes(normalizedQuery),
  );
  if (partial.length === 1) {
    return { status: "found", group: partial[0] };
  }
  if (partial.length > 1) {
    return {
      status: "ambiguous",
      candidates: partial.slice(0, MAX_CANDIDATES),
    };
  }

  // Cheap "did you mean" hint: groups sharing the first three characters.
  const prefix = normalizedQuery.slice(0, 3);
  const suggestions = prefix
    ? groups
        .filter((group) => normalize(group.subject).startsWith(prefix))
        .slice(0, MAX_CANDIDATES)
    : [];

  return { status: "not_found", suggestions };
}

/** Send a text message to a group and return the WhatsApp message id. */
export async function sendGroupText(
  sock: WebSocketInfo,
  jid: string,
  text: string,
): Promise<string> {
  const sent = await sock.sendMessage(jid, { text });
  return sent?.key?.id ?? "";
}
