import type { DurableWorkSnapshot } from '../../../../shared/durable/types';

/** A label over native facts, not an execution state machine or persisted state. */
export function executionPresentation(
  snapshot: DurableWorkSnapshot | null,
  unavailable: boolean,
  awaitingReply: boolean,
) {
  if (unavailable || !snapshot) return 'unknown';
  if (snapshot.scheduling === 'closing') return 'closing';
  const pending =
    snapshot.tasks.length > 0 ||
    snapshot.pendingSubmissionCount > 0 ||
    snapshot.latestInput?.status === 'queued' ||
    snapshot.latestInput?.status === 'placed';
  if (pending && snapshot.scheduling === 'paused') return 'paused';
  if (pending) return awaitingReply ? 'waiting' : snapshot.tasks.length ? 'running' : 'queued';
  if (snapshot.latestInput?.status === 'done') return 'completed';
  if (snapshot.latestInput?.status === 'unanswered')
    return snapshot.latestInput.reason === 'aborted' ? 'stopped' : 'failed';
  return snapshot.latestInputKnown ? 'idle' : 'unknown';
}
