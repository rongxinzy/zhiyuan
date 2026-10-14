/** Read-only product projection. Native storage owns all execution identities and state. */
export interface DurableWorkSnapshot {
  sessionId: string;
  conversationId: number;
  scheduling: 'paused' | 'running' | 'closing';
  canResume: boolean;
  blockedReason?: 'no_pending_work' | 'already_running' | 'closing' | 'missing_task_definition';
  tasks: Array<{ id: number; kind: string; state: string }>;
  submissions: Array<{ id: number; status: string }>;
  pendingSubmissionCount: number;
  lastCommittedEntry?: { id: number; kind: string; text: string; timestamp?: number };
}
