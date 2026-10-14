export const CoworkContentPolicy = {
  PreviewCharacters: 2_000,
  ContentChunkCharacters: 60_000,
  MaximumContentCharacters: 2_000_000,
} as const;

export interface CoworkContentPatch {
  sessionId: string;
  messageId: string;
  revision: number;
  baseRevision: number;
  offset: number;
  content: string;
  totalLength: number;
  complete: boolean;
  truncated: boolean;
  metadata?: Record<string, unknown>;
}
