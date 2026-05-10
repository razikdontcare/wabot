import { describe, expect, it, mock, beforeEach } from "bun:test";
import * as node_cron from "node-cron";

// Mock node-cron before importing scheduler
mock.module("node-cron", () => ({
    default: {
        schedule: mock((cronStr: string, task: Function) => {
            (globalThis as any).lastCronTask = task;
            return { start: () => {} };
        })
    }
}));

// Mock other dependencies
mock.module("../src/infrastructure/config/mongo.js", () => ({
    getMongoClient: async () => ({})
}));

mock.module("../src/domain/services/ReminderService.js", () => ({
    ReminderService: {
        getInstance: async () => ({
            getUpcoming: async () => [{ 
                _id: "1", 
                userId: "user@s.whatsapp.net", 
                message: "Test",
                scheduledTime: new Date()
            }],
            markDelivered: async () => {}
        })
    }
}));

import { scheduleReminderCheck } from "../src/infrastructure/config/scheduler.js";

describe("Scheduler Stale Socket Fix", () => {
  it("should use the current socket from BotClient during execution", async () => {
    const mockSock = {
        sendMessage: mock(async () => ({}))
    };
    
    // Set global bot client with current socket
    (globalThis as any).__botClient = {
        sock: mockSock
    };

    // Initialize scheduler
    await scheduleReminderCheck();

    // Run the captured task
    const task = (globalThis as any).lastCronTask;
    expect(task).toBeDefined();
    await task();

    // It should have used mockSock (from globalThis.__botClient.sock)
    expect(mockSock.sendMessage).toHaveBeenCalled();
  });
});
