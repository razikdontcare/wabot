import cron from 'node-cron';
import {getMongoClient} from './mongo.js';
import {GroupSettingService} from '../../domain/services/GroupSettingService.js';
import {BotConfig, log} from './config.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {getAllRegisteredGroupJids} from '../../app/commands/RegisterGroupCommand.js';
import {VIPService} from '../../domain/services/VIPService.js';
import {ReminderService} from '../../domain/services/ReminderService.js';
import {formatIndonesianDate} from '../../shared/utils/indonesianDateParser.js';

// Example: Send a "Good morning!" message to all groups every day at 7am
export async function scheduleDailyMorningMessage(sock: WebSocketInfo) {
    cron.schedule('0 7 * * *', async () => {
        const client = await getMongoClient();
        const groupService = new GroupSettingService(client);
        // Fetch all registered group JIDs from the database
        const groupJids = await getAllRegisteredGroupJids(client);
        for (const jid of groupJids) {
            // Optionally, check if group has enabled daily messages
            const groupSetting = await groupService.get(jid);
            if (groupSetting?.welcomeMessage) {
                await sock.sendMessage(jid, {text: groupSetting.welcomeMessage});
            } else {
                await sock.sendMessage(jid, {
                    text: `Good morning from ${BotConfig.name}!`,
                });
            }
        }
    });
}

// VIP cleanup: Runs daily at midnight to clean expired VIPs and codes
export async function scheduleVIPCleanup() {
    cron.schedule('0 0 * * *', async () => {
        try {
            log.info('Running VIP cleanup task...');
            const vipService = await VIPService.getInstance();

            const expiredVIPs = await vipService.cleanupExpiredVIPs();
            const expiredCodes = await vipService.cleanupExpiredCodes();

            log.info(`VIP cleanup completed: ${expiredVIPs} VIPs and ${expiredCodes} codes cleaned`);
        } catch (error) {
            log.error('Error in VIP cleanup task:', error);
        }
    });
}

// Reminder checker: Runs every minute to check and send due reminders
export async function scheduleReminderCheck(sock: WebSocketInfo) {
    cron.schedule('* * * * *', async () => {
        try {
            const mongoClient = await getMongoClient();
            const reminderService = await ReminderService.getInstance(mongoClient);

            // Get reminders due in the next minute
            const dueReminders = await reminderService.getUpcoming(1);

            for (const reminder of dueReminders) {
                try {
                    // Determine target JID (group or user)
                    const targetJid = reminder.groupId || reminder.userId;

                    // Format the reminder message
                    const formattedTime = formatIndonesianDate(reminder.scheduledTime);
                    const message = `⏰ *Reminder!*\n\n📝 ${reminder.message}\n\n🕐 Dijadwalkan: ${formattedTime}\n\n@${reminder.userId.split('@')[0]}`;

                    // Send reminder
                    await sock.sendMessage(targetJid, {text: message, mentions: [reminder.userId]});

                    // Mark as delivered
                    await reminderService.markDelivered(reminder._id!);

                    log.info(`Reminder delivered: ${reminder._id} to ${targetJid}`);
                } catch (error) {
                    log.error(`Failed to send reminder ${reminder._id}:`, error);
                    // Continue with other reminders even if one fails
                }
            }

            if (dueReminders.length > 0) {
                log.info(`Processed ${dueReminders.length} reminder(s)`);
            }
        } catch (error) {
            log.error('Error in reminder check task:', error);
        }
    });

    log.info('Reminder checker scheduled (runs every minute)');
}
