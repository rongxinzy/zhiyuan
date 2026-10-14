import { join } from 'node:path';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { CodingTools, createPowerShellTool } from '@earendil-works/pi-durable/tools';

/** Keep upstream execution semantics: Windows uses the native powershell tool
 * (pwsh, then powershell); Unix keeps the original bash tool. */
export function nativeCodingTools(platform: NodeJS.Platform = process.platform) {
  if (platform !== 'win32') return CodingTools;
  return {
    ...CodingTools,
    tools: [
      ...(CodingTools.tools ?? []).filter(tool => tool.name !== 'bash'),
      createPowerShellTool(),
    ],
  };
}

/** Only session-local PATH additions. No shell override, installation, global
 * mutation or interpretation of PowerShell source by a Bash shell. */
export async function nativeExecutionOptions(
  cwd: string,
  resourcesRoot: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ConstructorParameters<typeof NodeExecutionEnv>[0]> {
  if (platform !== 'win32') return { cwd };
  const inheritedPath = Object.entries(environment).find(
    ([key]) => key.toUpperCase() === 'PATH',
  )?.[1];
  const windows = environment.SystemRoot || environment.WINDIR;
  return {
    cwd,
    shellEnv: {
      PATH: [
        join(resourcesRoot, 'mingit', 'cmd'),
        inheritedPath,
        ...(windows ? [join(windows, 'System32', 'WindowsPowerShell', 'v1.0')] : []),
      ]
        .filter(Boolean)
        .join(';'),
    },
  };
}

export async function createNativeExecutionEnv(
  cwd: string,
  resourcesRoot: string,
): Promise<NodeExecutionEnv> {
  return new NodeExecutionEnv(await nativeExecutionOptions(cwd, resourcesRoot));
}
