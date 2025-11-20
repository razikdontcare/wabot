import {proto} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {SessionService} from '../../domain/services/SessionService.js';
import {VIPService} from '../../domain/services/VIPService.js';
import {getUserRoles, log} from '../../infrastructure/config/config.js';

export class VIPCommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'vip',
        aliases: ['premium'],
        description: 'Kelola status VIP dan kode VIP (admin) atau klaim VIP (user)',
        helpText: `*Penggunaan VIP Command:*

*Untuk User:*
• !vip claim <code> — Klaim VIP menggunakan kode
• !vip status — Cek status VIP kamu
• !vip info — Lihat info tentang VIP

*Untuk Admin:*
• !vip add <user> <days> — Berikan VIP ke user (0 = lifetime)
• !vip remove <user> — Cabut status VIP user
• !vip extend <user> <days> — Perpanjang VIP user (0 = lifetime)
• !vip gencode <days> [uses] [expiry] — Generate kode VIP
  - days: durasi VIP dalam hari (0 = lifetime)
  - uses: max penggunaan kode (0 = unlimited, default: 1)
  - expiry: kode expired dalam berapa hari (default: 30)
• !vip deactivate <code> — Nonaktifkan kode VIP
• !vip list — Lihat semua VIP aktif
• !vip codes — Lihat semua kode VIP
• !vip stats — Lihat statistik VIP

*Contoh:*
!vip claim ABCD-1234-EFGH-5678
!vip add @user 30
!vip gencode 30 5 7
!vip extend @user 60`,
        category: 'general',
        commandClass: VIPCommand,
    };

    private vipService: VIPService | null = null;

    async handleCommand(
        args: string[],
        jid: string,
        user: string,
        sock: WebSocketInfo,
        _sessionService: SessionService,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        const chatId = jid;
        const senderId = user;

        if (args.length === 0) {
            await this.showHelp(sock, chatId);
            return;
        }

        const subcommand = args[0].toLowerCase();
        const vipService = await this.getVIPService();

        try {
            switch (subcommand) {
                case 'claim':
                    await this.handleClaim(args, senderId, chatId, sock, vipService);
                    break;

                case 'status':
                    await this.handleStatus(senderId, chatId, sock, vipService);
                    break;

                case 'info':
                    await this.showVIPInfo(chatId, sock);
                    break;

                case 'add':
                    await this.handleAdd(args, senderId, chatId, sock, vipService, msg);
                    break;

                case 'remove':
                    await this.handleRemove(args, senderId, chatId, sock, vipService, msg);
                    break;

                case 'extend':
                    await this.handleExtend(args, senderId, chatId, sock, vipService, msg);
                    break;

                case 'gencode':
                    await this.handleGenCode(args, senderId, chatId, sock, vipService);
                    break;

                case 'deactivate':
                    await this.handleDeactivate(args, senderId, chatId, sock, vipService);
                    break;

                case 'list':
                    await this.handleList(senderId, chatId, sock, vipService);
                    break;

                case 'codes':
                    await this.handleCodes(senderId, chatId, sock, vipService);
                    break;

                case 'stats':
                    await this.handleStats(senderId, chatId, sock, vipService);
                    break;

                default:
                    await sock.sendMessage(chatId, {
                        text: `❌ Subcommand tidak dikenal: ${subcommand}\n\nGunakan !vip tanpa argumen untuk melihat bantuan.`,
                    });
            }
        } catch (error) {
            log.error('Error in VIP command:', error);
            await sock.sendMessage(chatId, {
                text: '❌ Terjadi kesalahan saat memproses command VIP.',
            });
        }
    }

    private async getVIPService(): Promise<VIPService> {
        if (!this.vipService) {
            this.vipService = await VIPService.getInstance();
        }
        return this.vipService;
    }

    private async showHelp(sock: WebSocketInfo, chatId: string): Promise<void> {
        await sock.sendMessage(chatId, {
            text: VIPCommand.commandInfo.helpText || 'Bantuan tidak tersedia.',
        });
    }

    private async showVIPInfo(chatId: string, sock: WebSocketInfo): Promise<void> {
        const infoText = `✨ *Tentang VIP Membership* ✨

*Keuntungan VIP:*
🚀 Tidak ada cooldown pada semua command
💎 Unlimited penggunaan AI commands
🎨 Akses unlimited ke image generation
⚡ Priority processing untuk semua request
🎮 Akses ke fitur-fitur premium eksklusif
👑 Badge VIP di profil kamu

*Cara Mendapatkan VIP:*
1. Hubungi admin untuk membeli VIP
2. Gunakan kode VIP: !vip claim <code>

*Durasi VIP:*
- VIP tersedia dalam berbagai durasi
- Dari harian, mingguan, bulanan, hingga lifetime!

Tertarik? Hubungi admin untuk info lebih lanjut! 💫`;

        await sock.sendMessage(chatId, {text: infoText});
    }

    private async handleClaim(
        args: string[],
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService
    ): Promise<void> {
        if (args.length < 2) {
            await sock.sendMessage(chatId, {
                text: '❌ Gunakan: !vip claim <code>\n\nContoh: !vip claim ABCD-1234-EFGH-5678',
            });
            return;
        }

        const code = args[1].toUpperCase().trim();
        await sock.sendMessage(chatId, {text: '⏳ Memproses kode VIP...'});

        const result = await vipService.redeemCode(code, senderId);

        await sock.sendMessage(chatId, {
            text: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
        });
    }

    private async handleStatus(
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService
    ): Promise<void> {
        const info = await vipService.getVIPInfo(senderId);
        await sock.sendMessage(chatId, {text: info});
    }

    private async handleAdd(
        args: string[],
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        // Check admin permission
        const userRoles = await getUserRoles(senderId);
        if (!userRoles.includes('admin')) {
            await sock.sendMessage(chatId, {
                text: '❌ Hanya admin yang dapat menggunakan command ini.',
            });
            return;
        }

        if (args.length < 3) {
            await sock.sendMessage(chatId, {
                text: '❌ Gunakan: !vip add <user> <days>\n\nContoh: !vip add @user 30\nGunakan 0 untuk lifetime VIP.',
            });
            return;
        }

        // Extract mentioned user or use provided JID
        let targetUser = args[1];
        const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentionedJid && mentionedJid.length > 0) {
            targetUser = mentionedJid[0];
        }

        const days = parseInt(args[2]);
        if (isNaN(days) || days < 0) {
            await sock.sendMessage(chatId, {
                text: '❌ Durasi harus berupa angka positif (0 untuk lifetime).',
            });
            return;
        }

        const success = await vipService.grantVIP(targetUser, days, senderId);

        if (success) {
            const durationText = days === 0 ? 'selamanya (lifetime)' : `${days} hari`;
            await sock.sendMessage(chatId, {
                text: `✅ VIP berhasil diberikan kepada ${targetUser} selama ${durationText}! 🎉`,
            });
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Gagal memberikan VIP. Silakan coba lagi.',
            });
        }
    }

    private async handleRemove(
        args: string[],
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        // Check admin permission
        const userRoles = await getUserRoles(senderId);
        if (!userRoles.includes('admin')) {
            await sock.sendMessage(chatId, {
                text: '❌ Hanya admin yang dapat menggunakan command ini.',
            });
            return;
        }

        if (args.length < 2) {
            await sock.sendMessage(chatId, {
                text: '❌ Gunakan: !vip remove <user>\n\nContoh: !vip remove @user',
            });
            return;
        }

        // Extract mentioned user or use provided JID
        let targetUser = args[1];
        const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentionedJid && mentionedJid.length > 0) {
            targetUser = mentionedJid[0];
        }

        const success = await vipService.revokeVIP(targetUser, senderId);

        if (success) {
            await sock.sendMessage(chatId, {
                text: `✅ VIP berhasil dicabut dari ${targetUser}.`,
            });
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ User tidak memiliki VIP atau gagal mencabut VIP.',
            });
        }
    }

    private async handleExtend(
        args: string[],
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        // Check admin permission
        const userRoles = await getUserRoles(senderId);
        if (!userRoles.includes('admin')) {
            await sock.sendMessage(chatId, {
                text: '❌ Hanya admin yang dapat menggunakan command ini.',
            });
            return;
        }

        if (args.length < 3) {
            await sock.sendMessage(chatId, {
                text: '❌ Gunakan: !vip extend <user> <days>\n\nContoh: !vip extend @user 30\nGunakan 0 untuk convert ke lifetime VIP.',
            });
            return;
        }

        // Extract mentioned user or use provided JID
        let targetUser = args[1];
        const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentionedJid && mentionedJid.length > 0) {
            targetUser = mentionedJid[0];
        }

        const days = parseInt(args[2]);
        if (isNaN(days) || days < 0) {
            await sock.sendMessage(chatId, {
                text: '❌ Durasi harus berupa angka positif (0 untuk convert ke lifetime).',
            });
            return;
        }

        const success = await vipService.extendVIP(targetUser, days, senderId);

        if (success) {
            const durationText = days === 0 ? 'lifetime' : `${days} hari`;
            await sock.sendMessage(chatId, {
                text: `✅ VIP berhasil diperpanjang untuk ${targetUser} selama ${durationText}! 🎉`,
            });
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ User tidak memiliki VIP atau gagal memperpanjang VIP.',
            });
        }
    }

    private async handleGenCode(
        args: string[],
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService
    ): Promise<void> {
        // Check admin permission
        const userRoles = await getUserRoles(senderId);
        if (!userRoles.includes('admin')) {
            await sock.sendMessage(chatId, {
                text: '❌ Hanya admin yang dapat menggunakan command ini.',
            });
            return;
        }

        if (args.length < 2) {
            await sock.sendMessage(chatId, {
                text: '❌ Gunakan: !vip gencode <days> [uses] [expiry]\n\n' +
                    'Contoh:\n' +
                    '!vip gencode 30 — 30 hari, single-use, expired 30 hari\n' +
                    '!vip gencode 30 5 — 30 hari, 5 uses, expired 30 hari\n' +
                    '!vip gencode 30 0 90 — 30 hari, unlimited uses, expired 90 hari\n' +
                    '!vip gencode 0 — lifetime VIP',
            });
            return;
        }

        const days = parseInt(args[1]);
        if (isNaN(days) || days < 0) {
            await sock.sendMessage(chatId, {
                text: '❌ Durasi harus berupa angka positif (0 untuk lifetime).',
            });
            return;
        }

        const maxUses = args.length >= 3 ? parseInt(args[2]) : 1;
        if (isNaN(maxUses) || maxUses < 0) {
            await sock.sendMessage(chatId, {
                text: '❌ Max uses harus berupa angka positif (0 untuk unlimited).',
            });
            return;
        }

        const codeExpiry = args.length >= 4 ? parseInt(args[3]) : 30;
        if (isNaN(codeExpiry) || codeExpiry < 0) {
            await sock.sendMessage(chatId, {
                text: '❌ Code expiry harus berupa angka positif.',
            });
            return;
        }

        await sock.sendMessage(chatId, {text: '⏳ Generating VIP code...'});

        const code = await vipService.generateCode(days, maxUses, codeExpiry, senderId);

        if (code) {
            const durationText = days === 0 ? 'Lifetime' : `${days} hari`;
            const usesText = maxUses === 0 ? 'Unlimited' : `${maxUses}x`;
            const expiryText = `${codeExpiry} hari`;

            await sock.sendMessage(chatId, {
                text:
                    `✅ *Kode VIP berhasil dibuat!*\n\n` +
                    `🎫 Kode: \`${code}\`\n` +
                    `⏱️ Durasi VIP: ${durationText}\n` +
                    `🔢 Max Uses: ${usesText}\n` +
                    `📅 Kode Expired: ${expiryText}\n\n` +
                    `Bagikan kode ini kepada user untuk klaim VIP!`,
            });
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Gagal generate kode VIP. Silakan coba lagi.',
            });
        }
    }

    private async handleDeactivate(
        args: string[],
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService
    ): Promise<void> {
        // Check admin permission
        const userRoles = await getUserRoles(senderId);
        if (!userRoles.includes('admin')) {
            await sock.sendMessage(chatId, {
                text: '❌ Hanya admin yang dapat menggunakan command ini.',
            });
            return;
        }

        if (args.length < 2) {
            await sock.sendMessage(chatId, {
                text: '❌ Gunakan: !vip deactivate <code>\n\nContoh: !vip deactivate ABCD-1234-EFGH-5678',
            });
            return;
        }

        const code = args[1].toUpperCase().trim();
        const success = await vipService.deactivateCode(code, senderId);

        if (success) {
            await sock.sendMessage(chatId, {
                text: `✅ Kode VIP ${code} berhasil dinonaktifkan.`,
            });
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Kode tidak ditemukan atau gagal dinonaktifkan.',
            });
        }
    }

    private async handleList(
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService
    ): Promise<void> {
        // Check admin permission
        const userRoles = await getUserRoles(senderId);
        if (!userRoles.includes('admin')) {
            await sock.sendMessage(chatId, {
                text: '❌ Hanya admin yang dapat menggunakan command ini.',
            });
            return;
        }

        const vips = await vipService.getAllVIPs(true);

        if (vips.length === 0) {
            await sock.sendMessage(chatId, {
                text: 'ℹ️ Tidak ada VIP user saat ini.',
            });
            return;
        }

        const now = new Date();
        let listText = `👑 *Daftar VIP Users* (${vips.length})\n\n`;

        vips.slice(0, 20).forEach((vip, index) => {
            let expiryText: string;
            if (vip.expiresAt === null) {
                expiryText = '♾️ Lifetime';
            } else {
                const daysRemaining = Math.ceil((vip.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                expiryText = `${daysRemaining}d`;
            }

            listText += `${index + 1}. ${vip.userJid}\n   ${expiryText}\n`;
        });

        if (vips.length > 20) {
            listText += `\n... dan ${vips.length - 20} lainnya.`;
        }

        await sock.sendMessage(chatId, {text: listText});
    }

    private async handleCodes(
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService
    ): Promise<void> {
        // Check admin permission
        const userRoles = await getUserRoles(senderId);
        if (!userRoles.includes('admin')) {
            await sock.sendMessage(chatId, {
                text: '❌ Hanya admin yang dapat menggunakan command ini.',
            });
            return;
        }

        const codes = await vipService.getAllCodes(true);

        if (codes.length === 0) {
            await sock.sendMessage(chatId, {
                text: 'ℹ️ Tidak ada kode VIP aktif saat ini.',
            });
            return;
        }

        let listText = `🎫 *Daftar Kode VIP Aktif* (${codes.length})\n\n`;

        codes.slice(0, 15).forEach((code, index) => {
            const durationText = code.duration === 0 ? 'Lifetime' : `${code.duration}d`;
            const usesText = code.maxUses === 0 ? '∞' : `${code.currentUses}/${code.maxUses}`;

            listText += `${index + 1}. \`${code.code}\`\n`;
            listText += `   ⏱️ ${durationText} | 🔢 ${usesText}\n`;
        });

        if (codes.length > 15) {
            listText += `\n... dan ${codes.length - 15} kode lainnya.`;
        }

        await sock.sendMessage(chatId, {text: listText});
    }

    private async handleStats(
        senderId: string,
        chatId: string,
        sock: WebSocketInfo,
        vipService: VIPService
    ): Promise<void> {
        // Check admin permission
        const userRoles = await getUserRoles(senderId);
        if (!userRoles.includes('admin')) {
            await sock.sendMessage(chatId, {
                text: '❌ Hanya admin yang dapat menggunakan command ini.',
            });
            return;
        }

        const stats = await vipService.getStats();

        const statsText =
            `📊 *Statistik VIP*\n\n` +
            `👥 *Users:*\n` +
            `   • Total: ${stats.totalVIPs}\n` +
            `   • Aktif: ${stats.activeVIPs}\n` +
            `   • Expired: ${stats.expiredVIPs}\n\n` +
            `🎫 *Kode:*\n` +
            `   • Total: ${stats.totalCodes}\n` +
            `   • Aktif: ${stats.activeCodes}\n` +
            `   • Total Redemptions: ${stats.totalRedemptions}`;

        await sock.sendMessage(chatId, {text: statsText});
    }
}

