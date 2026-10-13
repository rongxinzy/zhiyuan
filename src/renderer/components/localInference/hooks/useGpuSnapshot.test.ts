// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import type { NvidiaSmiSnapshot } from '../../../../shared/hardware';
import { GPU_REFRESH_INTERVAL_MS, useGpuSnapshot } from './useGpuSnapshot';

const snapshot: NvidiaSmiSnapshot = {
  source: 'nvidia-smi',
  available: true,
  checkedAt: '2026-10-13T00:00:00Z',
  gpus: [{ index: 0, name: 'GPU', memoryTotalMiB: 8192, utilizationPercent: 0 }],
};
const originalElectron = window.electron;

afterEach(() => {
  window.electron = originalElectron;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('refreshes only while active and cleans up its polling timer', async () => {
  vi.useFakeTimers();
  const nvidiaSmi = vi.fn().mockResolvedValue(snapshot);
  window.electron = { ...window.electron, hardware: { ...window.electron?.hardware, nvidiaSmi } };
  const { result, rerender, unmount } = renderHook(({ active }) => useGpuSnapshot(active), {
    initialProps: { active: true },
  });
  await act(async () => {});
  expect(result.current.snapshot).toEqual(snapshot);
  await act(() => vi.advanceTimersByTimeAsync(GPU_REFRESH_INTERVAL_MS));
  expect(nvidiaSmi).toHaveBeenCalledTimes(2);
  rerender({ active: false });
  await act(() => vi.advanceTimersByTimeAsync(GPU_REFRESH_INTERVAL_MS * 2));
  expect(nvidiaSmi).toHaveBeenCalledTimes(2);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('does not overlap hardware requests or apply late replies after unmount', async () => {
  vi.useFakeTimers();
  let resolve: ((value: NvidiaSmiSnapshot) => void) | undefined;
  const nvidiaSmi = vi.fn(
    () =>
      new Promise<NvidiaSmiSnapshot>(done => {
        resolve = done;
      }),
  );
  window.electron = { ...window.electron, hardware: { ...window.electron?.hardware, nvidiaSmi } };
  const { unmount } = renderHook(() => useGpuSnapshot(true));
  await act(() => vi.advanceTimersByTimeAsync(GPU_REFRESH_INTERVAL_MS * 3));
  expect(nvidiaSmi).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => {
    resolve?.(snapshot);
  });
  expect(vi.getTimerCount()).toBe(0);
});

test('reuses an in-flight sample when rapidly leaving and returning to the page', async () => {
  vi.useFakeTimers();
  let resolve: ((value: NvidiaSmiSnapshot) => void) | undefined;
  const nvidiaSmi = vi.fn(
    () =>
      new Promise<NvidiaSmiSnapshot>(done => {
        resolve = done;
      }),
  );
  window.electron = { ...window.electron, hardware: { ...window.electron?.hardware, nvidiaSmi } };
  const { result, rerender, unmount } = renderHook(({ active }) => useGpuSnapshot(active), {
    initialProps: { active: true },
  });
  await act(async () => {});
  rerender({ active: false });
  rerender({ active: true });
  await act(async () => {
    resolve?.(snapshot);
  });
  expect(nvidiaSmi).toHaveBeenCalledTimes(1);
  expect(result.current.snapshot).toEqual(snapshot);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
});

test('clears stale readings after failure and pauses when the document is hidden', async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const nvidiaSmi = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValue(new Error('offline'));
  window.electron = { ...window.electron, hardware: { ...window.electron?.hardware, nvidiaSmi } };
  const { result, unmount } = renderHook(() => useGpuSnapshot(true));
  await act(async () => {});
  expect(result.current.snapshot).toEqual(snapshot);
  hidden = true;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(() => vi.advanceTimersByTimeAsync(GPU_REFRESH_INTERVAL_MS * 2));
  expect(nvidiaSmi).toHaveBeenCalledTimes(1);
  hidden = false;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(nvidiaSmi).toHaveBeenCalledTimes(2);
  expect(result.current.snapshot).toBeNull();
  expect(result.current.loading).toBe(false);
  unmount();
});
