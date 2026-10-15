import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const scriptPath = path.join(__dirname, 'windows-installer-interactive.ps1');
const helperPath = path.join(__dirname, 'windows-installer-ui.cs');
const script = readFileSync(scriptPath, 'utf8');
const helper = readFileSync(helperPath, 'utf8');
const workflow = readFileSync('.github/workflows/windows-acceptance.yml', 'utf8');
const delivery = readFileSync('scripts/ci/windows-acceptance-install.ps1', 'utf8');
const { createProbeSource } = createRequire(import.meta.url)(
  '../installer-ui/verify-native-languages.cjs',
) as {
  createProbeSource: (
    root: string,
    output: string,
    languages: string,
    paths: Pick<typeof path, 'join'>,
  ) => string;
};

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
    const retry = script.indexOf('::ClickActiveDialogButton($retryDialog.Handle, $retry.Handle)');
    expect(release).toBeGreaterThan(0);
    expect(release).toBeLessThan(retry);
    expect(script).toContain("Wait-ForProgressAndFinish 'recovery'");
    expect(script).toContain('$report.checks.lockedDirectoryRetry = $true');
    expect(script).toContain("Save-Page 'recovery-retry-failed' $blocked.Handle");
    expect(script).toContain('Native installation retry remained blocked');
    expect(script).toContain("'the clicked Retry dialog to close' 10");
  });

  it('compares real directory identities and backup differences across cancellation', () => {
    expect(helper).toContain('GetFileInformationByHandle(directory, out information)');
    expect(helper).toContain('CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02200000');
    expect(helper).toContain('allowMissing && (error == 2 || error == 3)');
    expect(script).toContain('$report.cancelDirectoryBefore = Get-InstallDirectorySnapshot');
    expect(script).toContain('$report.cancelDirectoryAfter = Get-InstallDirectorySnapshot');
    expect(script).toContain(
      'Assert-CancelDirectoryPreserved $report.cancelDirectoryBefore $report.cancelDirectoryAfter',
    );
    expect(script).toContain('$Before.identity -ne $After.identity');
    expect(script).toContain('$_.identity -eq $backup.identity');
    expect(script).toContain('Cancelling setup created or replaced an installation backup:');
    expect(script).not.toContain("Where-Object Name -like '安装路径.old.*'");
    expect(script.indexOf('$report.cancelDirectoryBefore =')).toBeLessThan(
      script.indexOf('$process = Start-Installer -Language 1033'),
    );
    const regression = readFileSync(
      path.join(__dirname, 'windows-installer-interactive-regression.ps1'),
      'utf8',
    );
    for (const assertion of [
      'A newly created backup was accepted after cancellation',
      'A replacement backup with the same name was accepted',
      'A missing installed directory was accepted',
      'A replacement installed directory with identical bytes was accepted',
    ]) {
      expect(regression).toContain(assertion);
    }
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
    expect(script).toContain(
      '::FindDialogAcknowledgement($window.Handle, $script:wizard.ProcessId',
    );
    expect(script).toContain(
      '::ClickDialogAcknowledgement($launchError.Handle, $script:wizard.ProcessId',
    );
    expect(script).not.toContain('Get-Button -Id 1 -Window $launchError.Handle');
    expect(helper).toContain('info.OwnerHandle != expectedOwner');
    expect(helper).toContain('buttons.Count != 1 || !buttons[0].Enabled');
  });

  it.skipIf(process.platform !== 'win32')(
    'recognizes and clicks real single-OK modal HWNDs independent of numeric control IDs',
    () => {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(__dirname, 'windows-installer-dialog-regression.ps1'),
        ],
        { encoding: 'utf8', timeout: 30_000 },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('PASS: real modal OK dialogs with control IDs 1 and 2');
      expect(result.stdout).toContain(
        'PASS: one activated real button click closes only the bound background dialog',
      );
    },
    35_000,
  );

  it('activates and records the exact fresh Close button without bypassing real exit', () => {
    const freshClose = script.slice(
      script.indexOf("Wait-ForProgressAndFinish 'fresh'"),
      script.indexOf('$report.checks.freshInstall'),
    );
    expect(freshClose).toContain('Get-Button -Id 1 -Label');
    expect(freshClose).toContain(
      '$report.actions += [ZhiYuan.Acceptance.InstallerUi]::ClickActiveDialogButton($script:wizard.Handle, $close.Handle)',
    );
    expect(freshClose).toContain('Wait-InstallerExit $process');
    expect(script).toContain('$Process.WaitForExit(60000)');
    expect(helper).toContain(
      'receipt.ActiveAtClick != dialog || receipt.ForegroundAtClick != dialog',
    );
    expect(helper).toContain('GetAncestor(window, 2) != parent');
    expect(helper).toContain('if (attached) AttachThreadInput(currentThread, targetThread, false)');
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
      expect(result.stdout).toContain(
        'PASS: real directory identities and cancellation backup differences',
      );
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'parses production NSIS process helpers and proves real scoped process termination',
    () => {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(__dirname, 'windows-installer-process-regression.ps1'),
          '-InstallerScriptPath',
          path.resolve('scripts/nsis-installer.nsh'),
        ],
        { encoding: 'utf8', timeout: 60_000 },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        'PASS: real bounded helper preserves exit codes 0, 3, 200 and both output streams',
      );
      expect(result.stdout).toContain(
        'PASS: production NSIS commands parse and stop only real owned processes',
      );
      expect(result.stdout).toContain(
        'PASS: production process stop releases file locks before returning with caller handles retained',
      );
    },
    70_000,
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

  it('renders native Windows and POSIX compiler file paths without rewriting separators', () => {
    for (const [root, output, paths] of [
      [String.raw`D:\a\知远 repo\zhiyuan`, String.raw`C:\Users\runner\Temp\probe`, path.win32],
      ['/workspace/知远 repo/zhiyuan', '/tmp/probe', path.posix],
    ] as const) {
      const source = createProbeSource(root, output, '!insertmacro addLangs', paths);
      expect(source).toContain(`!define PROJECT_DIR "${root}"`);
      expect(source).toContain(`!include "${paths.join(root, 'scripts', 'nsis-installer.nsh')}"`);
      expect(source).toContain(`OutFile "${paths.join(output, 'probe.exe')}"`);
      expect(source).toContain(`WriteUninstaller "${paths.join(output, 'uninstaller.exe')}"`);
      expect(source).toContain('"${NSISDIR}\\Contrib\\Graphics\\Wizard\\nsis3-metro.bmp"');
    }
  });

  it.skipIf(process.platform !== 'win32' && !process.env.ELECTRON_BUILDER_NSIS_DIR)(
    'compiles real installer and uninstaller hooks with every configured NSIS language',
    () => {
      const result = spawnSync(
        process.execPath,
        ['scripts/installer-ui/verify-native-languages.cjs'],
        {
          encoding: 'utf8',
          timeout: 180_000,
        },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toMatch(
        /PASS: production installer and uninstaller compile with all \d+ configured languages and -WX/,
      );
    },
    190_000,
  );
});
