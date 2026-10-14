import type { AssistantTurnItem } from './messageGrouping';
import { hasText } from './toolUtils';

export const getFinalAnswerIndex = (
  items: AssistantTurnItem[],
  allowCompletedFallback = false,
): number => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item.type === 'assistant' &&
      !item.message.metadata?.isThinking &&
      item.message.metadata?.isFinalAnswer === true &&
      hasText(item.message.content)
    ) {
      return index;
    }
  }
  const hasStreamingAnswer = items.some(
    item =>
      item.type === 'assistant' &&
      !item.message.metadata?.isThinking &&
      item.message.metadata?.isStreaming &&
      hasText(item.message.content),
  );
  // 2026/09/20 lixiang  轮次已结束时即使仍有未回填的 tool_result，也兜底展示最后一条回答，
  // 避免卡在「Running」工具态、用户看不到结果（issue #805）
  if (!allowCompletedFallback || hasStreamingAnswer) return -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item.type === 'assistant' &&
      !item.message.metadata?.isThinking &&
      !item.message.metadata?.isStreaming &&
      hasText(item.message.content)
    ) {
      return index;
    }
  }
  return -1;
};
