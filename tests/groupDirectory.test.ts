import { describe, expect, it } from "bun:test";
import {
  fetchJoinedGroups,
  resolveGroup,
  sendGroupText,
  type GroupSummary,
} from "../src/shared/utils/groupDirectory.js";
import type { WebSocketInfo } from "../src/shared/types/types.js";

function createFakeSocket(
  metadata: Record<string, Record<string, unknown>>,
) {
  let fetchCalls = 0;
  const sent: Array<{ jid: string; text: string }> = [];

  const socket = {
    groupFetchAllParticipating: async () => {
      fetchCalls += 1;
      return metadata;
    },
    sendMessage: async (jid: string, content: { text: string }) => {
      sent.push({ jid, text: content.text });
      return { key: { id: `msg-${sent.length}` } };
    },
  };

  return {
    socket: socket as unknown as WebSocketInfo,
    sent,
    get fetchCalls() {
      return fetchCalls;
    },
  };
}

const metadata = {
  "1201@g.us": {
    id: "1201@g.us",
    subject: "Info Bot",
    size: 12,
    announce: true,
  },
  "1202@g.us": {
    id: "1202@g.us",
    subject: "Kelas XI",
    participants: [{ id: "a" }, { id: "b" }, { id: "c" }],
  },
  "1203@g.us": {
    id: "1203@g.us",
    subject: "Info Kelas",
    size: 5,
  },
};

const groups: GroupSummary[] = [
  {
    jid: "1202@g.us",
    subject: "Kelas XI",
    participants: 3,
    announce: false,
    isCommunity: false,
  },
  {
    jid: "1201@g.us",
    subject: "Info Bot",
    participants: 12,
    announce: true,
    isCommunity: false,
  },
  {
    jid: "1203@g.us",
    subject: "Info Kelas",
    participants: 5,
    announce: false,
    isCommunity: false,
  },
];

describe("fetchJoinedGroups", () => {
  it("maps and sorts groups by subject", async () => {
    const fake = createFakeSocket(metadata);

    const result = await fetchJoinedGroups(fake.socket);

    expect(result.map((group) => group.subject)).toEqual([
      "Info Bot",
      "Info Kelas",
      "Kelas XI",
    ]);
    expect(result[0]).toEqual({
      jid: "1201@g.us",
      subject: "Info Bot",
      participants: 12,
      announce: true,
      isCommunity: false,
    });
  });

  it("caches results until a refresh is forced", async () => {
    const fake = createFakeSocket(metadata);

    await fetchJoinedGroups(fake.socket);
    await fetchJoinedGroups(fake.socket);
    expect(fake.fetchCalls).toBe(1);

    await fetchJoinedGroups(fake.socket, { forceRefresh: true });
    expect(fake.fetchCalls).toBe(2);
  });

  it("falls back to a placeholder name when the subject is empty", async () => {
    const fake = createFakeSocket({
      "1204@g.us": { id: "1204@g.us", subject: "  ", size: 1 },
    });

    const [group] = await fetchJoinedGroups(fake.socket);
    expect(group.subject).toBe("(tanpa nama)");
  });
});

describe("resolveGroup", () => {
  it("matches an exact name case-insensitively", () => {
    const result = resolveGroup(groups, "info bot");

    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.group.jid).toBe("1201@g.us");
  });

  it("matches a unique partial name", () => {
    const result = resolveGroup(groups, "kelas xi");

    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.group.subject).toBe("Kelas XI");
  });

  it("reports ambiguous names with candidates", () => {
    const result = resolveGroup(groups, "info");

    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it("matches by JID and by JID user part", () => {
    expect(resolveGroup(groups, "1202@g.us").status).toBe("found");
    expect(resolveGroup(groups, "1202").status).toBe("found");
  });

  it("suggests groups sharing the first characters when not found", () => {
    const result = resolveGroup(groups, "infx");

    expect(result.status).toBe("not_found");
    if (result.status === "not_found") {
      expect(result.suggestions.length).toBeGreaterThan(0);
    }
  });

  it("returns not found for an empty query", () => {
    expect(resolveGroup(groups, "   ").status).toBe("not_found");
  });
});

describe("sendGroupText", () => {
  it("sends the text and returns the message id", async () => {
    const fake = createFakeSocket(metadata);

    const id = await sendGroupText(fake.socket, "1201@g.us", "Halo semua");

    expect(id).toBe("msg-1");
    expect(fake.sent).toEqual([{ jid: "1201@g.us", text: "Halo semua" }]);
  });
});
