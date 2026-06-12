import { describe, expect, it, mock, spyOn } from "bun:test";
import { YtDlpWrapper } from "../src/shared/utils/ytdlp.js";
import { Readable } from "stream";
import * as child_process from "child_process";
import * as fsModule from "fs";

describe("YtDlpWrapper", () => {
  it("should stream video from yt-dlp", async () => {
    const wrapper = new YtDlpWrapper();
    
    // Mock getVideoInfo to skip real network call
    spyOn(wrapper, "getVideoInfo").mockResolvedValue({ 
        title: "Test Video", 
        duration: 100, 
        is_live: false 
    });

    // Mock findDownloadedFile to return a fake file path
    spyOn(wrapper as any, "findDownloadedFile").mockResolvedValue({
        path: "fake-file-path",
        name: "Test Video.mp4"
    });

    // Mock fs.promises.stat and fs.promises.unlink
    spyOn(fsModule.promises, "stat").mockResolvedValue({ size: 1000 } as any);
    spyOn(fsModule.promises, "unlink").mockResolvedValue(undefined);

    // Mock createReadStream
    spyOn(fsModule, "createReadStream").mockImplementation(() => {
        return new Readable({
            read() {
                this.push("fake video data");
                this.push(null);
            }
        }) as any;
    });

    // We need to spy on spawn
    const spawnSpy = spyOn(child_process, "spawn").mockImplementation(() => {
        const stdout = new Readable({
            read() {
                this.push("fake video data");
                this.push(null); // End stream
            }
        });
        const stderr = new Readable({ read() { this.push(null); } });
        
        const mockProcess = {
            stdout,
            stderr,
            on: mock((event: string, cb: Function) => {
                if (event === "close" || event === "exit") {
                    setTimeout(() => cb(0), 10);
                }
            }),
            kill: mock(() => {}),
        };
        return mockProcess as any;
    });

    const result = await wrapper.downloadAsStream("https://youtube.com/watch?v=123");
    
    expect(result.filename).toBe("Test Video.mp4");
    expect(result.metadata.title).toBe("Test Video");
    expect(result.stream).toBeInstanceOf(Readable);
    
    // Check if spawn was called with correct args
    expect(spawnSpy).toHaveBeenCalled();
    const args = spawnSpy.mock.calls[0][1];
    expect(args).toContain("-o");
  });

  it("should pass preset options (like -t mp4) to yt-dlp", async () => {
    const wrapper = new YtDlpWrapper();
    
    spyOn(wrapper, "getVideoInfo").mockResolvedValue({ 
        title: "Preset Test Video", 
        duration: 100, 
        is_live: false 
    });

    spyOn(wrapper as any, "findDownloadedFile").mockResolvedValue({
        path: "fake-file-path",
        name: "Test Video.mp4"
    });

    spyOn(fsModule.promises, "stat").mockResolvedValue({ size: 1000 } as any);
    spyOn(fsModule.promises, "unlink").mockResolvedValue(undefined);

    // Mock createReadStream
    spyOn(fsModule, "createReadStream").mockImplementation(() => {
        return new Readable({
            read() {
                this.push("fake video data");
                this.push(null);
            }
        }) as any;
    });

    const spawnSpy = spyOn(child_process, "spawn").mockImplementation(() => {
        const stdout = new Readable({
            read() {
                this.push("fake video data");
                this.push(null);
            }
        });
        const stderr = new Readable({ read() { this.push(null); } });
        
        const mockProcess = {
            stdout,
            stderr,
            on: mock((event: string, cb: Function) => {
                if (event === "close" || event === "exit") {
                    setTimeout(() => cb(0), 10);
                }
            }),
            kill: mock(() => {}),
        };
        return mockProcess as any;
    });

    await wrapper.downloadAsStream("https://youtube.com/watch?v=123", { preset: "mp4" });
    
    expect(spawnSpy).toHaveBeenCalled();
    const args = spawnSpy.mock.calls[0][1];
    expect(args).toContain("-t");
    expect(args).toContain("mp4");
  });

  it("should throw error for videos longer than 60 minutes", async () => {
    const wrapper = new YtDlpWrapper();
    
    // Spy on getVideoInfo to return long duration (> 3600 seconds)
    spyOn(wrapper, "getVideoInfo").mockResolvedValue({
        title: "Long Video",
        duration: 3700, // > 3600s
        is_live: false
    });

    await expect(wrapper.downloadAsStream("https://youtube.com/watch?v=123")).rejects.toThrow("Video too long");
  });
});
