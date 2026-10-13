// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { useBriefingData } from './useBriefingData';

const { dispatch, list, loadTasks } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  list: vi.fn(),
  loadTasks: vi.fn(),
}));
vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));
vi.mock('../../../services/scheduledTask', () => ({
  scheduledTaskService: { isInitialized: true, loadTasks },
}));

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ success: true, runs: [] });
  loadTasks.mockResolvedValue(undefined);
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      activity: { list },
      scheduledTasks: {},
    },
  });
});

test('hydrates successful empty results and loads existing schedules', async () => {
  const { result } = renderHook(useBriefingData);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.loadFailed).toBe(false);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: [] }));
  expect(loadTasks).toHaveBeenCalledOnce();
});

test('separates load failures from an empty briefing and supports retry', async () => {
  list.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(useBriefingData);
  await waitFor(() => expect(result.current.loadFailed).toBe(true));
  await act(() => result.current.refresh());
  expect(result.current.loadFailed).toBe(false);
  expect(result.current.loading).toBe(false);
});

test('ignores an older response after a newer refresh', async () => {
  let resolveOld!: (result: { success: boolean; runs: [] }) => void;
  list.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveOld = resolve;
      }),
  );
  const { result } = renderHook(useBriefingData);
  await act(() => result.current.refresh());
  await act(async () => {
    resolveOld({ success: true, runs: [] });
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
});

test('does not hydrate a late response after leaving the briefing', async () => {
  let resolve!: (result: { success: boolean; runs: [] }) => void;
  list.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  const { unmount } = renderHook(useBriefingData);
  unmount();
  await act(async () => {
    resolve({ success: true, runs: [] });
  });
  expect(dispatch).toHaveBeenCalledTimes(0);
});
