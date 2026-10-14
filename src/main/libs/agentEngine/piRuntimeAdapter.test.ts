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
  failMessage: 'Invalid request',
  partialTool: false,
  partialRelease: undefined as undefined | (() => void),
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
          ...(fixture.failFirst && fixture.calls === 1
            ? { errorMessage: fixture.failMessage }
            : {}),
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
            if (tool && fixture.partialTool) {
              const wait = () =>
                new Promise<void>(resolve => {
                  fixture.partialRelease = resolve;
                  options.signal.addEventListener('abort', () => resolve(), { once: true });
                });
              yield {
                type: 'toolcall_delta',
                partial: {
                  ...message,
                  content: [
                    {
                      ...message.content[0],
                      arguments: { path: join(fixture.directory, 'result.txt') },
                    },
                  ],
                },
              };
              await wait();
              yield { type: 'toolcall_delta', partial: message };
              await wait();
            }
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
import { DurableWorkDetachedError, NativeStopCause } from './piRuntimeTypes';

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
  fixture.failMessage = 'Invalid request';
  fixture.partialTool = false;
  fixture.partialRelease = undefined;
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
  const stopped = vi.fn();
  const complete = vi.fn();
  runtime.on('sessionStopped', stopped);
  runtime.on('complete', complete);
  await expect(
    runtime.runScheduledTask('scheduled-run:approval', 'Write', {
      requestId: 'scheduled:approval',
      workspaceRoot: fixture.directory,
    }),
  ).rejects.toThrow('aborted');
  await expect.poll(() => stopped.mock.calls.length).toBe(1);
  expect(stopped.mock.calls[0][1].cause).toBe('approval_denied');
  expect(complete).not.toHaveBeenCalled();
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

test('repeated denials are native cancellations and late replies cannot taint later work', async () => {
  fixture.tools = true;
  const permission = vi.fn();
  const stopped = vi.fn();
  const complete = vi.fn();
  runtime.on('permissionRequest', permission);
  runtime.on('sessionStopped', stopped);
  runtime.on('complete', complete);
  let oldRequest = '';
  for (let turn = 0; turn < 2; turn++) {
    fixture.calls = 0;
    await runtime.continueSession('refused', 'Write', { workspaceRoot: fixture.directory });
    await expect.poll(() => permission.mock.calls.length).toBe(turn + 1);
    oldRequest = permission.mock.calls[turn][1].requestId;
    expect(
      runtime.respondToPermission(oldRequest, { behavior: 'deny', message: 'Do not write' }),
    ).toBe(true);
    expect(runtime.respondToPermission(oldRequest, { behavior: 'deny', message: 'Again' })).toBe(
      false,
    );
    await expect.poll(() => stopped.mock.calls.length).toBe(turn + 1);
    expect(stopped.mock.calls[turn][1]).toMatchObject({ cause: NativeStopCause.ApprovalDenied });
    expect((await runtime.getDurableWork('refused'))?.latestInput).toMatchObject({
      status: 'unanswered',
      reason: 'aborted',
    });
    expect(fixture.calls).toBe(1);
  }
  expect(complete).not.toHaveBeenCalled();
  await expect(readFile(join(fixture.directory, 'result.txt'), 'utf8')).rejects.toThrow();
  fixture.tools = false;
  fixture.hold = true;
  fixture.calls = 0;
  await runtime.continueSession('refused', 'New independent task');
  await expect.poll(() => fixture.calls).toBe(1);
  expect(runtime.respondToPermission(oldRequest, { behavior: 'allow' })).toBe(false);
  await runtime.stopSession('refused');
  await expect.poll(() => stopped.mock.calls.length).toBe(3);
  expect(stopped.mock.calls[2][1]).toMatchObject({ cause: NativeStopCause.UserStop });
  expect(complete).not.toHaveBeenCalled();
});

