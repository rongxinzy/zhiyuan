import { expect, test, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createDurableModels } from './provider';
import { createPythonTools } from './pythonTools';
import { PythonRuntimeService } from '../../../pythonRuntime/service';

for (const allow of [false, true])
  test(`native Python tool ${allow ? 'executes after approval' : 'cannot start Runner after denial'}`, async () => {
    const service = new PythonRuntimeService({
      storageRoot: '/unused',
      runnerPath: '/must-not-run',
    });
    const install = vi.spyOn(service, 'install').mockResolvedValue({
      stdout: 'installed',
      stderr: '',
      exitCode: 0,
      truncated: false,
      environmentId: 'fixture',
      runtimeId: 'fixture',
    });
    const authorize = vi.fn(async (_call: import('./toolBridge').DurableToolAuthorization) => ({
      allow,
      reason: 'denied',
      terminateRun: !allow,
    }));
    const extension = createPythonTools(service, '/workspace', { authorize });
    expect(extension.tools?.every(tool => tool.replay === 'unsafe')).toBe(true);
    expect(extension.tools?.every(tool => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name))).toBe(true);
    const registry = createRegistry();
    registry.install(extension);
    const faux = createFauxCore({
      provider: 'fixture',
      models: [{ id: 'fixture' }],
      tokensPerSecond: 0,
    });
    faux.setResponses([
      {
        ...fauxAssistantMessage(''),
        content: [
          {
            type: 'toolCall',
            id: 'python-call',
            name: 'python_install',
            arguments: { packages: ['packaging==25.0'] },
          },
        ],
        stopReason: 'toolUse',
      },
      fauxAssistantMessage('Done'),
    ]);
    const harness = await Harness.open(
      new MemoryStorage(),
      { registry, models: await createDurableModels(faux.getModel(), 'unused', faux) },
      context,
    );
    try {
      const root = await harness.root(context, {
        agent: { model: { provider: 'fixture', modelId: 'fixture' } },
      });
      const submission = await root.submit(
        { type: 'input', content: 'Install the package' },
        context,
      );
      await submission.wait(context);
      expect(authorize).toHaveBeenCalledOnce();
      expect(authorize.mock.calls[0][0]).toMatchObject({ toolName: 'python_install' });
      expect(install).toHaveBeenCalledTimes(allow ? 1 : 0);
      if (allow)
        expect(install.mock.calls[0][0]).toEqual({
          workspace: '/workspace',
          packages: ['packaging==25.0'],
        });
    } finally {
      await harness.close(context);
      await service.shutdown();
    }
  });

test('real OpenAI and Anthropic serializers send portable Python names and matching approval names', async () => {
  const { normalizeContext } = await import('@earendil-works/pi-ai/utils/transcript');
  const openai = await import('@earendil-works/pi-ai/api/openai-completions');
  const anthropic = await import('@earendil-works/pi-ai/api/anthropic-messages');
  const service = new PythonRuntimeService({ storageRoot: '/unused', runnerPath: '/unused' });
  const tools = [
    ...createPythonTools(service, '/workspace', { authorize: async () => ({ allow: false }) })
      .tools!,
  ];
  const context = normalizeContext({
    messages: [{ role: 'user', content: 'test', timestamp: 1 }],
    tools,
  });
  const bodies: Array<{ tools: Array<{ name?: string; function?: { name: string } }> }> = [];
  const fetchRequest: typeof fetch = async (_input, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected serialized JSON');
    bodies.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        error: { message: 'fixture ends after serialization', type: 'invalid_request_error' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  };
  const base = {
    id: 'fixture',
    name: 'Fixture',
    provider: 'fixture',
    baseUrl: 'https://unused.invalid',
    reasoning: false,
    input: ['text' as const],
    contextWindow: 32000,
    maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  await openai
    .stream({ ...base, api: 'openai-completions' }, context, {
      apiKey: 'fixture-only',
      fetch: fetchRequest,
    })
    .result();
  await anthropic
    .stream({ ...base, api: 'anthropic-messages' }, context, {
      apiKey: 'fixture-only',
      fetch: fetchRequest,
    })
    .result();
  expect(bodies).toHaveLength(2);
  expect(bodies[0].tools.map(tool => tool.function?.name)).toEqual([
    'python_execute',
    'python_install',
  ]);
  expect(bodies[1].tools.map(tool => tool.name)).toEqual(['python_execute', 'python_install']);
  await service.shutdown();
});
