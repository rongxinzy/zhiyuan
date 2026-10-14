import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  isolatedEnvironment,
  assertPythonResult,
  assertMagpieStatus,
  runPythonProbe,
  runNativeShellProbe,
  deadline,
} from './windows-app-smoke.mjs';

const manifest = { id: 'pinned-runtime', pythonVersion: '3.12.15' };
const successful = () => ({
  success: true,
  result: {
    exitCode: 0,
    stderr: '',
    truncated: false,
    runtimeId: manifest.id,
    environmentId: 'actual-venv',
    stdout: JSON.stringify({ value: 42, version: manifest.pythonVersion, isolated: true }),
  },
});
afterEach(() => vi.useRealTimers());

test('fresh Windows profile excludes host credentials, tool paths and startup overrides', () => {
  const env = isolatedEnvironment('C:\\Temp\\isolated', {
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\user-python;C:\\user-git',
    HOME: 'C:\\real-user',
    APPDATA: 'C:\\real-user',
    USERPROFILE: 'C:\\real-user',
    OPENAI_API_KEY: 'not-a-real-key',
    ANTHROPIC_API_KEY: 'not-a-real-key',
    NODE_OPTIONS: '--require evil.js',
    ELECTRON_START_URL: 'https://invalid.example',
    ELECTRON_RUN_AS_NODE: '1',
    ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH: 'external',
  });
  expect(env.PATH).toBe('C:\\Windows\\System32;C:\\Windows');
  expect(env.HOME).toBe('C:\\Temp\\isolated');
  expect(env.USERPROFILE).toBe(env.HOME);
  for (const key of [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'NODE_OPTIONS',
    'ELECTRON_START_URL',
    'ELECTRON_RUN_AS_NODE',
    'ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH',
  ]) {
    expect(env).not.toHaveProperty(key);
  }
  for (const key of [
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA',
  ])
    expect(env[key]).toContain(env.HOME);
  expect(() => isolatedEnvironment('x', {})).toThrow('SystemRoot');
});

test('Python gate requires real zero exit, pinned interpreter/runtime and venv calculation', () => {
  expect(assertPythonResult(successful(), manifest).exitCode).toBe(0);
  expect(() =>
    assertPythonResult({ success: false, error: 'missing Job helper' }, manifest),
  ).toThrow('missing Job helper');
  for (const patch of [
    { exitCode: 1 },
    { truncated: true },
    { runtimeId: 'system-python' },
    { environmentId: '' },
    { stdout: '42' },
    { stdout: JSON.stringify({ value: 42, version: '3.13.0', isolated: true }) },
    { stdout: JSON.stringify({ value: 42, version: manifest.pythonVersion, isolated: false }) },
  ]) {
    expect(() =>
      assertPythonResult(
        { ...successful(), result: { ...successful().result, ...patch } },
        manifest,
      ),
    ).toThrow();
  }
});

test('Magpie gate rejects failed, account-enabled, wrong version or remote gateway', () => {
  const status = {
    state: 'running',
    version: 'pinned',
    subscriptionAccountsEnabled: false,
    gatewayUrl: 'http://127.0.0.1:12345',
  };
  expect(() => assertMagpieStatus(status, 'pinned')).not.toThrow();
  for (const patch of [
    { state: 'failed' },
    { version: 'other' },
    { subscriptionAccountsEnabled: true },
    { gatewayUrl: 'https://127.0.0.1' },
    { gatewayUrl: 'http://example.com' },
  ]) {
    expect(() => assertMagpieStatus({ ...status, ...patch }, 'pinned')).toThrow();
  }
});

function runnerFixture() {
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    stderr: new EventEmitter(),
    send: vi.fn((_message: unknown, callback: (error?: Error) => void) => callback()),
    kill: vi.fn(),
  });
  const spawn = vi.fn(() => child);
  const options = {
    executablePath: 'C:\\installed\\知远.exe',
    runnerPath: 'C:\\installed\\resources\\app.asar\\dist-electron\\python-runtime-runner.js',
    jobRunnerPath: 'C:\\installed\\resources\\python-runtime\\job-runner.exe',
    root: 'C:\\isolated',
    env: { SystemRoot: 'C:\\Windows' },
    timeoutMs: 100,
  };
  return { child, spawn, options };
}

