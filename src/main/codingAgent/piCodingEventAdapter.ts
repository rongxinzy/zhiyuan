import {
  CodingEventKind,
  CodingStreamUpdateMode,
  CodingToolCallStatus,
  type CodingEvent,
} from '../../shared/codingAgent';

type CodingDriverEvent = Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Converts Pi's Cowork messages into the payload contract used by coding lanes. */
export const normalizePiMessage = (value: unknown): CodingDriverEvent | null => {
  const message = asRecord(value);
  if (!message) return null;
  const type = message.type;
  const metadata = asRecord(message.metadata);
  if (type === 'assistant' || type === 'user') {
    return {
      kind: CodingEventKind.Message,
      payload: { message, role: type },
    };
  }
  if (type === 'tool_use') {
    const toolCallId =
      (typeof metadata?.toolUseId === 'string' && metadata.toolUseId) ||
      (typeof message.id === 'string' && message.id) ||
      null;
    if (!toolCallId) return null;
    return {
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId,
        toolName: typeof metadata?.toolName === 'string' ? metadata.toolName : message.content,
        toolInput: metadata?.toolInput,
        status: CodingToolCallStatus.Pending,
      },
    };
  }
  if (type === 'tool_result') {
    const toolCallId =
      (typeof metadata?.toolUseId === 'string' && metadata.toolUseId) ||
      (typeof message.id === 'string' && message.id) ||
      null;
    if (!toolCallId) return null;
    const failed = metadata?.isError === true || message.isError === true;
    return {
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId,
        output: typeof metadata?.toolResult === 'string' ? metadata.toolResult : message.content,
        status: failed ? CodingToolCallStatus.Failed : CodingToolCallStatus.Completed,
      },
    };
  }
  return null;
};

/** Native message revisions retain tool identity instead of becoming assistant text. */
export const normalizePiMessageUpdate = (
  messageId: string,
  content: string,
  metadata?: Record<string, unknown>,
): CodingDriverEvent => {
  if (typeof metadata?.toolUseId === 'string') {
    const isCall = Object.hasOwn(metadata, 'toolInput');
    return {
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: metadata.toolUseId,
        ...(typeof metadata.toolName === 'string' ? { toolName: metadata.toolName } : {}),
        ...(isCall ? { toolInput: metadata.toolInput } : { output: content }),
        status:
          isCall || metadata.isStreaming === true
            ? CodingToolCallStatus.Pending
            : metadata.isError === true
              ? CodingToolCallStatus.Failed
              : CodingToolCallStatus.Completed,
        streamUpdateMode: CodingStreamUpdateMode.Replace,
      },
    };
  }
  return {
    kind: metadata?.isThinking === true ? CodingEventKind.Reasoning : CodingEventKind.MessageDelta,
    payload: { content, messageId, streamUpdateMode: CodingStreamUpdateMode.Replace },
  };
};
