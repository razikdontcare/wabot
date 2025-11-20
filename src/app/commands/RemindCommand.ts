import {proto} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {BotConfig, getCurrentConfig, log} from '../../infrastructure/config/config.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {SessionService} from '../../domain/services/SessionService.js';
import {ReminderService} from '../../domain/services/ReminderService.js';
import {getMongoClient} from '../../infrastructure/config/mongo.js';
import {formatIndonesianDate, parseIndonesianDate,} from '../../shared/utils/indonesianDateParser.js';

export class RemindCommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'remind',
        aliases: ['reminder', 'ingetin'],
        description: 'Buat pengingat dengan bahasa natural Indonesia.',
        helpText: `*Cara pakai:* ⏰
• *${BotConfig.prefix}remind <waktu> <pesan>* — Buat pengingat
• *${BotConfig.prefix}remind list* — Lihat semua pengingat
• *${BotConfig.prefix}remind delete <nomor>* — Hapus pengingat
• *${BotConfig.prefix}remind clear* — Hapus semua pengingat

*Contoh waktu:*
• "besok pagi" — Besok jam 8 pagi
• "2 jam lagi" — 2 jam dari sekarang
• "jumat jam 9 pagi" — Jumat depan jam 9
• "minggu depan" — Minggu depan jam 9 pagi
• "lusa sore" — Lusa jam 4 sore
• "30 menit lagi" — 30 menit dari sekarang

*Contoh lengkap:*
• *${BotConfig.prefix}remind besok pagi meeting penting*
• *${BotConfig.prefix}remind 2 jam lagi cek oven*
• *${BotConfig.prefix}remind jumat sore jangan lupa bayar tagihan*

*Info:*
• Timezone: WIB (UTC+7)
• Reminder akan dihapus otomatis setelah 7 hari
• Maksimal 20 reminder aktif per user`,
        category: 'utility',
        commandClass: RemindCommand,
        cooldown: 10000,
        maxUses: 5,
    };

    private readonly MAX_REMINDERS_PER_USER = 20;

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
            const mongoClient = await getMongoClient();
            const reminderService = await ReminderService.getInstance(mongoClient);

            // Handle subcommands
            if (args.length === 0) {
                await sock.sendMessage(jid, {
                    text: `${config.emoji.info} ${RemindCommand.commandInfo.helpText}`,
                });
                return;
            }

            const subcommand = args[0].toLowerCase();

            // List reminders
            if (subcommand === 'list' || subcommand === 'daftar') {
                await this.handleList(reminderService, user, jid, sock, config);
                return;
            }

            // Delete reminder
            if (subcommand === 'delete' || subcommand === 'hapus') {
                await this.handleDelete(reminderService, user, jid, sock, config, args);
                return;
            }

            // Clear all reminders
            if (subcommand === 'clear' || subcommand === 'bersihkan') {
                await this.handleClear(reminderService, user, jid, sock, config);
                return;
            }

            // Create new reminder
            await this.handleCreate(reminderService, user, jid, sock, config, args);
        } catch (error) {
            log.error('Error in RemindCommand:', error);
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Yah ada error nih 😢\n\nCoba lagi ya bestie!`,
            });
        }
    }

    /**
     * Handle creating a new reminder
     */
    private async handleCreate(
        reminderService: ReminderService,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any,
        args: string[]
    ): Promise<void> {
        // Check user's reminder count
        const count = await reminderService.countUserReminders(user);
        if (count >= this.MAX_REMINDERS_PER_USER) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Waduh, kamu udah punya ${count} reminder aktif!\n\nMaksimal ${this.MAX_REMINDERS_PER_USER} reminder per user ya. Hapus yang lama dulu dengan *${config.prefix}remind delete <nomor>*`,
            });
            return;
        }

        // Parse input: find where the time phrase ends and message begins

        // Try to extract time and message
        let parsedDate: Date | null = null;
        let message = '';
        let timePhrase = '';

        // Try progressively longer time phrases
        for (let i = 1; i <= Math.min(args.length, 6); i++) {
            const testTimePhrase = args.slice(0, i).join(' ');
            const testDate = parseIndonesianDate(testTimePhrase);

            if (testDate && testDate > new Date()) {
                parsedDate = testDate;
                timePhrase = testTimePhrase;
                message = args.slice(i).join(' ');
            }
        }

        if (!parsedDate) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Hmm, gak ngerti waktu yang kamu maksud nih 🤔\n\n*Contoh yang bener:*\n• besok pagi\n• 2 jam lagi\n• jumat sore\n• minggu depan\n• 30 menit lagi\n\nCoba lagi ya!`,
            });
            return;
        }

        if (!message || message.trim().length === 0) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Eh, pesan reminder-nya mana? 😅\n\n*Format:*\n*${config.prefix}remind <waktu> <pesan>*\n\n*Contoh:*\n*${config.prefix}remind besok pagi meeting penting*`,
            });
            return;
        }

        // Check if date is in the past (with 1 minute grace period)
        const now = new Date();
        if (parsedDate.getTime() < now.getTime() - 60000) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Eh, waktu yang kamu kasih udah lewat bestie! ⏰\n\nCoba kasih waktu yang lebih kedepan dong.`,
            });
            return;
        }

        // Create reminder
        const groupId = jid.endsWith('@g.us') ? jid : undefined;
        const reminderId = await reminderService.create({
            userId: user,
            groupId,
            message: message.trim(),
            scheduledTime: parsedDate,
            timezone: 7, // WIB
        });

        const formattedDate = formatIndonesianDate(parsedDate);

        await sock.sendMessage(jid, {
            text: `${config.emoji.success} Reminder berhasil dibuat! ✨\n\n📝 *Pesan:* ${message.trim()}\n⏰ *Waktu:* ${formattedDate}\n🆔 *ID:* #${count + 1}\n\nAku akan ingetin kamu nanti ya! 💭`,
        });

        log.info(`Reminder created: ${reminderId} for user ${user} at ${parsedDate}`);
    }

    /**
     * Handle listing reminders
     */
    private async handleList(
        reminderService: ReminderService,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any
    ): Promise<void> {
        const reminders = await reminderService.getUserReminders(user, false);

        if (reminders.length === 0) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.info} Kamu belum punya reminder aktif nih!\n\nBuat reminder baru dengan:\n*${config.prefix}remind <waktu> <pesan>*`,
            });
            return;
        }

        let text = `⏰ *Reminder Kamu* (${reminders.length}/${this.MAX_REMINDERS_PER_USER})\n\n`;

        reminders.forEach((reminder, index) => {
            const formattedDate = formatIndonesianDate(reminder.scheduledTime);
            text += `*${index + 1}.* ${reminder.message}\n`;
            text += `   ⏰ ${formattedDate}\n\n`;
        });

        text += `\nHapus dengan: *${config.prefix}remind delete <nomor>*`;

        await sock.sendMessage(jid, {text});
    }

    /**
     * Handle deleting a reminder
     */
    private async handleDelete(
        reminderService: ReminderService,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any,
        args: string[]
    ): Promise<void> {
        if (args.length < 2) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Kasih nomor reminder yang mau dihapus dong!\n\n*Format:*\n*${config.prefix}remind delete <nomor>*\n\nLihat daftar reminder dengan: *${config.prefix}remind list*`,
            });
            return;
        }

        const index = parseInt(args[1]) - 1;

        if (isNaN(index) || index < 0) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Nomor reminder-nya gak valid nih!\n\nPakai nomor dari *${config.prefix}remind list* ya.`,
            });
            return;
        }

        const reminders = await reminderService.getUserReminders(user, false);

        if (index >= reminders.length) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Reminder nomor ${index + 1} gak ada bestie!\n\nKamu cuma punya ${reminders.length} reminder. Cek lagi dengan *${config.prefix}remind list*`,
            });
            return;
        }

        const reminder = reminders[index];
        const deleted = await reminderService.delete(reminder._id!, user);

        if (deleted) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.success} Reminder berhasil dihapus! 🗑️\n\n❌ "${reminder.message}"`,
            });
        } else {
            await sock.sendMessage(jid, {
                text: `${config.emoji.error} Gagal hapus reminder nih 😢\n\nCoba lagi ya!`,
            });
        }
    }

    /**
     * Handle clearing all reminders
     */
    private async handleClear(
        reminderService: ReminderService,
        user: string,
        jid: string,
        sock: WebSocketInfo,
        config: any
    ): Promise<void> {
        const count = await reminderService.deleteAllUserReminders(user);

        if (count === 0) {
            await sock.sendMessage(jid, {
                text: `${config.emoji.info} Kamu gak punya reminder aktif yang bisa dihapus!`,
            });
            return;
        }

        await sock.sendMessage(jid, {
            text: `${config.emoji.success} Semua reminder berhasil dihapus! 🗑️\n\nTotal ${count} reminder dihapus.`,
        });
    }
}

