import {Collection, MongoClient, ObjectId} from 'mongodb';
import {log} from '../../infrastructure/config/config.js';

export interface Reminder {
    _id?: ObjectId;
    userId: string; // WhatsApp JID of the user who set the reminder
    groupId?: string; // Optional: group JID if reminder was set in a group
    message: string; // Reminder message
    scheduledTime: Date; // When to send the reminder
    createdAt: Date; // When the reminder was created
    delivered: boolean; // Whether the reminder has been delivered
    timezone: number; // Timezone offset in hours (default 7 for WIB)
}

export class ReminderService {
    private static instance: ReminderService | null = null;
    private collection: Collection<Reminder>;

    private constructor(mongoClient: MongoClient) {
        this.collection = mongoClient.db().collection<Reminder>('reminders');
        this.ensureIndexes();
    }

    /**
     * Get singleton instance of ReminderService
     */
    public static async getInstance(mongoClient?: MongoClient): Promise<ReminderService> {
        if (!ReminderService.instance) {
            if (!mongoClient) {
                throw new Error('MongoClient required for first initialization');
            }
            ReminderService.instance = new ReminderService(mongoClient);
        }
        return ReminderService.instance;
    }

    /**
     * Create a new reminder
     */
    async create(reminder: Omit<Reminder, '_id' | 'createdAt' | 'delivered'>): Promise<ObjectId> {
        const newReminder: Reminder = {
            ...reminder,
            createdAt: new Date(),
            delivered: false,
            timezone: reminder.timezone || 7, // Default to WIB
        };

        const result = await this.collection.insertOne(newReminder);
        log.info(`Reminder created for user ${reminder.userId} at ${reminder.scheduledTime}`);
        return result.insertedId;
    }

    /**
     * Get upcoming reminders within the next N minutes
     */
    async getUpcoming(withinMinutes: number = 1): Promise<Reminder[]> {
        const now = new Date();
        const future = new Date(now.getTime() + withinMinutes * 60000);

        return await this.collection
            .find({
                scheduledTime: {$gte: now, $lte: future},
                delivered: false,
            })
            .toArray();
    }

    /**
     * Mark reminder as delivered
     */
    async markDelivered(reminderId: ObjectId): Promise<boolean> {
        const result = await this.collection.updateOne({_id: reminderId}, {$set: {delivered: true}});

        return result.modifiedCount > 0;
    }

    /**
     * Get all reminders for a specific user
     */
    async getUserReminders(userId: string, includeDelivered: boolean = false): Promise<Reminder[]> {
        const query: any = {userId};

        if (!includeDelivered) {
            query.delivered = false;
        }

        return await this.collection.find(query).sort({scheduledTime: 1}).toArray();
    }

    /**
     * Delete a specific reminder
     */
    async delete(reminderId: ObjectId, userId: string): Promise<boolean> {
        const result = await this.collection.deleteOne({
            _id: reminderId,
            userId, // Ensure user can only delete their own reminders
        });

        return result.deletedCount > 0;
    }

    /**
     * Delete all reminders for a user
     */
    async deleteAllUserReminders(userId: string): Promise<number> {
        const result = await this.collection.deleteMany({userId, delivered: false});
        return result.deletedCount || 0;
    }

    /**
     * Get reminder by ID
     */
    async getById(reminderId: ObjectId): Promise<Reminder | null> {
        return await this.collection.findOne({_id: reminderId});
    }

    /**
     * Count active reminders for a user
     */
    async countUserReminders(userId: string): Promise<number> {
        return await this.collection.countDocuments({userId, delivered: false});
    }

    /**
     * Clean up old delivered reminders (called by scheduler)
     */
    async cleanupOldReminders(olderThanDays: number = 7): Promise<number> {
        const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
        const result = await this.collection.deleteMany({
            delivered: true,
            scheduledTime: {$lt: cutoffDate},
        });

        return result.deletedCount || 0;
    }

    /**
     * Ensure database indexes are created
     */
    private async ensureIndexes(): Promise<void> {
        try {
            // Index for finding upcoming reminders
            await this.collection.createIndex({scheduledTime: 1, delivered: 1});

            // Index for finding user reminders
            await this.collection.createIndex({userId: 1, delivered: 1});

            // TTL index to auto-delete old reminders after 7 days
            await this.collection.createIndex({scheduledTime: 1}, {expireAfterSeconds: 7 * 24 * 60 * 60});

            log.info('ReminderService indexes created successfully');
        } catch (error) {
            log.error('Failed to create ReminderService indexes:', error);
        }
    }
}

