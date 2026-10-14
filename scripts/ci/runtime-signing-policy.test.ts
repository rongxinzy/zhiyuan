import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.resolve(__dirname, '../..');

test('architecture gate accepts the current desktop runtime boundaries', () => {
  const filename = readdirSync(__dirname).find(name => name.endsWith('decoupling.mjs'));
  expect(filename).toBeDefined();
  const result = spawnSync(process.execPath, [path.join(__dirname, filename!)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});

function read(filename: string): string {
  return readFileSync(path.join(root, filename), 'utf8');
}

test('Windows packaging does not require runtime signature verification or public signer configuration', () => {
  for (const filename of [
    'build-platforms.yml',
    'windows-installer-pr.yml',
    'release-candidate.yml',
    'online-update-release.yml',
  ]) {
    const file = `.github/workflows/${filename}`;
    if (!existsSync(path.join(root, file))) continue;
    expect(read(file)).not.toMatch(/verify-windows-runtime-signatures|RUNTIME_SIGNER_THUMBPRINT/);
  }
  expect(existsSync(path.join(root, '.github/workflows/runtime-signature-gate.yml'))).toBe(false);
});

test('package smoke retains component hashes and runtime presence checks without Authenticode', () => {
  const smoke = read('scripts/ci/windows-runtime-smoke.ps1');
  expect(smoke).not.toMatch(
    /Assert-WindowsRuntimeSignature|Get-AuthenticodeSignature|runtime-authenticode/,
  );
  expect(smoke).toContain('SHA-256 mismatch for Windows component');
  expect(smoke).toContain('Sentinel SHA-256 mismatch');
  expect(smoke).toContain("'mingit\\usr\\bin\\bash.exe'");
  expect(smoke).toContain("$env:ELECTRON_RUN_AS_NODE = '1'");
});

test('cold installation and cache-hit upgrade retain runtime existence and component checks', () => {
  const smoke = read('scripts/ci/windows-installer-smoke.ps1');
  expect(smoke).not.toContain('verify-windows-runtime-signatures');
  expect(smoke).toContain("$componentKeys = @('portable-git')");
  expect(smoke).toContain('phase=component-cache-hit');
  expect(smoke).toContain('phase=component-cache-miss');
  expect(smoke).toContain('Wait-ForUninstallCompletion $installRoot $runtimeRoot');
});

test('desktop signing has no external memory executable exception', () => {
  const config = JSON.parse(read('electron-builder.json')) as { win: { signExts?: string[] } };
  expect(config.win.signExts).toBeUndefined();
});
