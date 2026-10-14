import { randomUUID } from 'node:crypto';

import { DurableWorkDetachedError } from '../main/libs/agentEngine/piRuntimeTypes';

import { ActivitySource, ActivityStatus } from '../shared/activity/constants';
import type { ActivityService } from '../main/activity/activityService';
import { PayloadKind, ScheduleKind, TaskStatus } from './constants';
import { nextScheduleTime } from './scheduleTime';
import type { SchedulerRuntime } from './schedulerRuntime';
import type { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { ScheduledTask, ScheduledTaskRun, TaskState } from './types';

// Recheck wall-clock time after sleep/clock changes without Node's long-delay overflow.
const MAX_CLOCK_WAIT_MS = 60_000;

export interface SchedulerEventSink {
  runUpdated(run: ScheduledTaskRun, taskName: string): void;
  taskStateChanged(taskId: string, state: TaskState): void;
}

/**
 * Local time trigger and UI projection adapter. Pi owns submission deduplication,
 * durable execution, checkpoints and replay. There is no host retry/lease engine.
 */
export class LocalSchedulerRuntime implements SchedulerRuntime {
  private started = false;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly observations = new Map<string, Promise<void>>();

  constructor(
    private readonly store: SqliteScheduledTaskStore,
    private readonly execute: (
      task: ScheduledTask,
      run: ScheduledTaskRun,
    ) => Promise<{ sessionId?: string | null; output?: string | null }>,
    private readonly activityService?: ActivityService,
    private readonly events?: SchedulerEventSink,
    private readonly cancel?: (run: ScheduledTaskRun) => Promise<void>,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    // Reattach UI projections to the original native request. Never declare
    // native work failed merely because the desktop process was interrupted.
    for (const run of this.store.listPendingRuns()) {
      const task = this.store.get(run.taskId);
      if (task) this.observeInBackground(task, run);
    }
    void this.reconcile(this.store.list());
  }

  stop(): void {
    this.started = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  async reconcile(tasks: readonly ScheduledTask[]): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const task of tasks) {
      try {
        await this.register(task);
      } catch (error) {
        console.error(`[Scheduler] failed to register task ${task.id}:`, error);
      }
    }
  }

  async register(task: ScheduledTask): Promise<void> {
    await this.remove(task.id);
    if (!task.enabled) {
      this.store.setNextRunAt(task.id, null);
      this.publishState(task.id);
      return;
    }
    const computed = nextScheduleTime(task, Date.now());
    const nextRunAtMs =
      task.schedule.kind === ScheduleKind.At &&
      computed !== null &&
      this.store.hasTrigger(task.id, task.scheduleVersion ?? '', new Date(computed).toISOString())
        ? null
        : (task.state.nextRunAtMs ?? computed);
    this.store.setNextRunAt(task.id, nextRunAtMs);
    this.publishState(task.id);
    if (this.started && nextRunAtMs !== null) this.arm(task, nextRunAtMs);
  }

  async remove(taskId: string): Promise<void> {
    const timer = this.timers.get(taskId);
    if (timer) clearTimeout(timer);
    this.timers.delete(taskId);
  }

  async runNow(taskId: string): Promise<void> {
    const task = this.store.get(taskId);
    if (!task) throw new Error(`Scheduled task not found: ${taskId}`);
    const run = this.store.claimTrigger(
      {
        taskId,
        scheduleVersion: task.scheduleVersion ?? '',
        scheduledAt: `${new Date().toISOString()}:manual:${randomUUID()}`,
      },
      { allowDisabled: true },
    );
    if (!run) throw new Error(`Unable to record scheduled task: ${taskId}`);
    await this.observe(task, run);
  }

  async stopRun(taskId: string): Promise<boolean> {
    const runs = this.store.listPendingRuns().filter(run => run.taskId === taskId);
    if (!runs.length) return false;
    if (!this.cancel) throw new Error('Native scheduled task cancellation is unavailable');
    await Promise.all(runs.map(run => this.cancel!(run)));
    return true;
  }

  private arm(task: ScheduledTask, scheduledAtMs: number): void {
    const delay = Math.min(MAX_CLOCK_WAIT_MS, Math.max(0, scheduledAtMs - Date.now()));
    const timer = setTimeout(() => {
      if (this.timers.get(task.id) !== timer) return;
      this.timers.delete(task.id);
      if (!this.started) return;
      if (Date.now() < scheduledAtMs) {
        this.arm(task, scheduledAtMs);
        return;
      }
      this.onTime(task, scheduledAtMs);
    }, delay);
    timer.unref?.();
    this.timers.set(task.id, timer);
  }

  private onTime(registered: ScheduledTask, scheduledAtMs: number): void {
    const task = this.store.get(registered.id);
    if (!task?.enabled || task.scheduleVersion !== registered.scheduleVersion) return;
    try {
      const run = this.store.claimTrigger({
        taskId: task.id,
        scheduleVersion: task.scheduleVersion ?? '',
        scheduledAt: new Date(scheduledAtMs).toISOString(),
      });
      // A missed window produces one occurrence, never a backlog of host jobs.
      const next =
        task.schedule.kind === ScheduleKind.At ? null : nextScheduleTime(task, Date.now());
      this.store.setNextRunAt(task.id, next);
      this.publishState(task.id);
      if (next !== null) this.arm(task, next);
      if (run) this.observeInBackground(task, run);
    } catch (error) {
      console.error(`[Scheduler] failed to trigger task ${task.id}:`, error);
    }
  }

  private observeInBackground(task: ScheduledTask, run: ScheduledTaskRun): void {
    void this.observe(task, run).catch(error => {
      console.error(`[Scheduler] native request for run ${run.id} failed:`, error);
    });
  }

  private observe(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    const existing = this.observations.get(run.id);
    if (existing) return existing;
    const observation = this.executeAndProject(task, run).finally(() => {
      this.observations.delete(run.id);
    });
    this.observations.set(run.id, observation);
    return observation;
  }

  private async executeAndProject(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    this.activityService?.upsertBestEffort({
      id: run.id,
      source: ActivitySource.ScheduledTask,
      status: ActivityStatus.Running,
      startedAt: Date.parse(run.startedAt),
      taskName: task.name,
      inputPreview:
        task.payload.kind === PayloadKind.AgentTurn ? task.payload.message : task.payload.text,
    });
    this.publishRun(run, task.name);
    try {
      const result = await this.execute(task, run);
      const completed = this.store.finishRun(run.id, {
        status: TaskStatus.Success,
        sessionId: result.sessionId ?? null,
      });
      this.publishRun(completed, task.name);
      this.activityService?.upsertBestEffort({
        id: run.id,
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Completed,
        taskName: task.name,
        sessionId: result.sessionId ?? undefined,
        replyPreview: result.output ?? undefined,
      });
    } catch (error) {
      // Closing the desktop detaches this observer; it does not terminate the
      // native task. Leave the projection pending for the next attachment.
      if (error instanceof DurableWorkDetachedError) return;
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.store.finishRun(run.id, { status: TaskStatus.Error, error: message });
      this.publishRun(failed, task.name);
      this.activityService?.upsertBestEffort({
        id: run.id,
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Failed,
        taskName: task.name,
        errorMessage: message,
      });
      throw error;
    }
  }

  private publishState(taskId: string): void {
    try {
      const state = this.store.get(taskId)?.state;
      if (state) this.events?.taskStateChanged(taskId, state);
    } catch (error) {
      console.warn(`[Scheduler] failed to publish task ${taskId}:`, error);
    }
  }

  private publishRun(run: ScheduledTaskRun, taskName: string): void {
    try {
      this.events?.runUpdated(run, taskName);
    } catch (error) {
      console.warn(`[Scheduler] failed to publish run ${run.id}:`, error);
    }
    this.publishState(run.taskId);
  }
}
