import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const projectRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(__dirname, 'validate-offline-components.ps1');
const activationPath = path.join(__dirname, 'activate-components.ps1');
const targetsPath = path.join(projectRoot, 'scripts', 'nsis-offline-components.json');
const sevenZipPath = path.join(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const temporaryDirectories: string[] = [];

type ComponentTarget = { key: string; prefix: string; sentinel: string };

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function runValidator(
  mode: 'cache' | 'expand',
  pluginDir: string,
  runtimeRoot: string,
  options: {
    deepAudit?: boolean;
    targetsPath?: string;
    timingLogPath?: string;
    blockFileHashCmdlet?: boolean;
  } = {},
) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Mode',
    mode,
    '-PluginDir',
    pluginDir,
    '-RuntimeRoot',
    runtimeRoot,
    '-ComponentTargetsPath',
    options.targetsPath ?? targetsPath,
    '-SevenZipPath',
    sevenZipPath,
  ];
  if (options.deepAudit) {
    args.push('-DeepAudit');
  }
  if (options.timingLogPath) args.push('-TimingLogPath', options.timingLogPath);
  if (options.blockFileHashCmdlet) {
    const fileIndex = args.indexOf('-File');
    const invocation = args
      .slice(fileIndex + 1)
      .map((value, index) =>
        index > 0 && value.startsWith('-') ? value : `'${value.replaceAll("'", "''")}'`,
      )
      .join(' ');
    args.splice(
      fileIndex,
      args.length - fileIndex,
      '-Command',
      `function global:Get-FileHash { throw 'Get-FileHash must not be called' }; & ${invocation}; exit $LASTEXITCODE`,
    );
  }
  return spawnSync('powershell.exe', args, { encoding: 'utf8' });
}

function componentId(key: string): string {
  return sha256Hex(Buffer.from(`content-id:${key}`));
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-offline-components-'));
  temporaryDirectories.push(root);
  const pluginDir = path.join(root, 'plugin');
  const runtimeRoot = path.join(root, 'runtimes');
  fs.mkdirSync(pluginDir);
  fs.mkdirSync(runtimeRoot);
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8')) as ComponentTarget[];
  const manifest = {
    components: targets.map(target => ({ ...target, contentId: componentId(target.key) })),
  };
  const manifestPath = path.join(pluginDir, 'component-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const fixtureTargetsPath = path.join(pluginDir, 'component-targets.json');
  fs.writeFileSync(fixtureTargetsPath, JSON.stringify(targets));

  for (const target of targets) {
    const id = componentId(target.key);
    const sentinelRelative = target.sentinel.replace(/\\/g, '/');
    const staging = path.join(root, 'staging', target.key);
    const sentinelPath = path.join(staging, sentinelRelative);
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    const sentinelContent = Buffer.from(`sentinel:${target.key}`);
    fs.writeFileSync(sentinelPath, sentinelContent);
    const extraPath = path.join(staging, target.prefix, 'extra.txt');
    fs.mkdirSync(path.dirname(extraPath), { recursive: true });
    fs.writeFileSync(extraPath, `extra:${target.key}`);

    const archivePath = path.join(pluginDir, `component-${target.key}.7z`);
    const archived = spawnSync(sevenZipPath, ['a', '-t7z', archivePath, target.prefix], {
      cwd: staging,
      encoding: 'utf8',
    });
    expect(archived.status, archived.stderr || archived.stdout).toBe(0);

    fs.writeFileSync(path.join(pluginDir, `component-${target.key}.version`), id);
    fs.writeFileSync(
      path.join(pluginDir, `component-${target.key}.sha256`),
      sha256Hex(fs.readFileSync(archivePath)),
    );
    fs.writeFileSync(
      path.join(pluginDir, `component-${target.key}.sentinel-sha256`),
      sha256Hex(sentinelContent),
    );
  }

  return { pluginDir, runtimeRoot, targets, manifest, manifestPath, fixtureTargetsPath };
}

function runActivation(fixture: ReturnType<typeof makeFixture>) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      activationPath,
      '-PluginDir',
      fixture.pluginDir,
      '-RuntimeRoot',
      fixture.runtimeRoot,
      '-ManifestPath',
      fixture.manifestPath,
      '-TargetsPath',
      fixture.fixtureTargetsPath,
      '-StatePath',
      path.join(fixture.runtimeRoot, 'component-switch-state.txt'),
    ],
    { encoding: 'utf8' },
  );
}

