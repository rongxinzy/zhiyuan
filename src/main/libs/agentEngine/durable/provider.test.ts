import { describe, expect, test, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import type { ApiConfigResolution } from '../../claudeSettings';
import { ProviderName } from '../../../../shared/providers';
import { resolveModelEndpoint } from '../../../../shared/providers/modelEndpoint';
import { ZhiyuanModelPoolHeader } from '../../../../shared/modelPool/constants';
import { createDurableModels, resolveDurableProviderFromConfiguration } from './provider';
import { buildDurableModel } from './providerConfiguration';

function configured(providerName: string = ProviderName.Ollama): ApiConfigResolution {
  return {
    config: {
      model: 'fixture',
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      apiType: 'openai',
    },
    providerMetadata: { providerName, codingPlanEnabled: false },
  };
}

describe('native durable configured provider', () => {
  test('retains native catalog capabilities, costs and limits when application metadata is absent', async () => {
    const { getBuiltinModels } = await import('@earendil-works/pi-ai/providers/all');
    const builtin = getBuiltinModels('anthropic').find(
      model => model.reasoning && model.input.includes('image'),
    )!;
    expect(builtin).toBeDefined();
    const resolution = configured(ProviderName.Anthropic);
    resolution.config = {
      model: builtin.id,
      baseURL: builtin.baseUrl,
      apiType: 'anthropic',
      apiKey: 'configured',
    };
    const result = await resolveDurableProviderFromConfiguration(
      resolution,
      'session',
      'work',
      async () => builtin.baseUrl,
      'unused',
    );
    expect(result.modelObject).toMatchObject({
      reasoning: builtin.reasoning,
      input: builtin.input,
      contextWindow: builtin.contextWindow,
      maxTokens: builtin.maxTokens,
      cost: builtin.cost,
    });
  });
  test('native Models dispatches a real Harness generation without a legacy runtime bridge', async () => {
    const faux = createFauxCore({
      provider: 'fixture',
      models: [{ id: 'fixture' }],
      tokensPerSecond: 0,
    });
    faux.setResponses([fauxAssistantMessage('Native durable answer')]);
    const models = await createDurableModels(faux.getModel(), 'test-only-key', faux);
    const harness = await Harness.open(
      new MemoryStorage(),
      { models, registry: createRegistry() },
      context,
    );
    try {
      const root = await harness.root(context, {
        agent: { model: { provider: 'fixture', modelId: 'fixture' } },
      });
      const submission = await root.submit(
        { type: 'input', content: 'hello', requestId: 'once' },
        context,
      );
      expect((await submission.wait(context)).status).toBe('done');
      expect(
        (await root.submit({ type: 'input', content: 'hello', requestId: 'once' }, context)).id,
      ).toBe(submission.id);
      expect(faux.state.callCount).toBe(1);
      expect((await root.context(context)).messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: [{ type: 'text', text: 'Native durable answer' }],
          }),
        ]),
      );
    } finally {
      await harness.close(context);
    }
  });

  test('keeps keyless local endpoints configured and uses bounded local defaults', async () => {
    const resolution = configured();
    const resolveBaseUrl = vi.fn(async () => resolution.config!.baseURL);
    const result = await resolveDurableProviderFromConfiguration(
      resolution,
      'session',
      'work',
      resolveBaseUrl,
      'unused',
    );
    expect(result.model).toEqual({ provider: ProviderName.Ollama, modelId: 'fixture' });
    expect(result.modelObject).toMatchObject({
      api: 'openai-completions',
      contextWindow: 32768,
      maxTokens: 4096,
    });
    expect((await result.models.getAuth(result.modelObject))?.auth.apiKey).toBe('sk-zhiyuan-local');
    expect(resolveBaseUrl).toHaveBeenCalledWith(resolution, 'openai-completions');
  });

  test('managed provider uses loopback capability and propagates session/workload headers', async () => {
    const resolution = configured(ProviderName.Zhiyuan);
    resolution.config!.apiKey = 'must-not-send-upstream-token-directly';
    const result = await resolveDurableProviderFromConfiguration(
      resolution,
      'room-42',
      'chat',
      async () => 'http://127.0.0.1:12345/v1',
      'loopback-capability',
    );
    expect(result.modelObject.baseUrl).toBe('http://127.0.0.1:12345/v1');
    expect(result.modelObject.headers).toEqual({
      [ZhiyuanModelPoolHeader.ConversationId]: 'room-42',
      [ZhiyuanModelPoolHeader.Workload]: 'chat',
    });
    expect((await result.models.getAuth(result.modelObject))?.auth.apiKey).toBe(
      'loopback-capability',
    );
  });

  test.each([
    [ProviderName.OpenAI, 'openai', 'openai-responses'],
    [ProviderName.Anthropic, 'anthropic', 'anthropic-messages'],
    [ProviderName.Gemini, 'gemini', 'google-generative-ai'],
  ] as const)(
    'retains %s protocol and supplied credentials',
    async (provider, protocol, expectedApi) => {
      const resolution = configured(provider);
      resolution.config!.apiKey = 'supplied-key';
      // Endpoint protocol is authoritative, including Gemini which older config aliases flatten.
      resolution.providerMetadata!.piRuntime = {
        ...(protocol === 'anthropic' ? { api: 'anthropic-messages' } : {}),
      };
      if (protocol === 'gemini') {
        resolution.endpoint = resolveModelEndpoint(provider, 'fixture', {
          apiFormat: 'gemini',
          baseUrl: resolution.config!.baseURL,
        });
      }
      const result = await resolveDurableProviderFromConfiguration(
        resolution,
        'session',
        'work',
        async () => resolution.config!.baseURL,
        'unused',
      );
      expect(result.modelObject.api).toBe(expectedApi);
      expect((await result.models.getAuth(result.modelObject))?.auth.apiKey).toBe('supplied-key');
    },
  );

  test('preserves configured reasoning, compatibility, cache, input limits and sampling metadata', () => {
    const resolution = configured();
    resolution.providerMetadata!.piRuntime = {
      compat: { maxTokensField: 'max_tokens', supportsStrictMode: false },
      thinkingLevelMap: { high: 'enabled' },
      inputLimits: { maxRequestBytes: 8192 },
      samplingParams: { temperature: 0.2 },
    };
    const model = buildDurableModel(resolution, 'http://localhost/v1', 'session', 'work');
    expect(model).toMatchObject(resolution.providerMetadata!.piRuntime);
  });
});
