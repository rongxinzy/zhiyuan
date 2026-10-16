export const TaskBoardColumnId = {
  Pending: 'pending',
  InProgress: 'inProgress',
  NeedsAttention: 'needsAttention',
  AwaitingConfirm: 'awaitingConfirm',
  Completed: 'completed',
} as const;

export type TaskBoardColumnId = (typeof TaskBoardColumnId)[keyof typeof TaskBoardColumnId];

export const TASK_BOARD_COLUMN_ORDER: TaskBoardColumnId[] = [
  TaskBoardColumnId.Pending,
  TaskBoardColumnId.InProgress,
  TaskBoardColumnId.NeedsAttention,
  TaskBoardColumnId.AwaitingConfirm,
  TaskBoardColumnId.Completed,
];
