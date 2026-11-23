import { describe, expect, it, mock, spyOn, beforeEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloaderCommand } from "../src/app/commands/DownloaderCommand.js";

const hasMediaTools = Boolean(Bun.which("ffmpeg") && Bun.which("ffprobe"));

describe("DownloaderCommand", () => {
  let command: DownloaderCommand;
  let mockSock: any;

  beforeEach(() => {
    command = new DownloaderCommand();
    mockSock = {
      sendMessage: mock(async () => ({ key: { id: "msg-123" } })),
    };
  });

  for (const encoder of ["libvpx-vp9", "libx264"]) {
    it.skipIf(!hasMediaTools)(`should send ${encoder} downloads as H.264 and AAC inline`, async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "downloader-test-"));
      const input = join(tempDir, "input.mp4");
      let uploadedPath: string | undefined;
      try {
        execFileSync("ffmpeg", [
          "-v", "error", "-f", "lavfi", "-i", "color=s=128x128:d=0.2",
          "-f", "lavfi", "-i", "sine=duration=0.2",
          "-c:v", encoder, ...(encoder === "libx264" ? ["-profile:v", "baseline"] : []),
          "-c:a", "aac", input,
        ]);
        const metadata = { id: "test", title: "Test Video", duration: 1 };
        (command as any).ytdl = {
          getVideoInfo: mock(async () => metadata),
          downloadToFile: mock(async () => ({
            filePath: input,
            filename: "test-video.mp4",
            size: (await stat(input)).size,
            metadata,
            cleanup: () => unlink(input),
          })),
        };

        let uploadedCodecs: string[] | undefined;
        const sendSpy = spyOn(command as any, "sendWithTimeout").mockImplementation(
          async (_sock, _jid, message: any) => {
            uploadedPath = message.video.stream.path;
            uploadedCodecs = execFileSync("ffprobe", [
              "-v", "error", "-show_entries", "stream=codec_name",
              "-of", "csv=p=0", uploadedPath!,
            ], { encoding: "utf8" }).trim().split(/\r?\n/);
            for await (const _chunk of message.video.stream) { /* Consume upload. */ }
            return true;
          },
        );

        await command.handleCommand(
          ["https://youtube.com/watch?v=test"],
          "jid@g.us", "user@s.whatsapp.net", mockSock, {} as any, {} as any,
        );

        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(uploadedCodecs).toEqual(["h264", "aac"]);
        if (encoder === "libx264") expect(uploadedPath).toBe(input);
        await expect(stat(input)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(stat(uploadedPath!)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        if (uploadedPath && uploadedPath !== input) await rm(uploadedPath, { force: true });
        await rm(input, { force: true });
        await rmdir(tempDir);
      }
    });
  }

  it.skipIf(!hasMediaTools)("should report when a download cannot be prepared as video", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "downloader-test-"));
    const input = join(tempDir, "input.mp4");
    try {
      await writeFile(input, "not a video");
      const metadata = { id: "invalid", title: "Invalid Video" };
      (command as any).ytdl = {
        getVideoInfo: mock(async () => metadata),
        downloadToFile: mock(async () => ({
          filePath: input,
          filename: "input.mp4",
          size: (await stat(input)).size,
          metadata,
          cleanup: () => unlink(input),
        })),
      };
      const sendSpy = spyOn(command as any, "sendWithTimeout").mockResolvedValue(true);
    
      await command.handleCommand(
        ["https://youtube.com/watch?v=invalid"],
        "jid@g.us", "user@s.whatsapp.net", mockSock, {} as any, {} as any,
      );

      expect(sendSpy).not.toHaveBeenCalled();
      expect(mockSock.sendMessage.mock.calls.some(([, message]: [string, { text?: string }]) =>
        message.text?.includes("Video tidak dapat disiapkan untuk WhatsApp"),
      )).toBe(true);
      await expect(stat(input)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(input, { force: true });
      await rmdir(tempDir);
    }
  });

  it("should reject files > 1GB", async () => {
    const monsterMetadata = {
        title: "Monster Video",
        duration: 300,
        filesize: 1200 * 1024 * 1024, // 1.2GB
    };

    (command as any).ytdl = {
      getVideoInfo: mock(async () => monsterMetadata),
      downloadToFile: mock(async () => ({
        filePath: "/tmp/monster.mp4",
        filename: "Monster.mp4",
        size: 1200 * 1024 * 1024,
        metadata: monsterMetadata,
        cleanup: mock(async () => {})
      }))
    };

    await command.handleCommand(
      ["https://youtube.com/watch?v=monster"],
      "jid@g.us",
      "user@s.whatsapp.net",
      mockSock,
      {} as any,
      {} as any
    );

    // Should have sent the error message
    const calls = mockSock.sendMessage.mock.calls;
    const errorCall = calls.find(c => c[1].text?.includes("File terlalu besar") && c[1].text?.includes("limit bot"));
    expect(errorCall).toBeDefined();
  });
});
