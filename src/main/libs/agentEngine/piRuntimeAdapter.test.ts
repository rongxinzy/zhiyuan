import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CoworkMessage, CoworkStore } from '../../coworkStore';

const fixture = vi.hoisted(() => ({
  directory: '',
  calls: 0,
  tools: false,
  hold: false,
  failFirst: false,
  release: undefined as undefined | (() => void),
}));
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
vi.mock('./durable/provider', () => ({
  resolveDurableProvider: async () => {
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
    const models = {
      getModel: () => model,
      streamSimple: (_model: unknown, _context: unknown, options: { signal: AbortSignal }) => {
        fixture.calls++;
        const tool = fixture.tools && fixture.calls === 1;
        const message = {
          role: 'assistant',
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: tool
            ? [
                {
                  type: 'toolCall',
                  id: 'write-1',
                  name: 'write',
                  arguments: { path: join(fixture.directory, 'result.txt'), content: 'approved' },
                },
              ]
            : [{ type: 'text', text: 'Native answer' }],
          stopReason:
            fixture.failFirst && fixture.calls === 1 ? 'error' : tool ? 'toolUse' : 'stop',
          ...(fixture.failFirst && fixture.calls === 1 ? { errorMessage: 'Invalid request' } : {}),
          timestamp: Date.now(),
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        };
        const ready =
          fixture.hold && fixture.calls === 1
            ? new Promise<void>((resolve, reject) => {
                fixture.release = resolve;
                options.signal.addEventListener('abort', () => reject(options.signal.reason), {
                  once: true,
                });
              })
            : Promise.resolve();
        return {
          async *[Symbol.asyncIterator]() {
            await ready;
            yield { type: 'done', reason: message.stopReason, message };
          },
          result: async () => message,
        };
      },
    };
    return { models, model: { provider: model.provider, modelId: model.id }, modelObject: model };
  },
}));
import { PiRuntimeAdapter } from './piRuntimeAdapter';

let runtime: PiRuntimeAdapter;
const messages = new Map<string, CoworkMessage>();
const updates: unknown[] = [];
beforeEach(async () => {
  fixture.directory = await mkdtemp(join(tmpdir(), 'zhiyuan-native-entry-'));
  fixture.calls = 0;
  fixture.tools = false;
  fixture.hold = false;
  fixture.failFirst = false;
  fixture.release = undefined;
  messages.clear();
  updates.length = 0;
  runtime = new PiRuntimeAdapter();
  runtime.setCoworkStore({
    getSession: (id: string) => ({
      id,
      cwd: fixture.directory,
      mode: 'work',
      systemPrompt: '',
      modelOverride: '',
    }),
    updateSession: (_id: string, update: unknown) => updates.push(update),
    upsertMessage: (_id: string, message: CoworkMessage) => {
      messages.set(message.id, message);
      return message;
    },
  } as unknown as CoworkStore);
});
afterEach(async () => {
  await runtime.close();
  await rm(fixture.directory, { recursive: true, force: true });
});

test('the actual Cowork adapter executes through native submit and projects committed messages', async () => {
  const complete = vi.fn();
  runtime.on('complete', complete);
  await runtime.startSession('session-a', 'Hello', {
    workspaceRoot: fixture.directory,
    sessionMode: 'work',
  });
  await expect.poll(() => complete.mock.calls.length).toBe(1);
  expect(fixture.calls).toBe(1);
  expect([...messages.values()].map(message => message.content)).toEqual([
    'Hello',
    'Native answer',
  ]);
  expect((await runtime.getDurableWork('session-a'))?.pendingSubmissionCount).toBe(0);
  expect(updates).toContainEqual({ status: 'running' });
  expect(updates).toContainEqual({ status: 'completed' });
});

