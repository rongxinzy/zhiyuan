import { describe, expect, test } from 'vitest';

import {
  CodingEventKind,
  CodingStreamUpdateMode,
  CodingToolCallStatus,
} from '../../shared/codingAgent';
import { normalizePiMessage, normalizePiMessageUpdate } from './piCodingEventAdapter';

describe('Pi coding event adapter', () => {
  test('maps tool messages to durable tool call events', () => {
    expect(
      normalizePiMessage({
        id: 'message-1',
        type: 'tool_use',
        content: 'Using tool: bash',
        metadata: {
          toolUseId: 'call-1',
          toolName: 'bash',
          toolInput: { command: 'pwd' },
        },
      }),
    ).toEqual({
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: 'call-1',
        toolName: 'bash',
        toolInput: { command: 'pwd' },
        status: CodingToolCallStatus.Pending,
      },
    });

    expect(
      normalizePiMessage({
        id: 'message-2',
        type: 'tool_result',
        content: 'done',
        metadata: { toolUseId: 'call-1', toolResult: 'done' },
      }),
    ).toEqual({
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: 'call-1',
        output: 'done',
        status: CodingToolCallStatus.Completed,
      },
    });
  });

  test('keeps native argument revisions on the same tool instead of assistant text', () => {
    expect(
      normalizePiMessageUpdate('message-1', '', {
        toolUseId: 'call-1',
        toolName: 'bash',
        toolInput: { command: 'pwd' },
        isStreaming: true,
      }),
    ).toEqual({
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: 'call-1',
        toolName: 'bash',
        toolInput: { command: 'pwd' },
        status: CodingToolCallStatus.Pending,
        streamUpdateMode: CodingStreamUpdateMode.Replace,
      },
    });
  });

  test('a failed tool result stays failed without settling the whole turn', () => {
    expect(
      normalizePiMessageUpdate('message-2', 'permission denied', {
        toolUseId: 'call-1',
        isError: true,
        isStreaming: false,
      }),
    ).toMatchObject({
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: 'call-1',
        output: 'permission denied',
        status: CodingToolCallStatus.Failed,
      },
    });
    expect(
      normalizePiMessage({ type: 'tool_result', id: 'r', metadata: { isError: true } }),
    ).toMatchObject({
      kind: CodingEventKind.ToolCall,
      payload: { status: CodingToolCallStatus.Failed },
    });
  });

  test('preserves reasoning and assistant replacement semantics', () => {
    expect(normalizePiMessageUpdate('m', 'answer')).toEqual({
      kind: CodingEventKind.MessageDelta,
      payload: {
        messageId: 'm',
        content: 'answer',
        streamUpdateMode: CodingStreamUpdateMode.Replace,
      },
    });
    expect(normalizePiMessageUpdate('m', 'thinking', { isThinking: true })).toMatchObject({
      kind: CodingEventKind.Reasoning,
    });
  });
});
