import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const scriptPath = path.join(__dirname, 'windows-installer-diagnostics.ps1');
const script = fs.readFileSync(scriptPath, 'utf8');
const temporaryDirectories: string[] = [];

test('collects only allowlisted installer files without profile enumeration or environment mutation', () => {
  for (const folder of ['ApplicationData', 'LocalApplicationData', 'CommonApplicationData']) {
    expect(script).toContain(
      `[Environment]::GetFolderPath([Environment+SpecialFolder]::${folder})`,
    );
  }
  for (const filename of [
    'install-timing.log',
    'install-start-tick.txt',
    'component-switch-state.txt',
  ]) {
    expect(script).toContain(filename);
  }
  expect(script).not.toMatch(/Get-ChildItem|-Recurse|Get-ItemProperty|GetEnvironmentVariables/);
  expect(script).not.toMatch(/\$env:\w+\s*=/);
  expect(script).toContain("'zhiyuan-acceptance-installed'");
});

test('bounds reads and requires fresh files plus the latest owned run marker', () => {
  expect(script).toContain('$item.LastWriteTimeUtc -lt $startedUtc');
  expect(script).toContain('Read-FreshTail $logPath 1048576');
  expect(script).toContain('$lastStart = $i');
  expect(script).toContain('$runRoot -ieq $InstallRoot');
  expect(script).toContain('$lines[$lastStart..($lines.Count - 1)]');
  expect(script).toContain('$tickText.Trim() -ceq $tick');
  expect(script).toContain('if ($ownedRunFound)');
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-installer-diagnostics-'));
  temporaryDirectories.push(root);
  const installRoot = path.join(root, 'zhiyuan-acceptance-installed');
  const profile = path.join(root, 'profile');
  const logRoot = path.join(profile, 'ZhiYuanAgent');
  const timing = path.join(logRoot, 'install-timing.log');
  const state = path.join(logRoot, 'runtimes', 'component-switch-state.txt');
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.mkdirSync(installRoot);
  const marker = `phase=run-start tick_ms=123 mode=silent instdir=${installRoot}`;
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  return { root, installRoot, profile, logRoot, timing, state, marker, startedAt };
}

function runCollector(
  fixture: ReturnType<typeof createFixture>,
  installRoot = fixture.installRoot,
) {
  const result = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      scriptPath,
      '-ProjectRoot',
      fixture.root,
      '-InstallRoot',
      installRoot,
      '-StartedAt',
      fixture.startedAt,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_TEMP: fixture.root,
        APPDATA: fixture.profile,
        LOCALAPPDATA: fixture.profile,
        PROGRAMDATA: fixture.profile,
      },
    },
  );
  const output = path.join(fixture.root, 'acceptance-diagnostics');
  const files = fs.existsSync(output)
    ? fs
        .readdirSync(output)
        .map(name => ({ name, text: fs.readFileSync(path.join(output, name), 'utf8') }))
    : [];
  return { result, files };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'win32')(
  'Windows installer diagnostics fixtures (no installation)',
  () => {
    test('exports only the latest owned run and its matching tick and protocol state', () => {
      const fixture = createFixture();
      fs.writeFileSync(
        fixture.timing,
        `phase=run-start tick_ms=1 mode=silent instdir=C:\\old\nOLD_PRIVATE_TEXT\n${fixture.marker}\nphase=expand-failed\n`,
      );
      fs.writeFileSync(path.join(fixture.logRoot, 'install-start-tick.txt'), '123');
      fs.writeFileSync(fixture.state, 'portable-git|False\r\n');
      const { result, files } = runCollector(fixture);

      expect(result.status, result.stderr).toBe(0);
      expect(files.find(file => file.name.startsWith('installer-timing-'))?.text).toBe(
        `${fixture.marker}\nphase=expand-failed\n`,
      );
      expect(files.some(file => file.name.startsWith('installer-start-tick-'))).toBe(true);
      expect(files.some(file => file.name.startsWith('installer-component-switch-state-'))).toBe(
        true,
      );
      expect(files.map(file => file.text).join('\n')).not.toContain('OLD_PRIVATE_TEXT');
    });

    test.each(['stale', 'different-latest-run', 'missing-marker', 'oversized-run'])(
      'does not export unowned or unprovable timing content: %s',
      scenario => {
        const fixture = createFixture();
        let text = `${fixture.marker}\nPRIVATE_TEXT\n`;
        if (scenario === 'different-latest-run') {
          text += 'phase=run-start tick_ms=456 mode=silent instdir=C:\\other\nPRIVATE_TEXT\n';
        } else if (scenario === 'missing-marker') {
          text = 'PRIVATE_TEXT\n';
        } else if (scenario === 'oversized-run') {
          text += 'x'.repeat(1048577);
        }
        fs.writeFileSync(fixture.timing, text);
        fs.writeFileSync(fixture.state, 'portable-git|True');
        if (scenario === 'stale') fs.utimesSync(fixture.timing, new Date(0), new Date(0));
        const { result, files } = runCollector(fixture);

        expect(result.status, result.stderr).toBe(0);
        expect(files).toHaveLength(1);
        expect(JSON.parse(files[0].text).ownedRunFound).toBe(false);
        expect(files[0].text).not.toContain('PRIVATE_TEXT');
      },
    );

    test('omits mismatched start ticks and arbitrary component-state content', () => {
      const fixture = createFixture();
      fs.writeFileSync(fixture.timing, `${fixture.marker}\nphase=failed\n`);
      fs.writeFileSync(path.join(fixture.logRoot, 'install-start-tick.txt'), '999');
      fs.writeFileSync(fixture.state, 'PRIVATE_TEXT');
      const { result, files } = runCollector(fixture);

      expect(result.status, result.stderr).toBe(0);
      expect(files.filter(file => file.name !== 'installer-summary.json')).toHaveLength(1);
      expect(files.map(file => file.text).join('\n')).not.toContain('PRIVATE_TEXT');
    });

    test('rejects an install directory outside the exact acceptance directory', () => {
      const fixture = createFixture();
      const { result, files } = runCollector(fixture, path.join(fixture.root, 'other'));

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('CI-owned');
      expect(files).toHaveLength(0);
    });
  },
);
