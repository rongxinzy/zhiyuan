import {
  CodingEventKind,
  CodingStreamUpdateMode,
  type CodingEvent,
} from '../../shared/codingAgent';
import type { PiRuntime, PiRuntimeEvents } from '../libs/agentEngine/piRuntimeTypes';
import { normalizePiMessage, normalizePiMessageUpdate } from './piCodingEventAdapter';

type RecordEvent = (
  sessionId: string,
  kind: CodingEvent['kind'],
  payload: Record<string, unknown>,
) => void;

/** One-way projection of native messages and receipts into the existing Coding event log. */
export function bindBuiltinCodingRuntime(
  runtime: Pick<PiRuntime, 'on' | 'off'>,
  record: RecordEvent,
): () => void {
  const dispose: Array<() => void> = [];
  const on = <K extends keyof PiRuntimeEvents>(event: K, listener: PiRuntimeEvents[K]) => {
    runtime.on(event, listener);
    dispose.push(() => {
      runtime.off(event, listener);
    });
  };
  on('message', (sessionId, message) => {
    if (message.metadata?.isThinking === true) {
      record(sessionId, CodingEventKind.Reasoning, {
        message,
        streamUpdateMode: CodingStreamUpdateMode.Replace,
      });
      return;
    }
    const normalized = normalizePiMessage(message);
    if (normalized) record(sessionId, normalized.kind, normalized.payload);
  });
  on('messageUpdate', (sessionId, messageId, content, metadata) => {
    const normalized = normalizePiMessageUpdate(messageId, content, metadata);
    record(sessionId, normalized.kind, normalized.payload);
  });
  on('permissionRequest', (sessionId, request) => {
    record(sessionId, CodingEventKind.Permission, { requestId: request.requestId, request });
  });
  on('complete', sessionId => record(sessionId, CodingEventKind.TurnComplete, {}));
  on('error', (sessionId, error) => record(sessionId, CodingEventKind.TurnFailed, { error }));
  on('sessionStopped', (sessionId, receipt) =>
    record(sessionId, CodingEventKind.TurnCancelled, {
      reason: receipt.cause,
      submissionId: receipt.submissionId,
    }),
  );
  return () => {
    for (const release of dispose.splice(0)) release();
  };
}
