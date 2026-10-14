import type { ConversationView, EntryRecord, LiveState } from '@earendil-works/pi-durable';
import type { CoworkMessage } from '../../../coworkStore';

type ModelMessage = NonNullable<EntryRecord['model']>[number];

function messages(
  sessionId: string,
  id: string,
  message: ModelMessage,
  streaming: boolean,
): CoworkMessage[] {
  const timestamp = message.timestamp;
  if (message.role === 'user') {
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n');
    return [{ id: `${id}:user`, type: 'user', content, timestamp }];
  }
  if (message.role === 'toolResult') {
    const content = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    return [
      {
        id: `${id}:result`,
        type: 'tool_result',
        content,
        timestamp,
        metadata: {
          toolUseId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
          isStreaming: streaming,
        },
      },
    ];
  }
  if (message.role !== 'assistant') return [];
  return message.content.flatMap((block, index): CoworkMessage[] => {
    const base = { id: `${id}:${index}`, timestamp };
    if (block.type === 'text')
      return [
        {
          ...base,
          type: 'assistant',
          content: block.text,
          metadata: { isStreaming: streaming, isError: message.stopReason === 'error' },
        },
      ];
    if (block.type === 'thinking')
      return [
        {
          ...base,
          type: 'assistant',
          content: block.thinking,
          metadata: { isThinking: true, isStreaming: streaming },
        },
      ];
    if (block.type === 'toolCall')
      return [
        {
          ...base,
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: block.name,
            toolUseId: block.id,
            toolInput: block.arguments,
            isStreaming: streaming,
          },
        },
      ];
    return [];
  });
}

/** Stable native identities make reconnect/reopen an idempotent display projection. */
export function projectDurableEntry(sessionId: string, entry: EntryRecord): CoworkMessage[] {
  return (entry.model ?? []).flatMap((message, index) => {
    const identity =
      message.role === 'assistant' && entry.byTaskId !== undefined
        ? `task:${entry.byTaskId}`
        : `entry:${entry.id}`;
    const projected = messages(
      sessionId,
      `durable:${sessionId}:${identity}:${index}`,
      message,
      false,
    );
    if (
      message.role === 'user' &&
      entry.data &&
      typeof entry.data === 'object' &&
      !Array.isArray(entry.data)
    ) {
      const data = entry.data;
      for (const item of projected) {
        if (typeof data.userMessageId === 'string') item.id = data.userMessageId;
        if (typeof data.displayText === 'string') item.content = data.displayText;
        item.metadata = {
          ...(Array.isArray(data.imageAttachments)
            ? { imageAttachments: data.imageAttachments }
            : {}),
          ...(Array.isArray(data.fileAttachments) ? { fileAttachments: data.fileAttachments } : {}),
        };
      }
    }
    return projected;
  });
}

export function projectDurablePartial(sessionId: string, view: ConversationView): CoworkMessage[] {
  const live = view.docs['pi.live'] as unknown as LiveState | undefined;
  if (!live?.run || !live.generation?.message) return [];
  return messages(
    sessionId,
    `durable:${sessionId}:task:${live.run.taskId}:0`,
    live.generation.message,
    true,
  );
}
