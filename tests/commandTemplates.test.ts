import { describe, expect, it } from "bun:test";
import {
  renderCommandTemplate,
  validateCommandTemplate,
} from "../src/shared/utils/commandTemplates.js";

const context = {
  args: ["dunia", "baru"],
  user: "62811@s.whatsapp.net",
  chat: "1201@g.us",
  prefix: "!",
  botName: "Nexa AI",
  command: "halo",
  now: new Date("2026-11-11T04:05:06.000Z"),
};

describe("renderCommandTemplate", () => {
  it("replaces args, individual args and metadata", () => {
    const text = renderCommandTemplate(
      "Halo {{args}} dari {{user}} di {{chat}} ({{command}}{{prefix}}) {{botname}}",
      context,
    );

    expect(text).toBe(
      "Halo dunia baru dari 62811@s.whatsapp.net di 1201@g.us (halo!) Nexa AI",
    );
  });

  it("renders missing positional args as empty strings", () => {
    expect(renderCommandTemplate("[{{arg3}}]", context)).toBe("[]");
  });

  it("renders date and time from the injected clock", () => {
    const text = renderCommandTemplate("{{date}} {{time}}", context);

    expect(text).not.toContain("{{");
    expect(text).toContain(String(context.now.getFullYear()));
  });
});

describe("validateCommandTemplate", () => {
  it("accepts known placeholders and rejects unknown ones", () => {
    expect(validateCommandTemplate("{{args}} {{arg9}} {{prefix}}")).toEqual([]);
    expect(validateCommandTemplate("{{args}} {{bogus}} {{nope}}")).toEqual([
      "bogus",
      "nope",
    ]);
  });
});
