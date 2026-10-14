import type { Api, Model } from '@earendil-works/pi-ai';
import type { MagpieModel } from '../../../../shared/magpie/types';
import { ZhiyuanModelPoolHeader } from '../../../../shared/modelPool/constants';

export const MAGPIE_PI_PROVIDER = 'magpie';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** The gateway owns provider configuration; this is only its public native Pi projection. */
export function buildDurableModel(
  model: MagpieModel,
  gatewayUrl: string,
  sessionId: string,
  mode: 'work' | 'chat',
): Model<Api> {
  const url = new URL(gatewayUrl);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Invalid owned model gateway URL');
  const endpoints = model.native_endpoints ?? [];
  const api = endpoints.includes('/v1/responses')
    ? 'openai-responses'
    : endpoints.includes('/v1/messages')
      ? 'anthropic-messages'
      : 'openai-completions';
  const levels = model.supported_reasoning_levels?.map(level => level.effort) ?? [];
  const thinkingLevelMap = levels.length
    ? Object.fromEntries(
        THINKING_LEVELS.map(level => {
          const effort = level === 'off' ? 'none' : level;
          return [level, levels.includes(effort) ? effort : null];
        }),
      )
    : undefined;
  const contextWindow = model.context_window ?? 32768;
  // Unknown limits are deliberately conservative, not invented vendor capabilities.
  const maxTokens = Math.min(model.max_output_tokens ?? 4096, contextWindow);
  return {
    id: model.id,
    name: model.display_name || model.id,
    provider: MAGPIE_PI_PROVIDER,
    api,
    baseUrl: api === 'anthropic-messages' ? url.origin : `${url.origin}/v1`,
    reasoning: model.reasoning === true,
    input: model.modalities?.input.includes('image') ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    compat: { sendSessionAffinityHeaders: true },
    headers: {
      'X-Magpie-Session': sessionId,
      [ZhiyuanModelPoolHeader.ConversationId]: sessionId,
      [ZhiyuanModelPoolHeader.Workload]: mode,
    },
  };
}
