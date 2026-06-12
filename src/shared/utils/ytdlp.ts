import { spawn } from "child_process";
import { createReadStream, promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { log } from "../../infrastructure/config/config.js";

export interface YtDlpFormat {
  format_id: string;
  protocol: string;
  ext: string;
  resolution?: string;
  filesize?: number;
  filesize_approx?: number;
  [key: string]: unknown;
}

export interface YtDlpVideoInfo {
  id: string;
  title: string;
  duration?: number;
  is_live?: boolean;
  format_id?: string;
  formats?: YtDlpFormat[];
  filesize?: number;
  filesize_approx?: number;
  destination?: string;
  progress?: number;
  [key: string]: unknown;
}

export interface DownloadProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  // bytes per second
  speed: number;
  // estimated seconds remaining
  eta: number;
}

export interface YtDlpOptions {
  cookiesFile?: string;
  noMtime?: boolean;
  sortBy?: string;
  format?: string;
  audioOnly?: boolean;
  outputTemplate?: string;
  // Use aria2c external downloader for parallel connections
  useAria2c?: boolean;
  // Custom aria2c arguments
  aria2cArgs?: string;
  // Concurrent fragments for HLS/DASH
  concurrentFragments?: number;
  // Suppress progress and reduce logging overhead
  quiet?: boolean;
  // Stream output to stdout instead of file (experimental)
  streamToStdout?: boolean;
  // Progress callback
  onProgress?: (progress: DownloadProgress) => void;
  // Skip separate info fetch (assume already validated)
  skipInfoFetch?: boolean;
  // Pre-fetched video info to use for validation
  videoInfo?: YtDlpVideoInfo;
  // Proxy URL (e.g., http://proxy.example.com:8080, socks5://127.0.0.1:1080)
  proxy?: string;
  // Use system proxy
  useSystemProxy?: boolean;
  // Custom user agent
  userAgent?: string;
  // Preset alias (e.g. mp4, mp3)
  preset?: string;
}

export interface YtDlpResult {
  buffer: Buffer;
  filename: string;
  metadata?: YtDlpVideoInfo;
}

export interface YtDlpFileResult {
  filePath: string;
  filename: string;
  size: number;
  metadata?: YtDlpVideoInfo;
  cleanup: () => Promise<void>;
}

export interface YtDlpStreamResult {
  stream: Readable;
  filename: string;
  metadata?: YtDlpVideoInfo;
  // Promise that resolves when the process closes
  wait: () => Promise<void>;
  filePath: string;
  size: number;
  cleanup: () => Promise<void>;
}

/**
 * YtDlpWrapper - Optimized yt-dlp wrapper for fast video/audio downloads
 */
export class YtDlpWrapper {
  private cookiesFile: string;
  private readonly DOWNLOAD_TIMEOUT = 300000; // 5 minutes timeout
  private readonly MAX_DURATION = 3600; // 60 minutes limit (large files served via public CDN)
  private useAria2c: boolean = false; // Enable aria2c by default for speed

  constructor(cookiesFile: string = "cookies.txt", useAria2c: boolean = false) {
    this.cookiesFile = cookiesFile;
    this.useAria2c = useAria2c;
  }

  async getVideoInfo(
    url: string,
    options: YtDlpOptions = {},
  ): Promise<YtDlpVideoInfo> {
    const args = [
      "yt-dlp",
      "--dump-json",
      "--no-download",
      "--no-progress",
      "-q",
      "--cookies",
      this.cookiesFile,
      "--js-runtimes",
      "node",
    ];

    if (options.proxy) {
      args.push("--proxy", options.proxy);
    }
    if (options.userAgent) {
      args.push("--user-agent", options.userAgent);
    }

    args.push(url);

    try {
      const { stdout } = await this.executeCommandWithTimeout(args, 30000);
      return JSON.parse(stdout) as YtDlpVideoInfo;
    } catch (error) {
      throw new Error(`Failed to get video info: ${error}`);
    }
  }

