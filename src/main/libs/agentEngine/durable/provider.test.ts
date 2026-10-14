import { describe, expect, test } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createDurableModels, resolveDurableProvider } from './provider';
import { buildDurableModel } from './providerConfiguration';
import { MagpieModelService, installMagpieModelService } from '../../../magpie/modelService';

describe('native durable gateway provider', () => {
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

  test('uses the native gateway protocol, exact id, limits, reasoning and vision', () => {
    const model = buildDurableModel(
      {
        id: 'vendor/model',
        native_endpoints: ['/v1/messages'],
        context_window: 200000,
        max_output_tokens: 64000,
        reasoning: true,
        supported_reasoning_levels: [{ effort: 'high' }],
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
      'http://127.0.0.1:1234',
      'session',
      'work',
    );
    expect(model).toMatchObject({
      id: 'vendor/model',
      provider: 'magpie',
      api: 'anthropic-messages',
      baseUrl: 'http://127.0.0.1:1234',
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      input: ['text', 'image'],
      thinkingLevelMap: { high: 'high', low: null },
    });
    expect(model.headers?.['X-Magpie-Session']).toBe('session');
  });
  test('prefers Responses over translated Chat and keeps the /v1 base only for OpenAI', () => {
    expect(
      buildDurableModel(
        { id: 'vendor/gpt', native_endpoints: ['/v1/chat/completions', '/v1/responses'] },
        'http://127.0.0.1:1234',
        's',
        'chat',
      ),
    ).toMatchObject({ api: 'openai-responses', baseUrl: 'http://127.0.0.1:1234/v1' });
    expect(() => buildDurableModel({ id: 'x' }, 'https://evil.test', 's', 'work')).toThrow(
      'gateway',
    );
  });
  test('uses only the registered gateway and rechecks policy on later requests', async () => {
    let allowed = true;
    let gatewayUrl = 'http://127.0.0.1:1234';
    const service = new MagpieModelService(
      {
        status: () => ({ state: 'running', version: 'test', gatewayUrl }),
        models: async () => [{ id: 'v/m' }],
      },
      {
        readDefaultModelId: () => 'v/m',
        writeDefaultModelId: () => {},
        allowedModel: () => allowed,
      },
    );
    const dispose = installMagpieModelService(service);
    try {
      const result = await resolveDurableProvider('s');
      expect(result.model).toEqual({ provider: 'magpie', modelId: 'v/m' });
      expect((await result.models.getAuth(result.modelObject))?.auth.apiKey).toBe('magpie-zhiyuan');
      gatewayUrl = 'http://127.0.0.1:2345';
      expect((await result.models.getAuth(result.modelObject))?.auth.baseUrl).toBe(
        'http://127.0.0.1:2345/v1',
      );
      allowed = false;
      await expect(result.models.getAuth(result.modelObject)).rejects.toThrow();
    } finally {
      dispose();
    }
  });
});
