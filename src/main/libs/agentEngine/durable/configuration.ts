import { WorkDocumentDoc, WorkDocumentExtension } from './workDocument';
import type { AgentChange, HarnessOptions } from '@earendil-works/pi-durable';
import { classifyWorkbenchToolRisk } from '../../../workbenchTask/riskClassifier';
import {
  WorkbenchApprovalMode,
  WorkbenchApprovalRiskLevel,
} from '../../../../shared/workbenchTask';
import type { PiStartOptions } from '../piRuntimeTypes';
import { DurableApprovalBroker } from './approvalBroker';
import { authorizeNativeTool } from './toolBridge';
import type { DurableConfiguration } from './runtimeHost';

export async function buildDurableConfiguration(input: {
  sessionId: string;
  options: PiStartOptions;
  models: HarnessOptions['models'];
  model: NonNullable<AgentChange['model']>;
  approvals: DurableApprovalBroker;
  approvalMode: () => WorkbenchApprovalMode;
}): Promise<DurableConfiguration> {
  const [{ createRegistry, section }, { CodingTools }, { NodeExecutionEnv }] = await Promise.all([
    import('@earendil-works/pi-durable'),
    import('@earendil-works/pi-durable/tools'),
    import('@earendil-works/pi-durable/env/node'),
  ]);
  const registry = createRegistry();
  registry.install(WorkDocumentExtension);
  if (input.options.sessionMode !== 'chat' && input.options.confirmationMode !== 'text') {
    registry.install({
      ...CodingTools,
      tools: CodingTools.tools?.map(tool =>
        authorizeNativeTool(tool, {
          authorize: async call => {
            const mode = input.approvalMode();
            const risk = classifyWorkbenchToolRisk(call.toolName, call.toolInput);
            if (
              mode === WorkbenchApprovalMode.AllowAll ||
              risk === WorkbenchApprovalRiskLevel.ReadOnly
            )
              return { allow: true };
            if (input.options.unattended)
              return {
                allow: false,
                reason: 'This action requires approval from the user.',
                terminateRun: true,
              };
            const result = await input.approvals.ask(
              input.sessionId,
              call.toolName,
              call.toolInput,
              call.callId,
              call.signal,
            );
            return result.behavior === 'allow'
              ? { allow: true, updatedInput: result.updatedInput }
              : { allow: false, reason: result.message, terminateRun: true };
          },
        }),
      ),
    });
  }
  if (input.options.systemPrompt?.trim()) {
    registry.install({
      name: 'zhiyuan-instructions',
      sections: [section('instructions', () => input.options.systemPrompt!, { tag: false })],
    });
  }
  const cwd = input.options.workspaceRoot || process.cwd();
  const environment = new NodeExecutionEnv({ cwd });
  return {
    harness: {
      models: input.models,
      registry,
      env: () => environment,
      conversationCreated: async (tx, conversation) => {
        await tx.doc(WorkDocumentDoc, conversation.id);
      },
    },
    agent: {
      model: input.model,
      cwd,
      ...(input.options.thinkingLevel ? { thinkingLevel: input.options.thinkingLevel } : {}),
    },
  };
}
