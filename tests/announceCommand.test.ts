import { describe, expect, it } from "bun:test";
import {
  formatGroupDirectory,
  parseAnnouncementArgs,
} from "../src/app/commands/AnnounceCommand.js";
import type { GroupSummary } from "../src/shared/utils/groupDirectory.js";

function group(overrides: Partial<GroupSummary>): GroupSummary {
  return {
    jid: "1201@g.us",
    subject: "Info Bot",
    participants: 10,
    announce: false,
    isCommunity: false,
    ...overrides,
  };
}

describe("parseAnnouncementArgs", () => {
  it("splits on the pipe separator and keeps spaces on both sides", () => {
    const parsed = parseAnnouncementArgs([
      "Info",
      "Bot",
      "|",
      "Bot",
      "maintenance",
      "malam",
      "ini",
    ]);

    expect(parsed.groupQuery).toBe("Info Bot");
    expect(parsed.message).toBe("Bot maintenance malam ini");
  });

  it("accepts a JID followed by the message", () => {
    const parsed = parseAnnouncementArgs(["1201@g.us", "Halo", "semua"]);

    expect(parsed.groupQuery).toBe("1201@g.us");
    expect(parsed.message).toBe("Halo semua");
  });

  it("uses the quoted message when no inline text is given", () => {
    const parsed = parseAnnouncementArgs(["Info", "Bot"], "Isi pengumuman");

    expect(parsed.groupQuery).toBe("Info Bot");
    expect(parsed.message).toBe("Isi pengumuman");
  });

  it("falls back to the quoted message when the pipe has no text", () => {
    const parsed = parseAnnouncementArgs(["Info", "Bot", "|"], "Dari reply");

    expect(parsed.groupQuery).toBe("Info Bot");
    expect(parsed.message).toBe("Dari reply");
  });

  it("returns an empty query when there are no args", () => {
    expect(parseAnnouncementArgs([], "")).toEqual({
      groupQuery: "",
      message: "",
    });
  });
});

describe("formatGroupDirectory", () => {
  it("lists group name, member count and JID", () => {
    const text = formatGroupDirectory([
      group({ subject: "Info Bot", participants: 12, announce: true }),
      group({ jid: "1202@g.us", subject: "Kelas XI", participants: 3 }),
    ]);

    expect(text).toContain("*Info Bot* — 12 anggota · hanya admin");
    expect(text).toContain("1201@g.us");
    expect(text).toContain("*Kelas XI* — 3 anggota");
    expect(text).not.toContain("dan 1 grup lainnya");
  });

  it("caps very long lists and reports the remainder", () => {
    const groups = Array.from({ length: 45 }, (_, index) =>
      group({
        jid: `120${index}@g.us`,
        subject: `Grup ${index + 1}`,
        participants: index,
      }),
    );

    const text = formatGroupDirectory(groups);

    expect(text).toContain("Grup 40");
    expect(text).not.toContain("Grup 41");
    expect(text).toContain("…dan 5 grup lainnya");
  });
});
