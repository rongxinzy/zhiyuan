import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { CodingEventKind, CodingToolCallStatus } from '../../shared/codingAgent';
import { classifyCoworkError } from '../../common/coworkError';
import { NativeStopCause } from '../libs/agentEngine/piRuntimeTypes';
import { bindBuiltinCodingRuntime } from './bindBuiltinCodingRuntime';

test('native tool revisions stay one tool and failed tools do not settle a turn', () => {
  const runtime = new EventEmitter();
  const record = vi.fn();
  const release = bindBuiltinCodingRuntime(runtime, record);
  runtime.emit('message', 's', {
    id: 'tool',
    type: 'tool_use',
    content: '',
    timestamp: 1,
    metadata: { toolUseId: 'call', toolName: 'bash', toolInput: {} },
  });
  runtime.emit('messageUpdate', 's', 'tool', '', {
    toolUseId: 'call',
    toolName: 'bash',
    toolInput: { command: 'pwd' },
    isStreaming: true,
  });
  runtime.emit('message', 's', {
    id: 'result',
    type: 'tool_result',
    content: 'failed',
    timestamp: 2,
    metadata: { toolUseId: 'call', isError: true },
  });
  expect(record.mock.calls.map(call => call[1])).toEqual(Array(3).fill(CodingEventKind.ToolCall));
  expect(record.mock.calls.map(call => call[2].toolCallId)).toEqual(['call', 'call', 'call']);
  expect(record.mock.calls[1][2]).toMatchObject({
    toolInput: { command: 'pwd' },
    status: CodingToolCallStatus.Pending,
  });
  expect(record.mock.calls[2][2]).toMatchObject({ status: CodingToolCallStatus.Failed });
  runtime.emit('message', 's', {
    id: 'answer',
    type: 'assistant',
    content: 'recovered',
    timestamp: 3,
  });
  runtime.emit('complete', 's');
  expect(record.mock.calls.at(-1)?.[1]).toBe(CodingEventKind.TurnComplete);
  release();
  expect(runtime.listenerCount('message')).toBe(0);
  release();
});

test('real model and admission failures remain failed rather than completed', () => {
  const runtime = new EventEmitter();
  const record = vi.fn();
  bindBuiltinCodingRuntime(runtime, record);
  const error = classifyCoworkError('model unavailable');
  runtime.emit('error', 's', error);
  expect(record).toHaveBeenCalledExactlyOnceWith('s', CodingEventKind.TurnFailed, { error });
});

test('native stop receipts preserve denial versus user cancellation without inventing completion', () => {
  const runtime = new EventEmitter();
  const record = vi.fn();
  bindBuiltinCodingRuntime(runtime, record);
  runtime.emit('sessionStopped', 's', { submissionId: 1, cause: NativeStopCause.ApprovalDenied });
  runtime.emit('sessionStopped', 's', { submissionId: 2, cause: NativeStopCause.UserStop });
  expect(record.mock.calls).toEqual([
    [
      's',
      CodingEventKind.TurnCancelled,
      { submissionId: 1, reason: NativeStopCause.ApprovalDenied },
    ],
    ['s', CodingEventKind.TurnCancelled, { submissionId: 2, reason: NativeStopCause.UserStop }],
  ]);
});