test('refusal text and native cancellation survive passive history reopen', async () => {
  fixture.tools = true;
  const stopped = vi.fn();
  runtime.on('sessionStopped', stopped);
  runtime.on('permissionRequest', (_id, request) => {
    runtime.respondToPermission(request.requestId, {
      behavior: 'deny',
      message: 'Do not write my file',
    });
  });
  await runtime.startSession('denial-history', 'Write');
  await expect.poll(() => stopped.mock.calls.length).toBe(1);
  const store = (runtime as unknown as { store: CoworkStore }).store;
  await runtime.close();
  runtime = new PiRuntimeAdapter();
  runtime.setCoworkStore(store);
  const history = await runtime.readHistory('denial-history', 100);
  const results = history.items
    .flatMap(entry => entry.model ?? [])
    .filter(message => message.role === 'toolResult');
  expect(results).toContainEqual(
    expect.objectContaining({
      isError: true,
      content: expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Do not write my file'),
        }),
      ]),
      details: expect.objectContaining({
        zhiyuanApprovalDenied: true,
        submissionIds: expect.arrayContaining([stopped.mock.calls[0][1].submissionId]),
      }),
    }),
  );
  expect((await runtime.getDurableWork('denial-history'))?.latestInput).toMatchObject({
    status: 'unanswered',
    reason: 'aborted',
  });
  expect(fixture.calls).toBe(1);
});

test('ordinary tool errors remain model context and may be followed by a successful answer', async () => {
  fixture.tools = true;
  fixture.python = true;
  pythonExecute.mockResolvedValue({
    stdout: '',
    stderr: 'recoverable tool failure',
    exitCode: 1,
    environmentId: 'fixture-env',
  });
  runtime.on('permissionRequest', (_id, request) => {
    runtime.respondToPermission(request.requestId, { behavior: 'allow' });
  });
  const complete = vi.fn();
  const stopped = vi.fn();
  const failed = vi.fn();
  runtime.on('complete', complete);
  runtime.on('sessionStopped', stopped);
  runtime.on('error', failed);
  await runtime.startSession('tool-error', 'Try it');
  await expect.poll(() => complete.mock.calls.length).toBe(1);
  expect(fixture.calls).toBe(2);
  expect(stopped).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  expect([...messages.values()]).toContainEqual(
    expect.objectContaining({
      type: 'tool_result',
      metadata: expect.objectContaining({ isError: true }),
    }),
  );
  expect((await runtime.getDurableWork('tool-error'))?.latestInput?.status).toBe('done');
});

test('real model failure emits the native failure detail and never completion', async () => {
  fixture.failFirst = true;
  fixture.failMessage = 'Invalid API key';
  const failed = vi.fn();
  const complete = vi.fn();
  runtime.on('error', failed);
  runtime.on('complete', complete);
  await runtime.startSession('model-error', 'Hello');
  await expect.poll(() => failed.mock.calls.length).toBe(1);
  expect(complete).not.toHaveBeenCalled();
  expect(failed.mock.calls[0][1].message).toBe('Invalid API key');
  expect((await runtime.getDurableWork('model-error'))?.latestInput).toMatchObject({
    status: 'unanswered',
    reason: 'model_error',
  });
});

test('close and passive reopen preserve paused native work without emitting a terminal event', async () => {
  fixture.hold = true;
  const complete = vi.fn();
  const stopped = vi.fn();
  const failed = vi.fn();
  runtime.on('complete', complete);
  runtime.on('sessionStopped', stopped);
  runtime.on('error', failed);
  await runtime.startSession('paused', 'Keep working');
  await expect.poll(() => fixture.calls).toBe(1);
  const store = (runtime as unknown as { store: CoworkStore }).store;
  await runtime.close();
  runtime = new PiRuntimeAdapter();
  runtime.setCoworkStore(store);
  runtime.on('complete', complete);
  runtime.on('sessionStopped', stopped);
  runtime.on('error', failed);
  const paused = await runtime.getDurableWork('paused');
  expect(paused?.scheduling).toBe('paused');
  expect(paused?.pendingSubmissionCount).toBeGreaterThan(0);
  expect(fixture.calls).toBe(1);
  expect(complete).not.toHaveBeenCalled();
  expect(stopped).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  await runtime.resumeDurableWork('paused');
  await expect.poll(() => complete.mock.calls.length).toBe(1);
  expect(fixture.calls).toBe(2);
});

