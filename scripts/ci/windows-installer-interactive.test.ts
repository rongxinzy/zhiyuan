import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const scriptPath = path.join(__dirname, 'windows-installer-interactive.ps1');
const helperPath = path.join(__dirname, 'windows-installer-ui.cs');
const script = readFileSync(scriptPath, 'utf8');
const helper = readFileSync(helperPath, 'utf8');
const workflow = readFileSync('.github/workflows/windows-acceptance.yml', 'utf8');
const delivery = readFileSync('scripts/ci/windows-acceptance-install.ps1', 'utf8');

describe('real interactive NSIS acceptance safeguards', () => {
  it('drives visible real controls and never advances the completed progress page itself', () => {
    expect(script).toContain(
      'Start-Process -FilePath $installer.FullName -ArgumentList "/LANGUAGE=$Language /D=$installRoot"',
    );
    expect(script).not.toMatch(/-ArgumentList[^\r\n]*\/S\b/);
    const progress = script.slice(
      script.indexOf('function Wait-ForProgressAndFinish'),
      script.indexOf('function Wait-InstallerExit'),
    );
    expect(progress).toContain("$_.ClassName -eq 'msctls_progress32' -and $_.Visible");
    expect(progress).toContain('automatic transition from progress to actionable finish page');
    expect(progress).not.toContain('::Click(');
    expect(helper).toContain('!control.Visible || !control.Enabled');
    expect(helper).toContain('PostMessage(window, 0x00F5');
    expect(helper).not.toContain('0x0111'); // No direct wizard WM_COMMAND shortcut.
  });

  it('captures actual windows, records real DPI and fails closed without an interactive desktop', () => {
    expect(helper).toContain('PrintWindow(window, dc, 2)');
    expect(helper).toContain('Window capture is blank');
    expect(helper).toContain('Dpi = GetDpiForWindow(window)');
    expect(script).toContain('$script:wizard.Dpi -ne $ExpectedDpi');
    expect(helper).toContain('Action is clipped by the wizard');
    expect(helper).toContain('Action text does not fit at');
    expect(script).toContain("throw 'Finish actions overlap'");
    expect(script).toContain("Save-Page 'launched-installed-app'");
    expect(script).not.toMatch(
      /Defender|Add-MpPreference|Set-MpPreference|Set-WinUILanguageOverride/,
    );
    expect(workflow).not.toContain('continue-on-error');
  });

  it('checks existing-install cancellation against live process, bytes and registration', () => {
    for (const assertion of [
      'Opening/cancelling setup terminated the existing application',
      'Cancelling setup changed the existing installation bytes',
      'Cancelling setup changed the existing installation registration',
      'Cancelling setup detached the existing installation',
    ]) {
      expect(script).toContain(assertion);
    }
    expect(script).toContain('Get-Button -Id 2).Handle');
    expect(script).toContain('$runningApp.HasExited');
    expect(script).toContain("'resources/app.asar'");
    expect(script).not.toMatch(/\$env:(?:USERPROFILE|APPDATA|LOCALAPPDATA|HOME)\s*=/);
  });

  it('induces and recovers from a real filesystem sharing violation', () => {
    expect(script).toContain('[IO.FileShare]::Read)');
    expect(script).toContain('recoverable locked-directory Retry/Cancel dialog');
    expect(script).toContain(
      'Committed reinstall did not stop the existing application before retry',
    );
    const release = script.indexOf(
      '$fileLock.Dispose()',
      script.indexOf("Save-Page 'recovery-locked-directory'"),
    );
    const retry = script.indexOf('::Click((Get-Button -Id 4');
    expect(release).toBeGreaterThan(0);
    expect(release).toBeLessThan(retry);
    expect(script).toContain("Wait-ForProgressAndFinish 'recovery'");
    expect(script).toContain('$report.checks.lockedDirectoryRetry = $true');
  });

  it('retains hash-bound NSIS interactive proof before its separate silent regression', () => {
    for (const check of [
      'freshInstall',
      'closeWithoutLaunch',
      'cancelPreservesRunningInstallation',
      'lockedDirectoryRetry',
      'launchFailureRecovery',
      'finishLaunchesInstalledApplication',
      'visibleActionsFitActualDpi',
      'chineseAndEnglish',
    ]) {
      expect(delivery).toContain(`'${check}'`);
      expect(script).toContain(`$report.checks.${check} = $true`);
    }
    expect(delivery).toContain('$interactive.installerSha256 -ne $nativeHash');
    expect(delivery).toContain('$interactive.commit -ne $env:GITHUB_SHA');
    expect(delivery).toContain('$interactive.runId -ne $env:GITHUB_RUN_ID');
    expect(
      delivery.indexOf('Real interactive installer acceptance evidence is required'),
    ).toBeLessThan(delivery.indexOf('Start-Process -FilePath $nativeInstaller.FullName'));
    expect(workflow.indexOf('run: ./scripts/ci/windows-installer-interactive.ps1')).toBeLessThan(
      workflow.indexOf('run: ./scripts/ci/windows-acceptance-install.ps1'),
    );
    expect(workflow).toContain('run: ./scripts/ci/windows-installer-size-smoke.ps1');
    expect(workflow).toContain("- 'scripts/nsis-installer.nsh'");
    expect(workflow).toContain("- 'tests/nsis-installer.test.ts'");
    expect(delivery).toContain('windows-app-smoke.mjs');
  });

  it('preserves Chinese source text under Windows PowerShell 5.1', () => {
    expect(readFileSync(scriptPath).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(script).toContain('我已阅读并同意许可协议');
    expect(script).toContain('安装路径');
    expect(script).toContain('Start-Installer -Language 2052');
    expect(script).toContain('Start-Installer -Language 1033');
    expect(script).toContain('The real installer did not display the requested language');
    expect(workflow).toContain('shell: powershell');
  });

  it('keeps a failed launch recoverable and restores the CI-owned executable even on failure', () => {
    expect(script).toContain('Move-Item -LiteralPath $app -Destination $launchBackup');
    expect(script).toContain('real failed-launch error dialog');
    expect(script).toContain('usable finish page after launch failure');
    expect(script).toContain('Launch failure closed the installer instead of allowing recovery');
    expect(script).toMatch(
      /finally\s*\{[\s\S]*Move-Item -LiteralPath \$launchBackup -Destination \$app/,
    );
    expect(script).toContain('$report.checks.launchFailureRecovery = $true');
  });

  it('reads the actual separate NSIS registration keys and preserves original failures during cleanup', () => {
    expect(script).toContain("$value.PSObject.Properties['UninstallString']");
    expect(script).toContain('[IO.Path]::GetFullPath($uninstallers[0].FullName)');
    expect(script).toContain(
      '$registeredUninstaller = [IO.Path]::GetFullPath($registeredUninstaller)',
    );
    expect(script).toContain(
      '$registeredUninstaller.Equals($expectedUninstaller, [StringComparison]::OrdinalIgnoreCase)',
    );
    expect(script).toContain('$installKey = "${hive}:/$software/$($item.PSChildName)"');
    expect(script).toContain('[IO.Path]::GetFullPath($installValue.InstallLocation).TrimEnd');
    expect(script).toContain('$item.GetValueNames()');
    expect(script).toContain('$installItem.GetValueNames()');
    expect(script).toContain('[InstallerInteractive] Acceptance failed:');
    expect(script).toContain('Stop-AcceptanceProcess $item.ProcessId');
    expect(script).not.toContain('& taskkill.exe');
  });

  it('covers real 8.3 path aliases without accepting unrelated existing executables', () => {
    const regression = readFileSync(
      path.join(__dirname, 'windows-installer-interactive-regression.ps1'),
      'utf8',
    );
    expect(regression).toContain('[AcceptanceShortPath]::GetShortPathName');
    expect(regression).toContain('Equivalent Windows path was not recognized');
    expect(regression).toContain('A different existing executable was accepted');
    expect(regression).toContain('Restoring raw registration values changed the snapshot');
  });

  it.skipIf(process.platform !== 'win32')(
    'handles real electron-builder registry layout and repeated process cleanup',
    () => {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(__dirname, 'windows-installer-interactive-regression.ps1'),
          '-DriverPath',
          scriptPath,
        ],
        { encoding: 'utf8', timeout: 25_000 },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        'PASS: registration and repeated process cleanup regressions',
      );
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'parses PowerShell and compiles the native driver before packaging',
    () => {
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const command = [
        "$ErrorActionPreference = 'Stop'",
        '$parseErrors = $null',
        `$null = [System.Management.Automation.Language.Parser]::ParseFile(${quote(scriptPath)}, [ref]$null, [ref]$parseErrors)`,
        'if ($parseErrors.Count) { throw ($parseErrors | Out-String) }',
        'Add-Type -AssemblyName System.Drawing',
        `Add-Type -Path ${quote(helperPath)} -ReferencedAssemblies System,System.Core,System.Drawing`,
        '[ZhiYuan.Acceptance.InstallerUi]::UsePhysicalCoordinates()',
      ].join('; ');
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {
          encoding: 'utf8',
          timeout: 20_000,
        },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    },
  );
});
