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
import { SessionTarget, WakeMode, DeliveryMode } from '../../../../scheduledTask/constants';
import type { ScheduledTask } from '../../../../scheduledTask/types';
import type { CoworkSessionSummary } from '../../../types/cowork';
import { buildWorkBriefing, type BriefingInput } from './projection';
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
  delivery: { mode: DeliveryMode.None },
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
    descriptionKey: 'activityErrorInterrupted',
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
  expect(result.progressedCount).toBe(2);
  expect(result.progressed.map(item => item.id)).toEqual(['activity:run', 'session:manual']);
  expect(result.progressed[0].description).toBe('Actual output');
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

test('shows only valid enabled future schedules, nearest first, with bounded lists', () => {
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
  expect(bounded.progressed).toHaveLength(5);
  expect(bounded.progressedCount).toBe(8);
});