test('native retry backoff is projected once while unrelated document commits do not repeat it', async () => {
  fixture.failFirst = true;
  fixture.failMessage = '503 Service unavailable';
  const retry = vi.fn();
  const complete = vi.fn();
  const failed = vi.fn();
  runtime.on('nativeRetry', retry);
  runtime.on('complete', complete);
  runtime.on('error', failed);
  await runtime.startSession('retry-event', 'Hello');
  await expect.poll(() => retry.mock.calls.length).toBe(1);
  expect(retry.mock.calls[0][1]).toMatchObject({
    attempt: 1,
    message: '503 Service unavailable',
    retryAt: expect.any(Number),
  });
  await runtime.updateWorkDocument('retry-event', { expectedRevision: 0, goal: 'Same work' });
  expect(retry).toHaveBeenCalledTimes(1);
  await expect.poll(() => complete.mock.calls.length, { timeout: 10000 }).toBe(1);
  expect(failed).not.toHaveBeenCalled();
  expect(retry).toHaveBeenCalledTimes(1);
});

test('native partial tool arguments use stable normal message identities through completion', async () => {
  fixture.tools = true;
  fixture.partialTool = true;
  const updated = vi.fn();
  const complete = vi.fn();
  runtime.on('messageUpdate', updated);
  runtime.on('complete', complete);
  runtime.on('permissionRequest', (_id, request) => {
    runtime.respondToPermission(request.requestId, { behavior: 'allow' });
  });
  await runtime.startSession('partial-tool', 'Write');
  await expect
    .poll(() => [...messages.values()].filter(message => message.type === 'tool_use').length)
    .toBe(1);
  const first = [...messages.values()].find(message => message.type === 'tool_use')!;
  expect(first.metadata?.toolInput).not.toHaveProperty('content');
  fixture.partialRelease!();
  await expect
    .poll(() =>
      updated.mock.calls.some(
        call => call[1] === first.id && call[3]?.toolInput?.content === 'approved',
      ),
    )
    .toBe(true);
  fixture.partialRelease!();
  await expect.poll(() => complete.mock.calls.length).toBe(1);
  expect([...messages.values()].filter(message => message.type === 'tool_use')).toHaveLength(1);
  expect([...messages.values()].filter(message => message.type === 'tool_result')).toHaveLength(1);
});

test('a delayed old stop projection cannot overwrite a newer native input', async () => {
  fixture.hold = true;
  const stopped = vi.fn();
  runtime.on('sessionStopped', stopped);
  await runtime.startSession('stop-race', 'Old work');
  await expect.poll(() => fixture.calls).toBe(1);
  const host = (runtime as unknown as { host: import('./durable/runtimeHost').DurableRuntimeHost })
    .host;
  const session = await host.runner.owner.open('stop-race');
  const nativeWatch = session.conversation.watch.bind(session.conversation);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let entered = false;
  const watchSpy = vi.spyOn(session.conversation, 'watch').mockImplementationOnce(async context => {
    const watch = await nativeWatch(context);
    const stop = watch.stop.bind(watch);
    watch.stop = async () => {
      entered = true;
      await gate;
      await stop();
    };
    return watch;
  });
  const settlement = host as unknown as { settle(...args: unknown[]): Promise<void> };
  const settle = settlement.settle.bind(host);
  let pending!: Promise<void>;
  const settleSpy = vi.spyOn(settlement, 'settle').mockImplementation((...args) => {
    pending = settle(...args);
    return pending;
  });
  try {
    await runtime.stopSession('stop-race');
    await expect.poll(() => entered).toBe(true);
    fixture.calls = 0;
    await runtime.continueSession('stop-race', 'New work');
    await expect.poll(() => fixture.calls).toBe(1);
    const beforeRelease = updates.length;
    release();
    await pending;
    expect(stopped).not.toHaveBeenCalled();
    expect(updates.slice(beforeRelease)).not.toContainEqual({ status: 'idle' });
    expect(runtime.isSessionRunning('stop-race')).toBe(true);
    expect((await runtime.getDurableWork('stop-race'))?.pendingSubmissionCount).toBeGreaterThan(0);
  } finally {
    release();
    watchSpy.mockRestore();
    settleSpy.mockRestore();
  }
});
