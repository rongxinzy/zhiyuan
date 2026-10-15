import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const scriptPath = path.join(__dirname, 'uninstall-cleanup.ps1');
const source = fs.readFileSync(scriptPath, 'utf8');
const temporaryDirectories: string[] = [];
const versionId = 'a'.repeat(64);

function sentinel(directory: string, content = 'preserve user data') {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'keep.txt');
  fs.writeFileSync(file, content);
  return file;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-uninstall-cleanup-'));
  temporaryDirectories.push(root);
  const installDir = path.join(root, 'app [private] & files');
  const runtimeRoot = path.join(root, 'runtimes [private] & files');
  const componentRoot = path.join(runtimeRoot, 'portable-git');
  const versionRoot = path.join(componentRoot, versionId);
  const resources = path.join(installDir, 'resources');
  sentinel(path.join(versionRoot, 'mingit'));
  fs.writeFileSync(path.join(versionRoot, '.complete'), `${versionId}|archive|1|18`);
  fs.mkdirSync(resources, { recursive: true });
  fs.symlinkSync(versionRoot, path.join(componentRoot, 'current'), 'junction');
  fs.symlinkSync(versionRoot, path.join(componentRoot, 'current.next'), 'junction');
  fs.symlinkSync(versionRoot, path.join(componentRoot, 'current.previous'), 'junction');
  fs.symlinkSync(path.join(versionRoot, 'mingit'), path.join(resources, 'mingit'), 'junction');
  return { root, installDir, runtimeRoot, componentRoot, versionRoot, resources };
}

function runCleanup(data: ReturnType<typeof createFixture>, installDir = data.installDir) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-InstallDir',
      installDir,
      '-RuntimeRoot',
      data.runtimeRoot,
    ],
    { encoding: 'utf8' },
  );
}