  async downloadToBuffer(
    url: string,
    options: YtDlpOptions = {},
  ): Promise<YtDlpResult> {
    if (options.videoInfo) {
      const videoInfo = options.videoInfo;
      if (videoInfo.duration && videoInfo.duration > this.MAX_DURATION) {
        throw new Error(
          `Video too long: ${Math.round(videoInfo.duration / 60)} minutes (max: ${this.MAX_DURATION / 60} minutes)`,
        );
      }
      if (videoInfo.is_live) {
        throw new Error("Live streams are not supported");
      }
    }

    const tempId = randomUUID();
    const tempDir = tmpdir();
    const outputTemplate = join(tempDir, `ytdlp_${tempId}.%(ext)s`);

    const args = this.buildArgs(
      url,
      outputTemplate,
      options,
      !!options.onProgress,
    );

    if (!options.videoInfo) {
      args.splice(1, 0, "--print-json");
    }

    try {
      const { stdout } = await this.executeCommandWithTimeout(
        args,
        this.DOWNLOAD_TIMEOUT,
        options.onProgress,
      );

      const downloadedFile = await this.findDownloadedFile(tempDir, tempId);
      if (!downloadedFile) {
        throw new Error("Downloaded file not found");
      }

      const buffer = await fs.readFile(downloadedFile.path);
      await fs.unlink(downloadedFile.path).catch(() => {});

      let metadata = options.videoInfo;
      if (!metadata && stdout) {
        try {
          const lines = stdout.split("\n");
          let jsonStr = "";
          let braceCount = 0;
          let foundStart = false;

          for (const line of lines) {
            for (const char of line) {
              if (char === "{") {
                braceCount++;
                foundStart = true;
              }
              if (foundStart) {
                jsonStr += char;
              }
              if (char === "}") {
                braceCount--;
                if (braceCount === 0 && foundStart) break;
              }
            }
            if (braceCount === 0 && foundStart) break;
            if (foundStart) jsonStr += "\n";
          }

          if (jsonStr) {
            metadata = JSON.parse(jsonStr) as YtDlpVideoInfo;
            if (metadata.duration && metadata.duration > this.MAX_DURATION) {
              throw new Error(
                `Video too long: ${Math.round(metadata.duration / 60)} minutes (max: ${this.MAX_DURATION / 60} minutes)`,
              );
            }
            if (metadata.is_live) {
              throw new Error("Live streams are not supported");
            }
          }
        } catch {
          metadata = this.parseMetadata(stdout);
        }
      }

      return {
        buffer,
        filename: downloadedFile.name,
        metadata: metadata || { id: "", title: "" },
      };
    } catch (error) {
      await this.cleanupTempFiles(tempDir, tempId);
      throw new Error(`yt-dlp failed: ${error}`);
    }
  }

  async downloadAsStream(
    url: string,
    options: YtDlpOptions = {},
  ): Promise<YtDlpStreamResult> {
    const fileResult = await this.downloadToFile(url, options);
    return {
      stream: createReadStream(fileResult.filePath),
      filename: fileResult.filename,
      metadata: fileResult.metadata,
      wait: async () => {},
      filePath: fileResult.filePath,
      size: fileResult.size,
      cleanup: fileResult.cleanup,
    };
  }

  async downloadToFile(
    url: string,
    options: YtDlpOptions = {},
  ): Promise<YtDlpFileResult> {
    let metadata = options.videoInfo;
    if (!metadata && !options.skipInfoFetch) {
      metadata = await this.getVideoInfo(url, options);
    }

    if (metadata?.duration && metadata.duration > this.MAX_DURATION) {
      throw new Error(
        `Video too long: ${Math.round(metadata.duration / 60)} minutes (max: ${this.MAX_DURATION / 60} minutes)`,
      );
    }

    if (metadata?.is_live) {
      throw new Error("Live streams are not supported");
    }

    const tempId = randomUUID();
    const tempDir = tmpdir();
    const outputTemplate = join(tempDir, `ytdlp_${tempId}.%(ext)s`);

    const args = this.buildArgs(
      url,
      outputTemplate,
      options,
      !!options.onProgress,
    );

    try {
      await this.executeCommandWithTimeout(
        args,
        this.DOWNLOAD_TIMEOUT,
        options.onProgress,
      );

      const downloadedFile = await this.findDownloadedFile(tempDir, tempId);
      if (!downloadedFile) {
        throw new Error("Downloaded file not found");
      }

      const stats = await fs.stat(downloadedFile.path);
      const cleanup = () => this.cleanupTempFiles(tempDir, tempId);

      return {
        filePath: downloadedFile.path,
        filename: downloadedFile.name,
        size: stats.size,
        metadata: metadata || { id: "", title: "" },
        cleanup,
      };
    } catch (error) {
      await this.cleanupTempFiles(tempDir, tempId);
      throw new Error(`yt-dlp failed: ${error}`);
    }
  }

  async downloadVideo(url: string): Promise<YtDlpResult> {
    return this.downloadToBuffer(url, {
      noMtime: true,
      sortBy: "ext",
      cookiesFile: this.cookiesFile,
      format:
        "best[height<=1080]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/worst",
    });
  }

  async downloadAudio(
    url: string,
    format: string = "mp3",
  ): Promise<YtDlpResult> {
    return this.downloadToBuffer(url, {
      noMtime: true,
      sortBy: "ext",
      cookiesFile: this.cookiesFile,
      audioOnly: true,
      format: `bestaudio[ext=${format}]/bestaudio/best`,
    });
  }

