export const HISTORY_PAGE_SIZE = 30;
export const CONTENT_PREVIEW_LENGTH = 16000;
export const HistorySource = { Cowork: 'cowork', Coding: 'coding' } as const;
export const HistoryRole = { User: 'user', Assistant: 'assistant', System: 'system' } as const;
export const HistoryMaintenanceKind = { Backup: 'backup', Restore: 'restore' } as const;
export const HistoryMaintenancePhase = {
  Idle: 'idle',
  Selecting: 'selecting',
  Scheduling: 'scheduling',
  Restarting: 'restarting',
  Uncertain: 'uncertain',
} as const;
