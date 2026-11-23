import {execFile, spawn} from 'child_process';
import {promises as fs} from 'fs';
import {tmpdir} from 'os';
import {extname, join} from 'path';
import {randomUUID} from 'crypto';
import {promisify} from 'util';

const execFileAsync = promisify(execFile);

interface ConversionOptions {
    /**
     * Timeout in milliseconds (default: 30000)
     */
    timeout?: number;
    /**
     * FFmpeg binary path (default: 'ffmpeg')
     */
    ffmpegPath?: string;
}

interface VideoProbe {
    format: { format_name: string };
    streams: {
        codec_type: string;
        codec_name: string;
        profile?: string;
        pix_fmt?: string;
        has_b_frames?: number;
    }[];
}

export async function prepareWhatsAppVideo(inputPath: string): Promise<{
    filePath: string;
    size: number;
    cleanup: () => Promise<void>;
} | undefined> {
    const {stdout} = await execFileAsync('ffprobe', [
        '-v', 'error', '-show_entries',
        'format=format_name:stream=codec_type,codec_name,profile,pix_fmt,has_b_frames',
        '-of', 'json', inputPath,
    ], {timeout: 30_000});
    const {format, streams} = JSON.parse(stdout) as VideoProbe;
    const videos = streams.filter(stream => stream.codec_type === 'video');
    const audio = streams.filter(stream => stream.codec_type === 'audio');
    const [video] = videos;
    if (!video) throw new Error('Downloaded file contains no video stream');

    const compatibleProfile = ['Baseline', 'Constrained Baseline', 'Main'].includes(video.profile ?? '') ||
        (video.profile === 'High' && video.has_b_frames === 0);
    if (extname(inputPath).toLowerCase() === '.mp4' && format.format_name.split(',').includes('mp4') &&
        videos.length === 1 && video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && compatibleProfile &&
        audio.length <= 1 && audio.every(stream => stream.codec_name === 'aac')) {
        return;
    }

    const filePath = join(tmpdir(), `whatsapp_video_${randomUUID()}.mp4`);
    const cleanup = () => fs.unlink(filePath).catch(() => {});
    try {
        await executeFFmpeg('ffmpeg', [
            '-v', 'error', '-nostdin', '-xerror', '-i', inputPath,
            '-map', '0:V:0', '-map', '0:a:0?',
            '-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2',
            '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
            '-c:a', 'aac', '-profile:a', 'aac_low', '-ac', '2', '-movflags', '+faststart', filePath,
        ], 300_000);
        const {size} = await fs.stat(filePath);
        return {filePath, size, cleanup};
    } catch (error) {
        await cleanup();
        throw error;
    }
}

/**
 * Converts MP3 buffer to OGG buffer using FFmpeg
 * Executes: ffmpeg -i input.mp3 -avoid_negative_ts make_zero -ac 1 output.ogg
 */
export async function convertMp3ToOgg(inputBuffer: Uint8Array, options: ConversionOptions = {}): Promise<Uint8Array> {
    const {timeout = 30000, ffmpegPath = 'ffmpeg'} = options;

    // Generate unique temporary file names
    const tempDir = tmpdir();
    const sessionId = randomUUID();
    const inputPath = join(tempDir, `ffmpeg_input_${sessionId}.mp3`);
    const outputPath = join(tempDir, `ffmpeg_output_${sessionId}.ogg`);

    try {
        // Write input buffer to temporary file
        await fs.writeFile(inputPath, Buffer.from(inputBuffer));

        // Execute FFmpeg command
        await executeFFmpeg(
            ffmpegPath,
            ['-i', inputPath, '-avoid_negative_ts', 'make_zero', '-ac', '1', outputPath],
            timeout
        );

        // Read output buffer
        const result = await fs.readFile(outputPath);
        return new Uint8Array(result);
    } finally {
        // Clean up temporary files
        await Promise.allSettled([fs.unlink(inputPath).catch(() => {
        }), fs.unlink(outputPath).catch(() => {
        })]);
    }
}

/**
 * Converts video buffer to audio buffer using FFmpeg
 * Executes: ffmpeg -i input.mp4 -vn -ar 44100 -ac 2 -b:a 192k output.mp3
 */
export async function convertVideoToAudio(
    inputBuffer: Uint8Array,
    options: ConversionOptions & {
        /**
         * Output format: mp3, ogg, wav, m4a (default: mp3)
         */
        format?: 'mp3' | 'ogg' | 'wav' | 'm4a';
        /**
         * Audio bitrate (default: 192k)
         */
        bitrate?: string;
    } = {}
): Promise<Uint8Array> {
    const {
        timeout = 60000, // Longer timeout for video processing
        ffmpegPath = 'ffmpeg',
        format = 'mp3',
        bitrate = '192k',
    } = options;

    // Generate unique temporary file names
    const tempDir = tmpdir();
    const sessionId = randomUUID();
    const inputPath = join(tempDir, `ffmpeg_video_input_${sessionId}.mp4`);
    const outputPath = join(tempDir, `ffmpeg_audio_output_${sessionId}.${format}`);

    try {
        // Write input buffer to temporary file
        await fs.writeFile(inputPath, Buffer.from(inputBuffer));

        // Build FFmpeg arguments for audio extraction
        const args = [
            '-i',
            inputPath,
            '-vn', // No video
            '-ar',
            '44100', // Sample rate
            '-ac',
            '2', // Stereo
            '-b:a',
            bitrate, // Audio bitrate
        ];

        // Add format-specific options
        if (format === 'ogg') {
            args.push('-c:a', 'libopus');
        } else if (format === 'm4a') {
            args.push('-c:a', 'aac');
        }

        args.push(outputPath);

        // Execute FFmpeg command
        await executeFFmpeg(ffmpegPath, args, timeout);

        // Read output buffer
        const result = await fs.readFile(outputPath);
        return new Uint8Array(result);
    } finally {
        // Clean up temporary files
        await Promise.allSettled([fs.unlink(inputPath).catch(() => {
        }), fs.unlink(outputPath).catch(() => {
        })]);
    }
}

/**
 * Execute FFmpeg with given arguments
 */
function executeFFmpeg(ffmpegPath: string, args: string[], timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const process = spawn(ffmpegPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let _stdout = '';
        let stderr = '';
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            process.kill('SIGKILL');
        }, timeout);

        // Collect output
        process.stdout?.on('data', (data) => {
            _stdout += data.toString();
        });

        process.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        // Handle process completion
        process.on('close', (code) => {
            clearTimeout(timeoutId);
            if (timedOut) {
                reject(new Error(`FFmpeg process timed out after ${timeout}ms`));
            } else if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg process exited with code ${code}. stderr: ${stderr}`));
            }
        });

        // Handle process errors
        process.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(new Error(`Failed to start FFmpeg process: ${error.message}`));
        });
    });
}
