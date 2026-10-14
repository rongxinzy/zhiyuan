// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useSessionStop } from './useSessionStop';
const { stopSession } = vi.hoisted(() => ({ stopSession: vi.fn() }));
vi.mock('../../../services/cowork', () => ({ coworkService: { stopSession } }));
beforeEach(() => stopSession.mockReset());
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(r => (resolve = r));
  return { promise, resolve };
}
test('same-tick stop clicks share one IPC and failure remains visible instead of fabricating stopped', async () => {
  const pending = deferred();
  stopSession.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useSessionStop('a'));
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  act(() => {
    first = result.current.stop('a');
    second = result.current.stop('a');
  });
  expect(first).toBe(second);
  expect(result.current.stopping).toBe(true);
  await act(async () => {
    await Promise.resolve();
    pending.resolve(false);
    await first;
  });
  expect(stopSession).toHaveBeenCalledExactlyOnceWith('a');
  expect(result.current.stopping).toBe(false);
  expect(result.current.stopFailed).toBe(true);
});
test('a late failure cannot overwrite another session stop or clear its pending indication', async () => {
  const a = deferred(),
    b = deferred();
  stopSession.mockImplementation((id: string) => (id === 'a' ? a.promise : b.promise));
  const { result, rerender, unmount } = renderHook(({ id }) => useSessionStop(id), {
    initialProps: { id: 'a' },
  });
  let pa!: Promise<boolean>, pb!: Promise<boolean>;
  act(() => {
    pa = result.current.stop('a');
  });
  rerender({ id: 'b' });
  act(() => {
    pb = result.current.stop('b');
  });
  await act(async () => {
    a.resolve(false);
    await pa;
  });
  expect(result.current.stopping).toBe(true);
  expect(result.current.stopFailed).toBe(false);
  unmount();
  await act(async () => {
    b.resolve(true);
    await pb;
  });
  expect(stopSession).toHaveBeenCalledTimes(2);
});
