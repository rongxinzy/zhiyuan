// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { DurableWorkSnapshot } from '../../../../shared/durable/types';
import { i18nService } from '../../../services/i18n';
import { DurableRecoveryCard } from './DurableRecoveryCard';
import { DurableResumeBlockedReason, DurableScheduling } from './constants';

const getDurableWork = vi.fn();
const resumeDurableWork = vi.fn();
const saved = (sessionId = 'session-1'): DurableWorkSnapshot => ({
  sessionId,
  conversationId: 41,
  scheduling: DurableScheduling.Paused,
  canResume: true,
  tasks: [{ id: 7, kind: 'work', state: 'paused' }],
  submissions: [{ id: 9, status: 'pending' }],
  pendingSubmissionCount: 1,
  lastCommittedEntry: {
    id: 12,
    kind: 'message',
    text: 'The last saved observation',
    timestamp: 10,
  },
});
const t = (key: string) => i18nService.t(key);

beforeEach(() => {
  vi.clearAllMocks();
  getDurableWork.mockResolvedValue({ success: true, snapshot: saved() });
  resumeDurableWork.mockResolvedValue({ success: true });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      cowork: { getDurableWork, resumeDurableWork },
    },
  });
});

test('shows only native committed evidence and never resumes merely by mounting', async () => {
  render(createElement(DurableRecoveryCard, { sessionId: 'session-1' }));
  expect(await screen.findByText('The last saved observation')).toBeTruthy();
  expect(screen.getByText(t('durableRecoveryEffectsUnknown'))).toBeTruthy();
  expect(getDurableWork).toHaveBeenCalledWith('session-1');
  expect(resumeDurableWork).not.toHaveBeenCalled();
});

test('hides legacy sessions with no native state rather than inventing a checkpoint', async () => {
  getDurableWork.mockResolvedValue({ success: true });
  const view = render(createElement(DurableRecoveryCard, { sessionId: 'legacy' }));
  await waitFor(() => expect(getDurableWork).toHaveBeenCalledWith('legacy'));
  expect(view.container.textContent).toBe('');
  expect(resumeDurableWork).not.toHaveBeenCalled();
});

test('requires the explicit native capability before offering continuation', async () => {
  getDurableWork.mockResolvedValue({
    success: true,
    snapshot: {
      ...saved(),
      canResume: false,
      blockedReason: DurableResumeBlockedReason.MissingTaskDefinition,
    },
  });
  render(createElement(DurableRecoveryCard, { sessionId: 'session-1' }));
  expect(await screen.findByText(t('durableRecoveryMissingDefinition'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('durableRecoveryResume') })).toBeNull();
});

test('resumes by session only, locks duplicate clicks, and rereads native state', async () => {
  let finish!: (value: { success: boolean }) => void;
  resumeDurableWork.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  render(createElement(DurableRecoveryCard, { sessionId: 'session-1' }));
  const button = await screen.findByRole('button', { name: t('durableRecoveryResume') });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(resumeDurableWork).toHaveBeenCalledTimes(1);
  expect(resumeDurableWork).toHaveBeenCalledWith('session-1');
  getDurableWork.mockResolvedValue({
    success: true,
    snapshot: {
      ...saved(),
      canResume: false,
      scheduling: DurableScheduling.Running,
    },
  });
  await act(async () => {
    finish({ success: true });
  });
  await waitFor(() => expect(screen.queryByText(t('durableRecoveryTitle'))).toBeNull());
  expect(getDurableWork).toHaveBeenCalledTimes(2);
});

test('disables continuation while the existing conversation is streaming', async () => {
  render(createElement(DurableRecoveryCard, { sessionId: 'session-1', disabled: true }));
  const button = await screen.findByRole('button', { name: t('durableRecoveryResume') });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(resumeDurableWork).not.toHaveBeenCalled();
});

test('makes failed inspection retryable without allowing execution from stale state', async () => {
  getDurableWork.mockRejectedValueOnce(new Error('offline'));
  render(createElement(DurableRecoveryCard, { sessionId: 'session-1' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(t('durableRecoveryLoadFailed'));
  expect(screen.queryByRole('button', { name: t('durableRecoveryResume') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('durableRecoveryRefresh') }));
  expect(await screen.findByText('The last saved observation')).toBeTruthy();
});

test('keeps failed continuation visible and rereads the state rather than claiming success', async () => {
  resumeDurableWork.mockResolvedValue({ success: false, error: 'unknown outcome' });
  render(createElement(DurableRecoveryCard, { sessionId: 'session-1' }));
  fireEvent.click(await screen.findByRole('button', { name: t('durableRecoveryResume') }));
  expect(await screen.findByRole('alert')).toHaveTextContent(t('durableRecoveryResumeFailed'));
  expect(getDurableWork).toHaveBeenCalledTimes(2);
});

test('a late inspection cannot replace a newer session', async () => {
  let finishOld!: (value: { success: boolean; snapshot: DurableWorkSnapshot }) => void;
  getDurableWork.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishOld = resolve;
      }),
  );
  const view = render(createElement(DurableRecoveryCard, { sessionId: 'session-1' }));
  getDurableWork.mockResolvedValue({
    success: true,
    snapshot: {
      ...saved('session-2'),
      lastCommittedEntry: { id: 13, kind: 'message', text: 'New session record' },
    },
  });
  view.rerender(createElement(DurableRecoveryCard, { sessionId: 'session-2' }));
  expect(await screen.findByText('New session record')).toBeTruthy();
  await act(async () => {
    finishOld({ success: true, snapshot: saved() });
  });
  expect(screen.queryByText('The last saved observation')).toBeNull();
  expect(screen.getByText('New session record')).toBeTruthy();
});

test('a late resume failure cannot restore a card after leaving its session', async () => {
  let failOld!: (value: { success: boolean }) => void;
  resumeDurableWork.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        failOld = resolve;
      }),
  );
  const view = render(createElement(DurableRecoveryCard, { sessionId: 'session-1' }));
  fireEvent.click(await screen.findByRole('button', { name: t('durableRecoveryResume') }));
  getDurableWork.mockResolvedValue({ success: true });
  view.rerender(createElement(DurableRecoveryCard, { sessionId: 'legacy' }));
  await act(async () => {
    failOld({ success: false });
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(view.container.textContent).toBe('');
});
