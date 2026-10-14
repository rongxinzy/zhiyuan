import type { ConversationView, HarnessInspection } from '@earendil-works/pi-durable';
import type { DurableWorkSnapshot } from '../../../../shared/durable/types';

/** Project only committed native facts; legacy workbench records are never checkpoints. */
export function projectDurableWork(
  sessionId: string,
  inspection: HarnessInspection,
  view: ConversationView,
): DurableWorkSnapshot {
  const hasPending = inspection.tasks.length > 0 || inspection.submissions.length > 0;
  const blockedReason =
    inspection.scheduling === 'closing'
      ? 'closing'
      : inspection.scheduling === 'running'
        ? 'already_running'
        : inspection.tasks.some(task => task.state.kind === 'blocked')
          ? 'missing_task_definition'
          : !hasPending
            ? 'no_pending_work'
            : undefined;
  // A compact display excerpt, never an input reconstructed for execution.
  const last = [...view.entries].reverse().find(entry => entry.model?.length);
  const message = last?.model?.at(-1);
  const text =
    typeof message?.content === 'string'
      ? message.content
      : (message?.content?.map(block => (block.type === 'text' ? block.text : '')).join('') ?? '');
  return {
    sessionId,
    conversationId: view.conversation.id,
    scheduling: inspection.scheduling,
    canResume: blockedReason === undefined,
    blockedReason,
    tasks: inspection.tasks.map(task => ({
      id: task.record.id,
      kind: task.record.kind,
      state: task.state.kind,
    })),
    submissions: inspection.submissions.map(submission => ({
      id: submission.id,
      status: submission.status,
    })),
    pendingSubmissionCount: inspection.submissions.length,
    lastCommittedEntry: last
      ? { id: last.id, kind: last.kind, text: text.slice(0, 500), timestamp: message?.timestamp }
      : undefined,
  };
}
