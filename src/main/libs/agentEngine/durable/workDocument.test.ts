import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import type { Storage } from '@earendil-works/pi-durable';
import { describe, test, expect } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createDurableModels } from './provider';
import {
  WorkDocumentDoc,
  WorkDocumentExtension,
  commitWorkDocument,
  validateWorkDocumentPatch,
} from './workDocument';

async function fixture(storage: Storage = new MemoryStorage()) {
  const faux = createFauxCore({
    provider: 'fixture',
    models: [{ id: 'fixture' }],
    tokensPerSecond: 0,
  });
  const registry = createRegistry();
  registry.install(WorkDocumentExtension);
  const harness = await Harness.open(
    storage,
    {
      models: await createDurableModels(faux.getModel(), 'test-only', faux),
      registry,
      conversationCreated: async (tx, conversation) => {
        await tx.doc(WorkDocumentDoc, conversation.id);
      },
    },
    context,
  );
  const root = await harness.root(context, {
    agent: { model: { provider: 'fixture', modelId: 'fixture' } },
  });
  return { harness, root, faux };
}

describe('native work Document', () => {
  test('atomic revision check rejects stale changes without losing fields', async () => {
    const { harness, root } = await fixture();
    try {
      await root.commit(
        tx =>
          commitWorkDocument(tx, root.id, {
            expectedRevision: 0,
            goal: 'ship',
            agreements: ['ask before publish'],
          }),
        context,
      );
      await expect(
        root.commit(
          tx => commitWorkDocument(tx, root.id, { expectedRevision: 0, goal: 'stale' }),
          context,
        ),
      ).rejects.toThrow('changed');
      expect(await harness.snapshot(WorkDocumentDoc, root.id, context)).toMatchObject({
        goal: 'ship',
        revision: 1,
        agreements: ['ask before publish'],
      });
    } finally {
      await harness.close(context);
    }
  });
  test('transaction failure rolls back the entire document', async () => {
    const { harness, root } = await fixture();
    try {
      await expect(
        root.commit(async tx => {
          await commitWorkDocument(tx, root.id, { expectedRevision: 0, goal: 'never' });
          throw new Error('rollback');
        }, context),
      ).rejects.toThrow('rollback');
      expect((await harness.snapshot(WorkDocumentDoc, root.id, context))?.revision).toBe(0);
    } finally {
      await harness.close(context);
    }
  });
  test('native watch reports edits while another work stays isolated', async () => {
    const { harness, root } = await fixture();
    const other = await fixture();
    try {
      const watch = (await harness.watchDoc(WorkDocumentDoc, root.id, context))!;
      const changed = new Promise<number>(resolve =>
        watch.start(async doc => {
          if (doc) resolve(doc.revision);
        }),
      );
      await root.commit(
        tx => commitWorkDocument(tx, root.id, { expectedRevision: 0, decisions: ['chosen'] }),
        context,
      );
      expect(await changed).toBe(1);
      expect(
        (await other.harness.snapshot(WorkDocumentDoc, other.root.id, context))?.decisions,
      ).toEqual([]);
      await watch.stop();
    } finally {
      await harness.close(context);
      await other.harness.close(context);
    }
  });
  test('real native agent tool writes the same Document visible to the host', async () => {
    const { harness, root, faux } = await fixture();
    try {
      faux.setResponses([
        {
          ...fauxAssistantMessage(''),
          content: [
            {
              type: 'toolCall',
              id: 'doc-call',
              name: 'update_work_document',
              arguments: {
                expectedRevision: 0,
                goal: 'tested goal',
                progress: ['first step done'],
              },
            },
          ],
          stopReason: 'toolUse',
        },
        fauxAssistantMessage('Saved'),
      ]);
      const submission = await root.submit(
        { type: 'input', content: 'Record this work goal', requestId: 'doc-test' },
        context,
      );
      expect((await submission.wait(context)).status).toBe('done');
      expect(await harness.snapshot(WorkDocumentDoc, root.id, context)).toMatchObject({
        goal: 'tested goal',
        progress: ['first step done'],
        revision: 1,
      });
    } finally {
      await harness.close(context);
    }
  });
  test('native SQLite reopens the same document without starting a model run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhiyuan-document-'));
    try {
      const file = join(dir, 'work.sqlite');
      const first = await fixture(await openNodeSqliteStorage(file));
      await first.root.commit(
        tx =>
          commitWorkDocument(tx, first.root.id, { expectedRevision: 0, goal: 'survives restart' }),
        context,
      );
      await first.harness.close(context);
      const second = await fixture(await openNodeSqliteStorage(file));
      try {
        expect(
          await second.harness.snapshot(WorkDocumentDoc, second.root.id, context),
        ).toMatchObject({ goal: 'survives restart', revision: 1 });
        expect((await second.harness.inspect(context)).tasks).toHaveLength(0);
      } finally {
        await second.harness.close(context);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test('rejects unknown fields, oversized state and invalid revisions', () => {
    for (const input of [
      { expectedRevision: -1 },
      { expectedRevision: 0, bad: 'x' },
      { expectedRevision: 0, goal: 'x'.repeat(8001) },
      { expectedRevision: 0, decisions: [42] },
    ])
      expect(() => validateWorkDocumentPatch(input)).toThrow();
  });
});
