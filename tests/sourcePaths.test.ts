import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSourceModule,
  resolveWorkerScriptPath,
} from "../src/shared/utils/sourcePaths.js";

describe("sourcePaths", () => {
  it("resolves worker-only modules inside src, not dist", () => {
    const worker = resolveWorkerScriptPath();

    expect(worker).toBe(join(process.cwd(), "src", "shared", "utils", "worker.ts"));
    expect(existsSync(worker)).toBe(true);
  });

  it("resolves every worker module referenced by commands", () => {
    const modules = [
      resolveSourceModule("shared", "utils", "stickerProcessor.ts"),
      resolveSourceModule("shared", "utils", "ffmpeg.ts"),
    ];

    modules.forEach((modulePath) => {
      expect(modulePath.endsWith(".ts")).toBe(true);
      expect(existsSync(modulePath)).toBe(true);
    });
  });
});
