import { CoworkContentPolicy } from '../shared/cowork/contentProjection';

const ToolPreviewLimit = { Nodes: 128, Characters: 8_000, Depth: 4, KeyCharacters: 128 } as const;

/** Fixed work/size budgets: this display preview never becomes executable tool arguments. */
function toolInputPreview(input: Record<string, unknown>) {
  let nodes = ToolPreviewLimit.Nodes as number;
  let characters = ToolPreviewLimit.Characters as number;
  let truncated = false;
  const seen = new Set<object>();
  const text = (value: string, maximum = characters): string => {
    const length = Math.min(value.length, characters, maximum);
    characters -= length;
    if (length < value.length) truncated = true;
    return value.slice(0, length) + (length < value.length ? '…[truncated]' : '');
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (--nodes < 0 || depth > ToolPreviewLimit.Depth || characters <= 0) {
      truncated = true;
      return '[truncated]';
    }
    if (typeof value === 'string') return text(value);
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value !== 'object') return undefined;
    if (seen.has(value)) {
      truncated = true;
      return '[circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) {
        if (nodes <= 0 || characters <= 0) {
          truncated = true;
          result.push('[truncated]');
          break;
        }
        result.push(visit(item, depth + 1));
      }
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (nodes <= 0 || characters <= 0) {
        truncated = true;
        result['…'] = '[truncated]';
        break;
      }
      result[text(key, ToolPreviewLimit.KeyCharacters)] = visit(
        (value as Record<string, unknown>)[key],
        depth + 1,
      );
    }
    return result;
  };
  const value = visit(input, 0);
  return { value, truncated };
}

/** Content frames carry bounded display state; attachment bytes remain excluded. */
export function getCoworkStreamMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const result: Record<string, unknown> = {};
  const scalarKeys = [
    'isError',
    'isStreaming',
    'isFinal',
    'isFinalAnswer',
    'isThinking',
    'thinkingDurationMs',
    'contextPercent',
    'toolUseId',
    'toolName',
    'model',
    'modelProviderKey',
    'agentName',
    'error',
    'errorKind',
  ];
  for (const key of scalarKeys) {
    const value = metadata[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
      result[key] = value;
    else if (typeof value === 'string')
      result[key] = value.slice(0, CoworkContentPolicy.PreviewCharacters);
  }
  if (
    metadata.toolInput &&
    typeof metadata.toolInput === 'object' &&
    !Array.isArray(metadata.toolInput)
  ) {
    const preview = toolInputPreview(metadata.toolInput as Record<string, unknown>);
    result.toolInput = preview.value;
    result.toolInputTruncated = preview.truncated || metadata.toolInputTruncated === true;
  }
  for (const key of ['metrics', 'usage', 'contextUsage']) {
    const value = metadata[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const bounded: Record<string, unknown> = {};
    let count = 0;
    for (const field in value) {
      if (++count > 32) break;
      const scalar = (value as Record<string, unknown>)[field];
      if (typeof scalar === 'number' && Number.isFinite(scalar)) bounded[field] = scalar;
    }
    result[key] = bounded;
  }
  return result;
}
