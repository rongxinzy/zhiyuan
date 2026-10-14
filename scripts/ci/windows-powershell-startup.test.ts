import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { observeStartup } from './windows-powershell-startup.mjs';

test('cold startup gets 90 seconds and records first output independently of exit', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  const launch = vi.fn(() => child);
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const pending = observeStartup(
      {
        executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        env: { ELECTRON_RUN_AS_NODE: '1' },
        cwd: 'isolated',
        label: 'cold',
      },
      launch,
    );
    expect(launch.mock.calls[0][1]).not.toContain('-ExecutionPolicy');
    expect(launch.mock.calls[0][2].stdio).toEqual(['ignore', 'pipe', 'pipe']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.kill).not.toHaveBeenCalled();
    child.stdout.emit('data', 'native-direct-enter');
    await vi.advanceTimersByTimeAsync(1000);
    child.emit('close', 0, null);
    await expect(pending).resolves.toMatchObject({
      firstOutputMs: 60_000,
      elapsedMs: 61_000,
      timedOut: false,
      code: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    log.mockRestore();
  }
});

test('90 second diagnostic timeout terminates fixed child and waits for close', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => {
      child.emit('close', null, 'SIGTERM');
      return true;
    }),
  });
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const pending = observeStartup(
      { executable: 'powershell.exe', env: {}, cwd: 'isolated', label: 'timeout' },
      () => child,
    );
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(pending).resolves.toMatchObject({
      timedOut: true,
      firstOutputMs: null,
      elapsedMs: 90_000,
    });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    log.mockRestore();
  }
});
