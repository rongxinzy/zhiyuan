import type { IpcMain } from 'electron';
import type {
  WorkDocument,
  WorkDocumentPatch,
  WorkDocumentResult,
} from '../../../../shared/durable/workDocument';
import { validateWorkDocumentPatch } from './workDocument';

export function registerWorkDocumentIpc(
  ipc: Pick<IpcMain, 'handle'>,
  runtime: () => {
    getWorkDocument(sessionId: string): Promise<WorkDocument>;
    updateWorkDocument(sessionId: string, patch: WorkDocumentPatch): Promise<WorkDocument>;
  },
  sessionExists: (sessionId: string) => boolean,
): void {
  const validate = (id: unknown): string => {
    if (typeof id !== 'string' || !id.trim() || id.length > 256 || !sessionExists(id))
      throw new Error('Cowork session not found.');
    return id;
  };
  const handle = async (operation: () => Promise<WorkDocument>): Promise<WorkDocumentResult> => {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  ipc.handle('cowork:workDocument:get', (_event, id: unknown) =>
    handle(() => runtime().getWorkDocument(validate(id))),
  );
  ipc.handle('cowork:workDocument:update', (_event, id: unknown, patch: unknown) =>
    handle(() => runtime().updateWorkDocument(validate(id), validateWorkDocumentPatch(patch))),
  );
}
