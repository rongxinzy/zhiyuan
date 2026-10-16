import { useEffect } from 'react';
import { useDispatch } from 'react-redux';

import { applyTaskBoardWorkEvent } from '../../store/slices/taskBoardSlice';

export function useTaskBoardWorkEventSubscription(): void {
  const dispatch = useDispatch();

  useEffect(() => {
    const api = window.electron?.taskBoard;
    if (!api?.onWorkEvent) return;
    return api.onWorkEvent(event => {
      dispatch(applyTaskBoardWorkEvent(event));
    });
  }, [dispatch]);

  useEffect(() => {
    if (!import.meta.env.VITE_BROWSER_PREVIEW) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;
      dispatch(applyTaskBoardWorkEvent(detail as Parameters<typeof applyTaskBoardWorkEvent>[0]));
    };
    window.addEventListener('browser-preview:task-board-work-event', handler);
    return () => window.removeEventListener('browser-preview:task-board-work-event', handler);
  }, [dispatch]);
}
