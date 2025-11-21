import {spawn} from 'child_process';
import {promises as fs} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {randomUUID} from 'crypto';

interface YtDlpOptions {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    videoInfo?: any;
    // Proxy URL (e.g., http://proxy.example.com:8080, socks5://127.0.0.1:1080)
    proxy?: string;
    // Use system proxy
    useSystemProxy?: boolean;
}

interface YtDlpResult {
    buffer: Buffer;
    filename: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
}

interface DownloadProgress {
    percent: number;
    downloadedBytes: number;
    totalBytes: number;
    // bytes per second
    speed: number;
    // estimated seconds remaining
    eta: number;
}

/**
 * YtDlpWrapper - Optimized yt-dlp wrapper for fast video/audio downloads
 *
 * Speed Optimizations:
 * 1. aria2c external downloader: Parallel connections (-x 16 -s 16 -k 1M) for faster downloads
 * 2. Concurrent fragments: Downloads HLS/DASH segments in parallel (--concurrent-fragments 5)
 * 3. Pre-muxed formats: Prefers mp4/m4a to avoid ffmpeg remuxing overhead
 * 4. Reduced logging: --no-progress and -q flags to minimize I/O overhead
 * 5. Fragment retries: --fragment-retries 5 for robustness
 * 6. Smart format selection: Prioritizes already-muxed formats over separate video+audio
 *
 * Requirements:
 * - aria2c must be installed on the system for external downloader support
 * - yt-dlp must be installed and accessible in PATH
 */
export class YtDlpWrapper {
    private cookiesFile: string;
    private readonly DOWNLOAD_TIMEOUT = 300000; // 5 minutes timeout// 100MB limit
    private readonly MAX_DURATION = 600; // 10 minutes limit
    private useAria2c: boolean = false; // Enable aria2c by default for speed

