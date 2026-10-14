import { afterEach, expect, test, vi } from 'vitest';

import type { CoworkSession } from '../main/coworkStore';
import { CoworkSessionSource } from '../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../shared/workbenchTask';
import { PayloadKind, ScheduleKind, SessionTarget, TaskStatus, WakeMode } from './constants';
import { PiScheduledTaskExecutor } from './piScheduledTaskExecutor';
import type { ScheduledTask, ScheduledTaskRun } from './types';

const task: ScheduledTask = {
  id: 'task',
  name: 'task',
  description: '',
  enabled: true,
  schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
  sessionTarget: SessionTarget.Isolated,
  wakeMode: WakeMode.Now,
  payload: { kind: PayloadKind.AgentTurn, message: 'run' },
  workspaceId: 'finance-workspace',
  sessionKey: null,
  state: {
    nextRunAtMs: null,
    lastRunAtMs: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
    runningAtMs: null,
    consecutiveErrors: 0,
  },
  createdAt: '',
  updatedAt: '',
};
const run: ScheduledTaskRun = {
  id: 'run',
  taskId: task.id,
  sessionId: null,
  sessionKey: null,
  status: TaskStatus.Running,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: null,
  error: null,
};

function setup() {
  const sessions = new Map<string, CoworkSession>();
  const createSession = vi.fn((...args: unknown[]) => {
    const session = {
      id: args[8],
      cwd: args[1],
      systemPrompt: args[2],
      executionMode: args[3],
      activeSkillIds: args[4],
      agentId: args[5],
      modelOverride: args[6],
      mode: args[7],
      workspaceId: args[9],
      experts: args[10],
      source: args[11],
      messages: [{ id: 'answer', type: 'assistant', content: 'done', timestamp: 1 }],
    } as CoworkSession;
    sessions.set(session.id, session);
    return session;
  });
  const store = {
    getConfig: () => ({ systemPrompt: 'Default prompt', executionMode: 'local' }),
    getWorkspace: () => ({ id: task.workspaceId, path: '/finance' }),
    createSession,
    getSession: (id: string) => sessions.get(id) ?? null,
  };
  const runtime = {
    runScheduledTask: vi.fn(async () => ({ submissionId: 1, conversationId: 2 })),
    cancelScheduledTask: vi.fn(async () => undefined),
  };
  const bindRunSession = vi.fn();
  const executor = new PiScheduledTaskExecutor(runtime as never, store as never, bindRunSession);
  return { executor, store, runtime, sessions, bindRunSession };
}

test('submits a stable per-run native request with normal unattended approval rules', async () => {
  const { executor, runtime, store, bindRunSession } = setup();
  await expect(executor.execute(task, run)).resolves.toEqual({
    sessionId: 'scheduled-run:run',
    output: 'done',
  });
  expect(runtime.runScheduledTask).toHaveBeenCalledWith(
    'scheduled-run:run',
    'run',
    expect.objectContaining({
      requestId: 'scheduled:run',
      approvalMode: WorkbenchApprovalMode.Ask,
      unattended: true,
      workspaceRoot: '/finance',
    }),
  );
  expect(store.createSession).toHaveBeenCalledWith(
    '[定时]task',
    '/finance',
    'Default prompt',
    'local',
    [],
    'main',
    '',
    'work',
    'scheduled-run:run',
    task.workspaceId,
    [],
    CoworkSessionSource.Scheduled,
  );
  expect(bindRunSession).toHaveBeenCalledWith('run', 'scheduled-run:run');
});

test('reattaching the same run preserves original session configuration and request identity', async () => {
  const { executor, runtime, store } = setup();
  await executor.execute(task, run);
  await executor.execute(
    {
      ...task,
      workspaceId: 'changed',
      payload: { kind: PayloadKind.AgentTurn, message: 'changed', model: 'changed' },
    },
    { ...run, sessionId: 'scheduled-run:run' },
  );
  expect(store.createSession).toHaveBeenCalledOnce();
  expect(runtime.runScheduledTask).toHaveBeenLastCalledWith(
    'scheduled-run:run',
    'changed',
    expect.objectContaining({
      requestId: 'scheduled:run',
      workspaceRoot: '/finance',
      systemPrompt: 'Default prompt',
      modelOverride: undefined,
    }),
  );
});

test('each occurrence gets a separate native conversation even when task binding is selected', async () => {
  const { executor, runtime, store } = setup();
  await executor.execute({ ...task, sessionTarget: SessionTarget.Task }, run);
  await executor.execute({ ...task, sessionTarget: SessionTarget.Task }, { ...run, id: 'run-2' });
  expect(store.createSession).toHaveBeenCalledTimes(2);
  expect(runtime.runScheduledTask.mock.calls.map(call => call[0])).toEqual([
    'scheduled-run:run',
    'scheduled-run:run-2',
  ]);
});

test('inherits selected chat configuration without executing in or cancelling that chat', async () => {
  const { executor, sessions, runtime } = setup();
  sessions.set('chat', {
    id: 'chat',
    cwd: '/original',
    systemPrompt: 'Original prompt',
    executionMode: 'local',
    activeSkillIds: ['skill'],
    modelOverride: 'model',
    mode: 'work',
    experts: [],
    workspaceId: 'source-workspace',
  } as unknown as CoworkSession);
  await executor.execute(
    { ...task, sessionTarget: SessionTarget.Main, sessionKey: 'zhiyuan:chat' },
    run,
  );
  expect(runtime.runScheduledTask).toHaveBeenCalledWith(
    'scheduled-run:run',
    'run',
    expect.objectContaining({
      workspaceRoot: '/original',
      systemPrompt: 'Original prompt',
      skillIds: ['skill'],
      modelOverride: 'model',
    }),
  );
  await executor.cancel({ ...run, sessionId: 'chat' });
  expect(runtime.cancelScheduledTask).toHaveBeenCalledWith('scheduled-run:run');
});

test('completion waits for native submission and propagates native cancellation', async () => {
  const { executor, runtime } = setup();
  let reject!: (error: Error) => void;
  runtime.runScheduledTask.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  const running = executor.execute(task, run);
  let completed = false;
  void running.then(
    () => {
      completed = true;
    },
    () => undefined,
  );
  await Promise.resolve();
  expect(completed).toBe(false);
  reject(new Error('Native submission aborted'));
  await expect(running).rejects.toThrow('Native submission aborted');
});

afterEach(() => vi.useRealTimers());

test('deadline aborts the native run without synthesizing a host completion and keeps the original deadline on restart', async () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-14T00:04:00Z');
  const { executor, runtime } = setup();
  let reject!: (error: Error) => void;
  runtime.runScheduledTask.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  const running = executor.execute(task, {
    ...run,
    startedAt: '2026-10-14T00:00:00Z',
    deadlineAtMs: Date.parse('2026-10-14T00:05:00Z'),
  });
  await vi.advanceTimersByTimeAsync(59_999);
  expect(runtime.cancelScheduledTask).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(runtime.cancelScheduledTask).toHaveBeenCalledWith('scheduled-run:run');
  reject(new Error('Native submission aborted'));
  await expect(running).rejects.toThrow('Native submission aborted');
  expect(vi.getTimerCount()).toBe(0);
});
