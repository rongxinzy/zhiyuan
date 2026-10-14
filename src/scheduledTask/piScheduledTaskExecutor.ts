import type { CoworkStore } from '../main/coworkStore';
import type { PiRuntime, PiStartOptions } from '../main/libs/agentEngine/piRuntimeTypes';
import { getDefaultConversationWorkspacePath } from '../main/defaultConversationWorkspace';
import { parseManagedSessionKey } from '../main/libs/managedSessionKey';
import { buildScheduledSessionTitle, CoworkSessionSource } from '../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../shared/workbenchTask';

import { PayloadKind, SessionTarget } from './constants';
import type { ScheduledTask, ScheduledTaskRun } from './types';

/** Executes one canonical task through the embedded Pi runtime only. */
export class PiScheduledTaskExecutor {
  constructor(
    private readonly runtime: PiRuntime,
    private readonly coworkStore: CoworkStore,
    private readonly bindRunSession: (runId: string, sessionId: string) => void,
  ) {}

  async execute(
    task: ScheduledTask,
    run: ScheduledTaskRun,
  ): Promise<{ sessionId: string; output: string | null }> {
    const prompt =
      task.payload.kind === PayloadKind.SystemEvent ? task.payload.text : task.payload.message;
    if (!prompt.trim()) throw new Error(`Scheduled task ${task.id} has an empty prompt`);
    const session = this.resolveSession(task, run);
    this.bindRunSession(run.id, session.id);
    const options: PiStartOptions & { requestId: string } = {
      systemPrompt: session.systemPrompt,
      skillIds: session.activeSkillIds,
      workspaceRoot: session.cwd,
      sessionMode: session.mode,
      expertIds: session.experts.map(expert => expert.expertId),
      modelOverride: session.modelOverride || undefined,
      requestId: `scheduled:${run.id}`,
      // A timer does not grant permission to perform unattended external actions.
      approvalMode: WorkbenchApprovalMode.Ask,
      unattended: true,
    };
    const execution = this.runtime.runScheduledTask(session.id, prompt, options);
    const clearDeadline =
      run.deadlineAtMs == null
        ? (): void => {}
        : this.armNativeDeadline(session.id, run.deadlineAtMs);
    try {
      await execution;
    } finally {
      clearDeadline();
    }
    return { sessionId: session.id, output: this.finalAssistantOutput(session.id) };
  }

  /** A deadline is only a time-triggered native abort, never a host completion. */
  private armNativeDeadline(sessionId: string, deadlineMs: number): () => void {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(
        () => {
          if (Date.now() < deadlineMs) {
            arm();
            return;
          }
          void this.runtime.cancelScheduledTask(sessionId).catch(error => {
            console.error(`[Scheduler] failed to abort expired session ${sessionId}:`, error);
          });
        },
        Math.min(60_000, Math.max(0, deadlineMs - Date.now())),
      );
      timer.unref?.();
    };
    arm();
    return () => clearTimeout(timer);
  }

  async cancel(run: ScheduledTaskRun): Promise<void> {
    await this.runtime.cancelScheduledTask(`scheduled-run:${run.id}`);
  }

  private resolveSession(task: ScheduledTask, run: ScheduledTaskRun) {
    const sessionId = `scheduled-run:${run.id}`;
    const original = this.coworkStore.getSession(sessionId);
    if (original) return original;
    const sourceId =
      task.sessionTarget === SessionTarget.Main && task.sessionKey
        ? (parseManagedSessionKey(task.sessionKey)?.sessionId ?? task.sessionKey)
        : task.sessionTarget === SessionTarget.Task
          ? `scheduled-task:${task.id}`
          : null;
    const source = sourceId ? this.coworkStore.getSession(sourceId) : null;
    const config = this.coworkStore.getConfig();
    const workspace = task.workspaceId ? this.coworkStore.getWorkspace(task.workspaceId) : null;
    // Each occurrence has its own native conversation. Configuration may be
    // inherited, but stopping a timer run can never abort the user's live chat.
    return this.coworkStore.createSession(
      buildScheduledSessionTitle(task.name),
      source?.cwd || workspace?.path || getDefaultConversationWorkspacePath(),
      source?.systemPrompt ?? config.systemPrompt,
      source?.executionMode ?? config.executionMode,
      source?.activeSkillIds ?? [],
      'main',
      source?.modelOverride ||
        (task.payload.kind === PayloadKind.AgentTurn ? (task.payload.model ?? '') : ''),
      'work',
      sessionId,
      source?.workspaceId ?? workspace?.id,
      source?.experts ?? [],
      CoworkSessionSource.Scheduled,
    );
  }

  private finalAssistantOutput(sessionId: string): string | null {
    const session = this.coworkStore.getSession(sessionId, null);
    const message = [...(session?.messages ?? [])]
      .reverse()
      .find(
        candidate =>
          candidate.type === 'assistant' &&
          candidate.content.trim() &&
          !candidate.metadata?.isThinking,
      );
    return message?.content.trim() || null;
  }
}