test('native built-in writes require the existing permission reply and persist their result', async () => {
  fixture.tools = true;
  const permission = vi.fn((_sessionId, request) =>
    runtime.respondToPermission(request.requestId, { behavior: 'allow' }),
  );
  runtime.on('permissionRequest', permission);
  const complete = vi.fn();
  runtime.on('complete', complete);
  await runtime.startSession('session-b', 'Write the result', {
    workspaceRoot: fixture.directory,
    sessionMode: 'work',
  });
  await expect.poll(() => complete.mock.calls.length).toBe(1);
  expect(permission).toHaveBeenCalledTimes(1);
  expect(await readFile(join(fixture.directory, 'result.txt'), 'utf8')).toBe('approved');
  expect([...messages.values()].some(message => message.type === 'tool_result')).toBe(true);
  expect(fixture.calls).toBe(2);
});

test('an existing initial user projection is updated rather than duplicated', async () => {
  messages.set('original-user', {
    id: 'original-user',
    type: 'user',
    content: 'Hello',
    timestamp: 1,
  });
  const complete = vi.fn();
  runtime.on('complete', complete);
  await runtime.startSession('session-c', 'Hello', {
    workspaceRoot: fixture.directory,
    _userMessageId: 'original-user',
  });
  await expect.poll(() => complete.mock.calls.length).toBe(1);
  expect([...messages.values()].filter(message => message.type === 'user')).toHaveLength(1);
});

test('the actual queue entry admits, edits, steers and withdraws native persisted input', async () => {
  fixture.hold = true;
  await runtime.startSession('queued', 'First', { workspaceRoot: fixture.directory });
  await expect.poll(() => fixture.calls).toBe(1);
  const queued = await runtime.enqueuePendingMessage('queued', 'Second');
  expect(queued.success).toBe(true);
  await expect.poll(() => runtime.listPendingMessages('queued').length).toBe(1);
  expect(
    (await runtime.updatePendingMessage('queued', queued.item!.id, 'Corrected second')).success,
  ).toBe(true);
  expect((await runtime.steerPendingMessage('queued', queued.item!.id)).success).toBe(true);
  const withdrawn = await runtime.enqueuePendingMessage('queued', 'Withdraw this');
  expect((await runtime.deletePendingMessage('queued', withdrawn.item!.id)).success).toBe(true);
  expect(
    (await runtime.updatePendingMessage('queued', withdrawn.item!.id, 'Do not revive')).success,
  ).toBe(false);
  fixture.release!();
  await expect.poll(() => fixture.calls).toBe(2);
  await expect.poll(() => runtime.listPendingMessages('queued').length).toBe(0);
  const userText = [...messages.values()]
    .filter(message => message.type === 'user')
    .map(message => message.content);
  expect(userText).toEqual(['First', 'Corrected second']);
});

test('retrying one user request reuses its native submission while a new request is independent', async () => {
  await runtime.startSession('retry', 'First', { requestId: 'request-1' });
  await expect.poll(() => fixture.calls).toBe(1);
  await runtime.continueSession('retry', 'First', { requestId: 'request-1' });
  expect(fixture.calls).toBe(1);
  await runtime.continueSession('retry', 'First', { requestId: 'request-2' });
  await expect.poll(() => fixture.calls).toBe(2);
  expect([...messages.values()].filter(message => message.type === 'user')).toHaveLength(2);
});

test('explicit follow-up releases input retained after a failed native run without adding a prompt', async () => {
  fixture.hold = true;
  fixture.failFirst = true;
  runtime.on('error', () => {});
  await runtime.startSession('failed-queue', 'First', {});
  await expect.poll(() => fixture.calls).toBe(1);
  const queued = await runtime.enqueuePendingMessage('failed-queue', 'Still needed');
  fixture.release!();
  await expect.poll(() => runtime.isSessionRunning('failed-queue')).toBe(false);
  expect(fixture.calls).toBe(1);
  expect((await runtime.followUpPendingMessage('failed-queue', queued.item!.id)).success).toBe(
    true,
  );
  await expect.poll(() => fixture.calls).toBe(2);
  await expect.poll(() => runtime.listPendingMessages('failed-queue').length).toBe(0);
  expect(
    [...messages.values()]
      .filter(message => message.type === 'user')
      .map(message => message.content),
  ).toEqual(['First', 'Still needed']);
});
