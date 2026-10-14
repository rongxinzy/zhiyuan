import { expect, test } from 'vitest';
import { ScheduleKind } from './constants';
import { nextScheduleTime } from './scheduleTime';
import type { Schedule, ScheduledTask } from './types';

function task(schedule: Schedule): ScheduledTask {
  return { id: 'stable-task', createdAt: '2026-10-14T00:00:00Z', schedule } as ScheduledTask;
}

test('interval follows a future anchor and then strict future boundaries', () => {
  const anchorMs = Date.parse('2026-10-14T00:10:00Z');
  const input = task({ kind: ScheduleKind.Every, everyMs: 60_000, anchorMs });
  expect(nextScheduleTime(input, anchorMs - 1)).toBe(anchorMs);
  expect(nextScheduleTime(input, anchorMs)).toBe(anchorMs + 60_000);
});

test('invalid dates, intervals and cron expressions are rejected', () => {
  for (const schedule of [
    { kind: ScheduleKind.At, at: 'not a date' },
    { kind: ScheduleKind.Every, everyMs: 0 },
    { kind: ScheduleKind.Every, everyMs: Infinity },
    { kind: ScheduleKind.Cron, expr: '* nope' },
    { kind: ScheduleKind.Cron, expr: '* * * * *', tz: 'Invalid/Timezone' },
    { kind: ScheduleKind.Cron, expr: '* * * * *', staggerMs: -1 },
  ] as Schedule[]) {
    expect(() => nextScheduleTime(task(schedule), Date.now())).toThrow();
  }
});

test('cron respects daylight-saving changes in the configured timezone', () => {
  const input = task({ kind: ScheduleKind.Cron, expr: '0 9 * * *', tz: 'America/New_York' });
  const before = Date.parse('2026-03-07T14:00:00Z');
  expect(nextScheduleTime(input, before)).toBe(Date.parse('2026-03-08T13:00:00Z'));
});

test('stagger is stable across restarts and leaves the next occurrence in the future', () => {
  const input = task({ kind: ScheduleKind.Cron, expr: '0 * * * *', tz: 'UTC', staggerMs: 60_000 });
  const now = Date.parse('2026-10-14T00:30:00Z');
  const next = nextScheduleTime(input, now)!;
  expect(next).toBe(nextScheduleTime(input, now));
  expect(next).toBeGreaterThanOrEqual(Date.parse('2026-10-14T01:00:00Z'));
  expect(next).toBeLessThan(Date.parse('2026-10-14T01:01:00Z'));
  expect(nextScheduleTime(input, next)).toBe(next + 60 * 60_000);
});