  private buildArgs(
    url: string,
    outputTemplate: string,
    options: YtDlpOptions,
    hasProgressCallback: boolean = false,
  ): string[] {
    const args = ["yt-dlp"];

    if (!hasProgressCallback) {
      if (options.quiet !== false) args.push("--no-progress");
      if (options.quiet) args.push("-q");
    } else {
      args.push("--newline");
    }

    args.push("--no-playlist");
    if (options.noMtime !== false) args.push("--no-mtime");

    if (options.preset) {
      args.push("-t", options.preset);
    } else if (!options.audioOnly) {
      args.push("-t", "mp4");
    }

    if (options.sortBy) {
      args.push("-S", options.sortBy);
    } else {
      args.push("-S", "ext:mp4:m4a");
    }

    const cookiesFile = options.cookiesFile || this.cookiesFile;
    args.push("--cookies", cookiesFile);
    args.push("--js-runtimes", "node");

    if (options.proxy) {
      args.push("--proxy", options.proxy);
    }
    if (options.userAgent) {
      args.push("--user-agent", options.userAgent);
    }

    const concurrentFragments = options.concurrentFragments || 5;
    args.push("--concurrent-fragments", String(concurrentFragments));
    args.push("--fragment-retries", "5");

    const useAria2c =
      options.useAria2c !== undefined ? options.useAria2c : this.useAria2c;
    if (useAria2c) {
      args.push("--downloader", "aria2c");
      const aria2cArgs = options.aria2cArgs || "-x 16 -s 16 -k 1M";
      args.push("--downloader-args", `aria2c:${aria2cArgs}`);
    }

    if (options.streamToStdout) {
      args.push("-o", "-");
    } else {
      args.push("-o", outputTemplate);
    }

    if (options.format) {
      args.push("-f", options.format);
    } else if (options.audioOnly) {
      args.push("-f", "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best");
    } else {
      const videoFormats = options.streamToStdout
        ? [
            "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=1080][vcodec^=avc1]",
            "best[vcodec^=avc1][ext=mp4][protocol^=http][height<=1080]",
            "best[ext=mp4][protocol^=http][height<=1080]",
            "best[protocol^=http][height<=1080]",
            "bestvideo[vcodec^=avc1][height<=1080][ext=mp4]+bestaudio[ext=m4a]",
            "best[vcodec^=avc1][ext=mp4][height<=1080]",
            "best[height<=1080]",
            "worst",
          ]
        : [
            "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=1080][vcodec^=avc1]",
            "best[vcodec^=avc1][ext=mp4][height<=1080]",
            "bestvideo[vcodec^=avc1][height<=1080][ext=mp4]+bestaudio[ext=m4a]",
            "bestvideo[vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]",
            "best[ext=mp4][height<=1080]",
            "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]",
            "best[height<=1080]",
            "best[height<=720]",
            "worst",
          ];
      args.push("-f", videoFormats.join("/"));
    }

    if (!options.audioOnly) args.push("--merge-output-format", "mp4");

    if (options.audioOnly) {
      args.push("-x");
      args.push("--audio-format", "mp3");
    }

    args.push(url);
    return args;
  }

