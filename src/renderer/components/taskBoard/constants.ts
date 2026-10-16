export const TaskBoardColumnId = {
  Pending: 'pending',
  InProgress: 'inProgress',
  NeedsAttention: 'needsAttention',
  AwaitingConfirm: 'awaitingConfirm',
  Completed: 'completed',
} as const;

export type TaskBoardColumnId = (typeof TaskBoardColumnId)[keyof typeof TaskBoardColumnId];

/** Minimum column width when the detail panel is open (horizontal scroll). */
export const TASK_BOARD_COLUMN_MIN_WIDTH_REM = 11;

export const TASK_BOARD_COLUMN_ORDER: TaskBoardColumnId[] = [
  TaskBoardColumnId.Pending,
  TaskBoardColumnId.InProgress,
  TaskBoardColumnId.NeedsAttention,
  TaskBoardColumnId.AwaitingConfirm,
  TaskBoardColumnId.Completed,
];
