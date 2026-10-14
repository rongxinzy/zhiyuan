import type { Api, Model } from '@earendil-works/pi-ai';
import type { ApiConfigResolution } from '../../claudeSettings';
import {
  isLocalProviderName,
  ModelCapabilityStatus,
  ProviderName,
  resolveProviderModelPiReasoning,
} from '../../../../shared/providers';
import { ZhiyuanModelPoolHeader } from '../../../../shared/modelPool/constants';
import { resolvePiCustomModelApi } from '../piModelApi';

/** Application model choices, expressed as a native pi-ai model, never a coding-agent session. */
export function buildDurableModel(
  resolution: ApiConfigResolution,
  baseUrl: string,
  sessionId: string,
  mode: 'work' | 'chat',
): Model<Api> {
  const { config, providerMetadata: metadata, endpoint } = resolution;
  if (!config || !metadata)
    throw new Error(resolution.error || 'Model configuration is unavailable.');
  const local = isLocalProviderName(metadata.providerName);
  const capabilities = endpoint?.capabilities ?? metadata.capabilities;
  const runtime = metadata.piRuntime;
  return {
    id: endpoint?.modelId ?? config.model,
    name: endpoint?.displayName || metadata.modelName || config.model,
    provider: metadata.providerName,
    api: resolvePiCustomModelApi(resolution),
    baseUrl,
    reasoning: resolveProviderModelPiReasoning(runtime, capabilities),
    input:
      metadata.supportsImage || capabilities?.imageInput === ModelCapabilityStatus.Supported
        ? ['text', 'image']
        : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow:
      endpoint?.contextWindow ||
      metadata.contextWindow ||
      metadata.contextTokens ||
      (local ? 32768 : 256000),
    maxTokens: endpoint?.maxTokens || metadata.maxTokens || (local ? 4096 : 32768),
    ...(runtime?.compat ? { compat: runtime.compat } : {}),
    ...(runtime?.thinkingLevelMap ? { thinkingLevelMap: runtime.thinkingLevelMap } : {}),
    ...(runtime?.inputLimits ? { inputLimits: runtime.inputLimits } : {}),
    ...(runtime?.promptCache ? { promptCache: runtime.promptCache } : {}),
    ...(runtime?.samplingParams ? { samplingParams: runtime.samplingParams } : {}),
    ...(metadata.providerName === ProviderName.Zhiyuan
      ? {
          headers: {
            [ZhiyuanModelPoolHeader.ConversationId]: sessionId,
            [ZhiyuanModelPoolHeader.Workload]: mode,
          },
        }
      : {}),
  };
}
