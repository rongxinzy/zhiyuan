import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CoworkMessage, CoworkStore } from '../../coworkStore';

const fixture = vi.hoisted(() => ({
  directory: '',
  calls: 0,
  tools: false,
  python: false,
  hold: false,
  failFirst: false,
  release: undefined as undefined | (() => void),
}));
const pythonExecute = vi.hoisted(() => vi.fn());
vi.mock('../../pythonRuntime/host', () => ({
  getPythonRuntimeService: () => ({ execute: pythonExecute }),
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
                  name: fixture.python ? 'python_execute' : 'write',
                  arguments: fixture.python
                    ? { code: 'print(6)' }
                    : { path: join(fixture.directory, 'result.txt'), content: 'approved' },
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
import { DurableWorkDetachedError } from './piRuntimeTypes';

let runtime: PiRuntimeAdapter;
const messages = new Map<string, CoworkMessage>();
const updates: unknown[] = [];
beforeEach(async () => {
  fixture.directory = await mkdtemp(join(tmpdir(), 'zhiyuan-native-entry-'));
  fixture.calls = 0;
  fixture.tools = false;
  fixture.python = false;
  pythonExecute
    .mockReset()
    .mockResolvedValue({ stdout: '6\n', stderr: '', exitCode: 0, environmentId: 'fixture-env' });
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

test('a scheduled occurrence waits for native completion and reuses its saved request after reopening', async () => {
  const first = await runtime.runScheduledTask('scheduled-run:one', 'Report', {
    requestId: 'scheduled:one',
  });
  expect(first.submissionId).toBeGreaterThan(0);
  expect(fixture.calls).toBe(1);
  await runtime.close();
  const reopened = new PiRuntimeAdapter();
  reopened.setCoworkStore((runtime as unknown as { store: CoworkStore }).store);
  runtime = reopened;
  const retry = await runtime.runScheduledTask('scheduled-run:one', 'Report', {
    requestId: 'scheduled:one',
  });
  expect(retry).toEqual(first);
  expect(fixture.calls).toBe(1);
});

test('scheduled native work cannot auto-approve a workspace write', async () => {
  fixture.tools = true;
  runtime.on('error', () => {});
  await runtime.runScheduledTask('scheduled-run:approval', 'Write', {
    requestId: 'scheduled:approval',
    workspaceRoot: fixture.directory,
  });
  expect(
    [...messages.values()].some(
      message => message.type === 'tool_result' && message.content.includes('requires approval'),
    ),
  ).toBe(true);
  await expect(readFile(join(fixture.directory, 'result.txt'), 'utf8')).rejects.toThrow();
});

test('cancelling scheduled work aborts the native task and releases its waiter', async () => {
  fixture.hold = true;
  runtime.on('error', () => {});
  const pending = runtime.runScheduledTask('scheduled-run:cancel', 'Hold', {
    requestId: 'scheduled:cancel',
  });
  const rejected = expect(pending).rejects.toThrow();
  await expect.poll(() => fixture.calls).toBe(1);
  await runtime.cancelScheduledTask('scheduled-run:cancel');
  await rejected;
});

test('immediate scheduled cancellation waits for admission then aborts the native work', async () => {
  fixture.hold = true;
  runtime.on('error', () => {});
  const pending = runtime.runScheduledTask('scheduled-run:early-stop', 'Hold', {
    requestId: 'scheduled:early-stop',
  });
  const rejected = expect(pending).rejects.toThrow();
  await runtime.cancelScheduledTask('scheduled-run:early-stop');
  await rejected;
  expect((await runtime.getDurableWork('scheduled-run:early-stop'))?.pendingSubmissionCount).toBe(
    0,
  );
});

test('closing the app detaches a scheduled waiter without declaring durable failure', async () => {
  fixture.hold = true;
  const pending = runtime.runScheduledTask('scheduled-run:close', 'Hold', {
    requestId: 'scheduled:close',
  });
  const detached = expect(pending).rejects.toBeInstanceOf(DurableWorkDetachedError);
  await expect.poll(() => fixture.calls).toBe(1);
  await runtime.close();
  await detached;
});

test('actual native work exposes Python and waits for approval before dispatching its Runner', async () => {
  fixture.tools = true;
  fixture.python = true;
  const permission = vi.fn();
  const complete = vi.fn();
  runtime.on('permissionRequest', permission);
  runtime.on('complete', complete);
  await runtime.startSession('python-entry', 'Calculate with Python', {
    workspaceRoot: fixture.directory,
    sessionMode: 'work',
  });
  await expect.poll(() => permission.mock.calls.length).toBe(1);
  expect(pythonExecute).not.toHaveBeenCalled();
  const request = permission.mock.calls[0][1];
  expect(request.toolName).toBe('python_execute');
  runtime.respondToPermission(request.requestId, { behavior: 'allow' });
  await expect.poll(() => complete.mock.calls.length).toBe(1);
  expect(pythonExecute).toHaveBeenCalledWith(
    { workspace: fixture.directory, code: 'print(6)' },
    expect.any(AbortSignal),
  );
  expect(
    [...messages.values()].some(
      message => message.type === 'tool_result' && message.content.includes('fixture-env'),
    ),
  ).toBe(true);
});

test('manual stop joins native cancellation and concurrent clicks share the same request', async () => {
  fixture.hold = true;
  await runtime.startSession('manual-stop', 'Hold');
  await expect.poll(() => fixture.calls).toBe(1);
  const first = runtime.stopSession('manual-stop');
  const second = runtime.stopSession('manual-stop');
  expect(second).toBe(first);
  await first;
  expect(runtime.isSessionRunning('manual-stop')).toBe(false);
  const snapshot = await runtime.getDurableWork('manual-stop');
  expect(snapshot?.tasks).toHaveLength(0);
  expect(snapshot?.latestInput).toMatchObject({ status: 'unanswered', reason: 'aborted' });
});

test('stop during admission cannot report success and then start the cancelled work', async () => {
  fixture.hold = true;
  const admission = runtime.startSession('early-manual-stop', 'Hold').catch(() => {});
  await runtime.stopSession('early-manual-stop');
  await admission;
  expect(runtime.isSessionRunning('early-manual-stop')).toBe(false);
  expect(fixture.calls).toBe(0);
});

test('native cancellation failures reject the actual stop request and permit explicit retry', async () => {
  const { DurableConversationRunner } = await import('./durable/conversationRunner');
  const abort = vi.spyOn(DurableConversationRunner.prototype, 'abort');
  abort.mockRejectedValueOnce(new Error('Native cancellation failed'));
  await expect(runtime.stopSession('stop-failure')).rejects.toThrow('Native cancellation failed');
  await expect(runtime.stopSession('stop-failure')).resolves.toBeUndefined();
  expect(abort).toHaveBeenCalledTimes(2);
  abort.mockRestore();
});
