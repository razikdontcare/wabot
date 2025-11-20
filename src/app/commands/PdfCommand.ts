import {downloadMediaMessage, proto, WAMessage} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {BotConfig, getCurrentConfig, log} from '../../infrastructure/config/config.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {SessionService} from '../../domain/services/SessionService.js';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';

interface PdfSession {
    images: Buffer[];
    totalSize: number;
}

export class PdfCommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'pdf',
        aliases: ['topdf', 'makepdf'],
        description: 'Gabungkan beberapa gambar menjadi satu file PDF.',
        helpText: `*Cara pakai:* 📄
• *${BotConfig.prefix}pdf start* — Mulai sesi PDF
• Kirim gambar-gambar yang mau digabung
• *${BotConfig.prefix}pdf done [nama]* — Selesai & buat PDF

*Atau:*
• Reply gambar dengan *${BotConfig.prefix}pdf* (langsung jadi PDF 1 halaman)

*Batasan:*
• Maksimal 20 gambar
• Total size maksimal 50MB
• Gambar akan di-resize otomatis (max 1200px)

*Contoh:*
• *${BotConfig.prefix}pdf start*
• (kirim gambar 1)
• (kirim gambar 2)
• (kirim gambar 3)
• *${BotConfig.prefix}pdf done Laporan_Desember*

*Keluar dari sesi:*
• *${BotConfig.prefix}pdf cancel* — Batalkan sesi`,
        category: 'utility',
        commandClass: PdfCommand,
        cooldown: 15000,
        maxUses: 3,
        vipOnly: true,
    };

    private readonly MAX_IMAGES = 20;
    private readonly MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB
    private readonly MAX_IMAGE_WIDTH = 1200;

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
            const subcommand = args[0]?.toLowerCase();

            // Start new PDF session
            if (subcommand === 'start' || subcommand === 'mulai') {
                await this.handleStart(sessionService, user, jid, sock, config);
                return;
            }

            // Done - generate PDF
            if (subcommand === 'done' || subcommand === 'selesai') {
                await this.handleDone(sessionService, user, jid, sock, config, args);
                return;
            }

            // Cancel session
            if (subcommand === 'cancel' || subcommand === 'batal') {
                await this.handleCancel(sessionService, user, jid, sock, config);
                return;
            }

            // Status
            if (subcommand === 'status') {
                await this.handleStatus(sessionService, user, jid, sock, config);
                return;
            }

            // Quick PDF from quoted image
            if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                await this.handleQuickPdf(msg, jid, sock, config, args);
                return;
            }

            // Check if user is in a session and sent an image
            const session = await sessionService.getSession(jid, user);
            if (session && session.game === 'pdf') {
                if (msg.message?.imageMessage) {
                    await this.handleAddImage(sessionService, msg, user, jid, sock, config);
                    return;
                }
            }

            // No active session and no quoted image - show help
            await sock.sendMessage(jid, {
                text: `${config.emoji.info} ${PdfCommand.commandInfo.helpText}`,
            });
        } catch (error) {
            log.error('Error in PdfCommand:', error);
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Yah ada error nih 😢\n\nCoba lagi ya!`,
            });
        }
    }

    /**
     * Start a new PDF session
     */
    private async handleStart(
        sessionService: SessionService,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any
    ): Promise<void> {
        const existingSession = await sessionService.getSession(jid, user);
        if (existingSession) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Kamu masih punya sesi ${existingSession.game} yang aktif!\n\nSelesaikan dulu atau batalkan dengan *${config.prefix}${existingSession.game} cancel*`,
            });
            return;
        }

        const pdfSession: PdfSession = {
            images: [],
            totalSize: 0,
        };

        await sessionService.setSession(jid, user, 'pdf', pdfSession);

        await sock.sendMessage(jid, {
            text: `${config.emoji.success} Sesi PDF dimulai! 📄✨\n\n*Langkah selanjutnya:*\n1️⃣ Kirim gambar-gambar yang mau digabung (max ${this.MAX_IMAGES})\n2️⃣ Ketik *${config.prefix}pdf done* kalau udah selesai\n\n*Info:*\n• Lihat status: *${config.prefix}pdf status*\n• Batalkan: *${config.prefix}pdf cancel*`,
        });
    }

    /**
     * Add image to session
     */
    private async handleAddImage(
        sessionService: SessionService,
        msg: proto.IWebMessageInfo,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any
    ): Promise<void> {
        const session = await sessionService.getSession(jid, user);
        if (!session || session.game !== 'pdf') return;

        const pdfSession = session.data as PdfSession;

        // Check max images
        if (pdfSession.images.length >= this.MAX_IMAGES) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Udah maksimal ${this.MAX_IMAGES} gambar nih!\n\nSelesaikan PDF-nya dengan *${config.prefix}pdf done*`,
            });
            return;
        }

        try {
            // Download image
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
            const imageBuffer = stream ? Buffer.from(stream) : null;

            if (!imageBuffer) {
                await sock.sendMessage(jid, {
                    text: `${config.emoji.error} Gagal download gambar 😢\n\nCoba kirim lagi!`,
                });
                return;
            }

            // Check total size
            if (pdfSession.totalSize + imageBuffer.length > this.MAX_TOTAL_SIZE) {
                await sock.sendMessage(jid, {
                    text: `${config.emoji.error} Total ukuran gambar udah melebihi 50MB!\n\nSelesaikan PDF-nya sekarang dengan *${config.prefix}pdf done*`,
                });
                return;
            }

            // Resize image if needed
            const processedImage = await this.resizeImage(imageBuffer);

            pdfSession.images.push(processedImage);
            pdfSession.totalSize += processedImage.length;

            await sessionService.setSession(jid, user, 'pdf', pdfSession);

            await sock.sendMessage(jid, {
                text: `${config.emoji.success} Gambar ke-${pdfSession.images.length} ditambahkan! 📸\n\n*Progress:* ${pdfSession.images.length}/${this.MAX_IMAGES} gambar\n*Size:* ${(pdfSession.totalSize / 1024 / 1024).toFixed(2)}MB / 50MB\n\nKirim gambar lagi atau ketik *${config.prefix}pdf done* untuk selesai!`,
            });
        } catch (error) {
            log.error('Error adding image to PDF session:', error);
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Gagal memproses gambar 😢\n\nCoba gambar lain!`,
            });
        }
    }

    /**
     * Finish and generate PDF
     */
    private async handleDone(
        sessionService: SessionService,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any,
        args: string[]
    ): Promise<void> {
        const session = await sessionService.getSession(jid, user);
        if (!session || session.game !== 'pdf') {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Kamu gak punya sesi PDF yang aktif!\n\nMulai dulu dengan *${config.prefix}pdf start*`,
            });
            return;
        }

        const pdfSession = session.data as PdfSession;

        if (pdfSession.images.length === 0) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Belum ada gambar yang ditambahkan!\n\nKirim gambar dulu atau batalkan dengan *${config.prefix}pdf cancel*`,
            });
            return;
        }

        // Get filename from args or generate one
        const filename = args.slice(1).join('_') || this.generateFilename();

        await sock.sendMessage(jid, {
            text: `${config.emoji.info} Lagi bikin PDF-nya... tunggu sebentar ya! 📄✨`,
        });

        try {
            // Generate PDF
            const pdfBuffer = await this.createPdf(pdfSession.images);

            // Send PDF
            await sock.sendMessage(jid, {
                document: pdfBuffer,
                fileName: `${filename}.pdf`,
                mimetype: 'application/pdf',
                caption: `📄 *PDF berhasil dibuat!*\n\n*Nama:* ${filename}.pdf\n*Halaman:* ${pdfSession.images.length}\n*Ukuran:* ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`,
            });

            // Clear session
            await sessionService.clearSession(jid, user);

            log.info(`PDF created for user ${user}: ${pdfSession.images.length} pages`);
        } catch (error) {
            log.error('Error generating PDF:', error);
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Gagal bikin PDF 😢\n\nCoba lagi atau pakai gambar yang lebih kecil!`,
            });
        }
    }

    /**
     * Cancel PDF session
     */
    private async handleCancel(
        sessionService: SessionService,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any
    ): Promise<void> {
        const session = await sessionService.getSession(jid, user);
        if (!session || session.game !== 'pdf') {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Kamu gak punya sesi PDF yang aktif!`,
            });
            return;
        }

        await sessionService.clearSession(jid, user);

        await sock.sendMessage(jid, {
            text: `${config.emoji.success} Sesi PDF dibatalkan! 🗑️`,
        });
    }

    /**
     * Show session status
     */
    private async handleStatus(
        sessionService: SessionService,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any
    ): Promise<void> {
        const session = await sessionService.getSession(jid, user);
        if (!session || session.game !== 'pdf') {
            await sock.sendMessage(jid, {
                text: `${config.emoji.info} Kamu gak punya sesi PDF yang aktif!\n\nMulai dengan *${config.prefix}pdf start*`,
            });
            return;
        }

        const pdfSession = session.data as PdfSession;

        await sock.sendMessage(jid, {
            text: `📊 *Status Sesi PDF*\n\n*Gambar:* ${pdfSession.images.length}/${this.MAX_IMAGES}\n*Total Size:* ${(pdfSession.totalSize / 1024 / 1024).toFixed(2)}MB / 50MB\n\n*Next:*\n• Kirim gambar lagi\n• *${config.prefix}pdf done* untuk selesai\n• *${config.prefix}pdf cancel* untuk batalkan`,
        });
    }

    /**
     * Quick PDF from quoted image
     */
    private async handleQuickPdf(
        msg: proto.IWebMessageInfo,
        jid: string,
        sock: WebSocketInfo,
        config: any,
        args: string[]
    ): Promise<void> {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quoted?.imageMessage) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Reply gambar yang mau dijadikan PDF dong!\n\nAtau pakai mode sesi: *${config.prefix}pdf start*`,
            });
            return;
        }

        await sock.sendMessage(jid, {
            text: `${config.emoji.info} Lagi bikin PDF-nya... tunggu sebentar ya! 📄`,
        });

        try {
            // Download image
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
            const imageBuffer = stream ? Buffer.from(stream) : null;

            if (!imageBuffer) {
                throw new Error('Failed to download image');
            }

            // Resize image
            const processedImage = await this.resizeImage(imageBuffer);

            // Create PDF
            const pdfBuffer = await this.createPdf([processedImage]);

            // Get filename
            const filename = args.slice(1).join('_') || this.generateFilename();

            // Send PDF
            await sock.sendMessage(jid, {
                document: pdfBuffer,
                fileName: `${filename}.pdf`,
                mimetype: 'application/pdf',
                caption: `📄 *PDF berhasil dibuat!*\n\n*Nama:* ${filename}.pdf\n*Ukuran:* ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`,
            });
        } catch (error) {
            log.error('Error creating quick PDF:', error);
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Gagal bikin PDF 😢\n\nCoba lagi ya!`,
            });
        }
    }

    /**
     * Resize image if needed
     */
    private async resizeImage(imageBuffer: Buffer): Promise<Buffer> {
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();

        if (!metadata.width || metadata.width <= this.MAX_IMAGE_WIDTH) {
            // No resize needed, just convert to JPEG
            return await image.jpeg({quality: 90}).toBuffer();
        }

        // Resize maintaining aspect ratio
        return await image
            .resize(this.MAX_IMAGE_WIDTH, null, {
                fit: 'inside',
                withoutEnlargement: true,
            })
            .jpeg({quality: 90})
            .toBuffer();
    }

    /**
     * Create PDF from images
     */
    private async createPdf(images: Buffer[]): Promise<Buffer> {
        const pdfDoc = await PDFDocument.create();

        for (const imageBuffer of images) {
            // Embed image
            const image = await pdfDoc.embedJpg(imageBuffer);
            const {width, height} = image.scale(1);

            // Calculate page size (A4 max, maintain aspect ratio)
            const maxWidth = 595; // A4 width in points
            const maxHeight = 842; // A4 height in points
            let pageWidth = width;
            let pageHeight = height;

            if (width > maxWidth || height > maxHeight) {
                const widthRatio = maxWidth / width;
                const heightRatio = maxHeight / height;
                const ratio = Math.min(widthRatio, heightRatio);

                pageWidth = width * ratio;
                pageHeight = height * ratio;
            }

            // Add page
            const page = pdfDoc.addPage([pageWidth, pageHeight]);

            // Draw image
            page.drawImage(image, {
                x: 0,
                y: 0,
                width: pageWidth,
                height: pageHeight,
            });
        }

        return Buffer.from(await pdfDoc.save());
    }

    /**
     * Generate filename from timestamp
     */
    private generateFilename(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');

        return `Dokumen_${year}${month}${day}_${hours}${minutes}${seconds}`;
    }
}

