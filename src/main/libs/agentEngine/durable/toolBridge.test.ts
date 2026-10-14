import { copyJson, type JsonValue } from '@earendil-works/chord';
import { awaitWithContext } from '@earendil-works/chord/context';
import type { ToolExecutionResult } from '@earendil-works/pi-durable';
import type { TSchema } from 'typebox';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import {
  createRegistry,
  defineTool,
  Harness,
  LiveDoc,
  type LiveState,
  type HarnessOptions,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from 'typebox';
import {
  authorizeNativeTool,
  type DurableToolBridgeOptions,
  type DurableToolDecision,
} from './toolBridge';

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
function models(callTool: boolean): HarnessOptions['models'] {
  let called = !callTool;
  return {
    getModel: () => model,
    streamSimple: () => {
      const invoke = !called;
      called = true;
      const answer = {
        role: 'assistant',
        content: invoke
          ? [{ type: 'toolCall', id: 'call-1', name: 'fixture', arguments: { value: 1 } }]
          : [{ type: 'text', text: 'Done' }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: invoke ? 'toolUse' : 'stop',
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
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', reason: answer.stopReason, message: answer };
        },
        result: () => Promise.resolve(answer),
      };
    },
  } as unknown as HarnessOptions['models'];
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhiyuan-tool-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return async (tool: ToolRegistration, callTool = true) => {
    const registry = createRegistry();
    registry.install({ name: 'fixture', tools: [tool] });
    const harness = await Harness.open(
      await openNodeSqliteStorage(join(directory, 'session.sqlite')),
      {
        registry,
        models: models(callTool),
        settings: { retry: { enabled: false } },
      },
      context,
    );
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        await harness.close(context);
      }
    };
    cleanups.push(close);
    const conversation = await harness.root(context, {
      agent: { model: { provider: model.provider, modelId: model.id } },
    });
    return { harness, conversation, close };
  };
}

function definition(execute: unknown) {
  return {
    name: 'fixture',
    description: 'Fake effect',
    parameters: Type.Object({ value: Type.Number() }),
    execute,
  };
}
const allow = async () => ({ allow: true });
const completed = () =>
  Promise.resolve({
    content: [{ type: 'text', text: 'Effect complete' }],
    details: { done: true },
  });
const submit = (session: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>>>) =>
  session.conversation.submit(
    { type: 'input', content: 'Run fixture', requestId: 'request-1' },
    context,
  );
async function results(session: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>>>) {
  const watch = await session.conversation.watch(context);
  const messages = watch.value.entries
    .flatMap(entry => entry.model ?? [])
    .filter(message => message.role === 'toolResult');
  await watch.stop();
  return messages;
}

test('native call waits for approval, validates edits, and preserves content and error details', async () => {
  let decide!: (decision: DurableToolDecision) => void;
  const authorize = vi.fn(
    () =>
      new Promise<DurableToolDecision>(resolve => {
        decide = resolve;
      }),
  );
  const execute = vi.fn(async (_id, args) => ({
    content: [
      { type: 'text', text: `value ${args.value}` },
      { type: 'image', data: 'AA==', mimeType: 'image/png' },
    ],
    details: { failed: true, omitted: undefined },
    isError: true,
  }));
  const open = await fixture();
  const session = await open(bridgeToolDefinition(definition(execute), { authorize }));
  const submission = await submit(session);
  await expect.poll(() => authorize.mock.calls.length).toBe(1);
  expect(execute).not.toHaveBeenCalled();
  decide({ allow: true, updatedInput: { value: 2 } });
  await submission.wait(context);
  expect(execute.mock.calls[0][1]).toEqual({ value: 2 });
  expect(await results(session)).toEqual([
    expect.objectContaining({
      isError: true,
      details: { failed: true },
      content: [
        { type: 'text', text: 'value 2' },
        { type: 'image', data: 'AA==', mimeType: 'image/png' },
      ],
    }),
  ]);
});

test('denial and invalid approved edits cannot execute a tool', async () => {
  for (const decision of [
    { allow: false, reason: 'Denied', terminateRun: true },
    { allow: true, updatedInput: { value: {} } },
  ]) {
    const open = await fixture();
    const execute = vi.fn(completed);
    const session = await open(
      bridgeToolDefinition(definition(execute), { authorize: async () => decision }),
    );
    await (await submit(session)).wait(context);
    expect(execute).not.toHaveBeenCalled();
    expect((await results(session))[0].isError).toBe(true);
  }
});

test('stop cancels pending approval; a late approval cannot start execution', async () => {
  let decide!: (decision: DurableToolDecision) => void;
  let signal: AbortSignal | undefined;
  const authorize: DurableToolBridgeOptions['authorize'] = call => {
    signal = call.signal;
    return new Promise(resolve => {
      decide = resolve;
    });
  };
  const execute = vi.fn(completed);
  const session = await (await fixture())(bridgeToolDefinition(definition(execute), { authorize }));
  await submit(session);
  await expect.poll(() => signal).toBeDefined();
  await session.conversation.abort(context);
  expect(signal!.aborted).toBe(true);
  decide({ allow: true });
  await session.conversation.waitForIdle(context);
  expect(execute).not.toHaveBeenCalled();
  expect((await results(session))[0].isError).toBe(true);
});

