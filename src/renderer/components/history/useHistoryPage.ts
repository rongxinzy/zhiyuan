import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryPage, HistoryResult } from '@shared/history';
import { HistoryRequestGate } from './historyBrowserModel';

/** Retains one bounded page, not every visited message in a long conversation. */
export function useHistoryPage<T>(
  scope: string,
  load: (cursor?: string) => Promise<HistoryResult<HistoryPage<T>>>,
) {
  const gate = useRef(new HistoryRequestGate());
  const loadRef = useRef(load);
  const attemptedCursors = useRef<(string | undefined)[]>([undefined]);
  loadRef.current = load;
  const [state, setState] = useState({
    scope,
    items: [] as T[],
    nextCursor: undefined as string | undefined,
    cursors: [undefined] as (string | undefined)[],
    loading: true,
    failed: false,
  });
  const fetchPage = useCallback(
    async (cursors: (string | undefined)[], reset = false) => {
      const isCurrent = gate.current.begin();
      attemptedCursors.current = cursors;
      setState(previous => ({
        ...previous,
        scope,
        items: reset ? [] : previous.items,
        cursors: reset ? [undefined] : previous.cursors,
        nextCursor: reset ? undefined : previous.nextCursor,
        loading: true,
        failed: false,
      }));
      try {
        const result = await loadRef.current(cursors.at(-1));
        if (!isCurrent()) return;
        if (!result.success) throw new Error(result.error);
        setState({
          scope,
          items: result.data.items,
          nextCursor: result.data.nextCursor,
          cursors,
          loading: false,
          failed: false,
        });
      } catch {
        if (!isCurrent()) return;
        setState(previous => ({ ...previous, loading: false, failed: true }));
      }
    },
    [scope],
  );

  useEffect(() => {
    const requestGate = gate.current;
    void fetchPage([undefined], true);
    return () => requestGate.invalidate();
  }, [fetchPage]);

  // Hide the previous conversation even before the navigation effect runs.
  const visible =
    state.scope === scope ? state : { ...state, items: [] as T[], loading: true, failed: false };
  return {
    ...visible,
    next: () => {
      if (!visible.loading && visible.nextCursor)
        void fetchPage([...visible.cursors, visible.nextCursor]);
    },
    previous: () => {
      if (!visible.loading && visible.cursors.length > 1)
        void fetchPage(visible.cursors.slice(0, -1));
    },
    retry: () => {
      if (!visible.loading) void fetchPage(attemptedCursors.current);
    },
  };
}
