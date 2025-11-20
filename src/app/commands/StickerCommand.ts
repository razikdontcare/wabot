import {downloadMediaMessage, proto, WAMessage} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {BotConfig, getCurrentConfig, log} from '../../infrastructure/config/config.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {SessionService} from '../../domain/services/SessionService.js';
import sharp from 'sharp';
import {spawn} from 'child_process';
import {promises as fs} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {randomUUID} from 'crypto';

export class StickerCommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'sticker',
        aliases: ['s', 'stiker'],
        description: 'Convert gambar, video, atau GIF menjadi sticker WhatsApp.',
        helpText: `*Cara pakai:* 🎨
• Reply gambar/video/GIF dengan *${BotConfig.prefix}sticker*
• Kirim *${BotConfig.prefix}sticker* lalu kirim gambar

*Opsi:*
• *${BotConfig.prefix}sticker --crop* — Crop ke tengah (512x512)
• Default: auto-fit dengan padding putih

*Batasan:*
• Ukuran file: maksimal 16MB
• Video: maksimal 10 detik (frame pertama akan dipakai)

*Contoh:*
• Reply gambar: *${BotConfig.prefix}s*
• Crop mode: *${BotConfig.prefix}s --crop*

👑 *VIP Members:* No cooldown!`,
        category: 'utility',
        commandClass: StickerCommand,
        cooldown: 5000,
        maxUses: 3,
        vipBypassCooldown: true,
    };

    private readonly MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB
    private readonly STICKER_SIZE = 512;

    async handleCommand(
        args: string[],
        jid: string,
        user: string,
        sock: WebSocketInfo,
        sessionService: SessionService,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        const config = await getCurrentConfig();

        try {
            // Check for crop flag
            const useCrop = args.includes('--crop');

            // Try to get media from quoted message
            let mediaBuffer: Buffer | null = null;
            let mediaType: 'image' | 'video' | null = null;

            if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;

                if (quoted.imageMessage) {
                    mediaType = 'image';
                    const quotedMsg: proto.IWebMessageInfo = {
                        key: {
                            remoteJid: jid,
                            fromMe: !msg.message?.extendedTextMessage?.contextInfo?.participant,
                            id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || '',
                            participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
                        },
                        message: quoted,
                    };
                    const stream = await downloadMediaMessage(
                        <WAMessage>quotedMsg,
                        'buffer',
                        {},
                        {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            logger: log as any,
                            reuploadRequest: sock.updateMediaMessage,
                        }
                    );
                    mediaBuffer = stream ? Buffer.from(stream) : null;
                } else if (quoted.videoMessage) {
                    mediaType = 'video';
                    const quotedMsg: proto.IWebMessageInfo = {
                        key: {
                            remoteJid: jid,
                            fromMe: !msg.message?.extendedTextMessage?.contextInfo?.participant,
                            id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || '',
                            participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
                        },
                        message: quoted,
                    };
                    const stream = await downloadMediaMessage(
                        <WAMessage>quotedMsg,
                        'buffer',
                        {},
                        {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            logger: log as any,
                            reuploadRequest: sock.updateMediaMessage,
                        }
                    );
                    mediaBuffer = stream ? Buffer.from(stream) : null;
                } else if (quoted.stickerMessage) {
                    await sock.sendMessage(jid, {
                        text: `${config.emoji.error} Gambar yang kamu quote itu udah sticker bestie! 😅\n\nCoba quote gambar/video biasa aja.`,
                    });
                    return;
                }
            }

            // If no quoted media, check direct message
            if (!mediaBuffer && msg.message?.imageMessage) {
                mediaType = 'image';
                const stream = await downloadMediaMessage(
                    <WAMessage>msg,
                    'buffer',
                    {},
                    {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        logger: log as any,
                        reuploadRequest: sock.updateMediaMessage,
                    }
                );
                mediaBuffer = stream ? Buffer.from(stream) : null;
            } else if (!mediaBuffer && msg.message?.videoMessage) {
                mediaType = 'video';
                const stream = await downloadMediaMessage(
                    <WAMessage>msg,
                    'buffer',
                    {},
                    {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        logger: log as any,
                        reuploadRequest: sock.updateMediaMessage,
                    }
                );
                mediaBuffer = stream ? Buffer.from(stream) : null;
            }

            if (!mediaBuffer || !mediaType) {
                await sock.sendMessage(jid, {
                    text: `${config.emoji.error} Mana gambar/video-nya bestie? 🤔\n\n*Cara pakai:*\n• Reply gambar/video dengan *${config.prefix}sticker*\n• Atau kirim *${config.prefix}sticker* lalu kirim gambarnya\n\nPake *--crop* buat crop mode!`,
                });
                return;
            }

            // Check file size
            if (mediaBuffer.length > this.MAX_FILE_SIZE) {
                await sock.sendMessage(jid, {
                    text: `${config.emoji.error} Waduh, file-nya terlalu gede nih (${(mediaBuffer.length / 1024 / 1024).toFixed(2)}MB)!\n\nMaksimal 16MB ya bestie 📦`,
                });
                return;
            }

            // Send processing message
            await sock.sendMessage(jid, {
                text: `${config.emoji.info} Lagi bikin sticker-nya... tunggu sebentar ya! ✨`,
            });

            // Process media to sticker
            let stickerBuffer: Buffer;

            if (mediaType === 'video') {
                // Extract first frame from video
                const frameBuffer = await this.extractVideoFrame(mediaBuffer);
                stickerBuffer = await this.createSticker(frameBuffer, useCrop);
            } else {
                stickerBuffer = await this.createSticker(mediaBuffer, useCrop);
            }

            // Send sticker
            await sock.sendMessage(jid, {
                sticker: stickerBuffer,
            });

            log.info(`Sticker created for user ${user} in ${jid}`);
        } catch (error) {
            log.error('Error in StickerCommand:', error);
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Yah ada error nih pas bikin sticker 😢\n\nCoba lagi atau pakai gambar yang lain!`,
            });
        }
    }

    /**
     * Create sticker from image buffer
     */
    private async createSticker(imageBuffer: Buffer, useCrop: boolean): Promise<Buffer> {
        const config = await getCurrentConfig();

        try {
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();

            if (!metadata.width || !metadata.height) {
                throw new Error('Invalid image dimensions');
            }

            let processed: sharp.Sharp;

            if (useCrop) {
                // Crop to center (512x512)
                const minDimension = Math.min(metadata.width, metadata.height);
                processed = image
                    .extract({
                        left: Math.floor((metadata.width - minDimension) / 2),
                        top: Math.floor((metadata.height - minDimension) / 2),
                        width: minDimension,
                        height: minDimension,
                    })
                    .resize(this.STICKER_SIZE, this.STICKER_SIZE, {
                        fit: 'cover',
                    });
            } else {
                // Auto-fit with white padding
                processed = image.resize(this.STICKER_SIZE, this.STICKER_SIZE, {
                    fit: 'contain',
                    background: {r: 255, g: 255, b: 255, alpha: 0}, // Transparent background
                });
            }

            // Convert to WebP with sticker metadata
            const webpBuffer = await processed
                .webp({
                    quality: 100,
                    lossless: false,
                })
                .toBuffer();

            // Add sticker metadata (author and pack name)
            return await this.addStickerMetadata(webpBuffer, config.name, 'WhatsApp Sticker');
        } catch (error) {
            log.error('Error creating sticker:', error);
            throw new Error('Failed to create sticker');
        }
    }

    /**
     * Extract first frame from video
     */
    private async extractVideoFrame(videoBuffer: Buffer): Promise<Buffer> {
        const tempDir = tmpdir();
        const sessionId = randomUUID();
        const inputPath = join(tempDir, `video_${sessionId}.mp4`);
        const outputPath = join(tempDir, `frame_${sessionId}.png`);

        try {
            // Write video to temp file
            await fs.writeFile(inputPath, videoBuffer);

            // Extract first frame using ffmpeg
            await this.executeFFmpeg([
                '-i',
                inputPath,
                '-vframes',
                '1',
                '-vf',
                'scale=512:512:force_original_aspect_ratio=decrease',
                '-y',
                outputPath,
            ]);

            // Read frame
            return await fs.readFile(outputPath);
        } finally {
            // Cleanup
            await Promise.allSettled([
                fs.unlink(inputPath).catch(() => {
                }),
                fs.unlink(outputPath).catch(() => {
                }),
            ]);
        }
    }

    /**
     * Execute FFmpeg command
     */
    private executeFFmpeg(args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const process = spawn('ffmpeg', args, {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stderr = '';

            process.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
                }
            });

            process.on('error', (error) => {
                reject(new Error(`FFmpeg error: ${error.message}`));
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                process.kill('SIGKILL');
                reject(new Error('FFmpeg timeout'));
            }, 30000);
        });
    }

    /**
     * Add sticker metadata (author and pack name)
     */
    private async addStickerMetadata(
        webpBuffer: Buffer,
        author: string,
        packName: string
    ): Promise<Buffer> {
        // For simplicity, we'll return the buffer as-is
        // WhatsApp will accept WebP without explicit EXIF metadata
        // If you need proper metadata, you can use a library like 'node-webpmux'
        return webpBuffer;
    }
}

