import { Worker } from 'worker_threads';
import { join } from 'path';
import { log } from '../../infrastructure/config/config.js';
import { randomUUID } from 'crypto';

interface Task<T = unknown> {
  id: string;
  modulePath: string;
  functionName: string;
  args: unknown[];
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface WorkerResponse<T = unknown> {
  taskId: string;
  result?: T;
  error?: string;
  success: boolean;
}

export class WorkerPool {
  private static instance: WorkerPool;
  private workers: Worker[] = [];
  private freeWorkers: Worker[] = [];
  private taskQueue: Task<unknown>[] = []; 
  private readonly maxWorkers: number;
  private readonly workerPath: string;

  private constructor(maxWorkers: number = 4) {
    this.maxWorkers = maxWorkers;
    // Use the compiled JS file path
    this.workerPath = join(process.cwd(), 'dist', 'shared', 'utils', 'worker.js');
    
    // In dev mode (Bun), we might need to point to the TS file
    if (process.env.NODE_ENV !== 'production' && !process.env.USE_DIST) {
        this.workerPath = join(process.cwd(), 'src', 'shared', 'utils', 'worker.ts');
    }
  }

  public static getInstance(): WorkerPool {
    if (!WorkerPool.instance) {
      WorkerPool.instance = new WorkerPool();
    }
    return WorkerPool.instance;
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerPath);
    this.workers.push(worker);

    worker.on('exit', () => {
      const index = this.workers.indexOf(worker);
      if (index !== -1) this.workers.splice(index, 1);
      
      const freeIndex = this.freeWorkers.indexOf(worker);
      if (freeIndex !== -1) this.freeWorkers.splice(freeIndex, 1);
      
      log.warn('Worker thread exited unexpectedly');
    });

    return worker;
  }

  public async run<T>(modulePath: string, functionName: string, args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: Task<T> = {
        id: randomUUID(),
        modulePath,
        functionName,
        args,
        resolve,
        reject
      };

      this.taskQueue.push(task as unknown as Task<unknown>);
      this.processNextTask();
    });
  }

  private processNextTask() {
    if (this.taskQueue.length === 0) return;

    let worker: Worker | undefined;

    if (this.freeWorkers.length > 0) {
      worker = this.freeWorkers.pop();
    } else if (this.workers.length < this.maxWorkers) {
      worker = this.createWorker();
    }

    if (!worker) return;

    const task = this.taskQueue.shift()!;
    
    const onMessage = (message: WorkerResponse) => {
      if (message.taskId === task.id) {
        worker!.off('message', onMessage);
        worker!.off('error', onError);
        
        this.freeWorkers.push(worker!);
        
        if (message.success) {
          task.resolve(message.result);
        } else {
          task.reject(new Error(message.error));
        }
        
        this.processNextTask();
      }
    };

    const onError = (error: Error) => {
      worker!.off('message', onMessage);
      worker!.off('error', onError);
      
      // Remove broken worker
      const index = this.workers.indexOf(worker!);
      if (index !== -1) this.workers.splice(index, 1);
      
      task.reject(error);
      this.processNextTask();
    };

    worker.on('message', onMessage);
    worker.on('error', onError);

    worker.postMessage({
      taskId: task.id,
      modulePath: task.modulePath,
      functionName: task.functionName,
      args: task.args
    });
  }
}
