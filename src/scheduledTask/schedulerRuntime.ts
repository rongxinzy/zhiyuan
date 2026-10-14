import type { ScheduledTask } from './types';

/** Host clock boundary. Pi Durable Task remains the execution owner. */
export interface SchedulerRuntime {
  start(): void;
  stop(): void;
  reconcile(tasks: readonly ScheduledTask[]): Promise<void>;
  register(task: ScheduledTask): Promise<void>;
  remove(taskId: string): Promise<void>;
  runNow(taskId: string): Promise<void>;
  stopRun(taskId: string): Promise<boolean>;
}