test('close/reopen never replays an unsafe effect and preserves committed partial details', async () => {
  const execute = vi.fn(async (_id, _args, signal: AbortSignal, update) => {
    update({ content: [{ type: 'text', text: 'part' }], details: { phase: 'writing' } });
    update({ content: [{ type: 'text', text: 'partial' }], details: { phase: 'written' } });
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  });
  const authorize = vi.fn(allow);
  const tool = bridgeToolDefinition(
    { ...definition(execute), annotations: { readOnlyHint: true } },
    { authorize },
  );
  expect(tool.replay).toBe('unsafe');
  const open = await fixture();
  const first = await open(tool);
  const submission = await submit(first);
  const watch = await first.conversation.watch(context);
  watch.start(async () => {});
  await expect
    .poll(() => (watch.value.docs[LiveDoc.definition.kind] as LiveState)?.tools?.[0]?.details)
    .toEqual({ phase: 'written' });
  await watch.stop();
  await first.close();
  const second = await open(tool, false);
  expect((await second.harness.inspect(context)).scheduling).toBe('paused');
  second.harness.resume();
  await (await second.harness.submission(submission.id, context))!.wait(context);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(authorize).toHaveBeenCalledTimes(1);
  expect((await results(second))[0]).toMatchObject({
    isError: true,
    details: { phase: 'written' },
  });
  expect(JSON.stringify(await results(second))).toContain('partial');
});

test('safe recovery rechecks authorization inside execute before rerunning', async () => {
  const execute = vi.fn(
    async (_id, _args, signal: AbortSignal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  );
  const authorize = vi.fn(allow);
  const open = await fixture();
  const first = await open(
    bridgeToolDefinition(definition(execute), { authorize, replay: 'safe' }),
  );
  const submission = await submit(first);
  await expect.poll(() => execute.mock.calls.length).toBe(1);
  await first.close();
  const deny = vi.fn(async () => ({ allow: false, reason: 'Permission revoked' }));
  const second = await open(
    bridgeToolDefinition(definition(execute), { authorize: deny, replay: 'safe' }),
    false,
  );
  second.harness.resume();
  await (await second.harness.submission(submission.id, context))!.wait(context);
  expect(deny).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(await results(second))).toContain('Permission revoked');
});

test('closing during approval cancels the waiter and cannot approve on reopen', async () => {
  let signal: AbortSignal | undefined;
  let decide!: (decision: DurableToolDecision) => void;
  const authorize: DurableToolBridgeOptions['authorize'] = call => {
    signal = call.signal;
    return new Promise(resolve => {
      decide = resolve;
    });
  };
  const execute = vi.fn(completed);
  const tool = bridgeToolDefinition(definition(execute), { authorize });
  const open = await fixture();
  const first = await open(tool);
  const submission = await submit(first);
  await expect.poll(() => signal).toBeDefined();
  await first.close();
  expect(signal!.aborted).toBe(true);
  decide({ allow: true });
  const second = await open(tool, false);
  second.harness.resume();
  await (await second.harness.submission(submission.id, context))!.wait(context);
  expect(execute).not.toHaveBeenCalled();
  expect((await results(second))[0].isError).toBe(true);
});

test('native execution keeps final content separate from progress and validates structured results', async () => {
  const execute = vi.fn(async (_id, _args, _signal, update) => {
    update({ content: [{ type: 'text', text: 'working' }], details: { progress: 1 } });
    return {
      content: [{ type: 'text', text: 'Final result' }],
      details: undefined,
      structuredContent: { count: 2 },
    };
  });
  const session = await (
    await fixture()
  )(
    bridgeToolDefinition(
      {
        ...definition(execute),
        outputSchema: Type.Object({ count: Type.Number() }),
      },
      { authorize: allow },
    ),
  );
  await (await submit(session)).wait(context);
  expect((await results(session))[0]).toMatchObject({
    isError: false,
    content: [{ type: 'text', text: 'Final result' }],
    details: { progress: 1 },
  });
});

test('stopping a running effect aborts its original signal and records a native error', async () => {
  let signal: AbortSignal | undefined;
  const execute = vi.fn(async (_id, _args, incoming: AbortSignal) => {
    signal = incoming;
    return new Promise((_resolve, reject) =>
      incoming.addEventListener('abort', () => reject(incoming.reason), { once: true }),
    );
  });
  const session = await (
    await fixture()
  )(bridgeToolDefinition(definition(execute), { authorize: allow }));
  await submit(session);
  await expect.poll(() => signal).toBeDefined();
  await session.conversation.abort(context);
  expect(signal!.aborted).toBe(true);
  expect(execute).toHaveBeenCalledTimes(1);
  expect((await results(session))[0].isError).toBe(true);
});

