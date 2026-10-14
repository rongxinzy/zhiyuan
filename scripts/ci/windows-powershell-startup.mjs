#!/usr/bin/env node
// Diagnostic only. Does not replace or relax native installed acceptance.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isolatedEnvironment } from './windows-smoke-environment.mjs';

export function observeStartup({ executable, env, cwd, label }, launch = spawn) {
  const started = Date.now();
  const result = {
    label,
    executable,
    electronNodeFlag: env.ELECTRON_RUN_AS_NODE === '1',
    firstOutputMs: null,
    output: '',
    timedOut: false,
  };
  return new Promise((resolve, reject) => {
    // No ExecutionPolicy flag: this is a fixed inline expression, no script file.
    const child = launch(
      executable,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Write-Output 'native-direct-enter'; $PSVersionTable.PSVersion.ToString()",
      ],
      {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const timeout = setTimeout(() => {
      result.timedOut = true;
      child.kill();
    }, 90_000);
    const cleanupTimeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${label}: child did not close after termination`));
    }, 95_000);
    const output = chunk => {
      result.firstOutputMs ??= Date.now() - started;
      result.output = (result.output + String(chunk)).slice(-4000);
    };
    child.stdout?.on('data', output);
    child.stderr?.on('data', output);
    child.once('error', error => {
      result.error = error.message;
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(cleanupTimeout);
      Object.assign(result, { code, signal, elapsedMs: Date.now() - started });
      console.log(`[PowerShellStartup] ${JSON.stringify(result)}`);
      resolve(result);
    });
  });
}

export async function diagnoseStartup(outputDirectory) {
  if (process.platform !== 'win32') throw new Error('Windows diagnostic only');
  await mkdir(outputDirectory, { recursive: true });
  const root = await mkdtemp(path.join(os.tmpdir(), 'zhiyuan-ps-startup-'));
  const profiles = await Promise.all(
    ['a', 'b'].map(async name => {
      const cwd = path.join(root, name);
      const env = isolatedEnvironment(cwd);
      await Promise.all(
        [cwd, env.APPDATA, env.LOCALAPPDATA, env.TEMP].map(directory =>
          mkdir(directory, { recursive: true }),
        ),
      );
      return { cwd, env };
    }),
  );
  const executable = path.join(
    profiles[0].env.SystemRoot || profiles[0].env.WINDIR,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const standardKeys = [
    'ProgramFiles',
    'ProgramW6432',
    'CommonProgramFiles',
    'PSModulePath',
    'USERDOMAIN',
  ];
  const present = (env, key) =>
    Object.keys(env).some(name => name.toUpperCase() === key.toUpperCase());
  const report = {
    kind: 'diagnostic-only-not-acceptance',
    // Presence only: never dump inherited variables or credential-bearing paths.
    standardVariablePresence: Object.fromEntries(
      standardKeys.map(key => [
        key,
        {
          host: present(process.env, key),
          isolated: present(profiles[0].env, key),
        },
      ]),
    ),
    results: [],
  };
  // Paired fresh profiles share machine-level cold state; crossover removes
  // the previous sequential flag-removal/third-launch confounder.
  for (const round of [0, 1]) {
    const results = await Promise.all(
      profiles.map(({ cwd, env }, index) => {
        const flag = index === round;
        return observeStartup({
          executable,
          cwd,
          env: { ...env, ...(flag ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
          label: `profile-${index}-round-${round}-${flag ? 'flag' : 'no-flag'}`,
        });
      }),
    );
    report.results.push(...results);
    await writeFile(
      path.join(outputDirectory, 'powershell-startup.json'),
      JSON.stringify(report, null, 2),
    );
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' } } });
  await diagnoseStartup(path.resolve(values.output || 'build-tar/powershell-startup')).catch(
    error => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
