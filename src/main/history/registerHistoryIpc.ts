import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type Database from 'better-sqlite3';
import {
  HistoryIpc,
  type HistoryListRequest,
  type HistoryReadRequest,
  type HistorySearchRequest,
} from '../../shared/history';
import { HistoryReader, type NativeHistoryReader } from './historyReader';
import { HistoryIndex } from './historyIndex';
import { HistoryMaintenanceController, type HistoryMaintenanceOptions } from './historyMaintenance';

export interface HistoryIpcOptions {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  /** Existing application database; this module only reads its authority tables. */
  db: Database.Database;
  /** Separate disposable index database. The owner closes it after dispose/drain. */
  indexDb: Database.Database;
  native: NativeHistoryReader;
  maintenance?: HistoryMaintenanceOptions;
  assertTrustedSender(event: IpcMainInvokeEvent): void;
}
export function registerHistoryIpc(options: HistoryIpcOptions) {
  const reader = new HistoryReader(options.db, options.native, options.maintenance?.dataRoot);
  const index = new HistoryIndex(options.indexDb, reader);
  const maintenance = options.maintenance
    ? new HistoryMaintenanceController(options.maintenance)
    : undefined;
  const handlers: Record<string, (request: unknown) => Promise<unknown>> = {
    [HistoryIpc.List]: request => reader.list((request ?? {}) as HistoryListRequest),
    [HistoryIpc.ReadPage]: request => reader.readPage(request as HistoryReadRequest),
    [HistoryIpc.Search]: request => index.search(request as HistorySearchRequest),
    [HistoryIpc.RebuildIndex]: () => index.rebuild(),
  };
  if (maintenance) {
    handlers[HistoryIpc.SelectMaintenance] = request =>
      maintenance.select(request as Parameters<typeof maintenance.select>[0]);
    handlers[HistoryIpc.ConfirmMaintenance] = request =>
      maintenance.confirm(request as Parameters<typeof maintenance.confirm>[0]);
    handlers[HistoryIpc.MaintenanceStatus] = () => maintenance.status();
  }
  let closed = false;
  const active = new Set<Promise<unknown>>();
  for (const [channel, handler] of Object.entries(handlers))
    options.ipcMain.handle(channel, async (event, request: unknown) => {
      try {
        options.assertTrustedSender(event);
        if (closed) throw new Error('History service is closing');
        const pending = handler(request);
        active.add(pending);
        try {
          return { success: true, data: await pending };
        } finally {
          active.delete(pending);
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  return {
    reader,
    index,
    /** Call on committed Cowork/Coding changes, including rename/delete and stream flush. */
    invalidate: () => index.invalidate(),
    async dispose() {
      closed = true;
      for (const channel of Object.keys(handlers)) options.ipcMain.removeHandler(channel);
      await Promise.allSettled([...active]);
    },
  };
}
