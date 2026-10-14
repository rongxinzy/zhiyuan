import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';

/** Product and package acceptance use the same native environment construction.
 * Windows ships PortableGit; never silently select an unrelated system shell. */
export async function nativeExecutionOptions(
  cwd: string,
  resourcesRoot: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ConstructorParameters<typeof NodeExecutionEnv>[0]> {
  if (platform !== 'win32') return { cwd };
  const gitRoot = join(resourcesRoot, 'mingit');
  const candidates = [join(gitRoot, 'bin', 'bash.exe'), join(gitRoot, 'usr', 'bin', 'bash.exe')];
  let shellPath: string | undefined;
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        shellPath = candidate;
        break;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (!shellPath)
    throw new Error(
      'The bundled PortableGit Bash is missing. Repair the application installation.',
    );
  const inheritedPath = Object.entries(environment).find(
    ([key]) => key.toUpperCase() === 'PATH',
  )?.[1];
  return {
    cwd,
    shellPath,
    shellEnv: {
      PATH: [join(gitRoot, 'cmd'), join(gitRoot, 'bin'), join(gitRoot, 'usr', 'bin'), inheritedPath]
        .filter(Boolean)
        .join(';'),
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
  };
}

export async function createNativeExecutionEnv(
  cwd: string,
  resourcesRoot: string,
): Promise<NodeExecutionEnv> {
  return new NodeExecutionEnv(await nativeExecutionOptions(cwd, resourcesRoot));
}
