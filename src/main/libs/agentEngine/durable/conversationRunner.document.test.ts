import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, vi } from 'vitest';
import { DurableSessionOwner } from './sessionOwner';
import { DurableConversationRunner } from './conversationRunner';

test('reading or editing a legacy archive never creates a native execution container', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zhiyuan-legacy-archive-'));
  const configure = vi.fn(async () => {
    throw new Error('must never resolve provider');
  });
  const owner = new DurableSessionOwner(dir, configure);
  const runner = new DurableConversationRunner(owner, { changed: vi.fn(), settled: vi.fn() });
  try {
    await expect(runner.getWorkDocument('legacy')).rejects.toThrow('historical');
    await expect(
      runner.updateWorkDocument('legacy', { expectedRevision: 0, goal: 'no' }),
    ).rejects.toThrow('historical');
    expect(configure).not.toHaveBeenCalled();
    expect(await owner.exists('legacy')).toBe(false);
    expect(await readdir(dir)).toEqual([]);
  } finally {
    await owner.close();
    await rm(dir, { recursive: true, force: true });
  }
});
