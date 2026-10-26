import { describe, expect, it } from "bun:test";
import { loadPersonalityPrompt } from "../src/shared/utils/promptLoader.js";

const baseContext = { currentDate: "2026-10-27" };

describe("loadPersonalityPrompt tool privileges", () => {
  it("hides admin-only tools from non-admin prompts", () => {
    const prompt = loadPersonalityPrompt("nexa", {
      ...baseContext,
      privileged: false,
    });

    expect(prompt).not.toContain("`exec_command(command)`");
    expect(prompt).not.toContain("`write_file(path, content)`");
    expect(prompt).not.toContain("You have persistent memory through `MEMORY.md`");
    expect(prompt).toContain("restricted to bot admins");
  });

  it("exposes admin-only tools to admin prompts", () => {
    const prompt = loadPersonalityPrompt("nexa", {
      ...baseContext,
      privileged: true,
    });

    expect(prompt).toContain("`exec_command(command)`");
    expect(prompt).toContain("`write_file(path, content)`");
    expect(prompt).toContain("You have persistent memory through `MEMORY.md`");
    expect(prompt).not.toContain("restricted to bot admins");
  });

  it("tells the model to check command status in both modes", () => {
    for (const privileged of [true, false]) {
      const prompt = loadPersonalityPrompt("nexa", {
        ...baseContext,
        privileged,
      });

      expect(prompt).toContain("If the status is `FAILED`");
    }
  });
});
