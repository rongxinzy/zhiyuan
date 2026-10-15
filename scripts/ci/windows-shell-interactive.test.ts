import fs, { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  assertDetachedTransaction,
  assertShellIdentity,
  observeDetachedUpgrade,
  shellChecks,
  shellScreenshots,
} from './windows-shell-evidence.mjs';
import { assertVisibleActions } from './windows-shell-interactive.mjs';

const script = readFileSync('scripts/ci/windows-shell-interactive.mjs', 'utf8');
const native = readFileSync('scripts/ci/windows-shell-native.ps1', 'utf8');
const workflow = readFileSync('.github/workflows/windows-acceptance.yml', 'utf8');
const delivery = readFileSync('scripts/ci/windows-acceptance-install.ps1', 'utf8');

function identity() {
  const expected = {
    commit: 'commit-a',
    runId: 'run-a',
    installerSha256: 'a'.repeat(64),
    installedExecutable: '/runner/shell-installed/app.exe',
  };
  const report = {
    ...expected,
    kind: 'webview2-shell-interactive-acceptance',
    passed: true,
    checks: Object.fromEntries(shellChecks.map(check => [check, true])),
  };
  return { expected, report };
}

function snapshot() {
  return {
    hosted: true,
    dpr: 1.5,
    width: 860,
    height: 560,
    actions: [
      {
        selector: '#btnDone',
        x: 300,
        y: 400,
        width: 100,
        height: 40,
        visible: true,
        textFits: true,
        hit: true,
      },
      {
        selector: '#btnLaunch',
        x: 420,
        y: 400,
        width: 180,
        height: 40,
        visible: true,
        textFits: true,
        hit: true,
      },
    ],
  };
}

