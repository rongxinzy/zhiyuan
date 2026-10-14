import type { HistoryMessage } from '../../shared/history';
export const HISTORY_METADATA_CHARS = 16 * 1024;
export const HISTORY_PREVIEW_CHARS = 32 * 1024;
/** Small metadata only. Inline image bytes and oversized legacy payloads never cross history IPC. */
export function historyMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string' && value.length > HISTORY_METADATA_CHARS)
    return { historyMetadataTruncated: true };
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    let nodes = 0;
    function clean(input: unknown, depth: number): unknown {
      if (++nodes > 200) return undefined;
      if (depth > 4) return undefined;
      if (typeof input === 'string')
        return input.startsWith('data:') ? undefined : input.slice(0, 2048);
      if (Array.isArray(input)) return input.slice(0, 20).map(item => clean(item, depth + 1));
      if (input && typeof input === 'object')
        return Object.fromEntries(
          Object.entries(input)
            .slice(0, 40)
            .filter(([key]) => !/(?:base64|imageData)/i.test(key))
            .map(([key, item]) => [key, clean(item, depth + 1)]),
        );
      return input;
    }
    return clean(parsed, 0) as Record<string, unknown>;
  } catch {
    return { historyMetadataTruncated: true };
  }
}
export function boundHistoryPreview(items: HistoryMessage[]): HistoryMessage[] {
  if (items.length > 1000)
    throw new Error(
      'This history entry is too large to preview; open the original conversation or export its archive',
    );
  const perContent = Math.min(
    HISTORY_PREVIEW_CHARS,
    Math.floor((512 * 1024) / Math.max(1, items.length)),
  );
  const perMetadata = Math.min(
    HISTORY_METADATA_CHARS,
    Math.floor((256 * 1024) / Math.max(1, items.length)),
  );
  const bounded = items.map(item => {
    // Native metadata is already an object. Bound serialization before forwarding it to the renderer.
    const cleaned = historyMetadata(item.metadata);
    const raw = JSON.stringify(cleaned);
    const metadata =
      raw.length > perMetadata ? { historyMetadataTruncated: true } : historyMetadata(raw);
    if (item.content.length > perContent) metadata.historyContentTruncated = true;
    return { ...item, content: item.content.slice(0, perContent), metadata };
  });
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > 4 * 1024 * 1024)
    throw new Error('History preview exceeds the safe page size');
  return bounded;
}
