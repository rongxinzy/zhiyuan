import { app } from 'electron';
import { join } from 'node:path';
import { createNativeExecutionEnv, nativeCodingTools } from './nativeExecutionEnv';
import { getPythonRuntimeService } from '../../../pythonRuntime/host';
import { createPythonTools } from './pythonTools';
import { WorkDocumentDoc, WorkDocumentExtension } from './workDocument';
import type { AgentChange, HarnessOptions } from '@earendil-works/pi-durable';
import { classifyToolRisk } from '../../../toolApproval/riskClassifier';
import { ToolApprovalMode, ToolRiskLevel } from '../../../../shared/cowork/approval';
import type { PiStartOptions } from '../piRuntimeTypes';
import { DurableApprovalBroker } from './approvalBroker';
import { authorizeNativeTool, type DurableToolBridgeOptions } from './toolBridge';
import type { DurableConfiguration } from './runtimeHost';

export async function buildDurableConfiguration(input: {
  sessionId: string;
  options: PiStartOptions;
  models: HarnessOptions['models'];
  model: NonNullable<AgentChange['model']>;
  approvals: DurableApprovalBroker;
  approvalMode: () => ToolApprovalMode;
}): Promise<DurableConfiguration> {
  const { createRegistry, section } = await import('@earendil-works/pi-durable');
  const CodingTools = nativeCodingTools();
  const registry = createRegistry();
  registry.install(WorkDocumentExtension);
  if (input.options.sessionMode !== 'chat' && input.options.confirmationMode !== 'text') {
    const authorization: DurableToolBridgeOptions = {
      authorize: async call => {
        const mode = input.approvalMode();
        const risk = classifyToolRisk(call.toolName, call.toolInput);
        if (mode === ToolApprovalMode.AllowAll || risk === ToolRiskLevel.ReadOnly)
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
    };
    registry.install({
      ...CodingTools,
      tools: CodingTools.tools?.map(tool => authorizeNativeTool(tool, authorization)),
    });
    registry.install(
      createPythonTools(
        getPythonRuntimeService(),
        input.options.workspaceRoot || process.cwd(),
        authorization,
      ),
    );
  }
  if (input.options.systemPrompt?.trim()) {
    registry.install({
      name: 'zhiyuan-instructions',
      sections: [section('instructions', () => input.options.systemPrompt!, { tag: false })],
    });
  }
  const cwd = input.options.workspaceRoot || process.cwd();
  const environment = await createNativeExecutionEnv(
    cwd,
    process.platform === 'win32'
      ? app.isPackaged
        ? process.resourcesPath
        : join(app.getAppPath(), 'resources')
      : '',
  );
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
