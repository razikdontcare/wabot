import {downloadMediaMessage, proto, WAMessage} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {BotConfig, getCurrentConfig, log} from '../../infrastructure/config/config.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {SessionService} from '../../domain/services/SessionService.js';
import sharp from 'sharp';

export class MemeCommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'meme',
        aliases: ['buatmeme', 'memegen'],
        description: 'Tambahkan teks ke gambar untuk bikin meme.',
        helpText: `*Cara pakai:* 😂
• Reply gambar dengan *${BotConfig.prefix}meme "teks atas" "teks bawah"*
• Reply gambar dengan *${BotConfig.prefix}meme teks atas | teks bawah*
• Reply gambar dengan *${BotConfig.prefix}meme teks* (hanya teks bawah)

*Contoh:*
• Reply gambar: *${BotConfig.prefix}meme "kapan gajian" "besok aja terus"*
• Reply gambar: *${BotConfig.prefix}meme kalo lagi bokek | jadi kreatif*
• Reply gambar: *${BotConfig.prefix}meme that's what she said*

*Tips:*
• Pakai tanda kutip untuk teks yang ada spasi
• Pakai | untuk pisah teks atas dan bawah
• Teks otomatis dibuat UPPERCASE dan bold

👑 *VIP Members:* No cooldown!`,
        category: 'utility',
        commandClass: MemeCommand,
        cooldown: 5000,
        maxUses: 3,
        vipBypassCooldown: true,
    };

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
            // Check for quoted image
            let imageBuffer: Buffer | null = null;

            if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;

                const quotedMsg: proto.IWebMessageInfo = {
                    key: {
                        remoteJid: jid,
                        fromMe: !msg.message?.extendedTextMessage?.contextInfo?.participant,
                        id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || '',
                        participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
                    },
                    message: quotedMessage,
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
                imageBuffer = stream ? Buffer.from(stream) : null;
            }

            if (!imageBuffer) {
                await sock.sendMessage(jid, {
                    text: `${config.emoji.error} Reply gambar yang mau dijadiin meme dong! 🖼️\n\n*Format:*\n*${config.prefix}meme "teks atas" "teks bawah"*\n\n*Contoh:*\nReply gambar dengan:\n*${config.prefix}meme "programmer" "stackoverflow copas"*`,
                });
                return;
            }

            if (args.length === 0) {
                await sock.sendMessage(jid, {
                    text: `${config.emoji.error} Eh, teks meme-nya mana? 😅\n\n*Format:*\n*${config.prefix}meme "teks atas" "teks bawah"*\natau\n*${config.prefix}meme teks atas | teks bawah*`,
                });
                return;
            }

            // Parse text input
            const fullText = args.join(' ');
            let topText = '';
            let bottomText: string;

            // Check for quoted text format: "text1" "text2"
            const quotedMatch = fullText.match(/"([^"]*)"\s*"([^"]*)"/);
            if (quotedMatch) {
                topText = quotedMatch[1].trim();
                bottomText = quotedMatch[2].trim();
            }
            // Check for pipe format: text1 | text2
            else if (fullText.includes('|')) {
                const parts = fullText.split('|');
                topText = parts[0].trim();
                bottomText = parts[1]?.trim() || '';
            }
            // Check for single quoted text (bottom only)
            else if (fullText.match(/"([^"]*)"/)) {
                const match = fullText.match(/"([^"]*)"/);
                bottomText = match![1].trim();
            }
            // Default: all text goes to bottom
            else {
                bottomText = fullText.trim();
            }

            // Validate text
            if (!topText && !bottomText) {
                await sock.sendMessage(jid, {
                    text: `${config.emoji.error} Teks meme-nya kosong nih! 😅\n\nKasih teks dong, masa meme kosong 🤔`,
                });
                return;
            }

            await sock.sendMessage(jid, {
                text: `${config.emoji.info} Lagi bikin meme-nya... bentar ya! 😂✨`,
            });

            // Create meme
            const memeBuffer = await this.createMeme(imageBuffer, topText, bottomText);

            // Send meme
            await sock.sendMessage(jid, {
                image: memeBuffer,
                caption: `😂 *Meme siap dipake!*${topText ? `\n📝 Atas: "${topText}"` : ''}${bottomText ? `\n📝 Bawah: "${bottomText}"` : ''}`,
            });

            log.info(`Meme created for user ${user} in ${jid}`);
        } catch (error) {
            log.error('Error in MemeCommand:', error);
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Yah gagal bikin meme 😢\n\nCoba gambar atau teks yang lain ya!`,
            });
        }
    }

    /**
     * Create meme from image with top and bottom text using sharp
     * Note: This is a simplified version using sharp's composite feature
     * For better text rendering with outline, consider using canvas or ImageMagick
     */
    private async createMeme(imageBuffer: Buffer, topText: string, bottomText: string): Promise<Buffer> {
        try {
            // Load image
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width || 800;
            const height = metadata.height || 600;

            // Calculate font size based on image width
            const fontSize = Math.max(Math.floor(width / 15), 32);
            const strokeWidth = Math.max(Math.floor(fontSize / 10), 3);

            // Create SVG text overlays
            const svgParts: string[] = [];

            if (topText) {
                const wrappedTop = this.wrapText(topText.toUpperCase(), Math.floor(width / fontSize * 1.8));
                const lines = wrappedTop.split('\n');
                const lineHeight = fontSize * 1.2;
                let yPos = 50;

                lines.forEach((line, index) => {
                    const y = yPos + (index * lineHeight);
                    // Add stroke (outline)
                    svgParts.push(
                        `<text x="50%" y="${y}" font-family="Impact, Arial Black, sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="black" stroke="black" stroke-width="${strokeWidth * 2}">${this.escapeXml(line)}</text>`
                    );
                    // Add white text on top
                    svgParts.push(
                        `<text x="50%" y="${y}" font-family="Impact, Arial Black, sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="white">${this.escapeXml(line)}</text>`
                    );
                });
            }

            if (bottomText) {
                const wrappedBottom = this.wrapText(bottomText.toUpperCase(), Math.floor(width / fontSize * 1.8));
                const lines = wrappedBottom.split('\n');
                const lineHeight = fontSize * 1.2;
                const totalHeight = lines.length * lineHeight;
                let yPos = height - totalHeight - 30;

                lines.forEach((line, index) => {
                    const y = yPos + (index * lineHeight);
                    // Add stroke (outline)
                    svgParts.push(
                        `<text x="50%" y="${y}" font-family="Impact, Arial Black, sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="black" stroke="black" stroke-width="${strokeWidth * 2}">${this.escapeXml(line)}</text>`
                    );
                    // Add white text on top
                    svgParts.push(
                        `<text x="50%" y="${y}" font-family="Impact, Arial Black, sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="white">${this.escapeXml(line)}</text>`
                    );
                });
            }

            // Create complete SVG
            const svg = `
                <svg width="${width}" height="${height}">
                    ${svgParts.join('\n')}
                </svg>
            `;

            // Composite text onto image
            const svgBuffer = Buffer.from(svg);
            return await image
                .composite([
                    {
                        input: svgBuffer,
                        top: 0,
                        left: 0,
                    },
                ])
                .jpeg({quality: 90})
                .toBuffer();
        } catch (error) {
            log.error('Error creating meme with sharp:', error);
            throw new Error('Failed to create meme');
        }
    }

    /**
     * Wrap text to fit within max characters per line
     */
    private wrapText(text: string, maxCharsPerLine: number): string {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (const word of words) {
            if ((currentLine + word).length <= maxCharsPerLine) {
                currentLine += (currentLine ? ' ' : '') + word;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                }
                currentLine = word;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines.join('\n');
    }

    /**
     * Escape XML special characters
     */
    private escapeXml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}