test('probe forks installed Electron and Runner with real IPC, waits for exit', async () => {
  const f = runnerFixture();
  const pending = runPythonProbe(f.options, f.spawn);
  expect(f.spawn).toHaveBeenCalledWith(
    f.options.runnerPath,
    [],
    expect.objectContaining({
      execPath: f.options.executablePath,
      execArgv: [],
      env: { ...f.options.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    }),
  );
  expect(f.child.send.mock.calls[0][0]).toMatchObject({
    operation: 'execute',
    jobRunnerPath: f.options.jobRunnerPath,
    storageRoot: path.join(f.options.root, 'python-runtime'),
    input: {
      workspace: f.options.root,
      code: expect.stringContaining('sys.prefix != sys.base_prefix'),
    },
  });
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  f.child.emit('message', successful());
  await Promise.resolve();
  expect(settled).toBe(false);
  f.child.emit('exit', 0, null);
  await expect(pending).resolves.toEqual(successful());
});

test('a reported result followed by abnormal Runner exit does not pass', async () => {
  const f = runnerFixture();
  const pending = runPythonProbe(f.options, f.spawn);
  f.child.emit('message', successful());
  f.child.emit('exit', 1, null);
  await expect(pending).rejects.toThrow('Runner exited');
});

test('hung Runner is cancelled then killed so its real Job owner can reap children', async () => {
  vi.useFakeTimers();
  const f = runnerFixture();
  const pending = runPythonProbe(f.options, f.spawn);
  const rejected = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(100);
  expect(f.child.send).toHaveBeenLastCalledWith({ cancel: true }, expect.any(Function));
  await vi.advanceTimersByTimeAsync(1500);
  expect(f.child.kill).toHaveBeenCalledOnce();
  f.child.emit('exit', null, 'SIGTERM');
  await rejected;
});

test('unresponsive main/sidecar evaluation is bounded', async () => {
  vi.useFakeTimers();
  const pending = deadline(new Promise(() => {}), 100, 'main health');
  const rejected = expect(pending).rejects.toThrow('main health timed out');
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
});

test('installed smoke has no disabled sandbox, security exclusions or success artifact shortcut', () => {
  const source = readFileSync(new URL('./windows-app-smoke.mjs', import.meta.url), 'utf8');
  expect(source).not.toMatch(
    /--no-sandbox|Add-MpPreference|ExclusionPath|setSubscriptionAccounts\(true\)/,
  );
  expect(source).toContain("getByTestId('sidebar-new-conversation')");
  expect(source).toContain("'installed-ui.png'");
  expect(source).toContain("'installed-initial-settings.png'");
  expect(source.replace(/\n\s*/g, '')).toContain(
    "locator('form').getByRole('button', { name: /^(Close|关闭)$/ }).click()",
  );
  expect(source).toContain("'app.asar', 'dist-electron', 'python-runtime-runner.js'");
  const installedFlow = source.slice(source.indexOf('export async function runSmoke'));
  expect(installedFlow.indexOf('report.passed = true')).toBeGreaterThan(
    installedFlow.indexOf('assertPythonResult(response, manifest)'),
  );
  expect(source).toContain('magpieRuntime.verifyRuntime');
  expect(source).toContain('assert.equal(afterHash, beforeHash)');
});

test('clean Runner exit without an IPC result cannot pass the Python phase', async () => {
  const f = runnerFixture();
  const pending = runPythonProbe(f.options, f.spawn);
  f.child.emit('exit', 0, null);
  await expect(pending).rejects.toThrow('Runner exited');
});

test.each([7, 5])(
  'native PowerShell %s smoke uses the installed entry and product factory request',
  async major => {
    const f = runnerFixture();
    const runnerPath =
      'C:\\installed\\resources\\app.asar\\dist-electron\\native-execution-smoke.js';
    const pending = runNativeShellProbe(
      {
        ...f.options,
        runnerPath,
        resourcesRoot: 'C:\\installed\\resources',
        expectedPowerShellMajor: major,
      },
      f.spawn,
    );
    expect(f.spawn).toHaveBeenCalledWith(
      runnerPath,
      [],
      expect.objectContaining({ execPath: f.options.executablePath }),
    );
    expect(f.child.send.mock.calls[0][0]).toEqual({
      cwd: f.options.root,
      resourcesRoot: 'C:\\installed\\resources',
      expectedPowerShellMajor: major,
    });
    f.child.emit('message', { success: true, result: { passed: true } });
    f.child.emit('exit', 0, null);
    await expect(pending).resolves.toMatchObject({ success: true });
  },
);

test('installed paths are canonicalized without weakening identity assertions', () => {
  const source = readFileSync(new URL('./windows-app-smoke.mjs', import.meta.url), 'utf8');
  expect(source).toContain('await realpath(state.userData)');
  expect(source).toContain('await realpath(env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA)');
  expect(source).toContain('await realpath(state.appPath)');
  expect(source).toContain("await realpath(path.join(resources, 'app.asar'))");
});

test('isolated Windows environment preserves command discovery without inheriting custom executable extensions', () => {
  const env = isolatedEnvironment('C:\\isolated', {
    systemroot: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    Path: 'C:\\user-tools',
    PATHEXT: '.EXE;.UNTRUSTED',
    PRIVATE_TOKEN: 'not-a-real-token',
  });
  expect(env.SystemRoot).toBe('C:\\Windows');
  expect(env.COMSPEC).toBe('C:\\Windows\\System32\\cmd.exe');
  expect(env.PATHEXT).toBe('.COM;.EXE;.BAT;.CMD');
  expect(Object.keys(env).filter(key => key.toUpperCase() === 'PATH')).toEqual(['PATH']);
  expect(Object.keys(env).filter(key => key.toUpperCase() === 'COMSPEC')).toEqual(['COMSPEC']);
  expect(env).not.toHaveProperty('PRIVATE_TOKEN');
});

test.skipIf(process.platform !== 'win32')(
  'real PowerShell command discovery needs PATHEXT even when System32 is on PATH',
  () => {
    const env = isolatedEnvironment(process.env.TEMP!, process.env);
    const pwsh = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'PowerShell',
      '7',
      'pwsh.exe',
    );
    const command =
      "$ErrorActionPreference='Stop'; (Get-Command whoami -CommandType Application -ErrorAction Stop).Name";
    const withoutExtensions = { ...env };
    delete withoutExtensions.PATHEXT;
    const before = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', command], {
      env: withoutExtensions,
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(before.error).toBeUndefined();
    expect(before.status).not.toBe(0);
    const after = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', command], {
      env,
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(after.error).toBeUndefined();
    expect(after.status, after.stderr).toBe(0);
    expect(after.stdout.trim().toLowerCase()).toBe('whoami.exe');
  },
);

