import type { AgentChange, ConversationView, SubmissionDraft } from '@earendil-works/pi-durable';
import type { DurableWorkSnapshot } from '../../../../shared/durable/types';
import { DurableSessionOwner, type DurableSession } from './sessionOwner';

export interface DurableConversationObserver {
  changed(sessionId: string, view: ConversationView): void;
  settled(sessionId: string, success: boolean, reason?: string): void;
}

/** Application operations over native submissions; no task scheduler or replay policy lives here. */
export class DurableConversationRunner {
  private closing = false;
  private readonly observing = new Set<string>();
  private readonly attached = new Map<string, Promise<void>>();

  constructor(
    readonly owner: DurableSessionOwner,
    private readonly observer: DurableConversationObserver,
  ) {}

  private async attach(session: DurableSession): Promise<void> {
    let pending = this.attached.get(session.sessionId);
    if (!pending) {
      pending = (async () => {
        const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
        const watch = await session.conversation.watch(BACKGROUND_CONTEXT);
        this.observer.changed(session.sessionId, watch.value);
        watch.start(async value => this.observer.changed(session.sessionId, value));
      })();
      this.attached.set(session.sessionId, pending);
      void pending.catch(() => this.attached.delete(session.sessionId));
    }
    await pending;
  }

  async submit(
    sessionId: string,
    draft: SubmissionDraft,
    agent?: AgentChange,
  ): Promise<import('@earendil-works/pi-durable').Submission> {
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const session = await this.owner.open(sessionId, agent);
    await this.attach(session);
    const submission = await session.conversation.submit(draft, BACKGROUND_CONTEXT);
    // The IPC caller awaits durable admission, never the whole model run.
    this.observe(sessionId, submission);
    return submission;
  }

  private observe(
    sessionId: string,
    submission: import('@earendil-works/pi-durable').Submission,
  ): void {
    const key = `${sessionId}:${submission.id}`;
    if (this.observing.has(key)) return;
    this.observing.add(key);
    void import('@earendil-works/chord/context')
      .then(({ BACKGROUND_CONTEXT }) => submission.wait(BACKGROUND_CONTEXT))
      .then(
        record => {
          if (!this.closing)
            this.observer.settled(
              sessionId,
              record.status === 'done',
              'reason' in record ? record.reason : undefined,
            );
        },
        error => {
          if (!this.closing)
            this.observer.settled(
              sessionId,
              false,
              error instanceof Error ? error.message : String(error),
            );
        },
      )
      .finally(() => this.observing.delete(key));
  }

  detach(sessionId: string): void {
    this.attached.delete(sessionId);
  }

  inspect(sessionId: string): Promise<DurableWorkSnapshot | undefined> {
    return this.owner.inspect(sessionId);
  }

  async resume(sessionId: string): Promise<void> {
    const snapshot = await this.inspect(sessionId);
    if (!snapshot?.canResume) throw new Error(snapshot?.blockedReason ?? 'No native work exists.');
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const session = await this.owner.open(sessionId);
    await this.attach(session);
    session.harness.resume();
    const pending = await session.harness.inspect(BACKGROUND_CONTEXT);
    for (const record of pending.submissions) {
      const submission = await session.harness.submission(record.id, BACKGROUND_CONTEXT);
      if (!submission) continue;
      this.observe(sessionId, submission);
    }
  }

  async abort(sessionId: string): Promise<void> {
    if (!(await this.owner.exists(sessionId))) return;
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const session = await this.owner.open(sessionId);
    await session.conversation.abort(BACKGROUND_CONTEXT);
  }

  close(): Promise<void> {
    this.closing = true;
    return this.owner.close();
  }
}
