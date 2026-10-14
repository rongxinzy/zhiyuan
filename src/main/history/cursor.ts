import type { HistoryLocator } from '../../shared/history';
export function pageLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100)
    throw new Error('Invalid history page size');
  return Number(value);
}
export function locatorKey(locator: HistoryLocator): string {
  if (
    !locator ||
    !['cowork', 'coding'].includes(locator.source) ||
    typeof locator.id !== 'string' ||
    !locator.id.trim() ||
    locator.id.length > 256
  )
    throw new Error('Invalid history locator');
  return `${locator.source}:${locator.id}`;
}
export function encodeCursor(scope: string, value: unknown): string {
  return Buffer.from(JSON.stringify({ scope, value })).toString('base64url');
}
export function decodeCursor<T>(scope: string, cursor?: string): T | undefined {
  if (cursor === undefined) return undefined;
  if (typeof cursor !== 'string' || cursor.length > 8192) throw new Error('Invalid history cursor');
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.scope !== scope || parsed.value === undefined) throw new Error();
    return parsed.value as T;
  } catch {
    throw new Error('Invalid or foreign history cursor');
  }
}
