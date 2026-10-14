import { useCallback, useEffect, useRef, useState } from 'react';
import { coworkService } from '../../../services/cowork';

/** UI request state only. A successful request never manufactures a terminal execution state. */
export function useSessionStop(sessionId: string | undefined) {
  const active = useRef(sessionId);
  active.current = sessionId;
  const requests = useRef(new Map<string, Promise<boolean>>());
  const [state, setState] = useState<{ id?: string; pending: boolean; failed: boolean }>({
    pending: false,
    failed: false,
  });
  useEffect(() => {
    active.current = sessionId;
    return () => {
      if (active.current === sessionId) active.current = undefined;
    };
  }, [sessionId]);
  const stop = useCallback((id: string) => {
    const existing = requests.current.get(id);
    if (existing) return existing;
    if (active.current === id) setState({ id, pending: true, failed: false });
    const request = Promise.resolve()
      .then(() => coworkService.stopSession(id))
      .then(
        success => {
          if (active.current === id) setState({ id, pending: false, failed: !success });
          return success;
        },
        () => {
          if (active.current === id) setState({ id, pending: false, failed: true });
          return false;
        },
      );
    requests.current.set(id, request);
    void request.finally(() => {
      if (requests.current.get(id) === request) requests.current.delete(id);
    });
    return request;
  }, []);
  return {
    stop,
    stopping: state.id === sessionId && state.pending,
    stopFailed: state.id === sessionId && state.failed,
  };
}
