import Database from 'better-sqlite3';
import { DurableWorkDetachedError } from '../main/libs/agentEngine/piRuntimeTypes';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { LocalSchedulerRuntime } from './localSchedulerRuntime';
import { PayloadKind, ScheduleKind, SessionTarget, TaskStatus, WakeMode } from './constants';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { Schedule } from './types';

const runtimes: LocalSchedulerRuntime[] = [];
const databases: Database.Database[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-14T00:00:00Z');
});
afterEach(() => {
  runtimes.forEach(runtime => runtime.stop());
  runtimes.length = 0;
  databases.forEach(db => db.close());
  databases.length = 0;
  vi.useRealTimers();
});

function setup(schedule: Schedule = { kind: ScheduleKind.Every, everyMs: 60_000 }) {
  const db = new Database(':memory:');
  databases.push(db);
  const store = new SqliteScheduledTaskStore(db);
  const task = store.create({
    name: 'task',
    description: '',
    enabled: true,
    schedule,
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.Now,
    payload: { kind: PayloadKind.AgentTurn, message: 'run' },
  });
  const execute = vi.fn(async () => ({ sessionId: 'pi-run', output: 'done' }));
  const events = { runUpdated: vi.fn(), taskStateChanged: vi.fn() };
  const cancel = vi.fn(async () => undefined);
  const runtime = new LocalSchedulerRuntime(store, execute, undefined, events, cancel);
  runtimes.push(runtime);
  return { db, store, task, execute, events, cancel, runtime };
}

async function start(runtime: LocalSchedulerRuntime) {
  runtime.start();
  await vi.advanceTimersByTimeAsync(0);
}

test('local interval drives native execution and publishes next-run and result projections', async () => {
  const { runtime, execute, store, task, events } = setup();
  await start(runtime);
  expect(store.get(task.id)?.state.nextRunAtMs).toBe(Date.now() + 60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(execute).toHaveBeenCalledOnce();
  expect(store.listRuns(task.id)).toMatchObject([
    { status: TaskStatus.Success, sessionId: 'pi-run' },
  ]);
  expect(events.runUpdated.mock.calls.map(call => call[0].status)).toEqual([
    TaskStatus.Running,
    TaskStatus.Success,
  ]);
  expect(store.get(task.id)?.state.nextRunAtMs).toBe(Date.now() + 60_000);
});

test('one-time occurrence remains completed after restart', async () => {
  const { runtime, execute, store, task } = setup({
    kind: ScheduleKind.At,
    at: '2026-10-14T00:00:01Z',
  });
  await start(runtime);
  await vi.advanceTimersByTimeAsync(1000);
  expect(execute).toHaveBeenCalledOnce();
  expect(store.get(task.id)?.state.nextRunAtMs).toBeNull();
  runtime.stop();
  await start(runtime);
  await vi.advanceTimersByTimeAsync(1000);
  expect(execute).toHaveBeenCalledOnce();
});

test('overdue intervals after downtime produce one occurrence, then the next future boundary', async () => {
  const { runtime, execute, store, task } = setup();
  await start(runtime);
  runtime.stop();
  vi.setSystemTime('2026-10-14T12:00:00Z');
  await start(runtime);
  expect(execute).toHaveBeenCalledOnce();
  expect(store.get(task.id)?.state.nextRunAtMs).toBe(Date.now() + 60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(execute).toHaveBeenCalledTimes(2);
});

test('wall-clock jump coalesces overdue ticks instead of replaying a backlog', async () => {
  const { runtime, execute, store, task } = setup();
  await start(runtime);
  vi.setSystemTime('2026-10-14T12:00:00Z');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(execute).toHaveBeenCalledOnce();
  expect(store.get(task.id)?.state.nextRunAtMs).toBe(Date.now() + 60_000);
});

test('cron respects its declared timezone', async () => {
  const { runtime, execute, store, task } = setup({
    kind: ScheduleKind.Cron,
    expr: '0 9 * * *',
    tz: 'Asia/Shanghai',
  });
  await start(runtime);
  expect(store.get(task.id)?.state.nextRunAtMs).toBe(Date.parse('2026-10-14T01:00:00Z'));
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(execute).toHaveBeenCalledOnce();
  expect(store.get(task.id)?.state.nextRunAtMs).toBe(Date.parse('2026-10-15T01:00:00Z'));
});

test('pause and removal clear timers while manual runs remain available for paused tasks', async () => {
  const { runtime, execute, store, task } = setup();
  await start(runtime);
  await runtime.register(store.update(task.id, { enabled: false }));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(execute).not.toHaveBeenCalled();
  expect(store.get(task.id)?.state.nextRunAtMs).toBeNull();
  await runtime.runNow(task.id);
  expect(execute).toHaveBeenCalledOnce();
  await runtime.register(store.update(task.id, { enabled: true }));
  await runtime.remove(task.id);
  store.remove(task.id);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(execute).toHaveBeenCalledOnce();
});

test('schedule updates discard the old timer and refresh next-run state', async () => {
  const { runtime, execute, store, task } = setup();
  await start(runtime);
  await runtime.register(
    store.update(task.id, { schedule: { kind: ScheduleKind.Every, everyMs: 120_000 } }),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(execute).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(execute).toHaveBeenCalledOnce();
});

test('reattaches a pending display record using its original native request identity', async () => {
  const { runtime, execute, store, task } = setup();
  const pending = store.claimTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: new Date().toISOString(),
  })!;
  store.setRunSession(pending.id, `scheduled-run:${pending.id}`);
  await start(runtime);
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({ id: task.id }),
    expect.objectContaining({ id: pending.id, sessionId: `scheduled-run:${pending.id}` }),
  );
  expect(store.listRuns(task.id)).toHaveLength(1);
});

test('failure comes from native execution and preserves the run projection', async () => {
  const { runtime, execute, store, task } = setup();
  execute.mockRejectedValueOnce(new Error('Native submission aborted'));
  await expect(runtime.runNow(task.id)).rejects.toThrow('Native submission aborted');
  expect(store.listRuns(task.id)[0]).toMatchObject({
    status: TaskStatus.Error,
    error: 'Native submission aborted',
  });
});

test('Stop delegates cancellation to the native run rather than marking a fake completion', async () => {
  const { runtime, store, task, cancel } = setup();
  const run = store.claimTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: new Date().toISOString(),
  })!;
  await expect(runtime.stopRun(task.id)).resolves.toBe(true);
  expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: run.id }));
  expect(store.listRuns(task.id)[0].status).toBe(TaskStatus.Running);
  await expect(runtime.stopRun('missing')).resolves.toBe(false);
});

test('desktop detachment leaves the native execution projection pending for reattachment', async () => {
  const { runtime, execute, store, task, events } = setup();
  execute.mockRejectedValueOnce(new DurableWorkDetachedError());
  await runtime.runNow(task.id);
  expect(store.listPendingRuns()).toHaveLength(1);
  expect(store.listRuns(task.id)[0].status).toBe(TaskStatus.Running);
  expect(events.runUpdated).toHaveBeenCalledOnce();
});
