import { describe, expect, it } from "bun:test";
import { WorkerPool } from "../src/shared/utils/WorkerPool.js";
import { join } from "path";

describe("WorkerPool", () => {
  it("should execute a task in a worker thread", async () => {
    const workerPool = WorkerPool.getInstance();
    
    // We'll use a real processor file but a simple function
    // For testing, we can create a simple test processor
    const testProcessorContent = `
      export async function testTask(a, b) {
        return a + b;
      }
    `;
    const testProcessorPath = join(process.cwd(), "test-processor.ts");
    await Bun.write(testProcessorPath, testProcessorContent);

    try {
      const result = await workerPool.run<number>(testProcessorPath, "testTask", [10, 20]);
      expect(result).toBe(30);
    } finally {
      // Clean up
      const fs = await import("fs/promises");
      await fs.unlink(testProcessorPath);
    }
  });

  it("should handle errors in worker threads", async () => {
    const workerPool = WorkerPool.getInstance();
    
    const errorProcessorContent = `
      export async function failTask() {
        throw new Error("Task failed successfully");
      }
    `;
    const errorProcessorPath = join(process.cwd(), "error-processor.ts");
    await Bun.write(errorProcessorPath, errorProcessorContent);

    try {
      await expect(workerPool.run(errorProcessorPath, "failTask", [])).rejects.toThrow("Task failed successfully");
    } finally {
      const fs = await import("fs/promises");
      await fs.unlink(errorProcessorPath);
    }
  });

  it("should run multiple tasks in parallel", async () => {
    const workerPool = WorkerPool.getInstance();
    
    const slowProcessorContent = `
      export async function slowTask(ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
        return Date.now();
      }
    `;
    const slowProcessorPath = join(process.cwd(), "slow-processor.ts");
    await Bun.write(slowProcessorPath, slowProcessorContent);

    try {
      const start = Date.now();
      // Run two 500ms tasks. If parallel, should take ~500ms, not 1000ms.
      const results = await Promise.all([
        workerPool.run<number>(slowProcessorPath, "slowTask", [500]),
        workerPool.run<number>(slowProcessorPath, "slowTask", [500])
      ]);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(900); // Should be significantly less than 1000ms
      expect(results.length).toBe(2);
    } finally {
      const fs = await import("fs/promises");
      await fs.unlink(slowProcessorPath);
    }
  });
});
