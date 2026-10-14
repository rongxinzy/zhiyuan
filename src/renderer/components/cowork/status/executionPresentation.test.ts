import { expect, test } from 'vitest';
import type { DurableWorkSnapshot } from '../../../../shared/durable/types';
import { executionPresentation } from './executionPresentation';
const base: DurableWorkSnapshot = {
  sessionId: 'a',
  conversationId: 1,
  scheduling: 'paused',
  canResume: false,
  tasks: [],
  submissions: [],
  pendingSubmissionCount: 0,
  latestInputKnown: true,
};
test('labels only native lifecycle evidence, never success from an idle scheduler or missing snapshot', () => {
  expect(executionPresentation(null, false, false)).toBe('unknown');
  expect(executionPresentation(base, false, false)).toBe('idle');
  expect(executionPresentation({ ...base, latestInputKnown: false }, false, false)).toBe('unknown');
  expect(
    executionPresentation({ ...base, latestInput: { id: 1, status: 'done' } }, false, false),
  ).toBe('completed');
  expect(
    executionPresentation(
      { ...base, latestInput: { id: 1, status: 'unanswered', reason: 'aborted' } },
      false,
      false,
    ),
  ).toBe('stopped');
  expect(
    executionPresentation(
      { ...base, latestInput: { id: 1, status: 'unanswered', reason: 'provider_error' } },
      false,
      false,
    ),
  ).toBe('failed');
});
test('pending, paused, live approval, queue and stale confirmation remain distinct', () => {
  const pending = { ...base, pendingSubmissionCount: 1 };
  expect(executionPresentation(pending, false, false)).toBe('paused');
  expect(executionPresentation({ ...pending, scheduling: 'running' }, false, false)).toBe('queued');
  const live: DurableWorkSnapshot = {
    ...pending,
    scheduling: 'running',
    tasks: [{ id: 2, kind: 'pi.run', state: 'running' }],
  };
  expect(executionPresentation(live, false, false)).toBe('running');
  expect(executionPresentation(live, false, true)).toBe('waiting');
  expect(executionPresentation(live, true, true)).toBe('unknown');
  expect(executionPresentation({ ...base, scheduling: 'closing' }, false, false)).toBe('closing');
});
