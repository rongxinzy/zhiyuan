import type { Api, Model, ProviderStreams } from '@earendil-works/pi-ai';
import type { AgentChange, HarnessOptions } from '@earendil-works/pi-durable';
import type { ApiConfigResolution } from '../../claudeSettings';
import {
  isLocalProviderName,
  ModelCapabilityStatus,
  ProviderName,
} from '../../../../shared/providers';
import { resolvePiCustomModelApi } from '../piModelApi';
import { resolvePiBuiltinProviderId } from '../piProviderIds';
import { buildDurableModel } from './providerConfiguration';

export interface DurableProvider {
  models: HarnessOptions['models'];
  model: NonNullable<AgentChange['model']>;
  modelObject: Model<Api>;
  maxOutputTokens: number;
}

/** Native Models is structurally checked against Durable's installed pi-ai API. */
export async function createDurableModels(
  model: Model<Api>,
  apiKey: string,
  streams?: ProviderStreams,
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
          name: 'Configured provider credential',
          resolve: async () => ({ auth: { apiKey }, source: 'application configuration' }),
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
    case 'google-generative-ai':
      return (
        await import('@earendil-works/pi-ai/api/google-generative-ai.lazy')
      ).googleGenerativeAIApi();
    default:
      throw new Error(`Unsupported configured model protocol: ${api}`);
  }
}

/** Also exported for configuration tests without touching the app's store or credentials. */
export async function resolveDurableProviderFromConfiguration(
  resolution: ApiConfigResolution,
  sessionId: string,
  mode: 'work' | 'chat',
  resolveBaseUrl: (
    resolution: ApiConfigResolution,
    api: ReturnType<typeof resolvePiCustomModelApi>,
  ) => Promise<string>,
  managedProxyKey: string,
): Promise<DurableProvider> {
  const { config, providerMetadata: metadata } = resolution;
  if (!config || !metadata)
    throw new Error(resolution.error || 'Model configuration is unavailable.');
  const baseUrl = await resolveBaseUrl(resolution, resolvePiCustomModelApi(resolution));
  let modelObject = buildDurableModel(resolution, baseUrl, sessionId, mode);
  // Keep the native catalog's provider-specific compatibility metadata when using its endpoint.
  const providerId = resolvePiBuiltinProviderId(metadata.providerName);
  if (providerId && !isLocalProviderName(metadata.providerName)) {
    const { getBuiltinModels, getBuiltinProviders, getBuiltinModelDataGeneratedAt } =
      await import('@earendil-works/pi-ai/providers/all');
    const { getNativeCatalogStore } = await import('./modelCatalog.js');
    const { isModelType } = await import('@earendil-works/pi-ai/models');
    const known = getBuiltinProviders().find(provider => provider === providerId);
    const catalog: readonly Model<Api>[] = known ? getBuiltinModels(known) : [];
    const cached = await (await getNativeCatalogStore()).read(providerId);
    const overlay =
      (cached?.lastModified ?? 0) > (getBuiltinModelDataGeneratedAt() ?? 0)
        ? cached?.models.find(
            (model): model is Model<Api> => isModelType(model, 'chat') && model.id === config.model,
          )
        : undefined;
    const builtin = overlay ?? catalog.find(model => model.id === config.model);
    const normalize = (url: string) => url.trim().replace(/\/+$/, '');
    if (
      builtin &&
      builtin.api === modelObject.api &&
      normalize(builtin.baseUrl) === normalize(baseUrl)
    ) {
      modelObject = {
        ...builtin,
        ...modelObject,
        provider: builtin.provider,
        cost: builtin.cost,
        reasoning:
          metadata.piRuntime?.reasoning !== undefined ||
          (resolution.endpoint?.capabilities.reasoning ?? metadata.capabilities?.reasoning) ===
            ModelCapabilityStatus.Supported ||
          (resolution.endpoint?.capabilities.reasoning ?? metadata.capabilities?.reasoning) ===
            ModelCapabilityStatus.Unsupported
            ? modelObject.reasoning
            : builtin.reasoning,
        input:
          metadata.supportsImage !== undefined ||
          (resolution.endpoint?.capabilities.imageInput ?? metadata.capabilities?.imageInput) ===
            ModelCapabilityStatus.Supported ||
          (resolution.endpoint?.capabilities.imageInput ?? metadata.capabilities?.imageInput) ===
            ModelCapabilityStatus.Unsupported
            ? modelObject.input
            : builtin.input,
        contextWindow:
          resolution.endpoint?.contextWindow ||
          metadata.contextWindow ||
          metadata.contextTokens ||
          builtin.contextWindow,
        maxTokens: resolution.endpoint?.maxTokens || metadata.maxTokens || builtin.maxTokens,
        compat: { ...builtin.compat, ...modelObject.compat },
      };
    }
  }
  const apiKey =
    metadata.providerName === ProviderName.Zhiyuan
      ? managedProxyKey
      : config.apiKey?.trim() ||
        (isLocalProviderName(metadata.providerName) ? 'sk-zhiyuan-local' : '');
  const models = await createDurableModels(modelObject, apiKey);
  return {
    models,
    model: { provider: modelObject.provider, modelId: modelObject.id },
    modelObject,
    maxOutputTokens: modelObject.maxTokens,
  };
}

export async function resolveDurableProvider(
  sessionId: string,
  modelRef?: string,
  mode: 'work' | 'chat' = 'work',
): Promise<DurableProvider> {
  const [{ resolveRawApiConfig, resolveRawApiConfigForModelRef }, proxy] = await Promise.all([
    import('../../claudeSettings.js'),
    import('../piManagedModelProxy.js'),
  ]);
  const ref = modelRef?.trim();
  const resolution = ref ? resolveRawApiConfigForModelRef(ref) : resolveRawApiConfig();
  return resolveDurableProviderFromConfiguration(
    resolution,
    sessionId,
    mode,
    proxy.resolvePiCustomModelBaseUrl,
    proxy.PI_MANAGED_PROXY_API_KEY,
  );
}
