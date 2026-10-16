// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';

import { TaskBoardWorkEventKind } from '../../../shared/taskBoard/constants';
import taskBoardReducer from '../../store/slices/taskBoardSlice';
import { useTaskBoardWorkEventSubscription } from './useTaskBoardWorkEventSubscription';

vi.stubEnv('VITE_BROWSER_PREVIEW', '1');

test('browser preview work events update task board thread state', async () => {
  const store = configureStore({ reducer: { taskBoard: taskBoardReducer } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );

  renderHook(() => useTaskBoardWorkEventSubscription(), { wrapper });

  window.dispatchEvent(
    new CustomEvent('browser-preview:task-board-work-event', {
      detail: {
        kind: TaskBoardWorkEventKind.Started,
        threadKey: 'preview-session-ui-review',
        sessionId: 'preview-session-ui-review',
        timestamp: Date.now(),
      },
    }),
  );

  await waitFor(() => {
    expect(store.getState().taskBoard.threads['preview-session-ui-review']?.length).toBeGreaterThan(0);
  });
});
