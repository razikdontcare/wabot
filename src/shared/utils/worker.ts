import { parentPort } from 'worker_threads';
import { pathToFileURL } from 'url';

if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

interface WorkerMessage {
  taskId: string;
  modulePath: string;
  functionName: string;
  args: unknown[];
}

parentPort.on('message', async (message: WorkerMessage) => {
  const { taskId, modulePath, functionName, args } = message;

  try {
    // Use pathToFileURL for cross-platform compatibility with dynamic imports
    const moduleUrl = pathToFileURL(modulePath).href;
    const module = await import(moduleUrl);
    const fn = module[functionName];

    if (typeof fn !== 'function') {
      throw new Error(`Function "${functionName}" not found in module "${modulePath}"`);
    }

    // Execute the function
    const result = await fn(...args);

    // Send result back
    parentPort!.postMessage({
      taskId,
      result,
      success: true
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Send error back
    parentPort!.postMessage({
      taskId,
      error: errorMessage,
      success: false
    });
  }
});
