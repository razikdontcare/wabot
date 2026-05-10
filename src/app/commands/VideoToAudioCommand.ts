import {downloadMediaMessage, getContentType, proto, WAMessage} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {BotConfig, log} from '../../infrastructure/config/config.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {SessionService} from '../../domain/services/SessionService.js';
import {WorkerPool} from '../../shared/utils/WorkerPool.js';
import {join} from 'path';

export class VideoToAudioCommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'videoaudio',
        aliases: ['v2a', 'toaudio', 'extractaudio'],
        description: 'Konversi video ke audio dengan berbagai format.',
        helpText: `*Penggunaan:*
• Reply video dengan ${BotConfig.prefix}videoaudio — Konversi ke MP3
• Reply video dengan ${BotConfig.prefix}videoaudio ogg — Konversi ke OGG
• Reply video dengan ${BotConfig.prefix}videoaudio wav — Konversi ke WAV
• Reply video dengan ${BotConfig.prefix}videoaudio m4a — Konversi ke M4A

*Format yang didukung:*
• mp3 — Format paling umum (default)
• ogg — Format untuk voice note WhatsApp
• wav — Format audio tanpa kompresi
• m4a — Format AAC dalam container M4A

*Contoh:*
Reply video dengan: ${BotConfig.prefix}v2a
Reply video dengan: ${BotConfig.prefix}v2a ogg`,
        category: 'utility',
        commandClass: VideoToAudioCommand,
        cooldown: 15000,
        maxUses: 2,
    };

    async handleCommand(
        args: string[],
        jid: string,
        user: string,
        sock: WebSocketInfo,
        sessionService: SessionService,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        // Handle help command
        if (args.length > 0 && args[0] === 'help') {
            await sock.sendMessage(jid, {
                text: VideoToAudioCommand.commandInfo.helpText || '',
            });
            return;
        }

        // Check if message is replying to a video
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quotedMessage?.videoMessage) {
            await sock.sendMessage(jid, {
                text: `❌ Kamu harus reply ke video yang mau dikonversi!\n\n*Cara pakai:*\nReply video dengan ${BotConfig.prefix}videoaudio [format]\n\n*Format yang tersedia:* mp3 (default), ogg, wav, m4a\n\nContoh: ${BotConfig.prefix}v2a mp3`,
            });
            return;
        }

        // Determine output format
        const formatArg = args[0]?.toLowerCase();
        const validFormats = ['mp3', 'ogg', 'wav', 'm4a'];
        const format = validFormats.includes(formatArg) ? formatArg : 'mp3';

        await sock.sendMessage(jid, {
            text: `⏳ Sedang mengekstrak audio dari video ke format ${format.toUpperCase()}...\nMohon tunggu sebentar ya! 🎵`,
        });

        try {
            // Download the video
            log.info(`Downloading video for audio conversion to ${format}`);

            // Create a proper message object for downloadMediaMessage
            const quotedMsg: proto.IWebMessageInfo = {
                key: {
                    remoteJid: jid,
                    fromMe: !msg.message?.extendedTextMessage?.contextInfo?.participant,
                    id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || '',
                    participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
                },
                message: quotedMessage,
            };

            // Verify it's actually a video message
            const messageType = getContentType(quotedMessage);
            if (messageType !== 'videoMessage') {
                throw new Error('Quoted message is not a video');
            }

            // Download the video as buffer
            const videoBuffer = await downloadMediaMessage(
                <WAMessage>quotedMsg,
                'buffer',
                {},
                {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    logger: log as any,
                    reuploadRequest: sock.updateMediaMessage,
                }
            );

            if (!videoBuffer || !Buffer.isBuffer(videoBuffer)) {
                throw new Error('Failed to download video');
            }

            log.info(`Video downloaded, size: ${videoBuffer.length} bytes`);

            // Check file size (limit to 50MB)
            const maxSize = 50 * 1024 * 1024; // 50MB
            if (videoBuffer.length > maxSize) {
                await sock.sendMessage(jid, {
                    text: '❌ Video terlalu besar! Maksimal 50MB ya. Coba video yang lebih kecil deh! 📏',
                });
                return;
            }

            // Convert video to audio via Worker Pool
            log.info(`Converting video to ${format} audio via Worker Pool`);
            
            const workerPool = WorkerPool.getInstance();
            const ffmpegPath = () => {
                if (process.env.NODE_ENV === 'production' || process.env.USE_DIST) {
                    return join(process.cwd(), "dist", "shared", "utils", "ffmpeg.js");
                }
                return join(process.cwd(), "src", "shared", "utils", "ffmpeg.js");
            };

            const result = await workerPool.run<Uint8Array>(
                ffmpegPath(),
                'convertVideoToAudio',
                [
                    new Uint8Array(videoBuffer),
                    {
                        format: format as 'mp3' | 'ogg' | 'wav' | 'm4a',
                        bitrate: '192k',
                        timeout: 120000, // 2 minutes timeout
                    }
                ]
            );
            
            const audioBuffer = Buffer.from(result);

            log.info(`Conversion complete, audio size: ${audioBuffer.length} bytes`);

            // Determine mimetype and file extension
            const mimeTypes: Record<string, string> = {
                mp3: 'audio/mpeg',
                ogg: 'audio/ogg; codecs=opus',
                wav: 'audio/wav',
                m4a: 'audio/mp4',
            };

            const mimetype = mimeTypes[format] || 'audio/mpeg';

            // Send audio file
            await sock.sendMessage(jid, {
                audio: audioBuffer,
                mimetype: mimetype,
                fileName: `converted_audio.${format}`,
                ptt: format === 'ogg', // Use push-to-talk for OGG format
            });

            await sock.sendMessage(jid, {
                text: `✅ Audio berhasil diekstrak!\n🎵 Format: ${format.toUpperCase()}\n📦 Size: ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB`,
            });

            log.info(`Audio sent successfully to ${jid}`);
        } catch (error) {
            log.error('Error converting video to audio:', error);

            let errorMessage = '❌ Maaf, terjadi error saat konversi video ke audio. ';

            if (error instanceof Error) {
                if (error.message.includes('timeout')) {
                    errorMessage += 'Proses konversi terlalu lama (timeout). Video mungkin terlalu besar atau kompleks. 😔';
                } else if (error.message.includes('FFmpeg')) {
                    errorMessage += 'Ada masalah dengan FFmpeg. Pastikan FFmpeg sudah terinstall dengan benar! 🔧';
                } else {
                    errorMessage += `Error: ${error.message}`;
                }
            } else {
                errorMessage += 'Coba lagi nanti ya! 🙏';
            }

            await sock.sendMessage(jid, {
                text: errorMessage,
            });
        }
    }
}
