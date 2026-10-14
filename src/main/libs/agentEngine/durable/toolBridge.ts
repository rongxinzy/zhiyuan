import { copyJson } from '@earendil-works/chord';
import { awaitWithContext } from '@earendil-works/chord/context';
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation';
import {
  defineTool,
  LiveDoc,
  InboxDoc,
  type JsonObject,
  type ToolExecutionApi,
  type ToolRegistration,
} from '@earendil-works/pi-durable';

export interface DurableToolAuthorization {
  readonly callId: string;
  readonly taskId: ToolExecutionApi['taskId'];
  readonly conversationId: ToolExecutionApi['conversationId'];
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly signal: AbortSignal | undefined;
}

export interface DurableToolDecision {
  readonly allow: boolean;
  readonly reason?: string;
  readonly terminateRun?: boolean;
  readonly updatedInput?: Record<string, unknown>;
}

export interface DurableToolBridgeOptions {
  /** Reuse the host's authorization service; it owns policy and approval dismissal. */
  readonly authorize: (call: DurableToolAuthorization) => Promise<DurableToolDecision>;
  /** Explicit host decision only. Tool annotations never grant replay permission. */
  readonly replay?: ToolRegistration['replay'];
}

/** Add the existing host policy to native tools without replacing their execution. */
export function authorizeNativeTool(
  tool: ToolRegistration,
  options: DurableToolBridgeOptions,
): ToolRegistration {
  if (typeof options.authorize !== 'function') {
    throw new Error('A tool authorization service is required.');
  }
  return defineTool({
    ...tool,
    // Never inherit a tool author's replay claim without explicit host review.
    replay: options.replay ?? 'unsafe',
    async execute(args, api, context) {
      context.abortSignal?.throwIfAborted();
      // Recovery runs execute directly, bypassing beforeTool. Authorization must
      // therefore live here, even for explicitly replay-safe read-only tools.
      const decision = await awaitWithContext(
        options.authorize({
          callId: api.callId,
          taskId: api.taskId,
          conversationId: api.conversationId,
          toolName: tool.name,
          toolInput: args as Record<string, unknown>,
          signal: context.abortSignal,
        }),
        context,
      );
      context.abortSignal?.throwIfAborted();
      if (!decision.allow) {
        if (decision.terminateRun) {
          // `control.terminate` means successful completion in the native
          // harness. A refused effect instead cancels the native conversation.
          // Commit the refusal on the tool's own progress before aborting; the
          // native abort result retains these details across close/reopen.
          const submissions = await api.commit(async tx => {
            const live = await tx.doc(LiveDoc, api.conversationId);
            const inbox = await tx.doc(InboxDoc, api.conversationId);
            return [
              ...(live.run?.inputs ?? []),
              ...inbox.items.filter(item => item.mode !== 'write').map(item => item.id),
            ];
          }, context);
          api.output(decision.reason || 'The tool call was not authorized.');
          await api.details({ zhiyuanApprovalDenied: true, submissionIds: submissions }, context);
          const conversation = await api.conversation(api.conversationId, context);
          if (!conversation) throw new Error('The tool conversation no longer exists.');
          await conversation.abort(context);
          context.abortSignal?.throwIfAborted();
        }
        return {
          output: [{ type: 'text', text: decision.reason || 'The tool call was not authorized.' }],
          isError: true,
        };
      }
      const authorizedArgs =
        decision.updatedInput === undefined
          ? args
          : validateToolArguments(tool, {
              type: 'toolCall',
              id: api.callId,
              name: tool.name,
              arguments: copyJson(decision.updatedInput) as JsonObject,
            });
      return tool.execute(authorizedArgs, api, context);
    },
  });
}
