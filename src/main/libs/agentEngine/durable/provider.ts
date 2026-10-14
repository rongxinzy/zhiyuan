import type { Api, Model, ProviderStreams } from '@earendil-works/pi-ai';
import type { AgentChange, HarnessOptions } from '@earendil-works/pi-durable';
import { getMagpieModelService } from '../../../magpie/modelService';
import { buildDurableModel } from './providerConfiguration';

export interface DurableProvider {
  models: HarnessOptions['models'];
  model: NonNullable<AgentChange['model']>;
  modelObject: Model<Api>;
  maxOutputTokens: number;
}

/** Native provider construction; no application credentials or second provider registry. */
export async function createDurableModels(
  model: Model<Api>,
  apiKey: string,
  streams?: ProviderStreams,
  beforeRequest?: () => Promise<{ baseUrl?: string } | void>,
): Promise<HarnessOptions['models']> {
  const { createModels, createProvider } = await import('@earendil-works/pi-ai/models');
  const api = streams ?? (await resolveStreams(model.api));
  const models = createModels();
  models.setProvider(
    createProvider({
      id: model.provider,
      name: model.provider,
      baseUrl: model.baseUrl,
      models: [model],
      auth: {
        apiKey: {
          name: 'Local model gateway',
          resolve: async () => {
            const current = await beforeRequest?.();
            return {
              auth: { apiKey, ...(current && current.baseUrl ? { baseUrl: current.baseUrl } : {}) },
              source: 'owned local gateway',
            };
          },
        },
      },
      api,
    }),
  );
  return models;
}
async function resolveStreams(api: Api): Promise<ProviderStreams> {
  switch (api) {
    case 'openai-completions':
      return (
        await import('@earendil-works/pi-ai/api/openai-completions.lazy')
      ).openAICompletionsApi();
    case 'openai-responses':
      return (await import('@earendil-works/pi-ai/api/openai-responses.lazy')).openAIResponsesApi();
    case 'anthropic-messages':
      return (
        await import('@earendil-works/pi-ai/api/anthropic-messages.lazy')
      ).anthropicMessagesApi();
    default:
      throw new Error(`Unsupported model gateway protocol: ${api}`);
  }
}
export async function resolveDurableProvider(
  sessionId: string,
  modelRef?: string,
  mode: 'work' | 'chat' = 'work',
): Promise<DurableProvider> {
  const service = getMagpieModelService();
  const selected = await service.resolve(modelRef);
  const modelObject = buildDurableModel(selected.model, selected.gatewayUrl, sessionId, mode);
  const models = await createDurableModels(modelObject, 'magpie-zhiyuan', undefined, async () => {
    // Revalidate revoked enterprise access, unloaded GPU models and the owned process each turn.
    const current = await service.resolve(selected.model.id);
    const currentModel = buildDurableModel(current.model, current.gatewayUrl, sessionId, mode);
    if (
      JSON.stringify({ ...currentModel, baseUrl: undefined }) !==
      JSON.stringify({ ...modelObject, baseUrl: undefined })
    )
      throw new Error('Model configuration changed. Start a new task with the current model.');
    // Pi native auth may override a model URL per request; gateway port changes after a
    // restart do not require a new session or ever redirect this model to a cloud fallback.
    return { baseUrl: currentModel.baseUrl };
  });
  return {
    models,
    model: { provider: modelObject.provider, modelId: modelObject.id },
    modelObject,
    maxOutputTokens: modelObject.maxTokens,
  };
}
