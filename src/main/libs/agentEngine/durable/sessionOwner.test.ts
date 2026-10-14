import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createRegistry, type HarnessOptions } from '@earendil-works/pi-durable';
import { DurableSessionOwner } from './sessionOwner';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

const model = {
  id: 'fixture',
  name: 'Fixture',
  provider: 'fixture',
  api: 'openai-completions',
  baseUrl: 'http://unused.invalid',
  input: ['text'],
  reasoning: false,
  contextWindow: 32000,
  maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const answer = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Persisted answer' }],
  api: 'openai-completions',
  provider: 'fixture',
  model: 'fixture',
  stopReason: 'stop',
  timestamp: 1,
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

function models(block: boolean, fail = false) {
  const calls: string[] = [];
  const fake = {
    getModel: () => model,
    streamSimple: (_model: unknown, _prompt: unknown, options: { signal: AbortSignal }) => {
      calls.push('request');
      const result = block
        ? new Promise<typeof answer>((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
              once: true,
            });
          })
        : fail
          ? Promise.reject(new Error('Fixture provider failure'))
          : Promise.resolve(answer);
      // A native model stream with no partial chunks and a final receipt.
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', reason: 'stop', message: await result };
        },
        result: () => result,
      };
    },
  };
  return { models: fake as unknown as HarnessOptions['models'], calls };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhiyuan-durable-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const create = (provider: ReturnType<typeof models>) => {
    const owner = new DurableSessionOwner(directory, async () => ({
      models: provider.models,
      registry: createRegistry(),
      settings: { retry: { enabled: false } },
    }));
    cleanups.push(() => owner.close());
    return owner;
  };
  return { create };
}
const agent = { model: { provider: 'fixture', modelId: 'fixture' } };

test('real SQLite reopens without running and resumes the same native submission explicitly', async () => {
  const { create } = await fixture();
  const firstModel = models(true);
  const first = create(firstModel);
  const original = await first.open('work-a', agent);
  const submission = await original.conversation.submit(
    { type: 'input', content: 'Do work', requestId: 'input-1' },
    context,
  );
  await expect.poll(() => firstModel.calls.length).toBe(1);
  await first.close();

  const resumedModel = models(false);
  const second = create(resumedModel);
  const reopened = await second.open('work-a', agent);
  expect(reopened.conversation.id).toBe(original.conversation.id);
  const inspection = await reopened.harness.inspect(context);
  expect(inspection.scheduling).toBe('paused');
  expect(inspection.submissions.map(item => item.id)).toContain(submission.id);
  const watch = await reopened.conversation.watch(context);
  expect(watch.value.entries.some(entry => entry.kind === 'pi.user')).toBe(true);
  expect(resumedModel.calls).toHaveLength(0);
  await watch.stop();
  reopened.harness.resume();
  const pending = await reopened.harness.submission(submission.id, context);
  expect((await pending!.wait(context)).status).toBe('done');
  expect(resumedModel.calls).toHaveLength(1);
  const duplicate = await reopened.conversation.submit(
    { type: 'input', content: 'Do work', requestId: 'input-1' },
    context,
  );
  expect(duplicate.id).toBe(submission.id);
  expect(resumedModel.calls).toHaveLength(1);
});

test('opening a second owner is rejected and simultaneous opens share one connection', async () => {
  const { create } = await fixture();
  const first = create(models(false));
  const one = first.open('../work-a', agent);
  expect(first.open('../work-a', agent)).toBe(one);
  await one;
  await expect(create(models(false)).open('../work-a', agent)).rejects.toThrow(
    'already has an owner',
  );
});

test('submitting in another session does not resume interrupted work', async () => {
  const { create } = await fixture();
  const blocked = models(true);
  const original = create(blocked);
  const a = await original.open('a', agent);
  await a.conversation.submit({ type: 'input', content: 'A', requestId: 'a' }, context);
  await expect.poll(() => blocked.calls.length).toBe(1);
  await original.close();
  const provider = models(false);
  const owner = create(provider);
  const restored = await owner.open('a', agent);
  const b = await owner.open('b', agent);
  const submission = await b.conversation.submit(
    { type: 'input', content: 'B', requestId: 'b' },
    context,
  );
  expect((await submission.wait(context)).status).toBe('done');
  expect(provider.calls).toHaveLength(1);
  expect((await restored.harness.inspect(context)).scheduling).toBe('paused');
  expect((await restored.harness.inspect(context)).tasks.length).toBeGreaterThan(0);
});

