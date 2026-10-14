import type { ConversationView, InboxItem } from '@earendil-works/pi-durable';
import {
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
  type CoworkQueueDelivery,
} from '../../../../shared/cowork/pendingMessageQueue';
import type { DurableSession } from './sessionOwner';

function project(item: InboxItem): CoworkPendingMessage | undefined {
  if (item.mode === 'write') return undefined;
  let text =
    typeof item.content === 'string'
      ? item.content
      : item.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
  const data = item.entry?.data;
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    typeof data.displayText === 'string'
  )
    text = data.displayText;
  const createdAt =
    data && typeof data === 'object' && !Array.isArray(data) && typeof data.createdAt === 'number'
      ? data.createdAt
      : 0;
  return {
    id: String(item.id),
    text,
    delivery: item.mode,
    status: CoworkQueueItemStatus.Pending,
    createdAt,
  };
}

export function projectPendingQueue(view: ConversationView | undefined): CoworkPendingMessage[] {
  const items = view?.docs['pi.inbox']?.items;
  if (!Array.isArray(items)) return [];
  return (items as InboxItem[]).flatMap(item => {
    const result = project(item);
    return result ? [result] : [];
  });
}

/** User edits the native queued document atomically, never withdraws then re-submits input. */
export async function changePendingInput(
  session: DurableSession,
  itemId: string,
  changes: { text?: string; delivery?: CoworkQueueDelivery },
): Promise<CoworkPendingMessage> {
  const [{ InboxDoc }, { BACKGROUND_CONTEXT }] = await Promise.all([
    import('@earendil-works/pi-durable'),
    import('@earendil-works/chord/context'),
  ]);
  if (changes.text !== undefined && !changes.text.trim())
    throw new Error('The queued input must not be empty.');
  const result = await session.conversation.commit(async tx => {
    const inbox = await tx.doc(InboxDoc, session.conversation.id);
    const item = inbox.items.find(candidate => String(candidate.id) === itemId);
    if (!item || item.mode === 'write')
      throw new Error('This input has already started or was withdrawn.');
    if (changes.text !== undefined) {
      const data = item.entry?.data;
      let modelText = changes.text;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        data.displayText = changes.text;
        if (Array.isArray(data.fileAttachments)) {
          const paths = data.fileAttachments.flatMap(file =>
            file &&
            typeof file === 'object' &&
            !Array.isArray(file) &&
            typeof file.name === 'string' &&
            typeof file.path === 'string'
              ? [`${file.name}: ${file.path}`]
              : [],
          );
          if (paths.length) modelText += `\n\nAttached files:\n${paths.join('\n')}`;
        }
      }
      item.content =
        typeof item.content === 'string'
          ? modelText
          : [
              { type: 'text', text: modelText },
              ...item.content.filter(block => block.type !== 'text'),
            ];
    }
    if (changes.delivery) item.mode = changes.delivery;
    const result = project(item);
    if (!result) throw new Error('This input cannot be edited.');
    return result;
  }, BACKGROUND_CONTEXT);
  if (changes.delivery) {
    const watch = await session.conversation.watch(BACKGROUND_CONTEXT);
    const idle = !watch.value.docs['pi.live']?.run;
    await watch.stop();
    if (idle) {
      // A context-empty write asks the native idle boundary to admit retained input.
      // It contributes no prompt and creates no application-owned execution task.
      await session.conversation.submit(
        {
          type: 'write',
          entry: { kind: 'zhiyuan.queue-release', model: [], data: { submissionId: itemId } },
        },
        BACKGROUND_CONTEXT,
      );
    }
  }
  return result;
}

export async function withdrawPendingInput(session: DurableSession, itemId: string): Promise<void> {
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
  const record = (await session.harness.inspect(BACKGROUND_CONTEXT)).submissions.find(
    item => String(item.id) === itemId,
  );
  if (!record) throw new Error('This input has already settled or was withdrawn.');
  const result = await session.harness.abortSubmission(
    record.id,
    BACKGROUND_CONTEXT,
    session.conversation.id,
  );
  if (result !== 'aborted')
    throw new Error('This input has already started and cannot be withdrawn.');
}
