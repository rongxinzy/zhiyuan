import Database from 'better-sqlite3';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { HistoryMaintenanceController, runPendingHistoryMaintenance } from './historyMaintenance';
const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
test('maintenance cancellation creates no intent; confirmed opaque selection runs only on the next startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-maintenance-'));
  roots.push(root);
  const data = join(root, 'data');
  await mkdir(data);
  const db = new Database(join(data, 'zhiyuan.sqlite'));
  db.exec('CREATE TABLE cowork_sessions(id TEXT);CREATE TABLE cowork_messages(id TEXT);');
  db.close();
  const choose = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(root);
  const restart = vi.fn();
  const options = {
    dataRoot: data,
    chooseDirectory: choose,
    restart,
    workerPath: join(__dirname, 'archiveWorker.ts'),
  };
  const controller = new HistoryMaintenanceController(options);
  expect(await controller.select({ kind: 'backup' })).toBeNull();
  expect((await readdir(data)).some(x => x.includes('pending'))).toBe(false);
  const selection = await controller.select({ kind: 'backup' });
  expect(selection?.requiresRestart).toBe(true);
  await expect(controller.confirm({ selectionId: '/etc/passwd' })).rejects.toThrow('Select');
  vi.useFakeTimers();
  expect(await controller.confirm({ selectionId: selection!.selectionId })).toEqual({
    scheduled: true,
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(restart).toHaveBeenCalledOnce();
  vi.useRealTimers();
  expect(await controller.status()).toBeNull();
  expect((await readdir(root)).some(x => x.startsWith('zhiyuan-history-'))).toBe(false);
  expect(await runPendingHistoryMaintenance(data, options)).toMatchObject({
    kind: 'backup',
    status: 'completed',
    path: selection!.displayPath,
  });
  expect(await controller.status()).toMatchObject({ status: 'completed' });
  expect(await runPendingHistoryMaintenance(data, options)).toBeNull();
});
