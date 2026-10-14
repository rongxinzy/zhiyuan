// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { CoworkSessionStatus } from '../../shared/cowork/constants';
import { CoworkRecoverySync, CoworkRecoveryPolicy } from './coworkRecoverySync';
import { PiUiRecovery } from './piUiRecovery';
import { CoworkContentBuffer } from './coworkContentBuffer';

const state = {
  cowork: { currentSessionId: null as string | null, streamingSessionIds: [] as string[] },
};
vi.mock('../store', () => ({ store: { getState: () => state } }));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'electron');
  state.cowork.currentSessionId = null;
  state.cowork.streamingSessionIds = [];
});

test('canonical recovery and replay do not require the retired null run snapshot', async () => {
  const order: string[] = [];
  const replayContent = vi.fn(async () => {
    order.push('replay');
    return { success: true };
  });
  Object.assign(window, { electron: { cowork: { replayContent } } });
  const sync = new CoworkRecoverySync(
    () => order.push('flush'),
    async () => {
      order.push('canonical');
    },
  );
  await sync.recover('a');
  expect(order).toEqual(['flush', 'canonical', 'replay']);
  expect(replayContent).toHaveBeenCalledWith('a');
});

test('continue with a missing completion event recovers terminal native facts on polling', async () => {
  vi.useFakeTimers();
  state.cowork.streamingSessionIds = ['a'];
  const applyStatus = vi.fn(() => {
    state.cowork.streamingSessionIds = [];
  });
  const readRuntime = vi
    .fn()
    .mockResolvedValue([{ sessionId: 'a', sequence: 2, status: CoworkSessionStatus.Completed }]);
  Object.assign(window, { electron: { cowork: { getRuntimeSnapshots: readRuntime } } });
  const recovery = new PiUiRecovery({
    readRuntime,
    readSession: vi.fn().mockResolvedValue(null),
    prepare: vi.fn(),
    applyStatus,
    applySession: vi.fn(),
    flush: vi.fn(),
  });
  const finish = recovery.beginSubmission('a');
  const sync = new CoworkRecoverySync(vi.fn(), id => recovery.recover(id));
  cleanups.push(sync.start());
  await sync.recover('a');
  expect(applyStatus).not.toHaveBeenCalled();
  finish();
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.PollMs);
  expect(applyStatus).toHaveBeenCalledWith({
    sessionId: 'a',
    sequence: 2,
    status: CoworkSessionStatus.Completed,
  });
  expect(state.cowork.streamingSessionIds).toEqual([]);
});

test('focus and visibility restore the selected session without submitting work', async () => {
  vi.useFakeTimers();
  const canonical = vi.fn().mockResolvedValue(undefined);
  const sync = new CoworkRecoverySync(vi.fn(), canonical);
  cleanups.push(sync.start());
  state.cowork.currentSessionId = 'a';
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.DebounceMs);
  expect(canonical).toHaveBeenCalledExactlyOnceWith('a');
});

test('a content patch gap requests canonical recovery and then full content replay', async () => {
  vi.useFakeTimers();
  const replayContent = vi.fn().mockResolvedValue({ success: true });
  Object.assign(window, { electron: { cowork: { replayContent } } });
  const canonical = vi.fn().mockResolvedValue(undefined);
  const sync = new CoworkRecoverySync(vi.fn(), canonical);
  cleanups.push(sync.start());
  const buffer = new CoworkContentBuffer(id => sync.requestRecovery(id));
  expect(
    buffer.apply({
      sessionId: 'a',
      messageId: 'm',
      revision: 2,
      baseRevision: 1,
      offset: 3,
      content: 'tail',
      totalLength: 7,
      complete: true,
      truncated: false,
    }),
  ).toBeNull();
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.DebounceMs);
  expect(canonical).toHaveBeenCalledWith('a');
  expect(replayContent).toHaveBeenCalledWith('a');
});

test('a gap during an outstanding recovery queues another read rather than disappearing', async () => {
  let finish!: () => void;
  const canonical = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const sync = new CoworkRecoverySync(vi.fn(), canonical);
  const first = sync.recover('a');
  const second = sync.recover('a');
  finish();
  await Promise.all([first, second]);
  expect(canonical).toHaveBeenCalledTimes(2);
});

test('teardown cancels scheduled recovery even without an Electron API', async () => {
  vi.useFakeTimers();
  const canonical = vi.fn();
  const sync = new CoworkRecoverySync(vi.fn(), canonical);
  const dispose = sync.start();
  sync.requestRecovery('a');
  dispose();
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.PollMs);
  expect(canonical).not.toHaveBeenCalled();
});

test('polling a quiet native running task never reads history or replays content', async () => {
  vi.useFakeTimers();
  state.cowork.streamingSessionIds = ['a'];
  const getRuntimeSnapshots = vi
    .fn()
    .mockResolvedValue([{ sessionId: 'a', sequence: 1, status: CoworkSessionStatus.Running }]);
  const replayContent = vi.fn();
  Object.assign(window, { electron: { cowork: { getRuntimeSnapshots, replayContent } } });
  const canonical = vi.fn();
  const sync = new CoworkRecoverySync(vi.fn(), canonical);
  cleanups.push(sync.start());
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.DebounceMs);
  canonical.mockClear();
  replayContent.mockClear();
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.PollMs * 3);
  expect(getRuntimeSnapshots).toHaveBeenCalledTimes(3);
  expect(canonical).not.toHaveBeenCalled();
  expect(replayContent).not.toHaveBeenCalled();
});

test('focus and patch gaps recover even while native poll confirmation is pending', async () => {
  vi.useFakeTimers();
  state.cowork.streamingSessionIds = ['a'];
  let resolve!: (value: []) => void;
  const getRuntimeSnapshots = vi.fn().mockReturnValue(
    new Promise<[]>(done => {
      resolve = done;
    }),
  );
  const replayContent = vi.fn().mockResolvedValue({ success: true });
  Object.assign(window, { electron: { cowork: { getRuntimeSnapshots, replayContent } } });
  const canonical = vi.fn().mockResolvedValue(undefined);
  const sync = new CoworkRecoverySync(vi.fn(), canonical);
  cleanups.push(sync.start());
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.PollMs);
  canonical.mockClear();
  replayContent.mockClear();
  window.dispatchEvent(new Event('focus'));
  const buffer = new CoworkContentBuffer(id => sync.requestRecovery(id));
  buffer.apply({
    sessionId: 'a',
    messageId: 'm',
    revision: 2,
    baseRevision: 1,
    offset: 1,
    content: 'x',
    totalLength: 2,
    complete: true,
    truncated: false,
  });
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.DebounceMs);
  expect(canonical).toHaveBeenCalledExactlyOnceWith('a');
  expect(replayContent).toHaveBeenCalledExactlyOnceWith('a');
  resolve([]);
});

test('failed or missing native confirmation does not manufacture a terminal result', async () => {
  vi.useFakeTimers();
  state.cowork.streamingSessionIds = ['a'];
  const getRuntimeSnapshots = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([]);
  Object.assign(window, { electron: { cowork: { getRuntimeSnapshots } } });
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  const canonical = vi.fn().mockResolvedValue(undefined);
  const sync = new CoworkRecoverySync(vi.fn(), canonical);
  cleanups.push(sync.start());
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.DebounceMs);
  canonical.mockClear();
  await vi.advanceTimersByTimeAsync(CoworkRecoveryPolicy.PollMs * 2);
  expect(getRuntimeSnapshots).toHaveBeenCalledTimes(2);
  expect(canonical).not.toHaveBeenCalled();
  expect(state.cowork.streamingSessionIds).toEqual(['a']);
});
