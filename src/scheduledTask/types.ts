import type { SessionTarget, TaskStatus, WakeMode } from './constants';

export interface ScheduleAt {
  kind: 'at';
  at: string;
}

export interface ScheduleEvery {
  kind: 'every';
  everyMs: number;
  anchorMs?: number;
}

export interface ScheduleCron {
  kind: 'cron';
  expr: string;
  tz?: string;
  staggerMs?: number;
}

export type Schedule = ScheduleAt | ScheduleEvery | ScheduleCron;

export interface AgentTurnPayload {
  kind: 'agentTurn';
  message: string;
  timeoutSeconds?: number;
  model?: string;
}

export interface SystemEventPayload {
  kind: 'systemEvent';
  text: string;
}

export type ScheduledTaskPayload = AgentTurnPayload | SystemEventPayload;

export type TaskLastStatus = TaskStatus | null;

export interface TaskState {
  nextRunAtMs: number | null;
  lastRunAtMs: number | null;
  lastStatus: TaskLastStatus;
  lastError: string | null;
  lastDurationMs: number | null;
  runningAtMs: number | null;
  consecutiveErrors: number;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule: Schedule;
  sessionTarget: SessionTarget;
  wakeMode: WakeMode;
  payload: ScheduledTaskPayload;
  /** Workspace whose configuration and working directory are inherited when the task runs. */
  workspaceId: string | null;
  sessionKey: string | null;
  /** Changes whenever a trigger-affecting task definition changes. */
  scheduleVersion?: string;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  sessionId: string | null;
  sessionKey: string | null;
  status: TaskStatus;
  startedAt: string;
  /** Original cancellation deadline; null means no host deadline was recorded. */
  deadlineAtMs?: number | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface ScheduledTaskRunWithName extends ScheduledTaskRun {
  taskName: string;
  taskPayload?: string;
}

export interface ScheduledTaskInput {
  name: string;
  description: string;
  enabled: boolean;
  schedule: Schedule;
  sessionTarget: SessionTarget;
  wakeMode: WakeMode;
  payload: ScheduledTaskPayload;
  /** Workspace whose configuration and working directory are inherited when the task runs. */
  workspaceId?: string | null;
  sessionKey?: string | null;
}

export interface ScheduledTaskStatusEvent {
  taskId: string;
  state: TaskState;
}

export interface ScheduledTaskRunEvent {
  run: ScheduledTaskRunWithName;
}

export type ScheduledTaskViewMode = 'list' | 'create' | 'edit' | 'detail';

export interface RunFilter {
  /** ISO date string (YYYY-MM-DD), inclusive lower bound for startedAt */
  startDate?: string;
  /** ISO date string (YYYY-MM-DD), inclusive upper bound for startedAt */
  endDate?: string;
  /** Filter by task run status */
  status?: string;
}
