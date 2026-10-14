import { defineTool, type Extension } from '@earendil-works/pi-durable';
import { Type } from 'typebox';
import type { PythonRuntimeService } from '../../../pythonRuntime/service';
import { authorizeNativeTool, type DurableToolBridgeOptions } from './toolBridge';

export function createPythonTools(
  service: PythonRuntimeService,
  workspace: string,
  authorization: DurableToolBridgeOptions,
): Extension {
  const execute = defineTool({
    name: 'python_execute',
    description:
      'Product interface python.execute: execute Python code in this workspace using its isolated Python 3.12 environment. Returns stdout, stderr and exit code. This is local execution with user permissions, not a filesystem sandbox. Use python_install (python.install) for pinned packages.',
    replay: 'unsafe',
    parameters: Type.Object({
      code: Type.String({ maxLength: 1048576 }),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 600000 })),
    }),
    async execute(args, _api, context) {
      const result = await service.execute({ workspace, ...args }, context.abortSignal);
      return {
        output: [{ type: 'text', text: JSON.stringify(result) }],
        isError: result.exitCode !== 0,
      };
    },
  });
  const install = defineTool({
    name: 'python_install',
    description:
      'Product interface python.install: install exact pinned PyPI wheel packages (for example numpy==2.2.6) into this workspace only. Installation creates a new environment and switches only after success. Set rebuild=true only when the user explicitly asks to rebuild; existing environment directories are retained.',
    replay: 'unsafe',
    parameters: Type.Object({
      packages: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 40 }),
      rebuild: Type.Optional(Type.Boolean()),
    }),
    async execute(args, _api, context) {
      const result = await service.install({ workspace, ...args }, context.abortSignal);
      return {
        output: [{ type: 'text', text: JSON.stringify(result) }],
        isError: result.exitCode !== 0,
      };
    },
  });
  return {
    name: 'zhiyuan-python',
    tools: [execute, install].map(tool =>
      authorizeNativeTool(tool, { ...authorization, replay: 'unsafe' }),
    ),
  };
}
