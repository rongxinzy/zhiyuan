import type {
  ConversationView,
  LiveState,
  SettledSubmissionRecord,
} from '@earendil-works/pi-durable';
import { classifyCoworkError } from '../../../../common/coworkError';
import { NativeStopCause, type NativeStopReceipt, type PiRuntimeEvents } from '../piRuntimeTypes';

/** Read native retry backoff; this projection owns neither retries nor timers. */
export function projectNativeRetry(
  view: ConversationView,
): Parameters<PiRuntimeEvents['nativeRetry']>[1] | undefined {
  const live = view.docs['pi.live'] as LiveState | undefined;
  const generation = live?.generation;
  if (!live?.run || !generation?.retry) return undefined;
  const error = classifyCoworkError(generation.retry.error);
  return {
    kind: error.kind,
    message: generation.retry.error,
    attempt: generation.attempt,
    retryAt: generation.retry.at,
  };
}

/** The denial is an immutable fact in the native aborted tool result, scoped
 * to its submission identities so an old refusal cannot taint a later stop. */
export function projectNativeStop(
  record: SettledSubmissionRecord,
  view: ConversationView,
): NativeStopReceipt {
  const denied = view.entries.some(entry =>
    (entry.model ?? []).some(message => {
      if (message.role !== 'toolResult') return false;
      const details = message.details;
      if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
      const denial = details as Record<string, unknown>;
      return (
        denial.zhiyuanApprovalDenied === true &&
        Array.isArray(denial.submissionIds) &&
        denial.submissionIds.includes(record.id)
      );
    }),
  );
  return {
    submissionId: record.id,
    cause: denied ? NativeStopCause.ApprovalDenied : NativeStopCause.UserStop,
  };
}
