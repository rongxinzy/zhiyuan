import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  isolatedEnvironment,
  assertPythonResult,
  assertMagpieStatus,
  runPythonProbe,
  runNativeBashProbe,
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
  expect(source).toContain("getByRole('button', { name: /^(Close|关闭)$/ }).click()");
  expect(source).toContain("'app.asar', 'dist-electron', 'python-runtime-runner.js'");
  expect(source.indexOf('report.passed = true')).toBeGreaterThan(
    source.indexOf('assertPythonResult(response, manifest)'),
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

test('native Bash smoke uses the installed entry and product factory request, never an absolute shell probe', async () => {
  const f = runnerFixture();
  const runnerPath = 'C:\\installed\\resources\\app.asar\\dist-electron\\native-execution-smoke.js';
  const pending = runNativeBashProbe(
    { ...f.options, runnerPath, resourcesRoot: 'C:\\installed\\resources' },
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
  });
  f.child.emit('message', { success: true, result: { passed: true } });
  f.child.emit('exit', 0, null);
  await expect(pending).resolves.toMatchObject({ success: true });
});
