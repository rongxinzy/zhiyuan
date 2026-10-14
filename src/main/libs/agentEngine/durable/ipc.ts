import type { IpcMain } from 'electron';
import type { DurableWorkSnapshot } from '../../../../shared/durable/types';

export interface DurableIpcRuntime {
  getDurableWork(sessionId: string): Promise<DurableWorkSnapshot | undefined>;
  resumeDurableWork(sessionId: string): Promise<void>;
}

export function registerDurableIpc(
  ipc: Pick<IpcMain, 'handle'>,
  runtime: () => DurableIpcRuntime,
  sessionExists: (sessionId: string) => boolean,
): void {
  function validate(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || !sessionExists(value)) {
      throw new Error('Cowork session not found.');
    }
    return value;
  }
  ipc.handle('cowork:getDurableWork', async (_event, value: unknown) => {
    try {
      return { success: true, snapshot: await runtime().getDurableWork(validate(value)) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipc.handle('cowork:resumeDurableWork', async (_event, value: unknown) => {
    try {
      await runtime().resumeDurableWork(validate(value));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
