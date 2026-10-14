import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';

import { CanonicalScheduledTaskService } from './canonicalScheduledTaskService';
import { PayloadKind, ScheduleKind, SessionTarget, WakeMode } from './constants';
import { LocalSchedulerRuntime } from './localSchedulerRuntime';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

const input = {
  name: 'task',
  description: '',
  enabled: true,
  schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
  sessionTarget: SessionTarget.Isolated,
  wakeMode: WakeMode.Now,
  payload: { kind: PayloadKind.AgentTurn, message: 'go' },
  workspaceId: 'workspace-1',
} as const;
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.useRealTimers();
});
function setup() {
  const db = new Database(':memory:');
  const store = new SqliteScheduledTaskStore(db);
  const execute = vi.fn(async () => ({ sessionId: 'pi' }));
  const runtime = new LocalSchedulerRuntime(store, execute);
  cleanups.push(() => {
    runtime.stop();
    db.close();
  });
  return { store, runtime, execute, service: new CanonicalScheduledTaskService(store, runtime) };
}

test('exposes local task operations and durable run projections', async () => {
  const { service } = setup();
  const task = await service.addJob(input);
  expect(task.state.nextRunAtMs).not.toBeNull();
  expect((await service.listJobs())[0].id).toBe(task.id);
  await service.runJob(task.id);
  expect(await service.countRuns(task.id)).toBe(1);
  expect((await service.listAllRuns())[0].taskName).toBe(task.name);
  await service.removeJob(task.id);
  expect(await service.getJob(task.id)).toBeNull();
});

test('start and stop polling really control local time triggers', async () => {
  vi.useFakeTimers();
  const { service, execute } = setup();
  await service.addJob(input);
  service.startPolling();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(execute).toHaveBeenCalledOnce();
  service.stopPolling();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(execute).toHaveBeenCalledOnce();
});

test('invalid schedules fail before the enabled task is saved', async () => {
  const { service } = setup();
  await expect(
    service.addJob({ ...input, schedule: { kind: ScheduleKind.Cron, expr: 'invalid' } }),
  ).rejects.toThrow();
  expect(await service.listJobs()).toEqual([]);
  const task = await service.addJob(input);
  await expect(
    service.updateJob(task.id, { schedule: { kind: ScheduleKind.Every, everyMs: 0 } }),
  ).rejects.toThrow();
  expect((await service.getJob(task.id))?.schedule).toEqual(input.schedule);
});
