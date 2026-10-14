import { createHash } from 'node:crypto';
import { readRestoredNativeFiles, type ArchiveInventoryOptions } from './archiveFiles';
/** Restore is not execution consent. Persistently exclude imported native stores from automatic resume. */
export async function loadRestoredNativeGuard(
  dataRoot: string,
  options: ArchiveInventoryOptions = {},
): Promise<{ has(sessionId: string): boolean }> {
  const files = new Set(await readRestoredNativeFiles(dataRoot, options));
  return {
    has: sessionId => files.has(`${createHash('sha256').update(sessionId).digest('hex')}.sqlite`),
  };
}
