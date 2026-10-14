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

/** At most 64 receipts; passive writes must never masquerade as answered user input. */
export async function readLatestInput(
  storage: import('@earendil-works/pi-durable').Storage,
  conversationId: import('@earendil-works/pi-durable').ConversationId,
  context: import('@earendil-works/chord').Context,
): Promise<Pick<DurableWorkSnapshot, 'latestInput' | 'latestInputKnown'>> {
  const page = await storage.scanSubmissions(
    { conversationId, order: 'descending' },
    64,
    undefined,
    context,
  );
  const input = page.items.find(item => item.type === 'input');
  return {
    latestInputKnown: Boolean(input) || !page.next,
    latestInput: input
      ? {
          id: input.id,
          status: input.status,
          ...(input.status === 'unanswered' ? { reason: input.reason } : {}),
        }
      : undefined,
  };
}

/** Storage-only projection: no Harness, registry, provider, migrations of task state or scheduler. */
export async function readStoredWork(
  sessionId: string,
  storage: import('@earendil-works/pi-durable').Storage,
  context: import('@earendil-works/chord').Context,
): Promise<DurableWorkSnapshot | undefined> {
  const roots = await storage.scanConversations({}, 1, undefined, context);
  const root = roots.items[0];
  if (!root) return undefined;
  const taskPages = await Promise.all(
    (['pending', 'running', 'waiting', 'completing'] as const).map(status =>
      storage.scanTasks({ status }, 64, undefined, context),
    ),
  );
  const submissionPages = await Promise.all(
    (['queued', 'placed'] as const).map(status =>
      storage.scanSubmissions({ status }, 64, undefined, context),
    ),
  );
  const tasks = taskPages.flatMap(page => page.items);
  const submissions = submissionPages.flatMap(page => page.items);
  const pending = tasks.length > 0 || submissions.length > 0;
  const entries = await storage.scanEntries(
    { conversationId: root.id, order: 'descending' },
    32,
    undefined,
    context,
  );
  const last = entries.items.find(entry => entry.model?.length);
  const message = last?.model?.at(-1);
  const text =
    typeof message?.content === 'string'
      ? message.content
      : (message?.content?.map(block => (block.type === 'text' ? block.text : '')).join('') ?? '');
  return {
    sessionId,
    conversationId: root.id,
    scheduling: 'paused',
    canResume: false,
    resumeRequiresCheck: pending,
    blockedReason: pending ? 'runtime_check_required' : 'no_pending_work',
    tasks: tasks.map(task => ({ id: task.id, kind: task.kind, state: task.state.status })),
    submissions: submissions.map(item => ({ id: item.id, status: item.status })),
    pendingSubmissionCount: submissions.length,
    pendingTruncated: [...taskPages, ...submissionPages].some(page => Boolean(page.next)),
    lastCommittedEntry: last
      ? { id: last.id, kind: last.kind, text: text.slice(0, 500), timestamp: message?.timestamp }
      : undefined,
    ...(await readLatestInput(storage, root.id, context)),
  };
}
