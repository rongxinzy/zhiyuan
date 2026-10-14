import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { ipcMain } from 'electron';
import { expect, test, vi } from 'vitest';
import { CoworkSessionIpc, CoworkStreamIpc } from '../shared/ipc/channels';
import type { PiRuntimeAdapter } from './libs/agentEngine/piRuntimeAdapter';
import { bindCoworkContentBridge } from './coworkContentBridge';
import { runTextWorkerOperation, type TextWorkerInput } from './contentWorker/textWorkerOperations';
import { CoworkContentBuffer } from '../renderer/services/coworkContentBuffer';
import type { CoworkContentPatch } from '../shared/cowork/contentProjection';

vi.mock('./contentWorker/contentWorkerPool', () => ({
  transformCoworkTextAsync: async (input: TextWorkerInput) => runTextWorkerOperation(input),
}));

test('recovery queries persisted sequence and creation time and replays the complete long message', async () => {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE cowork_messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
    metadata TEXT, created_at INTEGER NOT NULL, sequence INTEGER
  )`);
  const content = 'x'.repeat(190_000 - 4) + 'END!';
  database
    .prepare('INSERT INTO cowork_messages VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('message', 'session', 'assistant', content, null, 100, 1);
  const runtime = new EventEmitter();
  const handler = vi.spyOn(ipcMain, 'handle');
  try {
    bindCoworkContentBridge(runtime as unknown as PiRuntimeAdapter, () => database, vi.fn());
    const replayHandler = handler.mock.calls.find(
      ([channel]) => channel === CoworkSessionIpc.ReplayContent,
    )![1];
    const frames: CoworkContentPatch[] = [];
    const event = {
      sender: {
        isDestroyed: () => false,
        send: (channel: string, frame: CoworkContentPatch) => {
          expect(channel).toBe(CoworkStreamIpc.ContentPatch);
          frames.push(frame);
        },
      },
    };
    const result = await replayHandler(event as unknown as Electron.IpcMainInvokeEvent, 'session');
    expect(result).toEqual({ success: true });
    expect(runtime.eventNames()).toEqual(['message']);
    const gap = vi.fn();
    const buffer = new CoworkContentBuffer(gap);
    let update;
    for (const frame of frames) update = buffer.apply(frame) ?? update;
    expect(update?.content).toBe(content);
    expect(gap).not.toHaveBeenCalled();
  } finally {
    handler.mockRestore();
    database.close();
  }
});
