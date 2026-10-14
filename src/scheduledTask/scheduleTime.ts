import { createHash } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';

import { ScheduleKind } from './constants';
import type { ScheduledTask } from './types';

/** Computes host clock boundaries only; execution admission belongs to Pi. */
export function nextScheduleTime(
  task: Pick<ScheduledTask, 'id' | 'createdAt' | 'schedule'>,
  afterMs: number,
): number | null {
  const schedule = task.schedule;
  switch (schedule.kind) {
    case ScheduleKind.At: {
      const atMs = Date.parse(schedule.at);
      if (!Number.isFinite(atMs)) throw new Error('Scheduled task requires a valid date');
      return atMs;
    }
    case ScheduleKind.Every: {
      if (!Number.isSafeInteger(schedule.everyMs) || schedule.everyMs < 1) {
        throw new Error('Scheduled task interval must be a positive integer');
      }
      const anchorMs = schedule.anchorMs ?? Date.parse(task.createdAt);
      if (!Number.isFinite(anchorMs)) throw new Error('Scheduled task requires a valid anchor');
      const elapsed = Math.max(0, Math.floor((afterMs - anchorMs) / schedule.everyMs) + 1);
      const next = anchorMs + elapsed * schedule.everyMs;
      if (!Number.isFinite(next) || Math.abs(next) > 8.64e15) {
        throw new Error('Scheduled task interval exceeds the supported date range');
      }
      return next;
    }
    case ScheduleKind.Cron: {
      const staggerMs = schedule.staggerMs ?? 0;
      if (!Number.isSafeInteger(staggerMs) || staggerMs < 0) {
        throw new Error('Scheduled task stagger must be a non-negative integer');
      }
      // Stable per-task staggering avoids shifting a schedule on every restart.
      const offset = staggerMs
        ? createHash('sha256').update(task.id).digest().readUInt32BE(0) % staggerMs
        : 0;
      const interval = CronExpressionParser.parse(schedule.expr, {
        currentDate: new Date(afterMs - offset),
        ...(schedule.tz ? { tz: schedule.tz } : {}),
      });
      return interval.hasNext() ? interval.next().getTime() + offset : null;
    }
    default:
      throw new Error('Unsupported scheduled task schedule');
  }
}
