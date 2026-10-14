// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DurableWorkSnapshot } from '../../../../shared/durable/types';
import { CoworkExecutionStatus } from './CoworkExecutionStatus';
import { useDurableWorkSnapshot } from '../durable/useDurableWorkSnapshot';
vi.mock('../../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'en', subscribe: () => () => {} },
}));
const getDurableWork = vi.fn(),
  resumeDurableWork = vi.fn();
const pending: DurableWorkSnapshot = {
  sessionId: 'a',
  conversationId: 1,
  scheduling: 'paused',
  canResume: false,
  resumeRequiresCheck: true,
  tasks: [{ id: 1, kind: 'pi.run', state: 'waiting' }],
  submissions: [{ id: 1, status: 'placed' }],
  pendingSubmissionCount: 1,
  latestInputKnown: true,
  latestInput: { id: 1, status: 'placed' },
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { cowork: { getDurableWork, resumeDurableWork } },
  });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  getDurableWork.mockResolvedValue({ success: true, snapshot: pending });
  resumeDurableWork.mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const props = () => ({
  sessionId: 'a',
  isStreaming: false,
  awaitingReply: false,
  stopping: false,
  stopFailed: false,
  onStop: vi.fn(),
  onConversation: vi.fn(),
  onReview: vi.fn(),
});
test('stored pending work requires an explicit check-and-continue action; repeated clicks do not repeat it', async () => {
  let finish!: (value: { success: boolean }) => void;
  resumeDurableWork.mockReturnValue(new Promise(resolve => (finish = resolve)));
  render(<CoworkExecutionStatus {...props()} />);
  const button = await screen.findByRole('button', { name: 'executionCheckResume' });
  expect(screen.getByRole('status')).toHaveTextContent('execution_paused');
  expect(resumeDurableWork).not.toHaveBeenCalled();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(resumeDurableWork).toHaveBeenCalledExactlyOnceWith('a');
  await act(async () => finish({ success: false }));
  expect(await screen.findByRole('alert')).toHaveTextContent('durableRecoveryResumeFailed');
});
test('approval, failed and stopping controls reflect native data and explicit actions', async () => {
  getDurableWork.mockResolvedValue({
    success: true,
    snapshot: { ...pending, scheduling: 'running', canResume: false, resumeRequiresCheck: false },
  });
  const actions = props();
  const view = render(<CoworkExecutionStatus {...actions} awaitingReply />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('execution_waiting'));
  fireEvent.click(screen.getByRole('button', { name: 'executionReview' }));
  expect(actions.onReview).toHaveBeenCalledOnce();
  expect(actions.onStop).not.toHaveBeenCalled();
  view.rerender(<CoworkExecutionStatus {...actions} awaitingReply stopping />);
  expect(screen.getByRole('button', { name: 'executionStop' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('executionStopping');
  view.rerender(<CoworkExecutionStatus {...actions} stopFailed />);
  expect(screen.getByRole('alert')).toHaveTextContent('executionStopFailed');
});
test('visible pending status refresh is bounded, hidden work stops polling, and unmount removes the timer', async () => {
  vi.useFakeTimers();
  const { rerender, unmount } = renderHook(({ visible }) => useDurableWorkSnapshot('a', visible), {
    initialProps: { visible: true },
  });
  await act(async () => {
    await Promise.resolve();
  });
  getDurableWork.mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(getDurableWork).toHaveBeenCalledTimes(1);
  rerender({ visible: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(getDurableWork).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(getDurableWork).toHaveBeenCalledTimes(1);
});
