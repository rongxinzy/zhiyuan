import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
};
const MAX_OUTPUT = 1024 * 1024;

/** No shell. Windows cannot execute without the real Job Object owner. */
export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
    jobRunnerPath?: string;
  },
): Promise<ProcessResult> {
  options.signal.throwIfAborted();
  if (process.platform === 'win32') {
    if (!options.jobRunnerPath) throw new Error('The Windows Python Job Object helper is missing.');
    await access(options.jobRunnerPath);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? options.jobRunnerPath! : command,
      process.platform === 'win32' ? [String(process.pid), command, ...args] : args,
      {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '',
      stderr = '',
      bytes = 0,
      truncated = false;
    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const available = Math.max(0, MAX_OUTPUT - bytes);
      bytes += chunk.length;
      if (chunk.length > available) truncated = true;
      const value = chunk.subarray(0, available).toString('utf8');
      if (target === 'stdout') stdout += value;
      else stderr += value;
    };
    child.stdout.on('data', chunk => append('stdout', chunk));
    child.stderr.on('data', chunk => append('stderr', chunk));
    const terminate = () => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32')
          child.kill(); // Closing the helper's handle kills its Job.
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    const abort = () => {
      terminate();
    };
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    child.once('exit', () => {
      if (process.platform !== 'win32') terminate();
    });
    child.once('error', error => {
      options.signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', code => {
      options.signal.removeEventListener('abort', abort);
      // A completed script must not leave detached descendants running.
      terminate();
      if (options.signal.aborted)
        reject(options.signal.reason ?? new Error('Python execution cancelled.'));
      else resolve({ stdout, stderr, exitCode: code ?? 1, truncated });
    });
  });
}

export function isolatedEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'COMSPEC',
    'PATHEXT',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    UV_CACHE_DIR: root,
    UV_NO_CONFIG: '1',
    UV_PYTHON_DOWNLOADS: 'never',
    UV_NO_PROGRESS: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONSAFEPATH: '1',
    PYTHONUTF8: '1',
  };
}

/** Network transport settings reach the trusted downloader/uv only, not user scripts. */
export function runtimeNetworkEnvironment(root: string): NodeJS.ProcessEnv {
  const env = isolatedEnvironment(root);
  for (const key of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.NODE_USE_ENV_PROXY = '1';
  return env;
}
