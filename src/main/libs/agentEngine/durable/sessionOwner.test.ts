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

function models(block: boolean) {
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