    constructor(cookiesFile: string = 'cookies.txt', useAria2c: boolean = false) {
        this.cookiesFile = cookiesFile;
        this.useAria2c = useAria2c;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async getVideoInfo(url: string, options: YtDlpOptions = {}): Promise<any> {
        const args = [
            'yt-dlp',
            '--dump-json',
            '--no-download',
            '--no-progress',
            '-q',
            '--cookies',
            this.cookiesFile,
            '--js-runtimes',
            'node',
        ];

        // Add proxy if specified
        if (options.proxy) {
            args.push('--proxy', options.proxy);
        }

        args.push(url);

        try {
            const {stdout} = await this.executeCommandWithTimeout(args, 30000); // 30s timeout for info
            return JSON.parse(stdout);
        } catch (error) {
            throw new Error(`Failed to get video info: ${error}`);
        }
    }

    /**
     * Download video or audio to buffer with optimized performance.
     *
     * Performance Optimization:
     * - Uses --print-json flag to fetch metadata DURING download (single yt-dlp process!)
     * - If videoInfo is provided, uses it for pre-validation and skips --print-json
     * - This eliminates redundant yt-dlp execution, significantly improving performance
     *
     * @param url - Video URL to download
     * @param options - Download options including optional pre-fetched videoInfo
     * @returns Promise with buffer, filename and metadata
     */
    async downloadToBuffer(url: string, options: YtDlpOptions = {}): Promise<YtDlpResult> {
        // If pre-fetched info is provided, validate it upfront
        if (options.videoInfo) {
            const videoInfo = options.videoInfo;

            // Check duration limit
            if (videoInfo.duration && videoInfo.duration > this.MAX_DURATION) {
                throw new Error(
                    `Video too long: ${Math.round(videoInfo.duration / 60)} minutes (max: ${this.MAX_DURATION / 60} minutes)`
                );
            }

            // Check if it's a live stream
            if (videoInfo.is_live) {
                throw new Error('Live streams are not supported');
            }
        }

        // Generate temporary filename
        const tempId = randomUUID();
        const tempDir = tmpdir();
        const outputTemplate = join(tempDir, `ytdlp_${tempId}.%(ext)s`);

        // Build command arguments
        const args = this.buildArgs(url, outputTemplate, options, !!options.onProgress);

        // Add --print-json to get metadata during download (single process optimization!)
        // Only add if videoInfo is not provided
        if (!options.videoInfo) {
            // Insert after 'yt-dlp' command
            args.splice(1, 0, '--print-json');
        }

        try {
            // Execute yt-dlp command with timeout
            const {stdout} = await this.executeCommandWithTimeout(args, this.DOWNLOAD_TIMEOUT, options.onProgress);

            // Find the downloaded file
            const downloadedFile = await this.findDownloadedFile(tempDir, tempId);

            if (!downloadedFile) {
                throw new Error('Downloaded file not found');
            }

            // Read file into buffer
            const buffer = await fs.readFile(downloadedFile.path);

            // Clean up temporary file
            await fs.unlink(downloadedFile.path).catch(() => {
            });

            // Parse metadata from stdout if not provided
            let metadata = options.videoInfo;
            if (!metadata && stdout) {
                try {
                    // --print-json outputs JSON before download starts
                    // Look for the first complete JSON object in stdout
                    const lines = stdout.split('\n');
                    let jsonStr = '';
                    let braceCount = 0;
                    let foundStart = false;

                    for (const line of lines) {
                        for (const char of line) {
                            if (char === '{') {
                                braceCount++;
                                foundStart = true;
                            }
                            if (foundStart) {
                                jsonStr += char;
                            }
                            if (char === '}') {
                                braceCount--;
                                if (braceCount === 0 && foundStart) {
                                    // Found complete JSON object
                                    break;
                                }
                            }
                        }
                        if (braceCount === 0 && foundStart) {
                            break;
                        }
                        if (foundStart) {
                            jsonStr += '\n';
                        }
                    }

                    if (jsonStr) {
                        metadata = JSON.parse(jsonStr);

                        // Validate after download (in case validation is needed)
                        if (metadata.duration && metadata.duration > this.MAX_DURATION) {
                            throw new Error(
                                `Video too long: ${Math.round(metadata.duration / 60)} minutes (max: ${this.MAX_DURATION / 60} minutes)`
                            );
                        }

                        if (metadata.is_live) {
                            throw new Error('Live streams are not supported');
                        }
                    }
                } catch (_parseError) {
                    // Fallback to basic metadata if JSON parsing fails
                    metadata = this.parseMetadata(stdout);
                }
            }

            return {
                buffer,
                filename: downloadedFile.name,
                metadata: metadata || {},
            };
        } catch (error) {
            // Clean up any partial downloads
            await this.cleanupTempFiles(tempDir, tempId);
            throw new Error(`yt-dlp failed: ${error}`);
        }
    }

    // Convenience method for your specific command
    async downloadVideo(url: string): Promise<YtDlpResult> {
        return this.downloadToBuffer(url, {
            noMtime: true,
            sortBy: 'ext',
            cookiesFile: this.cookiesFile,
            format: 'best[height<=1080]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/worst',
        });
    }

    // Convenience method for downloading audio only
    async downloadAudio(url: string, format: string = 'mp3'): Promise<YtDlpResult> {
        return this.downloadToBuffer(url, {
            noMtime: true,
            sortBy: 'ext',
            cookiesFile: this.cookiesFile,
            audioOnly: true,
            format: `bestaudio[ext=${format}]/bestaudio/best`,
        });
    }

    private buildArgs(
        url: string,
        outputTemplate: string,
        options: YtDlpOptions,
        hasProgressCallback: boolean = false
    ): string[] {
        const args = ['yt-dlp'];

        // Performance: Reduce logging overhead
        // Don't suppress progress if callback is provided
        if (!hasProgressCallback) {
            if (options.quiet !== false) {
                args.push('--no-progress');
            }
            if (options.quiet) {
                args.push('-q');
            }
        } else {
            // Force newline output for progress parsing
            args.push('--newline');
        }

        args.push('--no-playlist');

        // Add no-mtime flag
        if (options.noMtime !== false) {
            args.push('--no-mtime');
        }

        // Add sort parameter - prefer pre-muxed formats to avoid ffmpeg remuxing
        if (options.sortBy) {
            args.push('-S', options.sortBy);
        } else {
            args.push('-S', 'ext:mp4:m4a');
        }

        // Add cookies file
        const cookiesFile = options.cookiesFile || this.cookiesFile;
        args.push('--cookies', cookiesFile);

        args.push('--js-runtimes', 'node');

        // Add proxy if specified
        if (options.proxy) {
            args.push('--proxy', options.proxy);
        }

        // Performance: Enable concurrent fragments for HLS/DASH streams
        const concurrentFragments = options.concurrentFragments || 5;
        args.push('--concurrent-fragments', String(concurrentFragments));

        // Performance: Fragment retries for robustness
        args.push('--fragment-retries', '5');

        // Performance: Use aria2c external downloader for parallel connections
        const useAria2c = options.useAria2c !== undefined ? options.useAria2c : this.useAria2c;
        if (useAria2c) {
            args.push('--downloader', 'aria2c');
            const aria2cArgs = options.aria2cArgs || '-x 16 -s 16 -k 1M';
            args.push('--downloader-args', `aria2c:${aria2cArgs}`);
        }

        // Add output template or stream to stdout
        if (options.streamToStdout) {
            args.push('-o', '-');
        } else {
            args.push('-o', outputTemplate);
        }

        // Enhanced format selection - prefer pre-muxed formats to avoid ffmpeg merging
        if (options.format) {
            args.push('-f', options.format);
        } else if (options.audioOnly) {
            // Priority: m4a > mp3 > any audio (m4a is pre-muxed)
            args.push('-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best');
        } else {
            // Prefer pre-muxed mp4 formats to avoid ffmpeg remuxing overhead
            const videoFormats = [
                'best[ext=mp4][height<=1080]',
                'best[ext=mp4][height<=720]',
                'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]',
                'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]',
                'best[height<=1080]',
                'best[height<=720]',
                'worst',
            ];
            args.push('-f', videoFormats.join('/'));
        }

        // Audio processing for video downloads
        if (!options.audioOnly) {
            args.push('--merge-output-format', 'mp4');
        }

        // Audio only option
        if (options.audioOnly) {
            args.push('-x');
            args.push('--audio-format', 'mp3');
        }

        // Add URL
        args.push(url);

        return args;
    }

    private executeCommandWithTimeout(
        args: string[],
        timeoutMs: number,
        onProgress?: (progress: DownloadProgress) => void
    ): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const process = spawn(args[0], args.slice(1), {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';
            let isResolved = false;

            // Set up timeout
            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    process.kill('SIGTERM');

                    // Force kill if SIGTERM doesn't work
                    setTimeout(() => {
                        if (!process.killed) {
                            process.kill('SIGKILL');
                        }
                    }, 5000);

                    reject(new Error(`Download timeout after ${timeoutMs}ms`));
                }
            }, timeoutMs);

