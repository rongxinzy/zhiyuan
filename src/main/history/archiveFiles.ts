import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
export interface ArchiveFile {
  path: string;
  size: number;
  sha256: string;
}
export interface ArchiveInventoryOptions {
  workerPath?: string;
  signal?: AbortSignal;
}
let running = 0;
const queue: Array<() => void> = [];
async function slot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw new Error('History archive cancelled');
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal?.removeEventListener('abort', cancel);
      running++;
      resolve();
    };
    const cancel = () => {
      const index = queue.indexOf(start);
      if (index >= 0) queue.splice(index, 1);
      reject(new Error('History archive cancelled'));
    };
    if (running < 2) start();
    else if (queue.length >= 16)
      reject(new Error('History file processing queue is full; try again shortly'));
    else {
      queue.push(start);
      signal?.addEventListener('abort', cancel, { once: true });
    }
  });
  return () => {
    running--;
    queue.shift()?.();
  };
}
async function workerTask<T>(
  data: Record<string, unknown>,
  options: ArchiveInventoryOptions,
): Promise<T> {
  const release = await slot(options.signal);
  try {
    return await new Promise<T>((resolve, reject) => {
      const worker = new Worker(options.workerPath ?? join(__dirname, 'archiveWorker.js'), {
        workerData: data,
      });
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', cancel);
        void worker.terminate().then(() => {
          if (error) reject(error);
          else resolve(value!);
        }, reject);
      };
      const cancel = () => finish(new Error('History archive cancelled'));
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
      worker.once('error', error => finish(error));
      worker.once('exit', code => {
        if (!settled) finish(new Error(`History archive worker exited (${code})`));
      });
      worker.once('message', (result: { value?: T; error?: string }) =>
        finish(result.error ? new Error(result.error) : undefined, result.value),
      );
    });
  } finally {
    release();
  }
}
/** Bounded two-worker pool shared by archive scans and user-selected attachment snapshots. */
export function inventoryArchive(
  root: string,
  paths: string[],
  options: ArchiveInventoryOptions = {},
): Promise<ArchiveFile[]> {
  return workerTask(
    { operation: 'inventory', root, paths, maxFiles: 100000, maxBytes: 50 * 1024 ** 3 },
    options,
  );
}
export function readArchiveManifest<T>(
  root: string,
  options: ArchiveInventoryOptions = {},
): Promise<T> {
  return workerTask({ operation: 'readManifest', root }, options);
}
export function encodeArchiveManifest(
  value: unknown,
  options: ArchiveInventoryOptions = {},
): Promise<string> {
  return workerTask({ operation: 'encodeManifest', manifest: value }, options);
}

export function readRestoredNativeFiles(
  root: string,
  options: ArchiveInventoryOptions = {},
): Promise<string[]> {
  return workerTask({ operation: 'readRestoreGuard', root }, options);
}
