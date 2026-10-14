import { projectPendingQueue } from './pendingQueue';
import { classifyCoworkError } from '../../../../common/coworkError';
import { readCoworkImageBase64 } from '../../../coworkImageAttachments';
import { randomUUID } from 'node:crypto';
import type { AgentChange, HarnessOptions, ConversationView } from '@earendil-works/pi-durable';
import type { CoworkStore, CoworkMessage } from '../../../coworkStore';
import type { PiStartOptions, PiContinueOptions, PiRuntimeEvents } from '../piRuntimeTypes';
import { DurableSessionOwner } from './sessionOwner';
import { DurableConversationRunner } from './conversationRunner';
import { projectDurableEntry, projectDurablePartial } from './messageProjection';

export interface DurableConfiguration {
  harness: HarnessOptions;
  agent: AgentChange;
}

export class DurableRuntimeHost {
  readonly runner: DurableConversationRunner;
  private readonly views = new Map<string, ConversationView>();
  private readonly running = new Set<string>();
  private readonly projected = new Map<string, Set<number>>();
  private readonly knownMessages = new Set<string>();
  private readonly configurations = new Map<string, Promise<DurableConfiguration>>();

  constructor(
    directory: string,
    private readonly store: CoworkStore,
    private readonly prepare: (
      sessionId: string,
      options: PiStartOptions,
    ) => Promise<DurableConfiguration>,
    private readonly emit: <K extends keyof PiRuntimeEvents>(
      event: K,
      ...args: Parameters<PiRuntimeEvents[K]>
    ) => void,
  ) {
    const owner = new DurableSessionOwner(
      directory,
      async sessionId => (await this.configuration(sessionId)).harness,
    );
    this.runner = new DurableConversationRunner(owner, {
      changed: (sessionId, view) => this.project(sessionId, view),
      settled: (sessionId, success, reason) => {
        void this.settle(sessionId, success, reason).catch(error =>
          console.error('[DurableRuntime] Failed to project a submission result:', error),
        );
      },
    });
  }

  private configuration(
    sessionId: string,
    options?: PiStartOptions,
  ): Promise<DurableConfiguration> {
    let pending = this.configurations.get(sessionId);
    if (!pending) {
      const saved = this.store.getSession(sessionId);
      if (!saved) return Promise.reject(new Error('Cowork session not found.'));
      pending = this.prepare(
        sessionId,
        options ?? {
          workspaceRoot: saved.cwd,
          systemPrompt: saved.systemPrompt,
          skillIds: saved.activeSkillIds,
          sessionMode: saved.mode,
          modelOverride: saved.modelOverride,
        },
      );
      this.configurations.set(sessionId, pending);
      void pending.catch(() => this.configurations.delete(sessionId));
    }
    return pending;
  }

  async submit(
    sessionId: string,
    prompt: string,
    options: PiStartOptions | PiContinueOptions,
  ): Promise<import('@earendil-works/pi-durable').Submission> {
    const config = await this.configuration(sessionId, options);
    const images = options.imageAttachments ?? [];
    const modelPrompt = options.fileAttachments?.length
      ? `${prompt}\n\nAttached files:\n${options.fileAttachments.map(file => `${file.name}: ${file.path}`).join('\n')}`
      : prompt;
    const content = images.length
      ? [
          { type: 'text' as const, text: modelPrompt },
          ...images.map(image => ({
            type: 'image' as const,
            mimeType: image.mimeType,
            data: readCoworkImageBase64(image),
          })),
        ]
      : modelPrompt;

    return await this.runner.submit(
      sessionId,
      {
        type: 'input',
        entry: {
          kind: 'zhiyuan.input',
          data: {
            createdAt: Date.now(),
            displayText: prompt,
            ...('_userMessageId' in options && options._userMessageId
              ? { userMessageId: options._userMessageId }
              : {}),
            ...(images.length
              ? {
                  imageAttachments: images.map(({ name, mimeType, path }) => ({
                    name,
                    mimeType,
                    ...(path ? { path } : {}),
                  })),
                }
              : {}),
            ...(options.fileAttachments?.length
              ? { fileAttachments: options.fileAttachments }
              : {}),
          },
        },
        content,
        requestId:
          options.requestId ??
          ('_userMessageId' in options ? options._userMessageId : undefined) ??
          randomUUID(),
        whenBusy:
          '_streamingBehavior' in options ? (options._streamingBehavior ?? 'followUp') : 'followUp',
      },
      config.agent,
    );
  }

  async reconfigure(sessionId: string): Promise<DurableConfiguration> {
    const snapshot = await this.runner.inspect(sessionId);
    if (snapshot?.tasks.length || snapshot?.pendingSubmissionCount)
      throw new Error('Stop or finish the current work before changing its model.');
    await this.runner.owner.release(sessionId);
    this.runner.detach(sessionId);
    this.configurations.delete(sessionId);
    return this.configuration(sessionId);
  }

  listPending(sessionId: string) {
    return projectPendingQueue(this.views.get(sessionId));
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }
  hasSession(sessionId: string): boolean {
    return this.configurations.has(sessionId);
  }
  hasRunning(): boolean {
    return this.running.size > 0;
  }

  private async settle(sessionId: string, success: boolean, reason?: string): Promise<void> {
    const snapshot = await this.runner.inspect(sessionId);
    if (snapshot?.tasks.length || snapshot?.pendingSubmissionCount) return;
    this.running.delete(sessionId);
    if (reason === 'aborted') {
      this.store.updateSession(sessionId, { status: 'idle' });
      this.emit('sessionStopped', sessionId);
    } else if (success) {
      this.store.updateSession(sessionId, { status: 'completed' });
      this.emit('complete', sessionId);
    } else {
      this.store.updateSession(sessionId, { status: 'error' });
      this.emit(
        'error',
        sessionId,
        classifyCoworkError(reason ?? 'The submission ended without an answer.'),
      );
    }
  }

  private write(sessionId: string, message: CoworkMessage): void {
    const exists = this.knownMessages.has(message.id);
    const stored = this.store.upsertMessage(sessionId, message);
    this.knownMessages.add(message.id);
    if (exists) this.emit('messageUpdate', sessionId, stored.id, stored.content, stored.metadata);
    else this.emit('message', sessionId, stored);
  }

  private project(sessionId: string, view: ConversationView): void {
    this.views.set(sessionId, view);
    this.emit('queueUpdated', sessionId, projectPendingQueue(view));
    let seen = this.projected.get(sessionId);
    if (!seen) {
      seen = new Set();
      this.projected.set(sessionId, seen);
    }
    for (const entry of view.entries) {
      if (seen.has(entry.id)) continue;
      for (const message of projectDurableEntry(sessionId, entry)) this.write(sessionId, message);
      seen.add(entry.id);
    }
    for (const message of projectDurablePartial(sessionId, view)) this.write(sessionId, message);
    const busy = !!view.docs['pi.live']?.run;
    if (busy && !this.running.has(sessionId)) {
      this.running.add(sessionId);
      this.store.updateSession(sessionId, { status: 'running' });
      this.emit('started', sessionId);
    } else if (!busy && this.running.delete(sessionId)) {
    }
  }
}
