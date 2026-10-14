import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { ExecutionError } from '@earendil-works/pi-durable/env';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { nativeCodingTools, nativeExecutionOptions } from './nativeExecutionEnv';
import { runNativeExecutionSmoke } from './nativeExecutionSmoke';

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
