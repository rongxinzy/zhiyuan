import type Database from 'better-sqlite3';
import { ipcMain } from 'electron';
import { CoworkSessionIpc, CoworkStreamIpc } from '../shared/ipc/channels';
import { CoworkContentPolicy, type CoworkContentPatch } from '../shared/cowork/contentProjection';
import type { PiRuntimeAdapter } from './libs/agentEngine/piRuntimeAdapter';
import { CoworkContentProjection } from './coworkContentProjection';

/** Display-only long-message transport. Execution recovery uses Pi UI facts. */
export function bindCoworkContentBridge(
  runtime: PiRuntimeAdapter,
  getDatabase: () => Database.Database,
  publishPatch: (patch: CoworkContentPatch) => void,
): CoworkContentProjection {
  const projection = new CoworkContentProjection();
  runtime.on('message', (sessionId, message) => {
    if (message.content.length <= CoworkContentPolicy.ContentChunkCharacters) return;
    setImmediate(() => {
      void projection
        .project(sessionId, message.id, message.content, message.metadata, true)
        .then(patches => {
          for (const patch of patches) publishPatch(patch);
        })
        .catch(error => console.error('[CoworkContentBridge] message projection failed:', error));
    });
  });
  ipcMain.handle(CoworkSessionIpc.ReplayContent, async (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200)
      return { success: false };
    // SQLite stays on main; bounded text transforms run in workers.
    const stored = getDatabase()
      .prepare(
        'SELECT id, substr(content, 1, ?) AS content FROM cowork_messages WHERE session_id = ? AND length(content) > 120000 ORDER BY sequence DESC, created_at DESC LIMIT 8',
      )
      .all(CoworkContentPolicy.MaximumContentCharacters + 1, sessionId) as {
      id: string;
      content: string;
    }[];
    for (const message of stored) {
      if (!projection.has(message.id))
        await projection.project(sessionId, message.id, message.content);
    }
    for (const patch of await projection.replay(sessionId)) {
      if (!event.sender.isDestroyed()) event.sender.send(CoworkStreamIpc.ContentPatch, patch);
    }
    return { success: true };
  });
  return projection;
}
