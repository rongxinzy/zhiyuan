import { ActivityStatus } from '../../shared/activity/constants';
import type { ActivityRun } from '../../shared/activity/types';
import {
  TaskBoardWorkEventKind,
  type TaskBoardWorkEvent,
} from '../../shared/taskBoard/constants';

export function mapActivityRunToWorkEvent(run: ActivityRun): TaskBoardWorkEvent | null {
  const threadKey = run.sessionId ?? `activity:${run.id}`;
  if (run.status === ActivityStatus.Running) {
    return {
      kind: TaskBoardWorkEventKind.Started,
      threadKey,
      sessionId: run.sessionId,
      activityId: run.id,
      summary: run.replyPreview ?? run.inputPreview,
      timestamp: run.updatedAt,
    };
  }
  if (run.status === ActivityStatus.Completed) {
    return {
      kind: TaskBoardWorkEventKind.ResultProduced,
      threadKey,
      sessionId: run.sessionId,
      activityId: run.id,
      summary: run.replyPreview ?? run.taskName,
      timestamp: run.updatedAt,
    };
  }
  if (run.status === ActivityStatus.Failed) {
    return {
      kind: TaskBoardWorkEventKind.Failed,
      threadKey,
      sessionId: run.sessionId,
      activityId: run.id,
      summary: run.replyPreview ?? run.taskName,
      timestamp: run.updatedAt,
    };
  }
  return null;
}
