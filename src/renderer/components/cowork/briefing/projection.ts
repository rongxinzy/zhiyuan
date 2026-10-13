import { ActivityStatus } from '../../../../shared/activity/constants';
import type { ActivityRun } from '../../../../shared/activity/types';
import {
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../../../shared/cowork/constants';
import type { ScheduledTask } from '../../../../scheduledTask/types';
import type { CoworkPermissionRequest, CoworkSessionSummary } from '../../../types/cowork';
import { BRIEFING_ITEM_LIMIT, BriefingTarget } from './constants';

export interface BriefingItem {
  id: string;
  title: string;
  description?: string;
  reasonKey: string;
  timestamp?: number;
  target: (typeof BriefingTarget)[keyof typeof BriefingTarget];
  sessionId?: string;
  taskId?: string;
}

export interface BriefingInput {
  sessions: readonly CoworkSessionSummary[];
  permissions: readonly CoworkPermissionRequest[];
  activities: readonly ActivityRun[];
  schedules: readonly ScheduledTask[];
  now: number;
}

/** A read-only projection. Session completion describes a turn, never a finished project. */
export function buildWorkBriefing(input: BriefingInput) {
  const { sessions, permissions, activities, schedules, now } = input;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = (time: number) => time >= startOfDay.getTime() && time <= now;
  const manualWork = sessions.filter(
    session =>
      session.mode !== CoworkSessionMode.Chat && session.source === CoworkSessionSource.Manual,
  );
  const sessionById = new Map(sessions.map(session => [session.id, session]));
  const waitingIds = new Set<string>();
  const decisions: BriefingItem[] = [];
  for (const permission of permissions) {
    const session = sessionById.get(permission.sessionId);
    if (session?.mode === CoworkSessionMode.Chat || waitingIds.has(permission.sessionId)) continue;
    waitingIds.add(permission.sessionId);
    decisions.push({
      id: `decision:${permission.sessionId}`,
      title: session?.title ?? '',
      reasonKey: 'briefingNeedsDecision',
      target: BriefingTarget.Session,
      sessionId: permission.sessionId,
    });
  }

  // The same background run may also appear in the session list. Prefer its durable output.
  const activitySessionIds = new Set(activities.map(run => run.sessionId).filter(Boolean));
  const progressed: BriefingItem[] = activities
    .filter(run => run.status === ActivityStatus.Completed && today(run.updatedAt))
    .map(run => ({
      id: `activity:${run.id}`,
      title: run.taskName || run.inputPreview || '',
      description: run.replyPreview,
      reasonKey: 'briefingBackgroundCompleted',
      timestamp: run.updatedAt,
      target: BriefingTarget.Activity,
    }));
  for (const session of manualWork) {
    if (
      session.status !== CoworkSessionStatus.Completed ||
      !today(session.updatedAt) ||
      waitingIds.has(session.id) ||
      activitySessionIds.has(session.id)
    )
      continue;
    progressed.push({
      id: `session:${session.id}`,
      title: session.title,
      reasonKey: 'briefingWorkUpdated',
      timestamp: session.updatedAt,
      target: BriefingTarget.Session,
      sessionId: session.id,
    });
  }
  progressed.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  // Failed work is an invitation to inspect, not a claim that it can be resumed.
  const attention: BriefingItem[] = manualWork
    .filter(session => session.status === CoworkSessionStatus.Error && !waitingIds.has(session.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(session => ({
      id: `attention:${session.id}`,
      title: session.title,
      reasonKey: 'briefingInspectWork',
      timestamp: session.updatedAt,
      target: BriefingTarget.Session,
      sessionId: session.id,
    }));
  const upcoming: BriefingItem[] = schedules
    .filter(
      task =>
        task.enabled &&
        task.state.runningAtMs === null &&
        task.state.nextRunAtMs !== null &&
        Number.isFinite(task.state.nextRunAtMs) &&
        task.state.nextRunAtMs >= now,
    )
    .sort((a, b) => a.state.nextRunAtMs! - b.state.nextRunAtMs!)
    .map(task => ({
      id: `schedule:${task.id}`,
      title: task.name,
      reasonKey: 'briefingUpcomingSchedule',
      timestamp: task.state.nextRunAtMs!,
      target: BriefingTarget.Schedule,
      taskId: task.id,
    }));
  const next = [...attention, ...upcoming];
  return {
    decisions: decisions.slice(0, BRIEFING_ITEM_LIMIT),
    progressed: progressed.slice(0, BRIEFING_ITEM_LIMIT),
    next: next.slice(0, BRIEFING_ITEM_LIMIT),
    decisionCount: decisions.length,
    progressedCount: progressed.length,
    nextCount: next.length,
    hasHistory:
      manualWork.length > 0 ||
      activities.length > 0 ||
      schedules.length > 0 ||
      decisions.length > 0,
  };
}
