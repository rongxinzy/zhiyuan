/** The current work's native Pi Document; never a cross-work memory index. */
export type WorkDocument = {
  goal: string;
  agreements: string[];
  decisions: string[];
  progress: string[];
  revision: number;
  updatedAt: number;
};
export type WorkDocumentPatch = Partial<
  Pick<WorkDocument, 'goal' | 'agreements' | 'decisions' | 'progress'>
> & { expectedRevision: number };
export type WorkDocumentResult =
  | { success: true; data: WorkDocument }
  | { success: false; error: string };
export type WorkDocumentChanged = { sessionId: string; document: WorkDocument };
