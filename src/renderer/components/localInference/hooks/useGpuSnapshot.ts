import { useEffect, useRef, useState } from 'react';

import type { NvidiaSmiSnapshot } from '../../../../shared/hardware';

export const GPU_REFRESH_INTERVAL_MS = 5000;
const GPU_UNAVAILABLE_REFRESH_INTERVAL_MS = 30_000;

/** One bounded hardware request at a time, only while this page is visible. */
export function useGpuSnapshot(active: boolean) {
  const [snapshot, setSnapshot] = useState<NvidiaSmiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const pending = useRef<Promise<NvidiaSmiSnapshot | undefined> | null>(null);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSnapshot(null);
    setLoading(true);

    const refresh = async () => {
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      let nextDelay = GPU_UNAVAILABLE_REFRESH_INTERVAL_MS;
      // Reuse an unfinished request when the user quickly leaves and returns.
      const request =
        pending.current ?? Promise.resolve().then(() => window.electron?.hardware?.nvidiaSmi?.());
      pending.current = request;
      try {
        const next = await request;
        if (next?.available) nextDelay = GPU_REFRESH_INTERVAL_MS;
        if (!stopped) setSnapshot(next ?? null);
      } catch {
        // Never leave a stale successful reading looking like live telemetry.
        if (!stopped) setSnapshot(null);
      } finally {
        if (pending.current === request) pending.current = null;
        inFlight = false;
        if (!stopped) {
          setLoading(false);
          if (!document.hidden) timer = setTimeout(refresh, nextDelay);
        }
      }
    };
    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [active]);

  return { snapshot, loading };
}
