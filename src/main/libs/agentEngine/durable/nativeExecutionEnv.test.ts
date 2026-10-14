import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { nativeExecutionOptions } from './nativeExecutionEnv';
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

test('Windows selects shipped Bash and prefixes only its toolchain without mutating process environment', async () => {
  const root = await fixture();
  await mkdir(join(root, 'mingit/bin'), { recursive: true });
  await mkdir(join(root, 'mingit/usr/bin'), { recursive: true });
  await writeFile(join(root, 'mingit/bin/bash.exe'), 'fixture only, never executed');
  await writeFile(join(root, 'mingit/usr/bin/bash.exe'), 'fixture only, never executed');
  const inherited = {
    Path: 'C:\\Windows\\System32',
    LANG: 'old',
    CLAUDE_CODE_GIT_BASH_PATH: 'C:\\unrelated\\bash.exe',
  };
  const options = await nativeExecutionOptions(root, root, 'win32', inherited);
  expect(options.shellPath).toBe(join(root, 'mingit/bin/bash.exe'));
  expect(options.shellEnv).toEqual({
    PATH: [
      join(root, 'mingit/cmd'),
      join(root, 'mingit/bin'),
      join(root, 'mingit/usr/bin'),
      inherited.Path,
    ].join(';'),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  });
  expect(inherited).toEqual({
    Path: 'C:\\Windows\\System32',
    LANG: 'old',
    CLAUDE_CODE_GIT_BASH_PATH: 'C:\\unrelated\\bash.exe',
  });
});

test('Windows uses alternate shipped layout and fails clearly if package is missing', async () => {
  const root = await fixture();
  await expect(
    nativeExecutionOptions(root, root, 'win32', { PATH: 'C:\\system-git' }),
  ).rejects.toThrow('bundled PortableGit Bash is missing');
  await mkdir(join(root, 'mingit/usr/bin'), { recursive: true });
  await writeFile(join(root, 'mingit/usr/bin/bash.exe'), 'fixture only, never executed');
  expect((await nativeExecutionOptions(root, root, 'win32', {})).shellPath).toBe(
    join(root, 'mingit/usr/bin/bash.exe'),
  );
});

test('other platforms retain native Pi default shell behavior', async () => {
  expect(await nativeExecutionOptions('/workspace', '/nonexistent', 'linux', {})).toEqual({
    cwd: '/workspace',
  });
});

test.skipIf(process.platform === 'win32')(
  'real native Harness executes original CodingTools bash through the product factory and approval wrapper',
  async () => {
    const root = await fixture();
    const result = await runNativeExecutionSmoke(root, root);
    expect(result).toMatchObject({ passed: true, tool: 'bash', approvals: 1 });
    expect(result.output).toContain('zhiyuan-native-bash-中文');
    expect(result.output).toContain(root);
  },
);