function expandFixture(fixture: ReturnType<typeof makeFixture>) {
  const expanded = runValidator('expand', fixture.pluginDir, fixture.runtimeRoot);
  expect(expanded.status, expanded.stderr || expanded.stdout).toBe(0);
  for (const target of fixture.targets) {
    expect(expanded.stdout).toContain(`expanded:${target.key}`);
  }
}

function targetDir(fixture: ReturnType<typeof makeFixture>, key: string): string {
  return path.join(fixture.runtimeRoot, key, componentId(key));
}

function toExtendedPath(target: string): string {
  // The \\?\ prefix lets node fs create trees deeper than MAX_PATH regardless
  // of the machine-wide LongPathsEnabled setting.
  return target.startsWith('\\\\?\\') ? target : `\\\\?\\${target}`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('installer validators enforce the current exact component set and preserve failure reasons', () => {
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8')) as ComponentTarget[];
  expect(targets).toEqual([
    { key: 'portable-git', prefix: 'mingit', sentinel: 'mingit\\usr\\bin\\bash.exe' },
  ]);
  for (const script of [scriptPath, activationPath]) {
    const source = fs.readFileSync(script, 'utf8');
    expect(source).toContain("$expectedKeys = @('portable-git')");
    expect(source).toContain('no missing, duplicate or unknown components');
    expect(source).toContain('mingit/usr/bin/bash.exe');
    expect(source).not.toMatch(/(?:Count\s+-ne\s+7|expected 7 components)/);
  }
  const validator = fs.readFileSync(scriptPath, 'utf8');
  expect(validator.indexOf('$modeStartedAt = Get-Date')).toBeLessThan(
    validator.indexOf('$components = Get-Components'),
  );
  expect(validator).toContain('reason=$message');
  expect(validator).toContain('Stop-WithCode 1 $message');
});

describe.skipIf(process.platform !== 'win32')('offline component cache validator', () => {
  test('hashes actual expanded and cached bytes without the Get-FileHash cmdlet', () => {
    const fixture = makeFixture();
    const expanded = runValidator('expand', fixture.pluginDir, fixture.runtimeRoot, {
      blockFileHashCmdlet: true,
    });
    expect(expanded.status, expanded.stderr || expanded.stdout).toBe(0);
    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot, {
      blockFileHashCmdlet: true,
    });
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);
    expect(cached.stdout).toContain('cache-hit:portable-git');
    const sentinel = path.join(targetDir(fixture, 'portable-git'), 'mingit/usr/bin/bash.exe');
    fs.appendFileSync(sentinel, 'tampered');
    const rejected = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot, {
      blockFileHashCmdlet: true,
    });
    expect(rejected.status, rejected.stderr || rejected.stdout).toBe(0);
    expect(rejected.stdout).not.toContain('cache-hit:');
    expect(fs.existsSync(path.join(fixture.pluginDir, 'component-portable-git.cache-valid'))).toBe(
      false,
    );
  });

  test('rejects a bad expected sentinel hash without the Get-FileHash cmdlet', () => {
    const fixture = makeFixture();
    fs.writeFileSync(
      path.join(fixture.pluginDir, 'component-portable-git.sentinel-sha256'),
      '0'.repeat(64),
    );
    const rejected = runValidator('expand', fixture.pluginDir, fixture.runtimeRoot, {
      blockFileHashCmdlet: true,
    });
    expect(rejected.status).toBe(5);
    expect(rejected.stdout).toContain('sentinel-mismatch:portable-git');
    expect(fs.existsSync(path.join(targetDir(fixture, 'portable-git'), '.complete'))).toBe(false);
  });

  test('the actual NSIS 7za hash expression matches SHA256 without module autoload', () => {
    const fixture = makeFixture();
    const bytes = Buffer.from('NSIS hash fixture\0\xff');
    fs.writeFileSync(path.join(fixture.pluginDir, '7za.exe'), bytes);
    const installer = fs.readFileSync(path.join(projectRoot, 'scripts/nsis-installer.nsh'), 'utf8');
    const line = installer
      .split('\n')
      .find(value => value.includes('$$hasher.ComputeHash($$stream)'));
    const expression = line?.match(/-Command "(.*)"'$/)?.[1];
    expect(expression).toBeTruthy();
    const command = expression!
      .replaceAll('$PLUGINSDIR', fixture.pluginDir)
      .replaceAll('$$', '$')
      .replaceAll('\\"', '"');
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `function global:Get-FileHash { throw 'Get-FileHash must not be called' }; ${command}`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout.trim()).toBe(sha256Hex(bytes));
  });

  test('activates the actual single-component manifest after verified expansion', () => {
    const fixture = makeFixture();
    expandFixture(fixture);
    const result = runActivation(fixture);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const current = path.join(fixture.runtimeRoot, 'portable-git', 'current');
    expect(fs.lstatSync(current).isSymbolicLink()).toBe(true);
    // Resolve 8.3 aliases as well as junctions before checking the exact target.
    expect(fs.realpathSync.native(current)).toBe(
      fs.realpathSync.native(targetDir(fixture, 'portable-git')),
    );
  });

  test.each(['missing', 'duplicate', 'unknown', 'prefix', 'sentinel'])(
    'rejects %s component targets before creating cache or activation state',
    kind => {
      const fixture = makeFixture();
      let targets = fixture.targets.map(target => ({ ...target }));
      if (kind === 'missing') targets = [];
      else if (kind === 'duplicate') targets.push({ ...targets[0] });
      else if (kind === 'unknown') targets[0].key = 'retired-python';
      else if (kind === 'prefix') targets[0].prefix = 'wrong';
      else targets[0].sentinel = 'mingit/wrong.exe';
      fs.writeFileSync(fixture.fixtureTargetsPath, JSON.stringify(targets));
      const timingLogPath = path.join(fixture.pluginDir, 'failure.log');
      const result = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot, {
        targetsPath: fixture.fixtureTargetsPath,
        timingLogPath,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Invalid component target');
      expect(fs.readFileSync(timingLogPath, 'utf8')).toContain('phase=validator-failed');
      expect(fs.readFileSync(timingLogPath, 'utf8')).toContain('reason=Invalid component target');
      const activation = runActivation(fixture);
      expect(activation.status).not.toBe(0);
      expect(fs.existsSync(path.join(fixture.runtimeRoot, 'component-switch-state.txt'))).toBe(
        false,
      );
    },
  );

  test.each(['missing', 'duplicate', 'unknown', 'content-id', 'sentinel'])(
    'rejects a %s manifest component before activation',
    kind => {
      const fixture = makeFixture();
      const manifest = fixture.manifest;
      if (kind === 'missing') manifest.components = [];
      else if (kind === 'duplicate') manifest.components.push({ ...manifest.components[0] });
      else if (kind === 'unknown') manifest.components[0].key = 'retired-python';
      else if (kind === 'content-id') manifest.components[0].contentId = '0'.repeat(64);
      else manifest.components[0].sentinel = 'mingit/wrong.exe';
      fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest));
      const result = runActivation(fixture);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/(?:Invalid component manifest|Component manifest .*mismatch)/);
      expect(fs.existsSync(path.join(fixture.runtimeRoot, 'component-switch-state.txt'))).toBe(
        false,
      );
    },
  );

  test('expand publishes a measured completion record that cache mode accepts', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    for (const target of fixture.targets) {
      const completePath = path.join(targetDir(fixture, target.key), '.complete');
      const record = fs.readFileSync(completePath, 'utf8').trim();
      const fields = record.split('|');
      expect(fields).toHaveLength(4);
      expect(fields[0]).toBe(componentId(target.key));
      expect(Number.parseInt(fields[2], 10)).toBeGreaterThan(0);
      expect(Number.parseInt(fields[3], 10)).toBeGreaterThan(0);
    }

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);
    for (const target of fixture.targets) {
      expect(cached.stdout).toContain(`cache-hit:${target.key}`);
      expect(
        fs.existsSync(path.join(fixture.pluginDir, `component-${target.key}.cache-valid`)),
      ).toBe(true);
    }
  });

  test('deep audit measures component trees with paths longer than 260 characters', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    const victim = fixture.targets[0];
    const victimDir = targetDir(fixture, victim.key);
    // Exercise deeply nested runtime payloads whose full
    // path under %LOCALAPPDATA% exceeds MAX_PATH and crashed the previous
    // Get-ChildItem based measurement on machines without LongPathsEnabled.
    let deepDirectory = path.join(victimDir, victim.prefix, 'deep');
    while (deepDirectory.length < 300) {
      deepDirectory = path.join(deepDirectory, 'aaaaaaaa');
    }
    const extendedDeepDirectory = toExtendedPath(deepDirectory);
    fs.mkdirSync(extendedDeepDirectory, { recursive: true });
    const addedFiles = ['leaf-one.txt', 'leaf-two.txt'];
    let addedBytes = 0;
    for (const name of addedFiles) {
      const content = Buffer.from(`deep:${name}`);
      fs.writeFileSync(`${extendedDeepDirectory}\\${name}`, content);
      addedBytes += content.length;
    }

    // Keep the completion record consistent with the tree on disk so cache
    // validation depends on the measurement succeeding rather than failing.
    const completePath = path.join(victimDir, '.complete');
    const fields = fs.readFileSync(completePath, 'utf8').trim().split('|');
    fields[2] = String(Number.parseInt(fields[2], 10) + addedFiles.length);
    fields[3] = String(Number.parseInt(fields[3], 10) + addedBytes);
    fs.writeFileSync(completePath, fields.join('|'));

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot, {
      deepAudit: true,
    });
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);
    expect(cached.stdout).toContain(`cache-hit:${victim.key}`);
  });

  test('the default cache path accepts a tree with a missing non-sentinel file', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    // Out-of-band tampering (a deleted payload file) is what the deep audit
    // exists for; the default path must stay cheap and accept the component,
    // because re-walking every file on every upgrade costs minutes with
    // real-time scanners enabled.
    const victim = fixture.targets[0];
    const victimDir = targetDir(fixture, victim.key);
    fs.rmSync(path.join(victimDir, victim.prefix, 'extra.txt'));

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);
    expect(cached.stdout).toContain(`cache-hit:${victim.key}`);
  });

  test('deep audit rejects a component tree left incomplete by an interrupted move', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    const victim = fixture.targets[0];
    const victimDir = targetDir(fixture, victim.key);
    fs.rmSync(path.join(victimDir, victim.prefix, 'extra.txt'));

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot, {
      deepAudit: true,
    });
    expect(cached.status).toBe(0);
    expect(cached.stdout).not.toContain(`cache-hit:${victim.key}`);
    expect(cached.stdout).not.toContain('cache-hit:');
    expect(fs.existsSync(path.join(fixture.pluginDir, `component-${victim.key}.cache-valid`))).toBe(
      false,
    );
  });

  test('cache mode rejects a completion record without measured entries', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    const victim = fixture.targets[0];
    const id = componentId(victim.key);
    fs.writeFileSync(
      path.join(targetDir(fixture, victim.key), '.complete'),
      `${id}|${sha256Hex(Buffer.from('legacy'))}`,
    );

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status).toBe(0);
    expect(cached.stdout).not.toContain(`cache-hit:${victim.key}`);
    expect(cached.stdout).not.toContain('cache-hit:');
  });

  test('cache mode removes a stale installing directory next to a valid target', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    const key = fixture.targets[0].key;
    const stale = `${targetDir(fixture, key)}.installing`;
    fs.mkdirSync(path.join(stale, 'leftover'), { recursive: true });

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);
    expect(cached.stdout).toContain(`cache-hit:${key}`);
    expect(fs.existsSync(stale)).toBe(false);
  });

  test('expand re-extracts a component whose cached target was corrupted', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    // Mirror the installer flow: cache validation marks every component as
    // reusable before expand runs and skips the marked ones.
    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);

    const victim = fixture.targets[0];
    const root = temporaryDirectories[temporaryDirectories.length - 1];
    fs.rmSync(path.join(fixture.pluginDir, `component-${victim.key}.cache-valid`));
    fs.rmSync(targetDir(fixture, victim.key), { recursive: true, force: true });

    const staging = path.join(root, 'restaging');
    const sentinelPath = path.join(staging, victim.sentinel.replace(/\\/g, '/'));
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    fs.writeFileSync(sentinelPath, `sentinel:${victim.key}`);
    const archivePath = path.join(fixture.pluginDir, `component-${victim.key}.7z`);
    const archived = spawnSync(sevenZipPath, ['a', '-t7z', archivePath, victim.prefix], {
      cwd: staging,
      encoding: 'utf8',
    });
    expect(archived.status, archived.stderr || archived.stdout).toBe(0);
    fs.writeFileSync(
      path.join(fixture.pluginDir, `component-${victim.key}.sha256`),
      sha256Hex(fs.readFileSync(archivePath)),
    );

    const reexpanded = runValidator('expand', fixture.pluginDir, fixture.runtimeRoot);
    expect(reexpanded.status, reexpanded.stderr || reexpanded.stdout).toBe(0);
    expect(reexpanded.stdout).toContain(`expanded:${victim.key}`);
    expect(reexpanded.stdout.match(/expanded:/g)).toHaveLength(1);
    expect(
      fs.existsSync(path.join(targetDir(fixture, victim.key), victim.sentinel.replace(/\\/g, '/'))),
    ).toBe(true);
  });
});
