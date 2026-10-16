import { PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import {
  TaskBoardWorkEventKind,
  type TaskBoardWorkEvent,
} from '../../shared/taskBoard/constants';

export function mapPiUiEventToWorkEvent(event: PiUiEvent): TaskBoardWorkEvent | null {
  const timestamp = event.emittedAt ?? Date.now();
  if (event.type === PiUiEventType.Started && event.sessionId) {
    return {
      kind: TaskBoardWorkEventKind.Started,
      threadKey: event.sessionId,
      sessionId: event.sessionId,
      timestamp,
    };
  }
  if (event.type === PiUiEventType.PermissionRequest && event.sessionId) {
    return {
      kind: TaskBoardWorkEventKind.NeedsConfirmation,
      threadKey: event.sessionId,
      sessionId: event.sessionId,
      timestamp,
    };
  }
  if (event.type === PiUiEventType.Completed && event.sessionId) {
    return {
      kind: TaskBoardWorkEventKind.ResultProduced,
      threadKey: event.sessionId,
      sessionId: event.sessionId,
      timestamp,
    };
  }
  if (event.type === PiUiEventType.Error && event.sessionId) {
    return {
      kind: TaskBoardWorkEventKind.Failed,
      threadKey: event.sessionId,
      sessionId: event.sessionId,
      summary: event.error.message,
      timestamp,
    };
  }
  return null;
}
