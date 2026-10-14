/** Isolated package acceptance entry. No Main IPC, provider or arbitrary script
 * interface: only this fixed harmless command can be approved and executed. */
import assert from 'node:assert/strict';
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context';
import {
  createRegistry,
  Harness,
  MemoryStorage,
  type HarnessOptions,
} from '@earendil-works/pi-durable';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { createNativeExecutionEnv } from './nativeExecutionEnv';
import { authorizeNativeTool } from './toolBridge';

export const NATIVE_SMOKE_COMMAND =
  "printf 'zhiyuan-native-bash-中文\\n'; printf '%s\\n' \"$PWD\"; git --version";

export async function runNativeExecutionSmoke(
  cwd: string,
  resourcesRoot: string,
  signal?: AbortSignal,
) {
  const context = signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT;
  const environment = await createNativeExecutionEnv(cwd, resourcesRoot);
  const registry = createRegistry();
  let approvals = 0;
  registry.install({
    ...CodingTools,
    tools: CodingTools.tools?.map(tool =>
      authorizeNativeTool(tool, {
        authorize: async call => {
          assert.equal(call.toolName, 'bash');
          assert.equal(call.toolInput.command, NATIVE_SMOKE_COMMAND);
          approvals++;
          return { allow: true };
        },
      }),
    ),
  });
  const model = {
    id: 'acceptance',
    name: 'Acceptance fixture',
    provider: 'acceptance',
    api: 'openai-completions' as const,
    baseUrl: 'http://unused.invalid',
    input: ['text' as const],
    reasoning: false,
    contextWindow: 32000,
    maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let calls = 0;
  // Fixture supplies only the two model operations exercised by this fixed run.
  const models = {
    getModel: () => model,
    streamSimple: () => {
      const invoke = calls++ === 0;
      const message = {
        role: 'assistant' as const,
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: invoke
          ? [
              {
                type: 'toolCall' as const,
                id: 'native-bash-1',
                name: 'bash',
                arguments: { command: NATIVE_SMOKE_COMMAND, timeout: 10 },
              },
            ]
          : [{ type: 'text' as const, text: 'Acceptance complete' }],
        stopReason: invoke ? ('toolUse' as const) : ('stop' as const),
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
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done' as const, reason: message.stopReason, message };
        },
        result: async () => message,
      } as unknown as ReturnType<NonNullable<HarnessOptions['models']>['streamSimple']>;
    },
  };
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      registry,
      models: models as unknown as HarnessOptions['models'],
      env: () => environment,
      settings: { retry: { enabled: false } },
    },
    BACKGROUND_CONTEXT,
  );
  try {
    const conversation = await harness.root(context, {
      agent: { model: { provider: model.provider, modelId: model.id }, cwd },
    });
    const submission = await conversation.submit(
      {
        type: 'input',
        content: 'Run the fixed package acceptance command',
        requestId: 'native-bash-acceptance',
      },
      context,
    );
    const receipt = await submission.wait(context);
    assert.equal(receipt.status, 'done');
    const watch = await conversation.watch(BACKGROUND_CONTEXT);
    const results = watch.value.entries
      .flatMap(entry => entry.model ?? [])
      .filter(message => message.role === 'toolResult');
    await watch.stop();
    assert.equal(results.length, 1);
    assert.equal(results[0].toolName, 'bash');
    assert.equal(results[0].isError, false);
    const output = results[0].content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
    assert.ok(output.includes('zhiyuan-native-bash-中文'));
    assert.match(output, /git version \d/);
    assert.equal(approvals, 1);
    assert.equal(calls, 2);
    return { passed: true, tool: 'bash', approvals, output };
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await environment.cleanup(BACKGROUND_CONTEXT);
  }
}

// Only a forked acceptance subprocess has IPC. Importing the helper never
// starts work or registers a product-facing command.
if (typeof require !== 'undefined' && require.main === module && process.send) {
  const controller = new AbortController();
  process.once('disconnect', () => controller.abort());
  let started = false;
  process.on('message', (input: { cwd: string; resourcesRoot: string } | { cancel: true }) => {
    if ('cancel' in input) {
      controller.abort();
      return;
    }
    if (started) return;
    started = true;
    const finish = (response: unknown) => {
      if (process.connected) process.send?.(response, () => process.disconnect());
    };
    void runNativeExecutionSmoke(input.cwd, input.resourcesRoot, controller.signal).then(
      result => finish({ success: true, result }),
      error =>
        finish({ success: false, error: error instanceof Error ? error.message : String(error) }),
    );
  });
}