test('native case progress is delivered immediately and cannot replace a final result', async () => {
  const f = runnerFixture();
  const onProgress = vi.fn();
  const pending = runNativeShellProbe({ ...f.options, onProgress }, f.spawn);
  const progress = {
    case: 'basic',
    stage: 'tool_returned',
    elapsedMs: 12,
    detail: '{"structuredOutput":{"exitCode":0}}',
  };
  f.child.emit('message', { type: 'native-smoke-progress', progress });
  expect(onProgress).toHaveBeenCalledWith(progress);
  f.child.emit('message', { success: false, error: 'basic failure' });
  f.child.emit('message', {
    type: 'native-smoke-progress',
    progress: { ...progress, stage: 'closed' },
  });
  f.child.emit('exit', 0, null);
  await expect(pending).resolves.toEqual({ success: false, error: 'basic failure' });
});

test('progress-only Runner exit never passes as a terminal success response', async () => {
  const f = runnerFixture();
  const pending = runNativeShellProbe({ ...f.options, onProgress: vi.fn() }, f.spawn);
  f.child.emit('message', {
    type: 'native-smoke-progress',
    progress: { case: 'worktree', stage: 'started', elapsedMs: 0 },
  });
  f.child.emit('exit', 0, null);
  await expect(pending).rejects.toThrow('Runner exited');
});

test.each([
  [5, 360_000],
  [7, 120_000],
])('native suite budget for PowerShell %s remains bounded', async (major, budget) => {
  vi.useFakeTimers();
  const f = runnerFixture();
  const pending = runNativeShellProbe({ ...f.options, expectedPowerShellMajor: major }, f.spawn);
  const rejected = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(budget - 1);
  expect(f.child.send).not.toHaveBeenCalledWith({ cancel: true }, expect.any(Function));
  await vi.advanceTimersByTimeAsync(1);
  expect(f.child.send).toHaveBeenLastCalledWith({ cancel: true }, expect.any(Function));
  f.child.emit('exit', null, 'SIGTERM');
  await rejected;
});
