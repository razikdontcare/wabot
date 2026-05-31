import { describe, expect, it, mock, spyOn, beforeEach } from "bun:test";
import { DownloaderCommand } from "../src/app/commands/DownloaderCommand.js";

describe("DownloaderCommand", () => {
  let command: DownloaderCommand;
  let mockSock: any;

  beforeEach(() => {
    command = new DownloaderCommand();
    mockSock = {
      sendMessage: mock(async () => ({ key: { id: "msg-123" } })),
    };
  });

  it("should use file-based download for normal files", async () => {
    const metadata = {
      title: "Test Video",
      duration: 300,
      filesize: 50 * 1024 * 1024, // 50MB
    };

    // Mock ytdl methods
    (command as any).ytdl = {
      getVideoInfo: mock(async () => metadata),
      downloadToFile: mock(async () => ({
        filePath: "/tmp/test.mp4",
        filename: "test-video.mp4",
        size: 50 * 1024 * 1024,
        metadata: metadata,
        cleanup: mock(async () => {})
      }))
    };

    // Mock sendWithTimeout
    const sendSpy = spyOn(command as any, "sendWithTimeout").mockResolvedValue(true);

    await command.handleCommand(
      ["https://youtube.com/watch?v=test"],
      "jid@g.us",
      "user@s.whatsapp.net",
      mockSock,
      {} as any,
      {} as any
    );

    // Should have called sendWithTimeout for the download
    expect(sendSpy).toHaveBeenCalled();
    
    // Should have called downloadToFile
    expect((command as any).ytdl.downloadToFile).toHaveBeenCalled();
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
