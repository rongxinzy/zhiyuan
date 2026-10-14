/** Read-only product projection. Native storage owns all execution identities and state. */
export interface DurableWorkSnapshot {
  sessionId: string;
  conversationId: number;
  scheduling: 'paused' | 'running' | 'closing';
  canResume: boolean;
  /** Stored pending work requires explicit runtime registry validation before resume. */
  resumeRequiresCheck?: boolean;
  latestInputKnown?: boolean;
  latestInput?: {
    id: number;
    status: 'queued' | 'placed' | 'done' | 'unanswered';
    reason?: string;
  };
  /** Lists/counts are bounded; true means the stored pending count is a lower bound. */
  pendingTruncated?: boolean;
  blockedReason?:
    | 'no_pending_work'
    | 'already_running'
    | 'closing'
    | 'missing_task_definition'
    | 'runtime_check_required';
  tasks: Array<{ id: number; kind: string; state: string }>;
  submissions: Array<{ id: number; status: string }>;
  pendingSubmissionCount: number;
  lastCommittedEntry?: { id: number; kind: string; text: string; timestamp?: number };
}
