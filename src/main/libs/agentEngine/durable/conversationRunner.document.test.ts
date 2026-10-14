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

test('closed work document and status reads never configure providers or attach execution', async () => {
  const { createRegistry } = await import('@earendil-works/pi-durable');
  const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
  const { WorkDocumentExtension, WorkDocumentDoc, commitWorkDocument } =
    await import('./workDocument');
  const dir = await mkdtemp(join(tmpdir(), 'zhiyuan-read-archive-'));
  const first = new DurableSessionOwner(dir, async () => {
    const registry = createRegistry();
    registry.install(WorkDocumentExtension);
    return { registry };
  });
  const configure = vi.fn(async () => {
    throw new Error('must never resolve provider');
  });
  const reader = new DurableSessionOwner(dir, configure);
  const changed = vi.fn();
  const runner = new DurableConversationRunner(reader, { changed, settled: vi.fn() });
  try {
    const session = await first.open('work');
    await session.conversation.commit(async tx => {
      await tx.doc(WorkDocumentDoc, session.conversation.id);
      return commitWorkDocument(tx, session.conversation.id, {
        expectedRevision: 0,
        goal: 'Persisted goal',
        progress: ['Checkpoint'],
      });
    }, context);
    expect((await first.readWorkDocument('work'))?.goal).toBe('Persisted goal');
    await first.close();
    const [document, snapshot] = await Promise.all([
      runner.getWorkDocument('work'),
      reader.inspect('work'),
    ]);
    expect(document).toMatchObject({
      goal: 'Persisted goal',
      progress: ['Checkpoint'],
      revision: 1,
    });
    expect(snapshot?.scheduling).toBe('paused');
    expect(configure).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(await runner.getWorkDocument('work')).toEqual(document);
  } finally {
    await first.close();
    await reader.close();
    await rm(dir, { recursive: true, force: true });
  }
});
