import { describe, expect, it, mock, spyOn, beforeEach } from "bun:test";
import { DownloaderCommand } from "../src/app/commands/DownloaderCommand.js";
import { Readable } from "stream";

describe("DownloaderCommand", () => {
  let command: DownloaderCommand;
  let mockSock: any;

  beforeEach(() => {
    command = new DownloaderCommand();
    mockSock = {
      sendMessage: mock(async () => ({ key: { id: "msg-123" } })),
    };
  });

  it("should switch to document mode for files > 100MB", async () => {
    const largeMetadata = {
      title: "Huge Movie",
      duration: 300,
      filesize: 150 * 1024 * 1024, // 150MB
    };

    const mockStream = new Readable({ read() { this.push(null); } });

    // Mock ytdl methods
    (command as any).ytdl = {
      getVideoInfo: mock(async () => largeMetadata),
      downloadAsStream: mock(async () => ({
        stream: mockStream,
        metadata: largeMetadata,
        filename: "Huge Movie.mp4",
        wait: async () => {}
      }))
    };

    // Spy on sendWithTimeout to check if it's called with document
    const sendSpy = spyOn(command as any, "sendWithTimeout").mockResolvedValue(undefined);

    await command.handleCommand(
      ["https://youtube.com/watch?v=large"],
      "jid@g.us",
      "user@s.whatsapp.net",
      mockSock,
      {} as any,
      {} as any
    );

    // Should have sent the informational message
    const calls = mockSock.sendMessage.mock.calls;
    const infoCall = calls.find(c => c[1].text?.includes("melebihi batas media WA"));
    expect(infoCall).toBeDefined();

    // Should have called sendWithTimeout with document instead of video
    expect(sendSpy).toHaveBeenCalled();
    const sendArgs = sendSpy.mock.calls[0][2];
    expect(sendArgs.document).toBeDefined();
    expect(sendArgs.video).toBeUndefined();
  });

  it("should reject files > 1GB", async () => {
    const monsterMetadata = {
        title: "Monster Video",
        duration: 300,
        filesize: 1200 * 1024 * 1024, // 1.2GB
    };

    const mockStream = new Readable({ 
        read() { this.push(null); }
    });
    mockStream.destroy = mock(() => (mockStream as any));
    
    (command as any).ytdl = {
      getVideoInfo: mock(async () => monsterMetadata),
      downloadAsStream: mock(async () => ({
        stream: mockStream,
        metadata: monsterMetadata,
        filename: "Monster.mp4",
        wait: async () => {}
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
    
    // Should have destroyed the stream
    expect(mockStream.destroy).toHaveBeenCalled();
  });
});
