import { changePendingInput, withdrawPendingInput } from './durable/pendingQueue';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
} from '../../../shared/cowork/pendingMessageQueue';
/** The single application entry point into Pi's native durable execution kernel. */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { app } from 'electron';
import type { CoworkStore } from '../../coworkStore';
import { ToolApprovalMode } from '../../../shared/cowork/approval';
import type { CoworkPendingMessage } from '../../../shared/cowork/pendingMessageQueue';
import {
  buildPiBackgroundCompletionContext,
  extractPiBackgroundCompletionText,
} from './piBackgroundCompletion';
import type {
  PiStartOptions,
  PiContinueOptions,
  PiSessionPatch,
  PiRuntimeEvents,
  PiPermissionResult,
} from './piRuntimeTypes';
import { DurableRuntimeHost } from './durable/runtimeHost';
import { DurableWorkDetachedError } from './piRuntimeTypes';
import { DurableApprovalBroker } from './durable/approvalBroker';
import { buildDurableConfiguration } from './durable/configuration';
import { resolveDurableProvider } from './durable/provider';

export class PiRuntimeAdapter extends EventEmitter {
  private host?: DurableRuntimeHost;
  private store?: CoworkStore;
  private closing = false;
  private readonly scheduledAdmissions = new Map<
    string,
    Promise<import('@earendil-works/pi-durable').Submission>
  >();
  private readonly approvalModes = new Map<string, ToolApprovalMode>();
  private readonly confirmationModes = new Map<string, 'modal' | 'text'>();
  private readonly approvals = new DurableApprovalBroker(
    (sessionId, request) => this.emit('permissionRequest', sessionId, request),
    requestId => this.emit('permissionDismiss', requestId),
  );

  override on<K extends keyof PiRuntimeEvents>(event: K, listener: PiRuntimeEvents[K]): this {
    return super.on(event, listener);
  }
  override off<K extends keyof PiRuntimeEvents>(event: K, listener: PiRuntimeEvents[K]): this {
    return super.off(event, listener);
  }

  setCoworkStore(store: CoworkStore): void {
    if (this.host) throw new Error('The runtime store is already configured.');
    this.store = store;
    this.host = new DurableRuntimeHost(
      join(app.getPath('userData'), 'durable-work'),
      store,
      async (sessionId, options) => {
        const provider = await resolveDurableProvider(
          sessionId,
          options.modelOverride,
          options.sessionMode,
        );
        return buildDurableConfiguration({
          sessionId,
          options,
          models: provider.models,
          model: provider.model,
          approvals: this.approvals,
          approvalMode: () => this.approvalModes.get(sessionId) ?? ToolApprovalMode.Ask,
        });
      },
      (event, ...args) => {
        this.emit(event, ...args);
      },
    );
  }

  private runtime(): DurableRuntimeHost {
    if (!this.host) throw new Error('The runtime store is not configured.');
    return this.host;
  }

  async startSession(
    sessionId: string,
    prompt: string,
    options: PiStartOptions = {},
  ): Promise<void> {
    this.approvalModes.set(sessionId, options.approvalMode ?? ToolApprovalMode.Ask);
    this.confirmationModes.set(sessionId, options.confirmationMode ?? 'modal');
    await this.runtime().submit(sessionId, prompt, options);
  }

  /** A scheduled occurrence waits on its native submission, not UI completion events. */
  async runScheduledTask(
    sessionId: string,
    prompt: string,
    options: PiStartOptions & { requestId: string },
  ): Promise<{ submissionId: number; conversationId: number }> {
    this.approvalModes.set(sessionId, options.approvalMode ?? ToolApprovalMode.Ask);
    const admission = this.runtime().submit(sessionId, prompt, { ...options, unattended: true });
    // Register synchronously so Stop cannot finish before a pending admission.
    this.scheduledAdmissions.set(sessionId, admission);
    try {
      const submission = await admission;
      const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
      const record = await submission.wait(BACKGROUND_CONTEXT);
      if (record.status !== 'done')
        throw new Error('reason' in record ? record.reason : 'Scheduled work did not complete.');
      return { submissionId: record.id, conversationId: record.conversationId };
    } catch (error) {
      if (this.closing) throw new DurableWorkDetachedError();
      throw error;
    } finally {
      if (this.scheduledAdmissions.get(sessionId) === admission)
        this.scheduledAdmissions.delete(sessionId);
    }
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: PiContinueOptions = {},
  ): Promise<void> {
    if (options.approvalMode) this.approvalModes.set(sessionId, options.approvalMode);
    await this.runtime().submit(sessionId, prompt, options);
  }

  async patchSession(sessionId: string, patch: PiSessionPatch): Promise<void> {
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    if (patch.model) {
      const current = await this.getDurableWork(sessionId);
      if (current?.tasks.length || current?.pendingSubmissionCount)
        throw new Error('Stop or finish the current work before changing its model.');
      this.store?.updateSession(sessionId, { modelOverride: patch.model });
      const configuration = await this.runtime().reconfigure(sessionId);
      const session = await this.runtime().runner.owner.open(sessionId);
      await session.conversation.configure(
        {
          model: configuration.agent.model,
          ...(patch.thinkingLevel ? { thinkingLevel: patch.thinkingLevel } : {}),
        },
        BACKGROUND_CONTEXT,
      );
    } else if (patch.thinkingLevel) {
      const session = await this.runtime().runner.owner.open(sessionId);
      await session.conversation.configure(
        { thinkingLevel: patch.thinkingLevel },
        BACKGROUND_CONTEXT,
      );
    }
  }