test('history reads all native entries before reset and reads closed sessions without a model configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhiyuan-history-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const provider = models(false);
  const owner = new DurableSessionOwner(directory, async () => ({
    models: provider.models,
    registry: createRegistry(),
  }));
  cleanups.push(() => owner.close());
  const session = await owner.open('history', agent);
  const first = await session.conversation.commit(
    tx =>
      tx.appendEntry(session.conversation.id, {
        kind: 'test.user',
        model: [{ role: 'user', content: 'Before reset', timestamp: 1 }],
      }),
    context,
  );
  await session.conversation.reset(undefined, context);
  const last = await session.conversation.commit(
    tx =>
      tx.appendEntry(session.conversation.id, {
        kind: 'test.user',
        model: [{ role: 'user', content: 'After reset', timestamp: 2 }],
      }),
    context,
  );
  await owner.close();
  const offline = new DurableSessionOwner(directory, async () => {
    throw new Error('No model configured');
  });
  cleanups.push(() => offline.close());
  const page = await offline.readHistory('history', 1);
  expect(page.items[0].id).toBe(last.id);
  let cursor = page.next;
  const ids = page.items.map(entry => entry.id);
  while (cursor) {
    const next = await offline.readHistory('history', 1, cursor);
    ids.push(...next.items.map(entry => entry.id));
    cursor = next.next;
  }
  expect(ids).toContain(first.id);
  expect(provider.calls).toEqual([]);
  await expect(offline.readHistory('missing', 10)).rejects.toThrow();
  expect(await offline.exists('missing')).toBe(false);
});

test('closed SQLite inspect never constructs configuration or calls a provider and preserves pending work', async () => {
  const { create } = await fixture();
  const blocked = models(true);
  const first = create(blocked);
  const session = await first.open('stored-only', agent);
  const submission = await session.conversation.submit(
    { type: 'input', content: 'Pending' },
    context,
  );
  await expect.poll(() => blocked.calls.length).toBe(1);
  await first.close();
  const unused = models(false);
  const second = create(unused);
  // Configuration is forbidden, even if no model request would be issued by Harness.open.
  Object.assign(second, {
    options: async () => {
      throw new Error('must not configure while browsing');
    },
  });
  const snapshot = await second.inspect('stored-only');
  expect(snapshot).toMatchObject({
    scheduling: 'paused',
    canResume: false,
    resumeRequiresCheck: true,
    blockedReason: 'runtime_check_required',
    latestInputKnown: true,
    latestInput: { id: submission.id, status: 'placed' },
  });
  expect(unused.calls).toHaveLength(0);
  expect(await second.inspect('missing')).toBeUndefined();
  expect(await second.exists('missing')).toBe(false);
  expect((await second.readHistory('stored-only', 10)).items.length).toBeGreaterThan(0);
});

test('stored inspection returns native done and aborted input receipts, excluding passive writes', async () => {
  const { create } = await fixture();
  const owner = create(models(false));
  const session = await owner.open('receipts', agent);
  const input = await session.conversation.submit({ type: 'input', content: 'Answer' }, context);
  await input.wait(context);
  await session.conversation.submit(
    { type: 'write', entry: { kind: 'fixture', model: [], data: {} } },
    context,
  );
  expect((await owner.inspect('receipts'))?.latestInput).toEqual({ id: input.id, status: 'done' });
  await owner.close();
  const reopened = create(models(false));
  expect((await reopened.inspect('receipts'))?.latestInput).toEqual({
    id: input.id,
    status: 'done',
  });

  const blocked = models(true);
  const active = create(blocked);
  const pendingSession = await active.open('aborted-receipt', agent);
  const pending = await pendingSession.conversation.submit(
    { type: 'input', content: 'Pending' },
    context,
  );
  await expect.poll(() => blocked.calls.length).toBe(1);
  await pendingSession.conversation.abort(context);
  const receipt = await pending.wait(context);
  expect(receipt.status).toBe('unanswered');
  await active.close();
  expect((await reopened.inspect('aborted-receipt'))?.latestInput).toMatchObject({
    id: pending.id,
    status: 'unanswered',
    reason: receipt.reason,
  });
});

test('bounded receipt scan reports unknown when recent passive writes hide the last user input', async () => {
  const { create } = await fixture();
  const owner = create(models(false));
  const session = await owner.open('bounded', agent);
  const input = await session.conversation.submit({ type: 'input', content: 'Answer' }, context);
  await input.wait(context);
  for (let i = 0; i < 65; i++) {
    await session.conversation.submit(
      { type: 'write', entry: { kind: 'fixture', model: [], data: {} } },
      context,
    );
  }
  await owner.close();
  const reader = create(models(false));
  const snapshot = await reader.inspect('bounded');
  expect(snapshot?.latestInputKnown).toBe(false);
  expect(snapshot?.latestInput).toBeUndefined();
  expect(snapshot?.blockedReason).toBe('no_pending_work');
});

test('closed inspection preserves failed input reason without retrying the provider', async () => {
  const { create } = await fixture();
  const failing = models(false, true);
  const owner = create(failing);
  const session = await owner.open('failed-receipt', agent);
  const input = await session.conversation.submit({ type: 'input', content: 'Fail' }, context);
  const receipt = await input.wait(context);
  expect(receipt.status).toBe('unanswered');
  await owner.close();
  const unused = models(false);
  const reader = create(unused);
  expect((await reader.inspect('failed-receipt'))?.latestInput).toMatchObject({
    id: input.id,
    status: 'unanswered',
    reason: receipt.reason,
  });
  expect(unused.calls).toHaveLength(0);
});
