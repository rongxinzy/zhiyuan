import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';
import { PayloadKind, ScheduleKind, SessionTarget, TaskStatus, WakeMode } from './constants';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new Database(':memory:');
  databases.push(db);
  const store = new SqliteScheduledTaskStore(db);
  const task = store.create({
    name: 'task',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *', tz: 'Asia/Shanghai' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.Now,
    payload: { kind: PayloadKind.AgentTurn, message: 'hello' },
    workspaceId: 'workspace',
  });
  const trigger = {
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-10-14T00:00:00Z',
  };
  return { db, store, task, trigger };
}

test('schedule edits reset next-run projection and change the schedule version', () => {
  const { store, task } = setup();
  store.setNextRunAt(task.id, Date.now() + 1000);
  const updated = store.update(task.id, { enabled: false });
  expect(updated.scheduleVersion).not.toBe(task.scheduleVersion);
  expect(updated.state.nextRunAtMs).toBeNull();
});

test('occurrence projection is unique while completed native results remain recorded', () => {
  const { store, task, trigger } = setup();
  const run = store.claimTrigger(trigger)!;
  expect(store.claimTrigger(trigger)).toBeNull();
  store.setRunSession(run.id, `scheduled-run:${run.id}`);
  expect(store.listPendingRuns()).toMatchObject([
    { id: run.id, sessionId: `scheduled-run:${run.id}` },
  ]);
  const finished = store.finishRun(run.id, { status: TaskStatus.Success });
  expect(finished.sessionId).toBe(`scheduled-run:${run.id}`);
  expect(store.listPendingRuns()).toEqual([]);
  expect(store.hasTrigger(task.id, task.scheduleVersion!, trigger.scheduledAt)).toBe(true);
});

test('paused tasks reject timer occurrences but still allow explicit manual execution', () => {
  const { store, task, trigger } = setup();
  const paused = store.update(task.id, { enabled: false });
  const input = { ...trigger, scheduleVersion: paused.scheduleVersion! };
  expect(store.claimTrigger(input)).toBeNull();
  expect(store.claimTrigger(input, { allowDisabled: true })?.status).toBe(TaskStatus.Running);
});

test('ending one run does not hide another active native submission', () => {
  const { store, task, trigger } = setup();
  const first = store.claimTrigger(trigger)!;
  const second = store.claimTrigger({ ...trigger, scheduledAt: '2026-10-14T00:01:00Z' })!;
  store.finishRun(first.id, { status: TaskStatus.Success });
  expect(store.get(task.id)?.state.runningAtMs).not.toBeNull();
  store.finishRun(second.id, { status: TaskStatus.Error, error: 'aborted' });
  expect(store.get(task.id)?.state.runningAtMs).toBeNull();
});

test('removed channel routing is neither returned nor given an active delivery table', () => {
  const { db, store, task } = setup();
  db.prepare('UPDATE zhiyuan_scheduled_tasks SET delivery_json = ? WHERE id = ?').run(
    '{invalid retired data',
    task.id,
  );
  expect(store.get(task.id)).not.toHaveProperty('delivery');
  store.update(task.id, { name: 'changed' });
  expect(
    db.prepare('SELECT delivery_json FROM zhiyuan_scheduled_tasks WHERE id = ?').get(task.id),
  ).toEqual({ delivery_json: '{invalid retired data' });
  expect(
    db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'zhiyuan_scheduled_task_deliveries'")
      .get(),
  ).toBeUndefined();
});

test('editing a task timeout never changes the original run cancellation deadline', () => {
  const { store, task, trigger } = setup();
  const run = store.claimTrigger(trigger)!;
  expect(run.deadlineAtMs).toBe(Date.parse(run.startedAt) + 300_000);
  store.update(task.id, {
    payload: { kind: PayloadKind.AgentTurn, message: 'updated', timeoutSeconds: 3600 },
  });
  expect(store.listPendingRuns()[0].deadlineAtMs).toBe(run.deadlineAtMs);
  const next = store.claimTrigger({ ...trigger, scheduledAt: '2026-10-14T00:01:00Z' })!;
  expect(next.deadlineAtMs).toBe(Date.parse(next.startedAt) + 3_600_000);
});