  private executeCommandWithTimeout(
    args: string[],
    timeoutMs: number,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const process = spawn(args[0], args.slice(1), {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          process.kill("SIGTERM");
          setTimeout(() => {
            if (!process.killed) process.kill("SIGKILL");
          }, 5000);
          reject(new Error(`Download timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      process.stdout?.on("data", (data) => {
        stdout += data.toString();
        if (onProgress) this.parseProgress(data.toString(), onProgress);
      });

      process.stderr?.on("data", (data) => {
        stderr += data.toString();
        if (onProgress) this.parseProgress(data.toString(), onProgress);
      });

      process.on("close", (code) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          if (code === 0) resolve({ stdout, stderr });
          else reject(new Error(`Process exited with code ${code}: ${stderr}`));
        }
      });

      process.on("error", (error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  private parseProgress(
    output: string,
    onProgress: (progress: DownloadProgress) => void,
  ): void {
    const lines = output.split("\n");
    for (const line of lines) {
      let progressMatch = line.match(
        /\[download]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\d+\.?\d*)\s*(KiB|MiB|GiB|KB|MB|GB|B)\s+at\s+(\d+\.?\d*)\s*(KiB|MiB|GiB|KB|MB|GB|B)\/s\s+ETA\s+(\d+):(\d+)/,
      );

      if (progressMatch) {
        const percent = parseFloat(progressMatch[1]);
        const totalSize = parseFloat(progressMatch[2]);
        const totalUnit = progressMatch[3];
        const speed = parseFloat(progressMatch[4]);
        const speedUnit = progressMatch[5];
        const etaMinutes = parseInt(progressMatch[6], 10);
        const etaSeconds = parseInt(progressMatch[7], 10);

        if (isNaN(percent) || isNaN(totalSize) || isNaN(speed)) continue;

        const totalBytes = this.convertToBytes(totalSize, totalUnit);
        const speedBytes = this.convertToBytes(speed, speedUnit);
        if (totalBytes === 0) continue;

        const downloadedBytes = (totalBytes * percent) / 100;
        const etaTotal = etaMinutes * 60 + etaSeconds;

        onProgress({
          percent,
          downloadedBytes,
          totalBytes,
          speed: speedBytes,
          eta: etaTotal,
        });
        continue;
      }

      const completionMatch = line.match(
        /\[download]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\d+\.?\d*)\s*(KiB|MiB|GiB|KB|MB|GB|B)\s+in\s+(\d+):(\d+):(\d+)\s+at\s+(\d+\.?\d*)\s*(KiB|MiB|GiB|KB|MB|GB|B)\/s/,
      );

      if (completionMatch) {
        const percent = parseFloat(completionMatch[1]);
        const totalSize = parseFloat(completionMatch[2]);
        const totalUnit = completionMatch[3];
        const speed = parseFloat(completionMatch[7]);
        const speedUnit = completionMatch[8];

        if (isNaN(percent) || isNaN(totalSize) || isNaN(speed)) continue;

        const totalBytes = this.convertToBytes(totalSize, totalUnit);
        const speedBytes = this.convertToBytes(speed, speedUnit);
        if (totalBytes === 0) continue;

        const downloadedBytes = (totalBytes * percent) / 100;

        onProgress({
          percent,
          downloadedBytes,
          totalBytes,
          speed: speedBytes,
          eta: 0,
        });
        continue;
      }

      const fallbackMatch = line.match(
        /\[download]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\d+\.?\d*)\s+at\s+(\d+\.?\d*)\s+ETA\s+(\d+):(\d+)/,
      );

      if (fallbackMatch) {
        const percent = parseFloat(fallbackMatch[1]);
        const totalSize = parseFloat(fallbackMatch[2]);
        const speed = parseFloat(fallbackMatch[3]);
        const etaMinutes = parseInt(fallbackMatch[4], 10);
        const etaSeconds = parseInt(fallbackMatch[5], 10);

        if (isNaN(percent) || isNaN(totalSize) || isNaN(speed)) continue;

        const totalBytes = this.convertToBytes(totalSize, "MiB");
        const speedBytes = this.convertToBytes(speed, "MiB");
        if (totalBytes === 0) continue;

        const downloadedBytes = (totalBytes * percent) / 100;
        const etaTotal = etaMinutes * 60 + etaSeconds;

        onProgress({
          percent,
          downloadedBytes,
          totalBytes,
          speed: speedBytes,
          eta: etaTotal,
        });
      }
    }
  }

  private convertToBytes(value: number, unit: string): number {
    if (isNaN(value) || value < 0) return 0;
    const units: { [key: string]: number } = {
      B: 1,
      KiB: 1024,
      MiB: 1024 * 1024,
      GiB: 1024 * 1024 * 1024,
      KB: 1000,
      MB: 1000 * 1000,
      GB: 1000 * 1000 * 1000,
    };
    return value * (units[unit] || units["MiB"]);
  }

  private async cleanupTempFiles(
    tempDir: string,
    tempId: string,
  ): Promise<void> {
    try {
      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter((file) =>
        file.includes(`ytdlp_${tempId}`),
      );
      await Promise.all(
        tempFiles.map((file) => fs.unlink(join(tempDir, file)).catch(() => {})),
      );
    } catch {
      /* ignore */
    }
  }

  private async findDownloadedFile(
    tempDir: string,
    tempId: string,
  ): Promise<{ path: string; name: string } | null> {
    try {
      const files = await fs.readdir(tempDir);
      const downloadedFile = files.find((file) =>
        file.includes(`ytdlp_${tempId}`),
      );
      if (downloadedFile) {
        return {
          path: join(tempDir, downloadedFile),
          name: downloadedFile.replace(`ytdlp_${tempId}.`, ""),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private parseMetadata(stdout: string): YtDlpVideoInfo {
    try {
      const lines = stdout.split("\n");
      const metadata: Partial<YtDlpVideoInfo> = {};
      lines.forEach((line) => {
        if (line.includes("[download]") && line.includes("Destination:")) {
          metadata.destination = line.split("Destination: ")[1];
        }
        if (line.includes("[download]") && line.includes("%")) {
          const match = line.match(/(\d+\.?\d*)%/);
          if (match) metadata.progress = parseFloat(match[1]);
        }
      });
      return metadata as YtDlpVideoInfo;
    } catch {
      return { id: "", title: "" };
    }
  }
}
