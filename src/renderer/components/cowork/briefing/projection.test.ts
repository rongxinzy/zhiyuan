import { expect, test } from 'vitest';

import {
  ActivityErrorCode,
  ActivitySource,
  ActivityStatus,
} from '../../../../shared/activity/constants';
import {
  CoworkPermissionOrigin,
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../../../shared/cowork/constants';
import { SessionTarget, WakeMode } from '../../../../scheduledTask/constants';
import type { ScheduledTask } from '../../../../scheduledTask/types';
import type { CoworkSessionSummary } from '../../../types/cowork';
import { buildWorkBriefing, pageBriefingItems, type BriefingInput } from './projection';
import { BriefingTarget } from './constants';

const now = new Date(2026, 9, 13, 12).getTime();
const session = (
  id: string,
  overrides: Partial<CoworkSessionSummary> = {},
): CoworkSessionSummary => ({
  id,
  title: id,
  status: CoworkSessionStatus.Completed,
  mode: CoworkSessionMode.Work,
  pinned: false,
  source: CoworkSessionSource.Manual,
  createdAt: now - 1000,
  updatedAt: now,
  ...overrides,
});
const project = (overrides: Partial<BriefingInput> = {}) =>
  buildWorkBriefing({
    sessions: [],
    permissions: [],
    activities: [],
    schedules: [],
    now,
    ...overrides,
  });
const schedule = (id: string, nextRunAtMs: number | null, enabled = true): ScheduledTask => ({
  id,
  name: id,
  description: '',
  enabled,
  schedule: { kind: 'every', everyMs: 60_000 },
  sessionTarget: SessionTarget.Isolated,
  wakeMode: WakeMode.Now,
  payload: { kind: 'agentTurn', message: 'work' },
  workspaceId: null,
  sessionKey: null,
  createdAt: '',
  updatedAt: '',
  state: {
    nextRunAtMs,
    lastRunAtMs: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
    runningAtMs: null,
    consecutiveErrors: 0,
  },
});

test('has an honest new-user state without invented suggestions', () => {
  expect(project()).toMatchObject({ decisions: [], progressed: [], next: [], hasHistory: false });
});

test('keeps failed scheduled and channel runs visible with their real error records', () => {
  const result = project({
    activities: [
      {
        id: 'cron-failed',
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Failed,
        startedAt: now - 10,
        updatedAt: now,
        taskName: 'Nightly report',
        errorMessage: 'Report upload failed',
      },
      {
        id: 'channel-failed',
        source: ActivitySource.Channel,
        status: ActivityStatus.Failed,
        startedAt: now - 20,
        updatedAt: now - 10,
        errorMessage: ActivityErrorCode.Interrupted,
      },
    ],
  });
  expect(result.nextCount).toBe(2);
  expect(result.next[0]).toMatchObject({
    target: BriefingTarget.Activity,
    description: 'Report upload failed',
  });
  expect(result.next[1]).toMatchObject({
    target: BriefingTarget.Activity,
    activityErrorMessage: ActivityErrorCode.Interrupted,
  });
  expect(result.next[1].description).toBeUndefined();
  expect(result.progressed).toEqual([]);
});

test('deduplicates failures by session and prefers the newest durable error over the session row', () => {
  const result = project({
    sessions: [session('same', { status: CoworkSessionStatus.Error })],
    activities: [1, 2].map(index => ({
      id: `failed-${index}`,
      sessionId: 'same',
      source: ActivitySource.ScheduledTask,
      status: ActivityStatus.Failed,
      startedAt: now - 100,
      updatedAt: now - 3 + index,
      errorMessage: `failure ${index}`,
    })),
  });
  expect(result.nextCount).toBe(1);
  expect(result.next[0]).toMatchObject({ id: 'activity:failed-2', description: 'failure 2' });
});

test('groups live approvals by work and excludes Chat approvals and completed duplicates', () => {
  const result = project({
    sessions: [session('work'), session('chat', { mode: CoworkSessionMode.Chat })],
    permissions: ['work', 'work', 'chat'].map((sessionId, index) => ({
      sessionId,
      requestId: String(index),
      toolName: 'Bash',
      toolInput: {},
      origin: CoworkPermissionOrigin.PiWorkbench,
    })),
  });
  expect(result.decisionCount).toBe(1);
  expect(result.decisions[0].sessionId).toBe('work');
  expect(result.decisions[0].headlineI18nKey).toBeTruthy();
  expect(result.progressed).toEqual([]);
});

test('uses local today and prefers background output without counting the session twice', () => {
  const result = project({
    sessions: [
      session('manual'),
      session('duplicate'),
      session('yesterday', { updatedAt: now - 86_400_000 }),
      session('running', { status: CoworkSessionStatus.Running }),
    ],
    activities: [
      {
        id: 'run',
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Completed,
        startedAt: now - 1000,
        updatedAt: now,
        sessionId: 'duplicate',
        replyPreview: 'Actual output',
      },
      {
        id: 'future',
        source: ActivitySource.Channel,
        status: ActivityStatus.Completed,
        startedAt: now,
        updatedAt: now + 1,
      },
    ],
  });
  expect(result.progressedCount).toBe(3);
  expect(result.progressed.map(item => item.id)).toEqual([
    'session:running',
    'activity:run',
    'session:manual',
  ]);
  expect(result.progressed[1].description).toBe('Actual output');
});

test('suggests inspecting failed work, never treats idle or completed history as resumable', () => {
  const result = project({
    sessions: [
      session('failed', { status: CoworkSessionStatus.Error }),
      session('idle', { status: CoworkSessionStatus.Idle }),
      session('complete'),
    ],
  });
  expect(result.next).toHaveLength(1);
  expect(result.next[0]).toMatchObject({ sessionId: 'failed', reasonKey: 'briefingInspectWork' });
});

test('shows valid future schedules and retains all loaded records for bounded paging', () => {
  const result = project({
    schedules: [
      schedule('later', now + 100),
      schedule('next', now + 10),
      schedule('disabled', now + 5, false),
      schedule('overdue', now - 1),
      schedule('invalid', NaN),
      schedule('none', null),
      {
        ...schedule('running', now + 3),
        state: { ...schedule('running', now + 3).state, runningAtMs: now },
      },
    ],
  });
  expect(result.next.map(item => item.taskId)).toEqual(['next', 'later']);
  const bounded = project({ sessions: Array.from({ length: 8 }, (_, i) => session(String(i))) });
  expect(bounded.progressed).toHaveLength(8);
  expect(bounded.progressedCount).toBe(8);
  const first = pageBriefingItems(bounded.progressed, 0);
  const second = pageBriefingItems(bounded.progressed, 1);
  expect(first.items).toHaveLength(5);
  expect(second.items).toHaveLength(3);
  expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(8);
  expect(second).toMatchObject({ from: 6, to: 8, page: 1, pageCount: 2 });
  expect(pageBriefingItems(bounded.progressed.slice(0, 2), 1)).toMatchObject({
    page: 0,
    from: 1,
    to: 2,
  });
  expect(pageBriefingItems([], 99)).toMatchObject({ page: 0, from: 0, to: 0, items: [] });
});

test('surfaces running work regardless of start date and provides its real session destination', () => {
  const result = project({
    sessions: [
      session('active', { status: CoworkSessionStatus.Running, updatedAt: now - 86_400_000 }),
    ],
    activities: [
      {
        id: 'background-active',
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Running,
        startedAt: now - 86_400_000,
        updatedAt: now - 1000,
        sessionId: 'background-session',
        replyPreview: 'Partial result',
      },
    ],
  });
  expect(result.progressed).toHaveLength(2);
  expect(
    result.progressed.every(item => item.running && item.reasonKey === 'briefingRunning'),
  ).toBe(true);
  expect(result.progressed[0]).toMatchObject({
    sessionId: 'background-session',
    description: 'Partial result',
  });
  expect(result.next).toEqual([]);
});
