import {spawn} from 'child_process';
import {promises as fs} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {randomUUID} from 'crypto';

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

/**
 * Converts MP3 buffer to OGG buffer using FFmpeg
 * Executes: ffmpeg -i input.mp3 -avoid_negative_ts make_zero -ac 1 output.ogg
 */
export async function convertMp3ToOgg(inputBuffer: Buffer, options: ConversionOptions = {}): Promise<Buffer> {
    const {timeout = 30000, ffmpegPath = 'ffmpeg'} = options;

    // Generate unique temporary file names
    const tempDir = tmpdir();
    const sessionId = randomUUID();
    const inputPath = join(tempDir, `ffmpeg_input_${sessionId}.mp3`);
    const outputPath = join(tempDir, `ffmpeg_output_${sessionId}.ogg`);

    try {
        // Write input buffer to temporary file
        await fs.writeFile(inputPath, inputBuffer);

        // Execute FFmpeg command
        await executeFFmpeg(
            ffmpegPath,
            ['-i', inputPath, '-avoid_negative_ts', 'make_zero', '-ac', '1', outputPath],
            timeout
        );

        // Read output buffer
        return await fs.readFile(outputPath);
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
    inputBuffer: Buffer,
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
): Promise<Buffer> {
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
        await fs.writeFile(inputPath, inputBuffer);

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
        return await fs.readFile(outputPath);
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

        // Collect output
        process.stdout?.on('data', (data) => {
            _stdout += data.toString();
        });

        process.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        // Handle process completion
        process.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg process exited with code ${code}. stderr: ${stderr}`));
            }
        });

        // Handle process errors
        process.on('error', (error) => {
            reject(new Error(`Failed to start FFmpeg process: ${error.message}`));
        });

        // Handle timeout
        const timeoutId = setTimeout(() => {
            process.kill('SIGKILL');
            reject(new Error(`FFmpeg process timed out after ${timeout}ms`));
        }, timeout);

        // Clear timeout when process completes
        process.on('close', () => {
            clearTimeout(timeoutId);
        });
    });
}
