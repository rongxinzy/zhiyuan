import { randomUUID } from 'node:crypto';
import type { PiPermissionRequest, PiPermissionResult } from '../piRuntimeTypes';

/** UI transport for an individual native tool invocation, not an approval/replay ledger. */
export class DurableApprovalBroker {
  private readonly pending = new Map<string, { resolve: (result: PiPermissionResult) => void }>();
  constructor(
    private readonly request: (sessionId: string, request: PiPermissionRequest) => void,
    private readonly dismiss: (requestId: string) => void,
  ) {}

  ask(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    callId: string,
    signal?: AbortSignal,
  ): Promise<PiPermissionResult> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const requestId = `durable:${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const clear = () => {
        this.pending.delete(requestId);
        signal?.removeEventListener('abort', abort);
        this.dismiss(requestId);
      };
      const abort = () => {
        clear();
        reject(signal?.reason ?? new Error('Tool invocation stopped.'));
      };
      this.pending.set(requestId, {
        resolve: result => {
          clear();
          resolve(result);
        },
      });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.request(sessionId, { requestId, toolName, toolInput, toolUseId: callId });
      } catch (error) {
        clear();
        reject(error);
      }
    });
  }

  respond(requestId: string, result: PiPermissionResult): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    pending.resolve(result);
    return true;
  }
}
