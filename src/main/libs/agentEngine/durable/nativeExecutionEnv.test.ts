import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { ExecutionError } from '@earendil-works/pi-durable/env';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { nativeCodingTools, nativeExecutionOptions } from './nativeExecutionEnv';
import {
  nativeSmokeBudgets,
  diagnoseWindowsPowerShell,
  runNativeExecutionSmoke,
} from './nativeExecutionSmoke';

const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zhiyuan-native-env-'));
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test('Windows registers upstream powershell instead of bash and retains native filesystem tools', () => {
  expect(nativeCodingTools('win32').tools?.map(tool => tool.name)).toEqual([
    'read',
    'write',
    'edit',
    'powershell',
  ]);
  expect(nativeCodingTools('linux')).toBe(CodingTools);
  expect(nativeCodingTools('darwin')).toBe(CodingTools);
});

test('Windows has no Bash dependency or shell override and keeps Git and default PowerShell discoverable', async () => {
  const root = await fixture();
  const inherited = {
    Path: 'C:\\Program Files\\PowerShell\\7;C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
  };
  const before = { ...inherited };
  const options = await nativeExecutionOptions(root, root, 'win32', inherited);
  expect(options).not.toHaveProperty('shellPath');
  expect(options.shellEnv).toEqual({
    PATH: [
      join(root, 'mingit', 'cmd'),
      inherited.Path,
      join(inherited.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(';'),
  });
  expect(inherited).toEqual(before);
});

test('other platforms retain native Pi default environment', async () => {
  expect(await nativeExecutionOptions('/workspace', '/nonexistent', 'linux', {})).toEqual({
    cwd: '/workspace',
  });
});

test.skipIf(process.platform === 'win32')(
  'actual Unix Harness still executes original bash through the factory and approval wrapper',
  async () => {
    const root = await fixture();
    const progress = vi.fn();
    const result = await runNativeExecutionSmoke(root, root, undefined, undefined, progress);
    expect(result).toMatchObject({ passed: true, tool: 'bash', approvals: 1 });
    expect(result.output).toContain('zhiyuan-native-bash-中文');
    expect(result.output).toContain(root);
    expect(progress.mock.calls.map(([value]) => value.stage)).toEqual([
      'started',
      'tool_started',
      'exec_started',
      'exec_returned',
      'tool_returned',
      'native_settled',
      'closed',
    ]);
    const returned = progress.mock.calls.find(([value]) => value.stage === 'tool_returned')![0];
    expect(JSON.parse(returned.detail).structuredOutput.exitCode).toBe(0);
    expect(returned.case).toBe('basic');
    expect(returned.elapsedMs).toBeGreaterThanOrEqual(0);
  },
);

test('unchanged upstream powershell tries pwsh first and falls back only on a spawn failure', async () => {
  const tool = nativeCodingTools('win32').tools!.find(tool => tool.name === 'powershell')!;
  const exec = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: new ExecutionError('spawn_error', 'pwsh missing') })
    .mockResolvedValue({ ok: true, value: { exitCode: 0 } });
  const api = {
    env: { cwd: 'workspace', exec },
    output: vi.fn(),
    retainedOutput: () => ({ text: 'native', truncated: false }),
    diagnostic: vi.fn(),
  } as unknown as ToolExecutionApi;
  await tool.execute({ command: 'Write-Output native' }, api, BACKGROUND_CONTEXT);
  expect(exec.mock.calls.map(call => call[0][0])).toEqual(['pwsh', 'powershell']);
  expect(exec.mock.calls[0][0]).toContain('-NoProfile');
  expect(exec.mock.calls[0][0].at(-1)).toContain('Write-Output native');
  exec.mockReset().mockResolvedValue({ ok: true, value: { exitCode: 17 } });
  const result = await tool.execute({ command: 'exit 17' }, api, BACKGROUND_CONTEXT);
  expect(exec).toHaveBeenCalledOnce();
  expect(exec.mock.calls[0][0][0]).toBe('pwsh');
  expect(result).toMatchObject({ isError: true, structuredOutput: { exitCode: 17 } });
});

test('failed native case diagnostic uses absolute official PowerShell and only varies Electron flag', async () => {
  const root = await fixture();
  const report = vi.fn();
  const launch = vi.fn((_program, _args, _options) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.emit('data', 'native-direct-enter\n5.1');
      child.emit('close', 0, null);
    });
    return child;
  });
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
  try {
    await diagnoseWindowsPowerShell(root, root, report, launch as unknown as typeof spawn);
    expect(launch).toHaveBeenCalledTimes(2);
    const [first, second] = launch.mock.calls;
    expect(first[0]).toMatch(/WindowsPowerShell[\\/]v1.0[\\/]powershell.exe$/);
    expect(first[1].slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
    ]);
    expect(first[1]).toEqual(second[1]);
    expect(first[2].stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(first[2].env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(second[2].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    const { ELECTRON_RUN_AS_NODE: _flag, ...rest } = first[2].env;
    expect(second[2].env).toEqual(rest);
    expect(report.mock.calls.map(([event]) => event.stage)).toEqual([
      'started',
      'closed',
      'started',
      'closed',
    ]);
    expect(JSON.parse(report.mock.calls[1][0].detail)).toMatchObject({
      code: 0,
      timedOut: false,
      output: 'native-direct-enter\n5.1',
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

test('direct PowerShell diagnostics retain the 20 second bound and close timed-out children', async () => {
  const root = await fixture();
  const report = vi.fn();
  const children: Array<EventEmitter & { kill: ReturnType<typeof vi.fn> }> = [];
  const launch = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(() => {
        child.emit('close', null, 'SIGTERM');
        return true;
      }),
    });
    children.push(child);
    return child;
  });
  vi.useFakeTimers();
  try {
    const pending = diagnoseWindowsPowerShell(
      root,
      root,
      report,
      launch as unknown as typeof spawn,
    );
    await vi.advanceTimersByTimeAsync(19_999);
    expect(children).toHaveLength(1);
    expect(children[0].kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(children[0].kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    await pending;
    expect(children[1].kill).toHaveBeenCalledOnce();
    expect(
      report.mock.calls
        .filter(([event]) => event.stage === 'closed')
        .every(([event]) => JSON.parse(event.detail).timedOut),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('5.1 launch budget does not relax cancellation after the child is ready', () => {
  expect(nativeSmokeBudgets(5)).toEqual({
    commandSeconds: 60,
    childReadyMs: 60_000,
    childExitMs: 10_000,
  });
  for (const major of [7, undefined]) {
    expect(nativeSmokeBudgets(major)).toEqual({
      commandSeconds: 20,
      childReadyMs: 15_000,
      childExitMs: 10_000,
    });
  }
});