async function waitUntil(check: () => boolean) {
  const deadline = Date.now() + 15_000;
  while (!check() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  expect(check(), 'asynchronous owned-version cleanup did not finish').toBe(true);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('uninstall cleanup never sweeps unknown runtimes, detached backups or retired caches', () => {
  expect(source).toContain("Join-Path $RuntimeRoot 'portable-git'");
  expect(source).toContain("($completion -split '\\|', 2)[0] -cne $version.Name");
  expect(source).not.toContain('runtime-packs');
  expect(source).not.toContain('$env:COMSPEC');
  expect(source).not.toContain('.uninstall.*');
  expect(source).not.toContain('.old*');
  expect(source).not.toMatch(/Get-ChildItem[^\r\n]*-LiteralPath \$RuntimeRoot/);
  expect(source).not.toMatch(/Remove-Item[^\r\n]*-Recurse/);
  expect(source).toContain("$version + '.uninstall.' + [Guid]::NewGuid().ToString('n')");
});

test('validates all cleanup roots before mutation and never follows nested links', () => {
  expect(source.indexOf('Assert-PhysicalDirectoryPath $componentRoot')).toBeLessThan(
    source.indexOf('[IO.Directory]::Delete($pointer)'),
  );
  const remover = source.slice(source.indexOf('function Remove-TreeWithoutFollowingLinks'));
  expect(remover.indexOf('ReparsePoint')).toBeLessThan(remover.indexOf('Get-ChildItem'));
  expect(source).toContain('[IO.Directory]::Delete($root)');
  expect(source).toContain('$env:ZY_UNINSTALL_COMPONENT_TARGETS | ConvertFrom-Json');
  const applicationWalker = source.slice(
    source.indexOf('function Remove-ApplicationLinks'),
    source.indexOf('# Validate every parent'),
  );
  expect(applicationWalker.indexOf('ReparsePoint')).toBeLessThan(
    applicationWalker.indexOf('Get-ChildItem'),
  );
  expect(applicationWalker).not.toContain('catch');
  expect(source.indexOf('Assert-PhysicalDirectoryPath $componentRoot')).toBeLessThan(
    source.indexOf('  Remove-ApplicationLinks $InstallDir'),
  );
  expect(source.indexOf('  Remove-ApplicationLinks $InstallDir')).toBeLessThan(
    source.indexOf('Rename-Item -LiteralPath $version'),
  );
});

describe.skipIf(process.platform !== 'win32')('uninstall cleanup on Windows', () => {
  test('reclaims owned versions and empty roots from an already-detached shell install', async () => {
    const data = createFixture();
    const detachedInstall = `${data.installDir}.uninstall.${'b'.repeat(32)}`;
    fs.renameSync(data.installDir, detachedInstall);
    const applicationFile = sentinel(detachedInstall, 'application owned by caller');
    const result = runCleanup(data, detachedInstall);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    await waitUntil(() => !fs.existsSync(data.runtimeRoot));
    expect(fs.existsSync(path.join(detachedInstall, 'resources', 'mingit'))).toBe(false);
    expect(fs.readFileSync(applicationFile, 'utf8')).toBe('application owned by caller');
  });

  test('unlinks the entire application tree before recursive removal without touching external targets', async () => {
    const data = createFixture();
    const externalRoot = path.join(data.root, 'external-user-data');
    const externalFile = sentinel(externalRoot);
    const nestedTarget = path.join(data.root, 'external-nested-data');
    const nestedFile = sentinel(nestedTarget);
    const outsideLink = path.join(externalRoot, 'untouched-link');
    fs.symlinkSync(nestedTarget, outsideLink, 'junction');
    const nestedDirectory = path.join(data.installDir, 'application', 'nested');
    const ordinaryFile = sentinel(nestedDirectory);
    const appLinks = [
      path.join(data.installDir, 'user-link'),
      path.join(nestedDirectory, 'nested-user-link'),
    ];
    for (const link of appLinks) fs.symlinkSync(externalRoot, link, 'junction');
    const result = runCleanup(data);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    for (const link of appLinks) expect(fs.existsSync(link)).toBe(false);
    expect(fs.readFileSync(ordinaryFile, 'utf8')).toBe('preserve user data');
    expect(fs.lstatSync(outsideLink).isSymbolicLink()).toBe(true);
    // The caller can now recursively remove ordinary application files;
    // neither an immediate nor deeply nested link remains to expose user data.
    fs.rmSync(data.installDir, { recursive: true });
    expect(fs.readFileSync(externalFile, 'utf8')).toBe('preserve user data');
    expect(fs.readFileSync(nestedFile, 'utf8')).toBe('preserve user data');
    expect(fs.lstatSync(outsideLink).isSymbolicLink()).toBe(true);
    await waitUntil(() => !fs.existsSync(data.runtimeRoot));
  });

  test('unlinks a resources-root junction without entering its target', async () => {
    const data = createFixture();
    const outside = `${data.resources}-outside`;
    fs.renameSync(data.resources, outside);
    const preserved = sentinel(outside);
    fs.symlinkSync(outside, data.resources, 'junction');
    const result = runCleanup(data);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.existsSync(data.resources)).toBe(false);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('preserve user data');
    // Its mingit link is inside the external target and must not be unlinked.
    expect(fs.lstatSync(path.join(outside, 'mingit')).isSymbolicLink()).toBe(true);
    await waitUntil(() => !fs.existsSync(data.runtimeRoot));
  });

  test('propagates application traversal errors before detaching any runtime version', () => {
    const data = createFixture();
    const wrapper = path.join(data.root, 'deny-app-enumeration.ps1');
    fs.writeFileSync(
      wrapper,
      `
function Get-ChildItem {
  [CmdletBinding()]
  param([string]$LiteralPath, [switch]$Directory, [switch]$Force)
  if ([IO.Path]::GetFullPath($LiteralPath) -eq [IO.Path]::GetFullPath($env:TEST_INSTALL_ROOT)) {
    throw 'injected application traversal denial'
  }
  Microsoft.PowerShell.Management\\Get-ChildItem @PSBoundParameters
}
& $env:TEST_CLEANUP_SCRIPT -InstallDir $env:TEST_INSTALL_ROOT -RuntimeRoot $env:TEST_RUNTIME_ROOT
`,
    );
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TEST_INSTALL_ROOT: data.installDir,
          TEST_RUNTIME_ROOT: data.runtimeRoot,
          TEST_CLEANUP_SCRIPT: scriptPath,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('injected application traversal denial');
    expect(fs.existsSync(path.join(data.versionRoot, '.complete'))).toBe(true);
    expect(fs.lstatSync(path.join(data.componentRoot, 'current')).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(data.resources, 'mingit')).isSymbolicLink()).toBe(true);
  });

  test('retains unknown data, historical backups and external junction targets', async () => {
    const data = createFixture();
    const userRoot = path.join(data.root, 'user-data');
    const externalFile = sentinel(userRoot);
    fs.symlinkSync(userRoot, path.join(data.versionRoot, 'mingit', 'user-link'), 'junction');
    const unknownComponent = path.join(data.runtimeRoot, 'retired-runtime');
    fs.mkdirSync(unknownComponent);
    fs.symlinkSync(userRoot, path.join(unknownComponent, 'current'), 'junction');
    const unknownHash = 'c'.repeat(64);
    const manualBackup = `${versionId}.uninstall.${'d'.repeat(32)}`;
    const preserved = [
      userRoot,
      path.join(data.runtimeRoot, 'notes'),
      path.join(data.componentRoot, 'notes'),
      path.join(data.componentRoot, unknownHash),
      path.join(data.componentRoot, manualBackup),
      `${data.runtimeRoot}.uninstall.12345`,
      `${data.runtimeRoot}.uninstall.${'e'.repeat(32)}`,
      `${data.installDir}.old.${'f'.repeat(32)}`,
      path.join(data.root, 'runtime-packs'),
      path.join(data.root, 'runtime-packs.uninstall.12345'),
    ].map(directory => sentinel(directory));
    const result = runCleanup(data);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const expectedNames = [manualBackup, unknownHash, 'notes'].sort();
    await waitUntil(
      () =>
        JSON.stringify(fs.readdirSync(data.componentRoot).sort()) === JSON.stringify(expectedNames),
    );
    for (const file of preserved) expect(fs.readFileSync(file, 'utf8')).toBe('preserve user data');
    expect(fs.readFileSync(externalFile, 'utf8')).toBe('preserve user data');
    expect(fs.lstatSync(path.join(unknownComponent, 'current')).isSymbolicLink()).toBe(true);
  });

  test('preserves hash-shaped versions with a mismatched completion record', async () => {
    const data = createFixture();
    const otherRoot = path.join(data.componentRoot, 'b'.repeat(64));
    const preserved = sentinel(otherRoot);
    fs.writeFileSync(path.join(otherRoot, '.complete'), `${versionId}|archive|1|18`);
    const result = runCleanup(data);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    await waitUntil(() => fs.readdirSync(data.componentRoot).length === 1);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('preserve user data');
    expect(fs.existsSync(path.join(otherRoot, '.complete'))).toBe(true);
  });

  test('preserves hash-shaped junctions without inspecting their external completion record', async () => {
    const data = createFixture();
    const id = 'b'.repeat(64);
    const outside = path.join(data.root, 'outside-version');
    const preserved = sentinel(outside);
    fs.writeFileSync(path.join(outside, '.complete'), `${id}|archive|1|18`);
    const link = path.join(data.componentRoot, id);
    fs.symlinkSync(outside, link, 'junction');
    const result = runCleanup(data);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    await waitUntil(() => fs.readdirSync(data.componentRoot).length === 1);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('preserve user data');
  });

  test.each(['runtime', 'component', 'application'])(
    'rejects a redirected %s root before unlinking any application resources',
    target => {
      const data = createFixture();
      const redirected =
        target === 'runtime'
          ? data.runtimeRoot
          : target === 'component'
            ? data.componentRoot
            : data.installDir;
      const outside = `${redirected}-outside`;
      fs.renameSync(redirected, outside);
      fs.symlinkSync(outside, redirected, 'junction');
      const preserved = sentinel(outside);
      const result = runCleanup(data);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unsafe uninstall cleanup directory link');
      expect(fs.lstatSync(path.join(data.resources, 'mingit')).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(preserved, 'utf8')).toBe('preserve user data');
      expect(fs.lstatSync(redirected).isSymbolicLink()).toBe(true);
    },
  );
});