            process.stdout?.on('data', (data) => {
                stdout += data.toString();
                // Parse progress from stdout if callback provided
                if (onProgress) {
                    this.parseProgress(data.toString(), onProgress);
                }
            });

            process.stderr?.on('data', (data) => {
                stderr += data.toString();
                // yt-dlp outputs progress to stderr
                if (onProgress) {
                    this.parseProgress(data.toString(), onProgress);
                }
            });

            process.on('close', (code) => {
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timeout);

                    if (code === 0) {
                        resolve({stdout, stderr});
                    } else {
                        reject(new Error(`Process exited with code ${code}: ${stderr}`));
                    }
                }
            });

            process.on('error', (error) => {
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        });
    }

    private parseProgress(output: string, onProgress: (progress: DownloadProgress) => void): void {
        // yt-dlp progress format variations:
        // [download]   0.0% of   17.70MiB at  107.11KiB/s ETA 02:49
        // [download]  45.2% of  123.45MiB at  1.23MiB/s ETA 00:45
        // [download] 100.0% of   17.70MiB at    1.09MiB/s ETA 00:00
        // [download] 100% of   17.70MiB in 00:00:17 at 1.03MiB/s (completion format)
        console.log(output);

        // Process each line separately (output may contain multiple lines)
        const lines = output.split('\n');

        for (const line of lines) {
            // Pattern 1: Standard progress with ETA
            // [download]   0.0% of   17.70MiB at  107.11KiB/s ETA 02:49
            let progressMatch = line.match(
                /\[download]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\d+\.?\d*)\s*(KiB|MiB|GiB|KB|MB|GB|B)\s+at\s+(\d+\.?\d*)\s*(KiB|MiB|GiB|KB|MB|GB|B)\/s\s+ETA\s+(\d+):(\d+)/
            );

            if (progressMatch) {
                const percent = parseFloat(progressMatch[1]);
                const totalSize = parseFloat(progressMatch[2]);
                const totalUnit = progressMatch[3];
                const speed = parseFloat(progressMatch[4]);
                const speedUnit = progressMatch[5];
                const etaMinutes = parseInt(progressMatch[6], 10);
                const etaSeconds = parseInt(progressMatch[7], 10);

                // Validate parsed values
                if (isNaN(percent) || isNaN(totalSize) || isNaN(speed)) {
                    continue;
                }

                // Convert to bytes
                const totalBytes = this.convertToBytes(totalSize, totalUnit);
                const speedBytes = this.convertToBytes(speed, speedUnit);

                // Prevent division by zero or invalid calculations
                if (totalBytes === 0) {
                    continue;
                }

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

            // Pattern 2: Completion format
            // [download] 100% of   17.70MiB in 00:00:17 at 1.03MiB/s
            const completionMatch = line.match(
                /\[download]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\d+\.?\d*)\s*(KiB|MiB|GiB|KB|MB|GB|B)\s+in\s+(\d+):(\d+):(\d+)\s+at\s+(\d+\.?\d*)\s*(KiB|MiB|GiB|KB|MB|GB|B)\/s/
            );

            if (completionMatch) {
                const percent = parseFloat(completionMatch[1]);
                const totalSize = parseFloat(completionMatch[2]);
                const totalUnit = completionMatch[3];
                const speed = parseFloat(completionMatch[7]);
                const speedUnit = completionMatch[8];

                // Validate parsed values
                if (isNaN(percent) || isNaN(totalSize) || isNaN(speed)) {
                    continue;
                }

                // Convert to bytes
                const totalBytes = this.convertToBytes(totalSize, totalUnit);
                const speedBytes = this.convertToBytes(speed, speedUnit);

                if (totalBytes === 0) {
                    continue;
                }

                const downloadedBytes = (totalBytes * percent) / 100;

                onProgress({
                    percent,
                    downloadedBytes,
                    totalBytes,
                    speed: speedBytes,
                    eta: 0, // Completion has no ETA
                });
                continue;
            }

            // Pattern 3: Fallback for formats without explicit units (assumes MiB default)
            const fallbackMatch = line.match(
                /\[download]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\d+\.?\d*)\s+at\s+(\d+\.?\d*)\s+ETA\s+(\d+):(\d+)/
            );

            if (fallbackMatch) {
                const percent = parseFloat(fallbackMatch[1]);
                const totalSize = parseFloat(fallbackMatch[2]);
                const speed = parseFloat(fallbackMatch[3]);
                const etaMinutes = parseInt(fallbackMatch[4], 10);
                const etaSeconds = parseInt(fallbackMatch[5], 10);

                // Validate parsed values
                if (isNaN(percent) || isNaN(totalSize) || isNaN(speed)) {
                    continue;
                }

                // Use default MiB units
                const totalBytes = this.convertToBytes(totalSize, 'MiB');
                const speedBytes = this.convertToBytes(speed, 'MiB');

                if (totalBytes === 0) {
                    continue;
                }

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
        // Validate input
        if (isNaN(value) || value < 0) {
            return 0;
        }

        const units: { [key: string]: number } = {
            B: 1,
            KiB: 1024,
            MiB: 1024 * 1024,
            GiB: 1024 * 1024 * 1024,
            KB: 1000,
            MB: 1000 * 1000,
            GB: 1000 * 1000 * 1000,
        };

        // Return bytes value, default to MiB if unit is unknown
        const multiplier = units[unit] || units['MiB'];
        return value * multiplier;
    }

    private async cleanupTempFiles(tempDir: string, tempId: string): Promise<void> {
        try {
            const files = await fs.readdir(tempDir);
            const tempFiles = files.filter((file) => file.includes(`ytdlp_${tempId}`));

            await Promise.all(tempFiles.map((file) => fs.unlink(join(tempDir, file)).catch(() => {
            })));
        } catch (_error) {
            // Ignore cleanup errors
        }
    }

    private async findDownloadedFile(tempDir: string, tempId: string): Promise<{ path: string; name: string } | null> {
        try {
            const files = await fs.readdir(tempDir);
            const downloadedFile = files.find((file) => file.includes(`ytdlp_${tempId}`));

            if (downloadedFile) {
                return {
                    path: join(tempDir, downloadedFile),
                    name: downloadedFile.replace(`ytdlp_${tempId}.`, ''),
                };
            }

            return null;
        } catch (_error) {
            return null;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private parseMetadata(stdout: string): any {
        // Basic metadata parsing from stdout
        // You can enhance this based on yt-dlp's JSON output format
        try {
            const lines = stdout.split('\n');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const metadata: any = {};

            lines.forEach((line) => {
                if (line.includes('[download]') && line.includes('Destination:')) {
                    metadata.destination = line.split('Destination: ')[1];
                }
                if (line.includes('[download]') && line.includes('%')) {
                    const match = line.match(/(\d+\.?\d*)%/);
                    if (match) {
                        metadata.progress = parseFloat(match[1]);
                    }
                }
            });

            return metadata;
        } catch {
            return {};
        }
    }
}

// Usage example
// export async function downloadYouTubeVideo(url: string): Promise<Buffer> {
//   const wrapper = new YtDlpWrapper('cookies.txt');
//   const result = await wrapper.downloadVideo(url);
//   return result.buffer;
// }

// Usage example for audio
// export async function downloadYouTubeAudio(url: string, format: string = 'mp3'): Promise<Buffer> {
//   const wrapper = new YtDlpWrapper('cookies.txt');
//   const result = await wrapper.downloadAudio(url, format);
//   return result.buffer;
// }
