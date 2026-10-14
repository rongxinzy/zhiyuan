import { store } from '../store';
import { CoworkSessionStatus } from '../../shared/cowork/constants';

export const CoworkRecoveryPolicy = { PollMs: 5_000, DebounceMs: 200 } as const;

/** Read-only recovery triggers. PiUiRecovery owns lifecycle watermarks. */
export class CoworkRecoverySync {
  private disposed = false;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly confirming = new Set<string>();
  private readonly requested = new Set<string>();
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly flushContent: () => void,
    private readonly recoverCanonicalSession: (sessionId: string) => Promise<void>,
  ) {}

  requestRecovery(sessionId: string): void {
    if (this.disposed || this.recoveryTimers.has(sessionId)) return;
    this.recoveryTimers.set(
      sessionId,
      setTimeout(() => {
        this.recoveryTimers.delete(sessionId);
        void this.recover(sessionId);
      }, CoworkRecoveryPolicy.DebounceMs),
    );
  }

  recover(sessionId: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.requested.add(sessionId);
    const existing = this.pending.get(sessionId);
    if (existing) return existing;
    const pending = this.drain(sessionId).finally(() => this.pending.delete(sessionId));
    this.pending.set(sessionId, pending);
    return pending;
  }

  private async drain(sessionId: string): Promise<void> {
    while (!this.disposed && this.requested.delete(sessionId)) {
      try {
        this.flushContent();
        await this.recoverCanonicalSession(sessionId);
        if (!this.disposed) await window.electron?.cowork?.replayContent?.(sessionId);
      } catch (error) {
        console.warn('[CoworkRecoverySync] runtime recovery failed:', error);
      }
    }
  }

  /** Quiet active runs need only a small native lifecycle projection. Explicit
   * focus/gap recovery remains independent of an outstanding confirmation. */
  private async confirm(sessionId: string): Promise<void> {
    const read = window.electron?.cowork?.getRuntimeSnapshots;
    if (!read || this.disposed || this.pending.has(sessionId) || this.confirming.has(sessionId))
      return;
    this.confirming.add(sessionId);
    try {
      const snapshots = await read(sessionId);
      if (this.disposed) return;
      const snapshot = snapshots.find(candidate => candidate.sessionId === sessionId);
      if (snapshot && snapshot.status !== CoworkSessionStatus.Running)
        await this.recover(sessionId);
    } catch (error) {
      console.debug('[CoworkRecoverySync] runtime confirmation failed:', error);
    } finally {
      this.confirming.delete(sessionId);
    }
  }

  start(): () => void {
    const timer = window.setInterval(() => {
      for (const id of store.getState().cowork.streamingSessionIds.slice(0, 32)) {
        void this.confirm(id);
      }
    }, CoworkRecoveryPolicy.PollMs);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const state = store.getState().cowork;
      for (const id of new Set([
        state.currentSessionId,
        ...state.streamingSessionIds.slice(0, 32),
      ])) {
        if (id && !id.startsWith('temp-')) this.requestRecovery(id);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    onVisible();
    return () => {
      this.disposed = true;
      this.requested.clear();
      window.clearInterval(timer);
      for (const pending of this.recoveryTimers.values()) clearTimeout(pending);
      this.recoveryTimers.clear();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }
}
