// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { CoworkInterruptionCause } from '../../../../shared/cowork/interruption';
import { useTaskResumeContext } from './useTaskResumeContext';

const mocks = vi.hoisted(() => ({ resume: vi.fn(), toast: vi.fn() }));
vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../../../services/errorNormalization', () => ({
  normalizeError: (error: string) => error,
}));
vi.mock('../../../services/toastNotification', () => ({ showAppErrorToast: mocks.toast }));

const interruption = (sessionId = 'session-a', taskId = 'task-a') => ({
  sessionId,
  taskId,
  interruptionId: `${taskId}-interruption`,
  cause: CoworkInterruptionCause.UserStop,
  recoverable: true,
});

function deferred() {
  let resolve!: (value: { success: boolean; error?: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ success: boolean; error?: string }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('electron', { workbenchTask: { resume: mocks.resume } });
});
afterEach(() => vi.unstubAllGlobals());

test('locks duplicate resume calls before the next render', async () => {
  const pending = deferred();
  mocks.resume.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useTaskResumeContext('session-a'));
  act(() => result.current.select(interruption()));
  let first!: Promise<boolean>;
  let duplicate!: Promise<boolean>;
  act(() => {
    const resume = result.current.resume;
    first = resume({ amendment: 'continue' });
    duplicate = resume({ amendment: 'continue' });
  });
  expect(mocks.resume).toHaveBeenCalledExactlyOnceWith({ taskId: 'task-a', amendment: 'continue' });
  expect(await duplicate).toBe(false);
  await act(async () => {
    pending.resolve({ success: true });
    expect(await first).toBe(true);
  });
  expect(result.current.isResuming).toBe(false);
});

test.each(['response', 'rejection', 'success'])(
  'ignores a stale %s after switching sessions',
  async outcome => {
    const old = deferred();
    const current = deferred();
    mocks.resume.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(({ sessionId }) => useTaskResumeContext(sessionId), {
      initialProps: { sessionId: 'session-a' },
    });
    act(() => result.current.select(interruption()));
    let oldResult!: Promise<boolean>;
    act(() => {
      oldResult = result.current.resume({});
    });
    rerender({ sessionId: 'session-b' });
    act(() => result.current.select(interruption('session-b', 'task-b')));
    let currentResult!: Promise<boolean>;
    act(() => {
      currentResult = result.current.resume({});
    });
    await act(async () => {
      if (outcome === 'rejection') old.reject(new Error('old failure'));
      else old.resolve({ success: outcome === 'success', error: 'old failure' });
      expect(await oldResult).toBe(false);
    });
    expect(result.current.interruption).toBeNull();
    expect(result.current.isResuming).toBe(true);
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => {
      current.resolve({ success: false, error: 'current failure' });
      expect(await currentResult).toBe(false);
    });
    expect(result.current.interruption).toEqual(interruption('session-b', 'task-b'));
    expect(result.current.isResuming).toBe(false);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('current failure');
  },
);

test.each(['cancel', 'select', 'unmount'])(
  'does not restore stale context after %s',
  async action => {
    const pending = deferred();
    mocks.resume.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useTaskResumeContext('session-a'));
    act(() => result.current.select(interruption()));
    let resumed!: Promise<boolean>;
    act(() => {
      resumed = result.current.resume({});
    });
    if (action === 'unmount') unmount();
    else
      act(() => {
        if (action === 'cancel') result.current.cancel();
        else result.current.select(interruption('session-a', 'replacement'));
      });
    await act(async () => {
      pending.reject(new Error('late failure'));
      expect(await resumed).toBe(false);
    });
    expect(mocks.toast).not.toHaveBeenCalled();
    if (action === 'select') expect(result.current.interruption?.taskId).toBe('replacement');
    if (action === 'cancel') expect(result.current.interruption).toBeNull();
  },
);

test('restores the current task after an exception so it can be retried', async () => {
  mocks.resume.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true });
  const { result } = renderHook(() => useTaskResumeContext('session-a'));
  act(() => result.current.select(interruption()));
  await act(async () => {
    expect(await result.current.resume({})).toBe(false);
  });
  expect(result.current.interruption).toEqual(interruption());
  expect(result.current.isResuming).toBe(false);
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('coworkResumeTaskFailed');
  await act(async () => {
    expect(await result.current.resume({})).toBe(true);
  });
  expect(mocks.resume).toHaveBeenCalledTimes(2);
});