test('native wrapper preserves the original API and result while requiring host approval', async () => {
  const execute = vi.fn(async (args, api, incomingContext) => {
    expect(api.callId).toBe('call-1');
    expect(api.taskId).toBeTruthy();
    expect(incomingContext.abortSignal).toBeInstanceOf(AbortSignal);
    api.output('Running');
    return {
      output: [{ type: 'text' as const, text: `native ${args.value}` }],
      details: { native: true },
    };
  });
  const original = defineTool({
    name: 'fixture',
    description: 'Native fake tool',
    parameters: Type.Object({ value: Type.Number() }),
    replay: 'safe',
    executionMode: 'sequential',
    execute,
  });
  const authorize = vi.fn(async () => ({ allow: true, updatedInput: { value: 3 } }));
  const wrapped = authorizeNativeTool(original, { authorize });
  expect(wrapped.replay).toBe('unsafe');
  expect(wrapped.executionMode).toBe(original.executionMode);
  expect(wrapped.parameters).toBe(original.parameters);
  const session = await (await fixture())(wrapped);
  await (await submit(session)).wait(context);
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
  expect((await results(session))[0]).toMatchObject({
    isError: false,
    content: [{ type: 'text', text: 'native 3' }],
    details: { native: true },
  });
});

// Fixture adapter used only to drive cancellation/progress cases in native tests.
type AgentToolResult<T> = {
  content: NonNullable<ToolExecutionResult['output']>;
  details?: T;
  isError?: boolean;
  structuredContent?: JsonValue;
  usage?: ToolExecutionResult['usage'];
  terminate?: boolean;
};
type Execute = (
  callId: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: (result: AgentToolResult<unknown>) => void,
) => Promise<AgentToolResult<unknown>>;

function bridgeToolDefinition(
  definition: Record<string, unknown>,
  options: DurableToolBridgeOptions,
): ToolRegistration {
  const { name, description, parameters, execute } = definition;
  if (
    typeof name !== 'string' ||
    !name ||
    typeof description !== 'string' ||
    !parameters ||
    typeof parameters !== 'object' ||
    Array.isArray(parameters) ||
    typeof execute !== 'function' ||
    typeof options.authorize !== 'function'
  ) {
    throw new Error('A tool definition and an authorization service are required.');
  }
  const tool = { name, description, parameters: parameters as TSchema };
  const run: Execute = (execute as Execute).bind(definition);
  const exposure = definition.exposure;
  return authorizeNativeTool(
    defineTool({
      ...tool,
      ...(definition.executionMode === 'parallel' || definition.executionMode === 'sequential'
        ? { executionMode: definition.executionMode }
        : {}),
      ...(typeof definition.prepareArguments === 'function'
        ? { prepareArguments: definition.prepareArguments as ToolRegistration['prepareArguments'] }
        : {}),
      ...(definition.outputSchema
        ? { structuredOutputSchema: definition.outputSchema as TSchema }
        : {}),
      ...(exposure === 'model-only' ? { callers: ['model'] as const } : {}),
      ...(exposure === 'codemode' || exposure === 'hidden' ? { callers: ['tools'] as const } : {}),
      ...(exposure === 'deferred' || definition.defaultActive === false
        ? { deferred: true as const }
        : {}),
      async execute(args, api, context) {
        context.abortSignal?.throwIfAborted();
        let active = true;
        let previousText = '';
        let progress = Promise.resolve();
        let progressError: unknown;
        try {
          const result = await awaitWithContext(
            run(api.callId, args as Record<string, unknown>, context.abortSignal, partial => {
              if (!active || context.abortSignal?.aborted) return;
              // Coding tools publish snapshots; the native stream accepts deltas.
              const text = partial.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('\n');
              if (text !== previousText) {
                api.output(
                  text.startsWith(previousText) ? text.slice(previousText.length) : `\n${text}`,
                );
                previousText = text;
              }
              if (partial.details !== undefined) {
                const details = copyJson(partial.details, { omitUndefinedProperties: true });
                // Native progress coalesces snapshots. Do not serialize updates
                // into one storage commit per token/chunk behind its throttle.
                progress = api.details(details, context).catch(error => {
                  progressError ??= error;
                });
              }
            }),
            context,
          );
          active = false;
          await progress;
          context.abortSignal?.throwIfAborted();
          if (progressError) throw progressError;
          return {
            output: result.content,
            ...(result.details === undefined
              ? {}
              : {
                  details: copyJson(result.details, { omitUndefinedProperties: true }),
                }),
            ...(result.structuredContent === undefined
              ? {}
              : {
                  structuredOutput: copyJson(result.structuredContent),
                }),
            ...(result.usage === undefined ? {} : { usage: result.usage }),
            ...(result.isError === undefined ? {} : { isError: result.isError }),
            ...(result.terminate ? { control: { terminate: true as const } } : {}),
          };
        } finally {
          active = false;
        }
      },
    }),
    options,
  );
}
