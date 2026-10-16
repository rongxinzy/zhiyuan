export const TaskBoardIpc = {
  WorkEvent: 'task-board:workEvent',
} as const;
export type TaskBoardIpc = (typeof TaskBoardIpc)[keyof typeof TaskBoardIpc];

export const TaskBoardWorkEventKind = {
  Started: 'started',
  NeedsConfirmation: 'needs_confirmation',
  ResultProduced: 'result_produced',
  Failed: 'failed',
} as const;
export type TaskBoardWorkEventKind =
  (typeof TaskBoardWorkEventKind)[keyof typeof TaskBoardWorkEventKind];

export const TaskBoardThreadAuthor = {
  User: 'user',
  Ai: 'ai',
  System: 'system',
} as const;
export type TaskBoardThreadAuthor =
  (typeof TaskBoardThreadAuthor)[keyof typeof TaskBoardThreadAuthor];

export interface TaskBoardWorkEvent {
  kind: TaskBoardWorkEventKind;
  /** Stable thread key: session id, task id, or card id. */
  threadKey: string;
  sessionId?: string;
  taskId?: string;
  activityId?: string;
  /** Latest AI-written result summary when available. */
  summary?: string;
  timestamp: number;
}

export interface TaskBoardThreadEntry {
  id: string;
  threadKey: string;
  author: TaskBoardThreadAuthor;
  body: string;
  createdAt: number;
}
