import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

import { scheduledTaskService } from '../../../services/scheduledTask';
import { hydrateRuns } from '../../../store/slices/activitySlice';

/** Reuse the existing SQLite projections and their application-owned event listeners. */
export function useBriefingData() {
  const dispatch = useDispatch();
  const generation = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      if (!window.electron?.activity || !window.electron?.scheduledTasks) {
        throw new Error('Briefing data is unavailable');
      }
      const [result] = await Promise.all([
        window.electron.activity.list(),
        scheduledTaskService.isInitialized
          ? scheduledTaskService.loadTasks()
          : scheduledTaskService.init(),
      ]);
      if (request !== generation.current) return;
      if (result.success) dispatch(hydrateRuns(result.runs));
      else setLoadFailed(true);
    } catch {
      if (request === generation.current) setLoadFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [dispatch]);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!import.meta.env.VITE_BROWSER_PREVIEW) return;
    const handler = () => void refresh();
    window.addEventListener('browser-preview:briefing-refresh', handler);
    return () => window.removeEventListener('browser-preview:briefing-refresh', handler);
  }, [refresh]);

  return { loading, loadFailed, refresh };
}
