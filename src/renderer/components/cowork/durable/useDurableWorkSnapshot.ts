import { useCallback, useEffect, useRef, useState } from 'react';

import type { DurableWorkSnapshot } from '../../../../shared/durable/types';

/** Inspect and resume native work only. Never create a submission or synthesize execution state. */
export function useDurableWorkSnapshot(sessionId: string) {
  const [snapshot, setSnapshot] = useState<DurableWorkSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);
  const [resuming, setResuming] = useState(false);
  const requestVersion = useRef(0);
  const activeSession = useRef<string | null>(sessionId);
  const actionLock = useRef<symbol | null>(null);

  const refresh = useCallback(async () => {
    if (activeSession.current !== sessionId) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const result = await window.electron.cowork.getDurableWork(sessionId);
      if (version !== requestVersion.current || activeSession.current !== sessionId) return;
      if (!result.success || (result.snapshot && result.snapshot.sessionId !== sessionId)) {
        setLoadFailed(true);
        return;
      }
      setSnapshot(result.snapshot ?? null);
    } catch {
      if (version === requestVersion.current && activeSession.current === sessionId) {
        setLoadFailed(true);
      }
    } finally {
      if (version === requestVersion.current && activeSession.current === sessionId) {
        setLoading(false);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    activeSession.current = sessionId;
    setSnapshot(null);
    setResumeFailed(false);
    setResuming(false);
    void refresh();
    return () => {
      activeSession.current = null;
      requestVersion.current += 1;
      actionLock.current = null;
    };
  }, [refresh, sessionId]);

  const resume = useCallback(async () => {
    if (
      activeSession.current !== sessionId ||
      snapshot?.sessionId !== sessionId ||
      !snapshot.canResume ||
      loading ||
      loadFailed ||
      actionLock.current
    )
      return;
    const request = Symbol();
    actionLock.current = request;
    setResuming(true);
    setResumeFailed(false);
    try {
      const result = await window.electron.cowork.resumeDurableWork(sessionId);
      if (actionLock.current !== request || activeSession.current !== sessionId) return;
      if (!result.success) setResumeFailed(true);
      // The native scheduler is the authority after either outcome, including a stale canResume.
      await refresh();
    } catch {
      if (actionLock.current === request && activeSession.current === sessionId) {
        setResumeFailed(true);
        await refresh();
      }
    } finally {
      if (actionLock.current === request) {
        actionLock.current = null;
        setResuming(false);
      }
    }
  }, [sessionId, snapshot, loading, loadFailed, refresh]);

  return {
    snapshot: snapshot?.sessionId === sessionId ? snapshot : null,
    loading,
    loadFailed,
    resumeFailed,
    resuming,
    refresh,
    resume,
  };
}
