export const DurableScheduling = {
  Paused: 'paused',
  Running: 'running',
  Closing: 'closing',
} as const;

export const DurableResumeBlockedReason = {
  NoPendingWork: 'no_pending_work',
  AlreadyRunning: 'already_running',
  Closing: 'closing',
  MissingTaskDefinition: 'missing_task_definition',
} as const;
