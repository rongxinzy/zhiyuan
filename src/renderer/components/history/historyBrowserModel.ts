import type { HistoryLocator, HistoryMessage } from '@shared/history';

/** A new navigation invalidates older IPC results without cancelling native work. */
export class HistoryRequestGate {
  private generation = 0;
  begin() {
    const generation = ++this.generation;
    return () => generation === this.generation;
  }
  invalidate() {
    this.generation++;
  }
}

export function historyLocatorKey(locator: HistoryLocator): string {
  return JSON.stringify([locator.source, locator.id]);
}

export function historyAttachments(message: Pick<HistoryMessage, 'metadata'>) {
  const metadata = message.metadata ?? {};
  const candidates = [metadata.imageAttachments, metadata.fileAttachments];
  return candidates.flatMap(items =>
    Array.isArray(items)
      ? items.flatMap((item: unknown) => {
          if (!item || typeof item !== 'object') return [];
          const value = item as Record<string, unknown>;
          if (typeof value.name !== 'string') return [];
          return [
            {
              name: value.name,
              mimeType:
                typeof value.mimeType === 'string' ? value.mimeType : 'application/octet-stream',
              path: typeof value.path === 'string' ? value.path : undefined,
            },
          ];
        })
      : [],
  );
}
