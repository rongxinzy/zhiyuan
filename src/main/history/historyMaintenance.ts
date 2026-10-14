import { readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  HistoryMaintenanceKind,
  HistoryMaintenanceSelection,
  HistoryMaintenanceStatus,
} from '../../shared/history';
import type { ArchiveInventoryOptions } from './archiveFiles';
import {
  createHistoryArchive,
  cleanupInterruptedHistoryExport,
  restoreHistoryArchive,
  recoverHistoryRestore,
  validateHistoryArchive,
} from './historyArchive';
const PENDING = '.history-maintenance-pending.json';
const RUNNING = '.history-maintenance-running.json';
const RESULT = 'history-maintenance-result.json';
interface Intent {
  version: 1;
  kind: HistoryMaintenanceKind;
  path: string;
}
async function readOptional<T>(path: string): Promise<T | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
      throw new Error('Invalid history maintenance record');
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function readHistoryMaintenanceStatus(
  dataRoot: string,
): Promise<HistoryMaintenanceStatus | null> {
  return readOptional(join(dataRoot, RESULT));
}
/** Called under the app single-instance lock, before initStore, any native owner, or cron starts. */
export async function runPendingHistoryMaintenance(
  dataRoot: string,
  options: ArchiveInventoryOptions = {},
): Promise<HistoryMaintenanceStatus | null> {
  const interrupted = await readOptional<Intent>(join(dataRoot, RUNNING));
  const recovered = await recoverHistoryRestore(dataRoot); // Failure here MUST block normal startup.
  if (interrupted || recovered) {
    if (
      interrupted?.kind === 'backup' &&
      typeof interrupted.path === 'string' &&
      isAbsolute(interrupted.path)
    )
      await cleanupInterruptedHistoryExport(dataRoot, interrupted.path);
    const result: HistoryMaintenanceStatus = {
      kind: interrupted?.kind ?? 'restore',
      status: recovered ? 'recovered' : 'failed',
      error: 'A history maintenance operation was interrupted',
    };
    await writeFile(join(dataRoot, RESULT), JSON.stringify(result), { flush: true });
    await rm(join(dataRoot, RUNNING), { force: true });
    return result;
  }
  const intent = await readOptional<Intent>(join(dataRoot, PENDING));
  if (!intent) return null;
  if (
    intent.version !== 1 ||
    !['backup', 'restore'].includes(intent.kind) ||
    typeof intent.path !== 'string' ||
    !isAbsolute(intent.path)
  )
    throw new Error('Invalid history maintenance request');
  await rename(join(dataRoot, PENDING), join(dataRoot, RUNNING));
  let result: HistoryMaintenanceStatus;
  try {
    if (intent.kind === 'backup') {
      const archive = await createHistoryArchive(dataRoot, intent.path, options);
      result = { kind: 'backup', status: 'completed', path: archive.path };
    } else {
      const restored = await restoreHistoryArchive(dataRoot, intent.path, options);
      for (const name of [
        'history-index.sqlite',
        'history-index.sqlite-wal',
        'history-index.sqlite-shm',
      ])
        await rm(join(dataRoot, name), { force: true });
      result = {
        kind: 'restore',
        status: 'completed',
        path: intent.path,
        rollbackPath: restored.rollbackPath,
      };
    }
  } catch (error) {
    // A surviving journal means rollback did not complete. Do not let the host open a mixed set of roots.
    if (await readOptional(join(dataRoot, '.history-restore-journal.json'))) throw error;
    result = {
      kind: intent.kind,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await writeFile(join(dataRoot, RESULT), JSON.stringify(result), { flush: true });
  await rm(join(dataRoot, RUNNING), { force: true });
  return result;
}
export interface HistoryMaintenanceOptions extends ArchiveInventoryOptions {
  dataRoot: string;
  /** Native directory dialog. No renderer-supplied paths are accepted. */
  chooseDirectory(kind: HistoryMaintenanceKind): Promise<string | null>;
  /** Host relaunches and closes all writers normally, preserving durable checkpoints. */
  restart(): void;
}
export class HistoryMaintenanceController {
  private selection?: { value: HistoryMaintenanceSelection; expires: number };
  private busy = false;
  constructor(private readonly options: HistoryMaintenanceOptions) {}
  async select(request: {
    kind: HistoryMaintenanceKind;
  }): Promise<HistoryMaintenanceSelection | null> {
    if (!request || !['backup', 'restore'].includes(request.kind))
      throw new Error('Invalid history maintenance action');
    if (this.busy) throw new Error('History maintenance is already being prepared');
    this.busy = true;
    this.selection = undefined;
    try {
      const chosen = await this.options.chooseDirectory(request.kind);
      if (!chosen) return null;
      if (!isAbsolute(chosen)) throw new Error('Invalid selected directory');
      const path =
        request.kind === 'backup'
          ? join(chosen, `zhiyuan-history-${Date.now()}-${randomUUID().slice(0, 8)}`)
          : chosen;
      if (request.kind === 'restore') await validateHistoryArchive(path, this.options);
      const value: HistoryMaintenanceSelection = {
        selectionId: randomUUID(),
        displayPath: path,
        kind: request.kind,
        attachmentScope: 'managed-attachments-only',
        externalReferencesIncluded: false,
        requiresRestart: true,
      };
      this.selection = { value, expires: Date.now() + 10 * 60 * 1000 };
      return value;
    } finally {
      this.busy = false;
    }
  }
  async confirm(request: { selectionId: string }): Promise<{ scheduled: true }> {
    const selected = this.selection;
    if (
      !selected ||
      selected.expires < Date.now() ||
      request?.selectionId !== selected.value.selectionId
    )
      throw new Error('Select the history archive again');
    if (this.busy) throw new Error('History maintenance is already being prepared');
    this.busy = true;
    try {
      if (
        (await readOptional(join(this.options.dataRoot, PENDING))) ||
        (await readOptional(join(this.options.dataRoot, RUNNING)))
      )
        throw new Error('History maintenance is already scheduled');
      const intent: Intent = {
        version: 1,
        kind: selected.value.kind,
        path: selected.value.displayPath,
      };
      await writeFile(join(this.options.dataRoot, PENDING), JSON.stringify(intent), {
        flag: 'wx',
        flush: true,
      });
      this.selection = undefined;
      // Defer relaunch until the invoke response has had a chance to reach the renderer.
      setTimeout(() => this.options.restart(), 250).unref();
      return { scheduled: true };
    } finally {
      this.busy = false;
    }
  }
  status(): Promise<HistoryMaintenanceStatus | null> {
    return readHistoryMaintenanceStatus(this.options.dataRoot);
  }
}
