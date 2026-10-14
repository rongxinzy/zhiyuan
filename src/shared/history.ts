/** Stable source locator; never a filesystem path supplied by the renderer. */
export interface HistoryLocator {
  source: 'cowork' | 'coding';
  id: string;
}
export interface HistoryConversation {
  locator: HistoryLocator;
  openTarget?: { roomId: string; laneId: string };
  title: string;
  workspace: string;
  updatedAt: number;
  backend: 'pi' | 'legacy' | 'coding';
  readOnly: boolean;
}
export interface HistoryMessage {
  id: string;
  entryId: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
export interface HistoryPage<T> {
  items: T[];
  nextCursor?: string;
}
export interface HistoryFilters {
  source?: 'cowork' | 'coding';
  /** Inclusive UTC epoch milliseconds. List uses conversation updatedAt; search uses message timestamp. */
  since?: number;
  /** Inclusive UTC epoch milliseconds; must be at least since when both are provided. */
  until?: number;
}
export interface HistoryListRequest extends HistoryFilters {
  limit?: number;
  cursor?: string;
  workspace?: string;
}
export interface HistoryReadRequest {
  locator: HistoryLocator;
  limit?: number;
  cursor?: string;
  /** Inclusive source entry anchor, as returned by search. Cannot accompany cursor. */
  anchor?: string;
}
export interface HistorySearchRequest extends HistoryFilters {
  query: string;
  limit?: number;
  cursor?: string;
}
export interface HistorySearchHit {
  locator: HistoryLocator;
  openTarget?: { roomId: string; laneId: string };
  title: string;
  entryId: string;
  messageId: string;
  content: string;
  timestamp: number;
}
export interface HistorySearchPage extends HistoryPage<HistorySearchHit> {
  indexedAt?: number;
}
export type HistoryResult<T> = { success: true; data: T } | { success: false; error: string };
export interface HistoryApi {
  selectMaintenance(request: {
    kind: HistoryMaintenanceKind;
  }): Promise<HistoryResult<HistoryMaintenanceSelection | null>>;
  confirmMaintenance(request: { selectionId: string }): Promise<HistoryResult<{ scheduled: true }>>;
  maintenanceStatus(): Promise<HistoryResult<HistoryMaintenanceStatus | null>>;
  list(request?: HistoryListRequest): Promise<HistoryResult<HistoryPage<HistoryConversation>>>;
  /** Entries are chronological within each page; nextCursor requests an older page. */
  readPage(request: HistoryReadRequest): Promise<HistoryResult<HistoryPage<HistoryMessage>>>;
  search(request: HistorySearchRequest): Promise<HistoryResult<HistorySearchPage>>;
  rebuildIndex(): Promise<HistoryResult<{ indexedAt: number; conversations: number }>>;
}
export const HistoryIpc = {
  SelectMaintenance: 'history:selectMaintenance',
  ConfirmMaintenance: 'history:confirmMaintenance',
  MaintenanceStatus: 'history:maintenanceStatus',
  List: 'history:list',
  ReadPage: 'history:readPage',
  Search: 'history:search',
  RebuildIndex: 'history:rebuildIndex',
} as const;

export type HistoryMaintenanceKind = 'backup' | 'restore';
export interface HistoryMaintenanceSelection {
  selectionId: string;
  displayPath: string;
  kind: HistoryMaintenanceKind;
  attachmentScope: 'managed-attachments-only';
  externalReferencesIncluded: false;
  requiresRestart: true;
}
export interface HistoryMaintenanceStatus {
  kind: HistoryMaintenanceKind;
  status: 'completed' | 'failed' | 'recovered';
  path?: string;
  rollbackPath?: string;
  error?: string;
}