  getDurableWork(sessionId: string) {
    return this.runtime().runner.inspect(sessionId);
  }
  async hasDurableWork(sessionId: string): Promise<boolean> {
    return this.runtime().runner.owner.exists(sessionId);
  }
  async resumeDurableWork(sessionId: string): Promise<void> {
    await this.runtime().runner.resume(sessionId);
  }
  async cancelScheduledTask(sessionId: string): Promise<void> {
    await this.scheduledAdmissions.get(sessionId)?.catch((): void => {});
    await this.runtime().runner.abort(sessionId);
  }
  stopSession(sessionId: string): void {
    void this.runtime()
      .runner.abort(sessionId)
      .catch(error => console.error('[DurableRuntime] Failed to stop work:', error));
  }
  async close(): Promise<void> {
    this.closing = true;
    await this.host?.runner.close();
  }
  stopAllSessions(): void {
    void this.close().catch(error =>
      console.error('[DurableRuntime] Failed to close work:', error),
    );
  }
  setApprovalModeForSession(sessionId: string, mode: ToolApprovalMode): void {
    this.approvalModes.set(sessionId, mode);
  }
  respondToPermission(requestId: string, result: PiPermissionResult): void {
    this.approvals.respond(requestId, result);
  }
  isSessionActive(sessionId: string): boolean {
    return this.host?.hasSession(sessionId) ?? false;
  }
  isSessionRunning(sessionId: string): boolean {
    return this.host?.isRunning(sessionId) ?? false;
  }
  hasRunningSessions(): boolean {
    return this.host?.hasRunning() ?? false;
  }
  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.confirmationModes.get(sessionId) ?? 'modal';
  }
  onSessionDeleted(sessionId: string): void {
    this.stopSession(sessionId);
  }
  respondToCodingElicitation(_requestId: string, _answer: string): boolean {
    return false;
  }
  cancelCodingElicitation(_requestId: string, _reason: string): boolean {
    return false;
  }

  async compactSession(sessionId: string): Promise<{ cancelled: boolean }> {
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const session = await this.runtime().runner.owner.open(sessionId);
    const task = await session.conversation.compact(undefined, BACKGROUND_CONTEXT);
    const receipt = await session.harness.waitForTask(task, BACKGROUND_CONTEXT);
    return {
      cancelled:
        receipt.state.status !== 'terminal' || receipt.state.outcome.status !== 'completed',
    };
  }

  enqueueControlAction(
    sessionId: string,
    action: () => Promise<void>,
  ): { success: boolean; error?: string } {
    void (async () => {
      const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
      const session = await this.runtime().runner.owner.open(sessionId);
      await session.conversation.waitForIdle(BACKGROUND_CONTEXT);
      await action();
    })().catch(error => console.error('[DurableRuntime] Control action failed:', error));
    return { success: true };
  }

  listPendingMessages(sessionId: string): CoworkPendingMessage[] {
    return this.runtime().listPending(sessionId);
  }
  async enqueuePendingMessage(
    sessionId: string,
    text: string,
    images?: PiContinueOptions['imageAttachments'],
    files?: PiContinueOptions['fileAttachments'],
    requestId?: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    try {
      const submission = await this.runtime().submit(sessionId, text, {
        requestId,
        imageAttachments: images,
        fileAttachments: files,
        _streamingBehavior: 'followUp',
      });
      return {
        success: true,
        item: {
          id: String(submission.id),
          text,
          delivery: CoworkQueueDelivery.FollowUp,
          status: CoworkQueueItemStatus.Pending,
          createdAt: Date.now(),
          imageAttachments: images,
          fileAttachments: files,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async updatePendingMessage(
    sessionId: string,
    itemId: string,
    text: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    try {
      return {
        success: true,
        item: await changePendingInput(await this.runtime().runner.owner.open(sessionId), itemId, {
          text,
        }),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async deletePendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await withdrawPendingInput(await this.runtime().runner.owner.open(sessionId), itemId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async steerPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    try {
      return {
        success: true,
        item: await changePendingInput(await this.runtime().runner.owner.open(sessionId), itemId, {
          delivery: CoworkQueueDelivery.Steer,
        }),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async followUpPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    try {
      return {
        success: true,
        item: await changePendingInput(await this.runtime().runner.owner.open(sessionId), itemId, {
          delivery: CoworkQueueDelivery.FollowUp,
        }),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async chatDirect(prompt: string, modelRef?: string): Promise<string> {
    const provider = await resolveDurableProvider('background', modelRef, 'chat');
    const result = await provider.models.completeSimple(
      provider.modelObject,
      buildPiBackgroundCompletionContext([{ role: 'user', content: prompt }]),
    );
    return extractPiBackgroundCompletionText(result);
  }
  historyExists(sessionId: string): Promise<boolean> {
    return this.runtime().runner.owner.exists(sessionId);
  }
  readHistory(
    sessionId: string,
    limit: number,
    cursor?: import('@earendil-works/pi-durable').Cursor,
    anchor?: import('@earendil-works/pi-durable').EntryId,
  ) {
    return this.runtime().runner.owner.readHistory(sessionId, limit, cursor, anchor);
  }
  getWorkDocument(sessionId: string) {
    return this.runtime().runner.getWorkDocument(sessionId);
  }
  updateWorkDocument(
    sessionId: string,
    patch: import('../../../shared/durable/workDocument').WorkDocumentPatch,
  ) {
    return this.runtime().runner.updateWorkDocument(sessionId, patch);
  }
}