describe('final WebView2 shell evidence identity', () => {
  it('accepts only the exact passing shell installer, commit, run and installed app', () => {
    const { report, expected } = identity();
    expect(() => assertShellIdentity(report, expected)).not.toThrow();
    for (const change of [
      { kind: 'nsis-interactive-acceptance' },
      { passed: false },
      { installerSha256: 'b'.repeat(64) },
      { commit: 'other' },
      { runId: 'other' },
      { installedExecutable: '/runner/nsis-installed/app.exe' },
    ])
      expect(() => assertShellIdentity({ ...report, ...change }, expected)).toThrow();
    expect(() => assertShellIdentity(report, { ...expected, commit: '' })).toThrow();
  });

  it('requires a real uncommitted, exact-directory GUID transaction for post-detach rollback proof', () => {
    const root = '/runner/app';
    const state = {
      InstallDir: root,
      BackupDir: `${root}.old.${'a'.repeat(32)}`,
      Committed: false,
    };
    expect(assertDetachedTransaction(state, root)).toBe(state.BackupDir);
    for (const change of [
      { InstallDir: '/runner/other' },
      { BackupDir: `${root}.old.manual` },
      { BackupDir: '/runner/other.old.' + 'a'.repeat(32) },
      { Committed: true },
    ]) {
      expect(() => assertDetachedTransaction({ ...state, ...change }, root)).toThrow();
    }
    expect(script).toContain("item.label === '正在解包应用程序'");
    expect(script).toContain('observeDetachedUpgrade(installRoot)');
    expect(script).toContain(
      'Post-detach rollback did not restore the old application and registration',
    );
    expect(script).toContain('Cancelled detached upgrade did not move its exact backup home');
    expect(script).toContain('.old.manual-acceptance');
    expect(script).toContain('.old.0123456789abcdef0123456789abcdef');
  });

  it('observes journal and detached filesystem state instead of accepting an early progress event', async () => {
    const fixture = fs.mkdtempSync(path.join(tmpdir(), 'shell-detach-observer-'));
    try {
      const install = path.join(fixture, 'app');
      const backup = `${install}.old.${'a'.repeat(32)}`;
      expect(await observeDetachedUpgrade(install)).toBeNull();
      fs.writeFileSync(
        `${install}.setup-state.json`,
        JSON.stringify({ InstallDir: install, BackupDir: backup, Committed: false }),
      );
      expect(await observeDetachedUpgrade(install)).toBeNull();
      fs.mkdirSync(path.join(backup, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(backup, '知远.exe'), 'previous executable fixture');
      fs.writeFileSync(path.join(backup, 'resources/app.asar'), 'previous application fixture');
      expect(await observeDetachedUpgrade(install)).toBeNull();
      fs.mkdirSync(install);
      expect(await observeDetachedUpgrade(install)).toBeNull();
      fs.writeFileSync(path.join(install, 'partial-file'), 'extracting');
      const observed = await observeDetachedUpgrade(install);
      expect(observed.transaction.BackupDir).toBe(backup);
      expect(observed.previousExeBytes).toBeGreaterThan(0);
      expect(observed.partialFiles).toEqual(['partial-file']);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails closed when any actual shell scenario is absent', () => {
    for (const check of shellChecks) {
      const { report, expected } = identity();
      report.checks[check] = false;
      expect(() => assertShellIdentity(report, expected)).toThrow(
        `Missing shell acceptance check: ${check}`,
      );
      expect(script).toContain(`report.checks.${check} = true`);
    }
    expect(shellScreenshots).toContain('missing-webview2');
    expect(shellScreenshots).toContain('fresh-progress');
    expect(shellScreenshots).toContain('fresh-finish');
    expect(shellScreenshots).toContain('launched-installed-app');
  });

  it('checks actual action bounds, text fit, occlusion, overlap and WebView2 host', () => {
    const valid = snapshot();
    expect(() => assertVisibleActions(valid, ['#btnDone', '#btnLaunch'])).not.toThrow();
    for (const change of [
      { visible: false },
      { x: -1 },
      { x: 820 },
      { y: 550 },
      { textFits: false },
      { hit: false },
      { width: 0 },
    ]) {
      const invalid = snapshot();
      Object.assign(invalid.actions[0], change);
      expect(() => assertVisibleActions(invalid, ['#btnDone'])).toThrow();
    }
    const overlap = snapshot();
    overlap.actions[1].x = 350;
    expect(() => assertVisibleActions(overlap, ['#btnDone', '#btnLaunch'])).toThrow(
      'Actions overlap',
    );
    expect(() => assertVisibleActions({ ...valid, hosted: false }, ['#btnDone'])).toThrow();
  });
});

describe('real final shell acceptance driver safeguards', () => {
  it('assembles the real shell before interactive acceptance and keeps delivery success-gated', () => {
    const config = loadYaml(workflow) as {
      jobs: {
        acceptance: {
          steps: Array<{ name?: string; if?: string; run?: string; uses?: string }>;
        };
      };
    };
    const { steps } = config.jobs.acceptance;
    const requiredCommands = [
      'electron-builder --win nsis',
      './scripts/ci/windows-installer-size-smoke.ps1',
      'node scripts/ci/windows-acceptance-resources.cjs verify-package release/win-unpacked',
      'node scripts/ci/windows-acceptance-resources.cjs probe-runtime release/win-unpacked',
      'node scripts/installer-shell/build-shell.cjs',
      'node scripts/installer-shell/pack-setup.cjs',
      './scripts/ci/windows-installer-interactive.ps1',
      './scripts/ci/windows-acceptance-install.ps1 -NativeOnly',
      'node scripts/ci/windows-shell-interactive.mjs',
    ];
    let previous = -1;
    for (const command of requiredCommands) {
      const index = steps.findIndex(step => step.run?.includes(command));
      expect(index, command).toBeGreaterThan(previous);
      expect(steps[index].if, command).toBeUndefined();
      previous = index;
    }
    const appSmoke = steps.findIndex(
      step => step.run === './scripts/ci/windows-acceptance-install.ps1',
    );
    const upload = steps.findIndex(step => step.uses === 'actions/upload-artifact@v4');
    expect(appSmoke).toBeGreaterThan(previous);
    expect(steps[appSmoke].if).toBeUndefined();
    expect(upload).toBeGreaterThan(appSmoke);
    expect(steps[upload].if).toBeUndefined();
    expect(workflow).not.toContain('continue-on-error');
  });

  it('drives real visible UI input and screenshots without synthetic completion shortcuts', () => {
    expect(script).toContain("'Input.dispatchMouseEvent'");
    expect(script).toContain("'Page.captureScreenshot'");
    expect(script).toContain("'page-complete'");
    expect(script).toContain("item.type === 'done'");
    expect(script).toContain("'--acceptance-debug-port'");
    expect(script).toContain("server.listen(0, '127.0.0.1'");
    expect(script).not.toMatch(/['"]--(?:auto-install|capture-preview|payload)['"]/);
    expect(script).not.toMatch(
      /\.evaluate\([^\n]*(?:\.click\(|showPage|hostObjects|handleEngineEvent)/,
    );
    expect(script).not.toContain('page=complete');
    expect(script).not.toContain('freeze=');
    expect(script).toContain("assert.equal(initial.licenseChecked, 'false'");
    expect(script).toContain("'Install must be license-gated'");
    expect(script).toContain("await click(session, '#licenseCheck')");
  });

  it('verifies real missing-runtime failure, cancel safety, OS file-lock recovery and launch recovery', () => {
    expect(script).toMatch(/'--webview2-runtime-path',\s*absentRuntime/);
    expect(script).toContain('Missing WebView2 must not silently install the app');
    expect(native).toContain('[IO.FileShare]::Read');
    expect(script).toContain('Opening/cancelling setup terminated the existing application');
    expect(script).toContain('Failed upgrade changed prior installed bytes or registration');
    expect(script).toContain('Cancelled upgrade did not restore the previous installation');
    expect(script).toContain('Cancelled upgrade falsely claimed completion');
    expect(script).toContain('Installation changed existing user-data sentinels');
    expect(script).toContain("await click(recovery, '#btnRetry')");
    expect(script).toContain('await rename(app, heldApp)');
    expect(script).toContain("item.type === 'launch-error'");
    expect(script).toContain('Launch failure must preserve usable completion page');
    expect(script).toContain('if (await exists(heldApp)) await rename(heldApp, app)');
    expect(native).toContain('InstallerUi]::Capture');
    expect(script).not.toMatch(/\b(?:Set-MpPreference|Add-MpPreference|Defender)\b/);
  });

  it('builds the official shell around real packaged input and delivers only that final artifact', () => {
    expect(workflow).toContain('actions/setup-dotnet@v4');
    expect(workflow).toContain("dotnet-version: '8.0.x'");
    expect(workflow).toContain('node scripts/installer-shell/build-shell.cjs');
    expect(workflow).toContain(
      '--app-dir release/win-unpacked --components-dir build-tar/windows-components',
    );
    expect(workflow).toContain('release/setup/ZhiYuanAgent-Setup-$version-win-x64.exe');
    expect(workflow).toContain('run: ./scripts/ci/windows-acceptance-install.ps1 -NativeOnly');
    expect(
      workflow.indexOf('run: ./scripts/ci/windows-acceptance-install.ps1 -NativeOnly'),
    ).toBeLessThan(workflow.indexOf('run: node scripts/ci/windows-shell-interactive.mjs'));
    expect(workflow.indexOf('run: node scripts/ci/windows-shell-interactive.mjs')).toBeLessThan(
      workflow.lastIndexOf('run: ./scripts/ci/windows-acceptance-install.ps1'),
    );
    expect(delivery).toContain("Join-Path $project 'release/setup'");
    expect(delivery).toContain("'zhiyuan-shell-acceptance/安装路径/知远.exe'");
    expect(delivery).toContain("installerKind='webview2-single-file-shell'");
    expect(
      delivery.indexOf('Real hash-bound WebView2 install/finish/launch evidence is required'),
    ).toBeLessThan(delivery.indexOf("'windows-app-smoke.mjs'"));
    expect(delivery.indexOf('Installed application smoke failed')).toBeLessThan(
      delivery.indexOf('Copy-Item -LiteralPath $installer.FullName'),
    );
    expect(delivery).not.toContain('Copy-Item -LiteralPath $nativeInstaller.FullName');
    expect(workflow).not.toContain('continue-on-error');
  });

  it.skipIf(process.platform !== 'win32')(
    'executes the actual shared component switch and recovery scripts on real Windows junctions',
    () => {
      const fixture = fs.mkdtempSync(path.join(tmpdir(), 'shell-component-recovery-'));
      try {
        const runtime = path.join(fixture, 'runtime[owned] %PATH% !literal! & (cache)');
        const component = path.join(runtime, 'portable-git');
        const oldId = '1'.repeat(64);
        const newId = '2'.repeat(64);
        const oldTarget = path.join(component, oldId);
        const newTarget = path.join(component, newId);
        const plugin = path.join(fixture, 'plugin');
        const resources = path.join(
          fixture,
          'application[owned] %PATH% !literal! & (app)',
          'resources',
        );
        fs.mkdirSync(resources, { recursive: true });
        for (const target of [oldTarget, newTarget, plugin])
          fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(oldTarget, 'preserve.txt'), 'original component data');
        fs.writeFileSync(path.join(newTarget, 'preserve.txt'), 'prepared component data');
        fs.writeFileSync(path.join(newTarget, '.complete'), newId);
        for (const target of [oldTarget, newTarget]) {
          fs.mkdirSync(path.join(target, 'mingit/cmd'), { recursive: true });
          fs.writeFileSync(
            path.join(target, 'mingit/cmd/git.exe'),
            `component:${path.basename(target)}`,
          );
        }
        fs.writeFileSync(path.join(plugin, 'component-portable-git.version'), newId);
        fs.symlinkSync(oldTarget, path.join(component, 'current'), 'junction');
        const manifest = path.join(fixture, 'manifest.json');
        fs.writeFileSync(
          manifest,
          JSON.stringify({
            components: [
              {
                key: 'portable-git',
                prefix: 'mingit',
                sentinel: 'mingit/cmd/git.exe',
                contentId: newId,
              },
            ],
          }),
        );
        const state = path.join(runtime, 'component-switch-state.txt');
        const run = (scriptName: string, args: string[]) => {
          const result = spawnSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-File',
              path.resolve('scripts/installer', scriptName),
              ...args,
            ],
            { encoding: 'utf8', timeout: 30_000 },
          );
          expect(result.error, result.stderr).toBeUndefined();
          expect(result.status, result.stderr || result.stdout).toBe(0);
        };
        run('activate-components.ps1', [
          '-PluginDir',
          plugin,
          '-RuntimeRoot',
          runtime,
          '-ManifestPath',
          manifest,
          '-TargetsPath',
          path.resolve('scripts/nsis-offline-components.json'),
          '-StatePath',
          state,
        ]);
        expect(fs.realpathSync.native(path.join(component, 'current'))).toBe(
          fs.realpathSync.native(newTarget),
        );
        expect(fs.realpathSync.native(path.join(component, 'current.previous'))).toBe(
          fs.realpathSync.native(oldTarget),
        );
        expect(fs.readFileSync(state, 'utf8')).toContain('portable-git|True');
        const linkArguments = [
          '-ResourceRoot',
          resources,
          '-RuntimeRoot',
          runtime,
          '-ManifestPath',
          manifest,
        ];
        run('link-runtime-junctions.ps1', linkArguments);
        expect(fs.lstatSync(path.join(resources, 'mingit')).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync.native(path.join(resources, 'mingit'))).toBe(
          fs.realpathSync.native(path.join(newTarget, 'mingit')),
        );
        // Replacing an existing link must also use literal discovery/removal.
        run('link-runtime-junctions.ps1', linkArguments);
        expect(fs.readFileSync(path.join(resources, 'mingit/cmd/git.exe'), 'utf8')).toBe(
          `component:${newId}`,
        );
        run('recover-component-switch.ps1', ['-RuntimeRoot', runtime]);
        expect(fs.realpathSync.native(path.join(component, 'current'))).toBe(
          fs.realpathSync.native(oldTarget),
        );
        expect(fs.realpathSync.native(path.join(resources, 'mingit'))).toBe(
          fs.realpathSync.native(path.join(oldTarget, 'mingit')),
        );
        expect(fs.readFileSync(path.join(resources, 'mingit/cmd/git.exe'), 'utf8')).toBe(
          `component:${oldId}`,
        );
        for (const removed of [
          state,
          path.join(component, 'current.previous'),
          path.join(component, 'current.next'),
        ])
          expect(fs.existsSync(removed)).toBe(false);
        expect(fs.readFileSync(path.join(oldTarget, 'preserve.txt'), 'utf8')).toBe(
          'original component data',
        );
        expect(fs.readFileSync(path.join(newTarget, 'preserve.txt'), 'utf8')).toBe(
          'prepared component data',
        );
        run('recover-component-switch.ps1', ['-RuntimeRoot', runtime]);
        expect(fs.realpathSync.native(path.join(component, 'current'))).toBe(
          fs.realpathSync.native(oldTarget),
        );
        expect(fs.realpathSync.native(path.join(resources, 'mingit'))).toBe(
          fs.realpathSync.native(path.join(oldTarget, 'mingit')),
        );
        expect(fs.readFileSync(path.join(resources, 'mingit/cmd/git.exe'), 'utf8')).toBe(
          `component:${oldId}`,
        );
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it('keeps both shared junction creation paths literal and avoids interpolating caller paths into shell code', () => {
    const scripts = ['activate-components.ps1', 'link-runtime-junctions.ps1'].map(name =>
      readFileSync(path.join('scripts/installer', name), 'utf8'),
    );
    for (const text of scripts) {
      expect(text).not.toMatch(/New-Item\s+-ItemType\s+Junction/);
      expect(text).toContain(
        '$start.Arguments = \'/d /v:off /c mklink /J "%ZY_JUNCTION_LINK%" "%ZY_JUNCTION_TARGET%"\'',
      );
      expect(text).toContain(
        "$start.EnvironmentVariables['ZY_JUNCTION_LINK'] = [IO.Path]::GetFullPath($LinkPath)",
      );
      expect(text).toContain(
        "$start.EnvironmentVariables['ZY_JUNCTION_TARGET'] = [IO.Path]::GetFullPath($TargetPath)",
      );
      expect(text).toContain('if ($process.ExitCode -ne 0)');
    }
    expect(scripts[1]).toContain('Test-Path -LiteralPath $link');
  });

  it.skipIf(process.platform !== 'win32')('parses the actual native Windows driver', () => {
    const target = path.resolve('scripts/ci/windows-shell-native.ps1').replaceAll("'", "''");
    const command = `$errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${target}', [ref]$null, [ref]$errors); if ($errors.Count) { throw ($errors | Out-String) }`;
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', timeout: 20_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
