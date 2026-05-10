import cron from "node-cron";
import { getMongoClient } from "./mongo.js";
import { GroupSettingService } from "../../domain/services/GroupSettingService.js";
import { BotConfig, log } from "./config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { getAllRegisteredGroupJids } from "../../app/commands/RegisterGroupCommand.js";
import { VIPService } from "../../domain/services/VIPService.js";
import { ReminderService } from "../../domain/services/ReminderService.js";
import {
  FreeGamesService,
  GamerPowerGiveaway,
} from "../../domain/services/FreeGamesService.js";
import { formatIndonesianDate } from "../../shared/utils/indonesianDateParser.js";
import { BotClient } from "../../app/client/BotClient.js";

let isFreeGamesSchedulerInitialized = false;
let isVIPCleanupSchedulerInitialized = false;
let isReminderSchedulerInitialized = false;
let isDailyMorningSchedulerInitialized = false;

// Helper to get the current active socket from the global BotClient instance
function getCurrentSocket(): WebSocketInfo | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bot = (globalThis as any).__botClient as BotClient;
  return bot?.sock || null;
}

// Example: Send a "Good morning!" message to all groups every day at 7am
export async function scheduleDailyMorningMessage() {
  if (isDailyMorningSchedulerInitialized) return;
  isDailyMorningSchedulerInitialized = true;

  cron.schedule("0 7 * * *", async () => {
    const sock = getCurrentSocket();
    if (!sock) {
      log.warn("Skipping daily morning message: No active socket");
      return;
    }

    const client = await getMongoClient();
    const groupService = new GroupSettingService(client);
    // Fetch all registered group JIDs from the database
    const groupJids = await getAllRegisteredGroupJids(client);
    for (const jid of groupJids) {
      // Optionally, check if group has enabled daily messages
      const groupSetting = await groupService.get(jid);
      if (groupSetting?.welcomeMessage) {
        await sock.sendMessage(jid, { text: groupSetting.welcomeMessage });
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
  if (isVIPCleanupSchedulerInitialized) return;
  isVIPCleanupSchedulerInitialized = true;

  cron.schedule("0 0 * * *", async () => {
    try {
      log.info("Running VIP cleanup task...");
      const vipService = await VIPService.getInstance();

      const expiredVIPs = await vipService.cleanupExpiredVIPs();
      const expiredCodes = await vipService.cleanupExpiredCodes();

      log.info(
        `VIP cleanup completed: ${expiredVIPs} VIPs and ${expiredCodes} codes cleaned`,
      );
    } catch (error) {
      log.error("Error in VIP cleanup task:", error);
    }
  });
}

// Reminder checker: Runs every minute to check and send due reminders
export async function scheduleReminderCheck() {
  if (isReminderSchedulerInitialized) return;
  isReminderSchedulerInitialized = true;

  cron.schedule("* * * * *", async () => {
    const sock = getCurrentSocket();
    if (!sock) {
      log.warn("Skipping reminder check: No active socket");
      return;
    }

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
          const message = `⏰ *Reminder!*\n\n📝 ${reminder.message}\n\n🕐 Dijadwalkan: ${formattedTime}\n\n@${reminder.userId.split("@")[0]}`;

          // Send reminder
          await sock.sendMessage(targetJid, {
            text: message,
            mentions: [reminder.userId],
          });

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
      log.error("Error in reminder check task:", error);
    }
  });

  log.info("Reminder checker scheduled (runs every minute)");
}

// Free games notifier: Runs every 30 minutes and notifies opted-in groups
export async function scheduleFreeGamesNotification() {
  if (isFreeGamesSchedulerInitialized) {
    log.warn(
      "Free games notifier already initialized, skipping duplicate schedule",
    );
    return;
  }

  isFreeGamesSchedulerInitialized = true;
  let isChecking = false;

  cron.schedule("*/30 * * * *", async () => {
    if (isChecking) {
      log.warn(
        "Skipping free games poll because previous run is still in progress",
      );
      return;
    }

    const sock = getCurrentSocket();
    if (!sock) {
      log.warn("Skipping free games poll: No active socket");
      return;
    }

    isChecking = true;

    try {
      const mongoClient = await getMongoClient();
      const groupSettingService = new GroupSettingService(mongoClient);
      const targetGroups =
        await groupSettingService.getFreeGamesEnabledGroups();

      if (targetGroups.length === 0) {
        return;
      }

      const freeGamesService = await FreeGamesService.getInstance(mongoClient);
      const newGiveaways = await freeGamesService.pollNewGiveaways({
        bootstrapIfEmpty: true,
        bootstrapLimit: 5,
        persist: false, // persist only after successful send
      });

      if (newGiveaways.length === 0) {
        return;
      }

      // Track which giveaways were successfully sent to at least one group
      const successfullySentIds = new Set<number>();

      for (const giveaway of newGiveaways) {
        const targetUrl = await freeGamesService.resolveRedirectLocation(
          giveaway.open_giveaway_url,
        );
        const message = formatFreeGamesMessage(giveaway, targetUrl);
        let sentToAtLeastOneGroup = false;

        for (const groupJid of targetGroups) {
          try {
            await sock.sendMessage(groupJid, { text: message });
            sentToAtLeastOneGroup = true;
          } catch (error) {
            log.error(
              `Failed to send free games notification to ${groupJid}:`,
              error,
            );
          }
        }

        if (sentToAtLeastOneGroup) {
          successfullySentIds.add(giveaway.id);
        }
      }

      // Mark only successfully-sent giveaways as seen
      const successfullySent = newGiveaways.filter((g) =>
        successfullySentIds.has(g.id),
      );
      if (successfullySent.length > 0) {
        try {
          await freeGamesService.markGiveawaysSeen(successfullySent);
          log.info(
            `[Scheduler] Marked ${successfullySent.length} successfully-sent giveaway(s) as seen`,
          );
        } catch (err) {
          log.error("Failed to mark giveaways as seen:", err);
        }
      } else {
        log.warn(
          `[Scheduler] No giveaways were successfully sent to any group; will retry on next poll`,
        );
      }

      log.info(
        `Free games notifier sent ${newGiveaways.length} giveaway(s) to ${targetGroups.length} group(s)`,
      );
    } catch (error) {
      log.error("Error in free games notifier task:", error);
    } finally {
      isChecking = false;
    }
  });

  log.info("Free games notifier scheduled (runs every 30 minutes)");
}

function formatFreeGamesMessage(
  giveaway: GamerPowerGiveaway,
  targetUrl: string,
): string {
  const endDate = formatFreeGamesEndDate(giveaway.end_date);
  const worth =
    giveaway.worth && giveaway.worth !== "N/A" ? giveaway.worth : "Gratis";

  return [
    "🎁 *Giveaway Game Baru Terdeteksi!*",
    "",
    `🎮 *${giveaway.title}*`,
    `💰 Worth: ${worth}`,
    `🖥️ Platform: ${giveaway.platforms || "N/A"}`,
    `🧩 Type: ${giveaway.type || "N/A"}`,
    `⏳ Berakhir: ${endDate}`,
    `🔗 Link: ${targetUrl}`,
    "",
    "Matikan notifikasi dengan */freegames off*",
  ].join("\n");
}

function formatFreeGamesEndDate(rawEndDate?: string): string {
  if (!rawEndDate || rawEndDate === "N/A") {
    return "Tidak diketahui";
  }

  const normalized = rawEndDate.trim();

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );

  let parsedDate: Date | null = null;

  if (match) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] =
      match;
    parsedDate = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
  } else {
    const fallback = new Date(normalized);
    if (!Number.isNaN(fallback.getTime())) {
      parsedDate = fallback;
    }
  }

  if (!parsedDate) {
    return normalized;
  }

  const formatted = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Jakarta",
  }).format(parsedDate);

  return `${formatted} WIB`;
}
