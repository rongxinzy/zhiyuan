import type { TaskBoardCard } from './taskBoardProjection';

export function resolveTaskBoardThreadKey(card: Pick<TaskBoardCard, 'sessionId' | 'taskId' | 'id'>): string {
  return card.sessionId ?? card.taskId ?? card.id;
}
