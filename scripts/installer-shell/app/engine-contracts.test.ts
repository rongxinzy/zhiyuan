import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from 'vitest';

const sourceRoot = __dirname;
const read = (name: string) => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
const installer = read('InstallerEngine.cs');
const uninstaller = read('UninstallerEngine.cs');
const form = read('SetupForm.cs');
const transaction = read('InstallDirectoryTransaction.cs');
const argumentsSource = read('SetupArguments.cs');

test('engine checks extraction and current portable-git sentinel without retired optional runtime paths', () => {
  expect(installer).toContain('failureMessage: "应用程序解包失败"');
  expect(installer).toContain('"mingit", "cmd", "git.exe"');
  for (const sentinel of [
    'git.exe',
    'libiconv-2.dll',
    'libintl-8.dll',
    'libpcre2-8-0.dll',
    'libwinpthread-1.dll',
    'zlib1.dll',
  ]) {
    expect(installer).toContain(`"mingit", "mingw64", "bin", "${sentinel}"`);
  }
  expect(installer).toContain('"resources", "app.asar"');
  expect(installer + form).not.toMatch(/localInference|pending-local-inference-install/);
  expect(form).toContain('public void StartInstall(string installPath)');
});

test('mandatory registration finishes before commit and destructive cleanup', () => {
  const run = installer.slice(
    installer.indexOf('public async Task RunAsync'),
    installer.indexOf('private async Task ResolvePayloadDirAsync'),
  );
  const register = run.indexOf('StepRegisterUninstall();');
  const commit = run.indexOf('transaction.MarkCommitted();');
  const cleanup = run.indexOf('await StepCleanup(', commit);
  expect(register).toBeGreaterThan(0);
  expect(commit).toBeGreaterThan(register);
  expect(cleanup).toBeGreaterThan(commit);
  expect(run).toContain('File.Delete(Path.Combine(runtimeRoot, "component-switch-state.txt"))');
  expect(installer).toContain('registrationSnapshot?.Restore()');
  expect(installer).toContain('"-UseExactOldInstallPath " + previousInstallArgument');
  expect(installer).toContain('transaction.BackupDir is { } backup');
  const committedRecovery = run.slice(
    run.indexOf('if (transaction.HasPendingState && transaction.IsCommitted)'),
    run.indexOf('await StepRecoverComponentSwitch'),
  );
  expect(committedRecovery.indexOf('await StepCleanup(')).toBeGreaterThan(0);
  expect(committedRecovery.indexOf('transaction.Finish()')).toBeGreaterThan(
    committedRecovery.indexOf('await StepCleanup('),
  );
});

test('native registration failures retain method diagnostics without source or payload values', () => {
  expect(installer).toContain('ReportPhase("正在创建开始菜单快捷方式")');
  expect(installer).toContain('ReportPhase("正在创建桌面快捷方式")');
  expect(installer).toContain('Detail: DescribeFailure(ex)');
  expect(installer).toContain('exception.HResult:X8');
  expect(installer).toContain('new StackTrace(exception, fNeedFileInfo: false)');
  for (const operation of [
    'IShellLinkW.Activate',
    'IShellLinkW.SetPath',
    'IShellLinkW.SetWorkingDirectory',
    'IShellLinkW.SetIconLocation',
    'IPersistFile.Save',
  ]) {
    expect(installer).toContain(`operation = "${operation}"`);
  }
  expect(installer).not.toContain('WScript.Shell');
  expect(read('WindowsShellLink.cs')).toContain('000214F9-0000-0000-C000-000000000046');
  expect(read('WindowsShellLink.cs')).toContain('UnmanagedType.LPWStr');
});

test('install and uninstall reject foreign directories before stopping any process', () => {
  expect(installer.indexOf('transaction.ValidateOwnership();')).toBeLessThan(
    installer.indexOf('await StepStopAppProcesses('),
  );
  expect(uninstaller.indexOf('ValidateInstallOwnership();')).toBeLessThan(
    uninstaller.indexOf('await StepStopAppProcesses('),
  );
  const ownership = transaction.slice(
    transaction.indexOf('public void ValidateOwnership()'),
    transaction.indexOf('public void Begin()'),
  );
  expect(ownership).toContain('ReadState()');
  expect(ownership).not.toMatch(/Directory\.(Move|Delete)|File\.(Write|Delete)/);
});

test('system folders protect descendants while Program Files only protects its root', () => {
  expect(transaction).toContain(
    'var protectsDescendants = folder is Environment.SpecialFolder.Windows',
  );
  expect(transaction).toContain(
    'or Environment.SpecialFolder.System or Environment.SpecialFolder.SystemX86',
  );
  expect(transaction).toContain('protectsDescendants && ContainsPath(protectedRoot, full)');
  const descendantPolicy = transaction.slice(
    transaction.indexOf('var protectsDescendants ='),
    transaction.indexOf('if (!string.IsNullOrEmpty(protectedRoot)'),
  );
  expect(descendantPolicy).not.toContain('Environment.SpecialFolder.ProgramFiles');
});

test('installation identity requires physical executable and asar for both installation and uninstall', () => {
  expect(transaction).toContain('ValidateInstalledApplication(installDir);');
  expect(transaction).toContain('Path.Combine(root, "resources", "app.asar")');
  expect(transaction).toContain('FileAttributes.ReparsePoint | FileAttributes.Directory');
  expect(transaction).toContain('attributes = File.GetAttributes(dir.FullName)');
  expect(transaction).not.toContain('dir.Exists &&');
  expect(uninstaller).toContain(
    'InstallDirectoryTransaction.ValidateInstalledApplication(installDir);',
  );
  const ownership = uninstaller.slice(
    uninstaller.indexOf('private void ValidateInstallOwnership()'),
    uninstaller.indexOf('private async Task StepCleanupRuntimeCaches'),
  );
  expect(ownership).not.toContain('"uninstall.exe"');
  expect(transaction).toContain('ValidateInstalledApplication(pending.BackupDir)');
});

test('upgrade rollback removes partial new files before restoring the previous application', () => {
  const partialRemoval = transaction.indexOf(
    'DeleteTreeWithoutFollowingLinks(installDir);',
    transaction.indexOf('else if (Directory.Exists(pending.BackupDir))'),
  );
  const restore = transaction.indexOf('Directory.Move(pending.BackupDir, installDir);');
  expect(partialRemoval).toBeGreaterThan(0);
  expect(restore).toBeGreaterThan(partialRemoval);
  expect(transaction).toContain('Guid.TryParseExact');
  expect(transaction).toContain('FileAttributes.ReparsePoint');
  expect(transaction).toContain('File.Move(temporary, journalPath, overwrite: true)');
  expect(installer).toContain('preserveJournal: failures.Count > 0');
});

test('uninstall preserves personal data and frees the old path before updater cleanup', () => {
  expect(uninstaller).not.toMatch(
    /StepRemoveAppData|Directory\.Delete\(appDataRoot|正在删除个人数据/,
  );
  const detach = uninstaller.indexOf('StepDetachInstallDirectory();');
  const runtimeCleanup = uninstaller.indexOf('await StepCleanupRuntimeCaches(');
  expect(detach).toBeGreaterThan(0);
  expect(runtimeCleanup).toBeGreaterThan(detach);
  expect(uninstaller).toContain('installDir + ".uninstall." + Guid.NewGuid().ToString("n")');
  expect(uninstaller).toContain('startInfo.Environment["ZY_UNINSTALL_TREE"] = detachedInstallDir');
  expect(uninstaller).not.toContain('rd /s /q');
});

test('uninstaller copies only the SFX host and validates footer bounds', () => {
  expect(installer).toContain('CopyUninstallerHost(selfPath, uninstallExe)');
  expect(installer).not.toContain('File.Copy(selfPath, uninstallExe');
  expect(installer).toContain('footer.AsSpan(8).SequenceEqual("ZYP1"u8)');
  expect(installer).toContain('hostLength -= payloadLength + 12');
  expect(installer).toContain('payloadLength > input.Length - 12');
});

test('silent NSIS uninstall arguments work without a WebView2 or automatic launch', () => {
  expect(argumentsSource).toContain('value.Equals("/S", StringComparison.OrdinalIgnoreCase)');
  expect(argumentsSource).toContain('value.StartsWith("_?=", StringComparison.Ordinal)');
  expect(form).toContain('if (SetupArguments.IsSilent(args))');
  const silent = form.slice(
    form.indexOf('public static int RunSilentInstall'),
    form.indexOf('internal static string? ValueAfter'),
  );
  expect(silent).toContain('engine.RunAsync(CancellationToken.None)');
  expect(silent).not.toMatch(/LaunchApp|Process\.Start/);
});

test('launch failure remains recoverable and successful launch has an explicit result', () => {
  const launch = form.slice(
    form.indexOf('internal bool LaunchApp()'),
    form.indexOf('internal string GetLicenseText()'),
  );
  expect(launch).toContain('Type: "launch-error"');
  expect(launch).toContain('Type: "launched"');
  expect(launch).toContain('return false;');
  expect(launch).not.toContain('Close()');
  expect(launch).toContain('if (launchStarted) return true;');
  expect(launch).toContain('Arguments = completedUpgrade ? "--updated" : string.Empty');
  expect(installer).toContain('isUpgrade = File.Exists(LaunchPath)');
});

test('retry gets a fresh cancellation token and closing waits for the engine to stop', () => {
  expect(form.match(/installCts = new CancellationTokenSource\(\);/g)).toHaveLength(2);
  expect(form).toContain('if (!operationActive) return;');
  expect(form).toContain('e.Cancel = true;');
  expect(form).toContain('closeRequested = true;');
  expect(form).toContain('finally { BeginInvoke(FinishOperation); }');
  expect(form).not.toContain(
    'Directory.EnumerateDirectories(Path.GetTempPath(), "zhiyuan-setup-*")',
  );
});

test('close diagnostics distinguish message delivery and deferred shutdown without payload logging', () => {
  for (const stage of [
    'web-message-received',
    'close-message-received',
    'close-dispatched',
    'form-closing',
    'form-close-deferred',
    'operation-finished',
    'form-closed',
    'form-cleanup-finished',
  ]) {
    expect(form).toContain(`RecordLifecycle("${stage}")`);
  }
  const diagnostic = form.slice(
    form.indexOf('private void RecordLifecycle('),
    form.indexOf('internal void CancelInstall()'),
  );
  expect(diagnostic).toContain('AppendEvent(eventsLogPath');
  expect(diagnostic).toContain('Type: "lifecycle"');
  expect(diagnostic).toContain(
    'operationActive={operationActive}; closeRequested={closeRequested}',
  );
  expect(diagnostic).not.toMatch(/WebMessageAsJson|PostWebMessage|OnEngineEvent|Close\(/);
});

test('license is embedded and acceptance debugging is opt-in, loopback-only and isolated', () => {
  expect(read('ZhiYuan.Setup.Shell.csproj')).toContain('LogicalName="ui.license"');
  expect(form).toContain('GetManifestResourceStream("ui.license")');
  expect(form).toContain('if (port is not null)');
  expect(form).toContain('--remote-debugging-address=127.0.0.1 --remote-debugging-port=');
  expect(form).toContain(
    'CoreWebView2Environment.CreateAsync(browserExecutableFolder, webViewDataDir, browserOptions)',
  );
  expect(form).toContain('Type: "webview2-error"');
  expect(argumentsSource).toContain('"--events-log"');
  expect(form).not.toMatch(/DownloadFile|DownloadString/);
  expect(form).toContain('https://developer.microsoft.com/microsoft-edge/webview2/');
});

const dotnet = process.env.ZHIYUAN_DOTNET || 'dotnet';
const dotnetAvailable = spawnSync(dotnet, ['--version'], { encoding: 'utf8' }).status === 0;

test.skipIf(!dotnetAvailable)(
  'actual C# transaction recovery and SFX host copy preserve old files and bound deletion',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-engine-contracts-'));
    const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    try {
      const sources = [
        'InstallerEngine.cs',
        'InstallDirectoryTransaction.cs',
        'InstallRegistrationSnapshot.cs',
        'ShellProcessRunner.cs',
        'UninstallerEngine.cs',
        'WindowsShellLink.cs',
      ];
      fs.writeFileSync(
        path.join(root, 'Contracts.csproj'),
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup>${sources.map(file => `<Compile Include="${xml(path.join(sourceRoot, file))}" />`).join('')}</ItemGroup></Project>`,
      );
      fs.writeFileSync(
        path.join(root, 'Program.cs'),
        `
using System.Text.Json;
using ZhiYuan.Setup.Shell;
static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
static void Reject(Action action, string message) {
    var rejected = false;
    try { action(); } catch (EngineException) { rejected = true; }
    Check(rejected, message);
}
static void WriteOwnedApp(string directory, string value) {
    Directory.CreateDirectory(Path.Combine(directory, "resources"));
    File.WriteAllText(Path.Combine(directory, InstallerEngine.AppExeName), value);
    File.WriteAllText(Path.Combine(directory, "resources", "app.asar"), "owned-asar");
}
static void LinkDirectory(string link, string target) {
    if (!OperatingSystem.IsWindows()) { Directory.CreateSymbolicLink(link, target); return; }
    using var child = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo {
        FileName = "cmd.exe", Arguments = $"/d /c mklink /J \\"{link}\\" \\"{target}\\"",
        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
    }) ?? throw new Exception("Could not create junction fixture");
    child.WaitForExit();
    Check(child.ExitCode == 0, "Junction fixture failed: " + child.StandardError.ReadToEnd());
}
static void UnlinkDirectory(string link) {
    if ((File.GetAttributes(link) & FileAttributes.Directory) != 0) Directory.Delete(link);
    else File.Delete(link);
}
var root = Path.Combine(Path.GetTempPath(), "zy-engine-behavior-" + Guid.NewGuid().ToString("n"));
Directory.CreateDirectory(root);
try {
    var install = Path.Combine(root, "app");
    var data = Path.Combine(root, "user-data");
    Directory.CreateDirectory(data);
    File.WriteAllText(Path.Combine(data, "sessions.sqlite"), "personal");
    WriteOwnedApp(install, "old");
    var first = new InstallDirectoryTransaction(install);
    first.Begin();
    Directory.CreateDirectory(install);
    File.WriteAllText(Path.Combine(install, InstallerEngine.AppExeName), "partial-new");
    File.WriteAllText(Path.Combine(install, "partial.txt"), "partial");
    new InstallDirectoryTransaction(install).Rollback();
    Check(File.ReadAllText(Path.Combine(install, InstallerEngine.AppExeName)) == "old", "interrupted upgrade lost old app");
    Check(!File.Exists(Path.Combine(install, "partial.txt")), "partial upgrade survived rollback");
    Check(File.ReadAllText(Path.Combine(data, "sessions.sqlite")) == "personal", "personal data changed");

    var fresh = Path.Combine(root, "fresh");
    var freshTransaction = new InstallDirectoryTransaction(fresh);
    freshTransaction.Begin();
    Directory.CreateDirectory(fresh);
    File.WriteAllText(Path.Combine(fresh, "partial"), "new");
    new InstallDirectoryTransaction(fresh).ValidateOwnership();
    new InstallDirectoryTransaction(fresh).Rollback();
    Check(!Directory.Exists(fresh), "fresh failed installation was not removed");

    var committed = new InstallDirectoryTransaction(install);
    committed.Begin();
    WriteOwnedApp(install, "committed-new");
    committed.MarkCommitted();
    var recovery = new InstallDirectoryTransaction(install);
    Check(recovery.IsCommitted, "commit marker was not durable");
    recovery.Rollback();
    Check(File.ReadAllText(Path.Combine(install, InstallerEngine.AppExeName)) == "committed-new", "committed app rolled back");
    recovery.Finish();

    File.WriteAllText(install + ".setup-state.json", JsonSerializer.Serialize(new { InstallDir=install, BackupDir=data, Committed=false }));
    var refused = false;
    try { new InstallDirectoryTransaction(install).Rollback(); } catch (EngineException) { refused = true; }
    Check(refused && Directory.Exists(data), "foreign recovery path was accepted");
    File.Delete(install + ".setup-state.json");
    refused = false;
    try { InstallDirectoryTransaction.ValidateRoots(data, Path.Combine(root, "runtime"), data); } catch (EngineException) { refused = true; }
    Check(refused, "installation accepted the data root");

    refused = false;
    try { new InstallDirectoryTransaction(data).ValidateOwnership(); } catch (EngineException) { refused = true; }
    Check(refused && File.ReadAllText(Path.Combine(data, "sessions.sqlite")) == "personal", "foreign directory was not rejected without mutation");

    var runtime = Path.Combine(root, "runtime");
    var emptyInstall = Path.Combine(root, "empty-install");
    Directory.CreateDirectory(emptyInstall);
    InstallDirectoryTransaction.ValidateRoots(emptyInstall, runtime, data);
    new InstallDirectoryTransaction(emptyInstall).ValidateOwnership();
    InstallDirectoryTransaction.ValidateRoots(install, runtime, data);
    new InstallDirectoryTransaction(install).ValidateOwnership();
    Check(File.ReadAllText(Path.Combine(install, InstallerEngine.AppExeName)) == "committed-new", "valid owned installation was changed by validation");

    var emptyTransaction = new InstallDirectoryTransaction(emptyInstall);
    emptyTransaction.Begin();
    Directory.CreateDirectory(emptyInstall);
    File.WriteAllText(Path.Combine(emptyInstall, "partial"), "new");
    new InstallDirectoryTransaction(emptyInstall).ValidateOwnership();
    new InstallDirectoryTransaction(emptyInstall).Rollback();
    Check(Directory.Exists(emptyInstall) && !Directory.EnumerateFileSystemEntries(emptyInstall).Any(), "empty previous directory was not restored");

    var impostor = Path.Combine(root, "uninstall-only");
    Directory.CreateDirectory(impostor);
    File.WriteAllText(Path.Combine(impostor, "uninstall.exe"), "not-ownership");
    Reject(() => new InstallDirectoryTransaction(impostor).ValidateOwnership(), "uninstall-only directory accepted for installation");
    Reject(() => new UninstallerEngine(impostor, runtime, data, "runtime,registry,shortcuts", new Progress<EngineEvent>()).UninstallAsync(CancellationToken.None).GetAwaiter().GetResult(), "uninstall-only directory accepted for removal");
    Check(File.ReadAllText(Path.Combine(impostor, "uninstall.exe")) == "not-ownership", "foreign uninstall marker was changed");
    File.WriteAllText(Path.Combine(impostor, InstallerEngine.AppExeName), "still-not-owned");
    Reject(() => new InstallDirectoryTransaction(impostor).ValidateOwnership(), "executable alone established ownership without asar");
    Reject(() => InstallDirectoryTransaction.ValidateInstalledApplication(Path.Combine(root, "missing-install")), "missing install accepted for uninstall");

    var external = Path.Combine(root, "external-data");
    WriteOwnedApp(external, "external");
    File.WriteAllText(Path.Combine(external, "keep.txt"), "keep-external");
    var linkedInstall = Path.Combine(root, "linked-install");
    LinkDirectory(linkedInstall, external);
    Reject(() => InstallDirectoryTransaction.ValidateRoots(linkedInstall, runtime, data), "linked install root was accepted");
    UnlinkDirectory(linkedInstall);
    var linkedResources = Path.Combine(root, "linked-resources");
    WriteOwnedApp(linkedResources, "linked");
    Directory.Delete(Path.Combine(linkedResources, "resources"), recursive: true);
    LinkDirectory(Path.Combine(linkedResources, "resources"), Path.Combine(external, "resources"));
    Reject(() => new InstallDirectoryTransaction(linkedResources).ValidateOwnership(), "linked resources established installation ownership");
    Reject(() => InstallDirectoryTransaction.ValidateInstalledApplication(linkedResources), "linked resources established uninstall ownership");
    UnlinkDirectory(Path.Combine(linkedResources, "resources"));

    var danglingTarget = Path.Combine(root, "dangling-target");
    Directory.CreateDirectory(danglingTarget);
    var danglingAncestor = Path.Combine(root, "dangling-ancestor");
    LinkDirectory(danglingAncestor, danglingTarget);
    Directory.Delete(danglingTarget);
    Reject(() => InstallDirectoryTransaction.ValidateRoots(Path.Combine(danglingAncestor, "child"), runtime, data), "dangling linked ancestor was accepted");
    UnlinkDirectory(danglingAncestor);
    Directory.CreateDirectory(danglingTarget);
    LinkDirectory(Path.Combine(linkedResources, "resources"), danglingTarget);
    Directory.Delete(danglingTarget);
    Reject(() => new InstallDirectoryTransaction(linkedResources).ValidateOwnership(), "dangling resources were accepted");
    UnlinkDirectory(Path.Combine(linkedResources, "resources"));

    if (!OperatingSystem.IsWindows()) {
        foreach (var identity in new[] { InstallerEngine.AppExeName, Path.Combine("resources", "app.asar") }) {
            var linkedFileApp = Path.Combine(root, "file-link-" + Guid.NewGuid().ToString("n"));
            WriteOwnedApp(linkedFileApp, "test");
            var identityPath = Path.Combine(linkedFileApp, identity);
            File.Delete(identityPath);
            File.CreateSymbolicLink(identityPath, Path.Combine(external, "keep.txt"));
            Reject(() => new InstallDirectoryTransaction(linkedFileApp).ValidateOwnership(), "linked identity file was accepted");
            File.Delete(identityPath);
        }
    }

    var lateFailure = new InstallDirectoryTransaction(install);
    lateFailure.Begin();
    Directory.CreateDirectory(Path.Combine(install, "resources"));
    LinkDirectory(Path.Combine(install, "resources", "mingit"), external);
    Directory.CreateDirectory(danglingTarget);
    LinkDirectory(Path.Combine(install, "resources", "dangling-component"), danglingTarget);
    Directory.Delete(danglingTarget);
    new InstallDirectoryTransaction(install).ValidateOwnership();
    new InstallDirectoryTransaction(install).Rollback();
    Check(File.ReadAllText(Path.Combine(install, InstallerEngine.AppExeName)) == "committed-new", "late failure did not restore the physical old installation");
    Check(File.ReadAllText(Path.Combine(external, "keep.txt")) == "keep-external", "rollback followed a component junction into external data");

    var foreignRecovery = Path.Combine(root, "foreign-recovery");
    var foreignBackup = foreignRecovery + ".old." + Guid.NewGuid().ToString("n");
    Directory.CreateDirectory(foreignBackup);
    File.WriteAllText(Path.Combine(foreignBackup, "uninstall.exe"), "not-owned");
    File.WriteAllText(foreignRecovery + ".setup-state.json", JsonSerializer.Serialize(new { InstallDir=foreignRecovery, BackupDir=foreignBackup, Committed=false }));
    Reject(() => new InstallDirectoryTransaction(foreignRecovery).ValidateOwnership(), "journal accepted a foreign backup");
    Check(File.ReadAllText(Path.Combine(foreignBackup, "uninstall.exe")) == "not-owned", "foreign backup was modified");
    Console.WriteLine("PASS: physical ownership, link rejection, interrupted empty/partial installs and component-junction rollback");
    if (OperatingSystem.IsWindows()) {
        // Match SetupForm's Task.Run apartment and the real Unicode install
        // path, without modifying the user's registry, Desktop or Start Menu.
        var shortcutInstall = Path.Combine(root, "安装 路径");
        WriteOwnedApp(shortcutInstall, "shortcut-target");
        var shortcutEngine = new InstallerEngine(null, shortcutInstall, runtime, data, false, new Progress<EngineEvent>());
        foreach (var folderName in new[] { "开始菜单", "桌面" }) {
            var shortcutFolder = Path.Combine(root, folderName);
            Directory.CreateDirectory(shortcutFolder);
            Task.Run(() => {
                Check(Thread.CurrentThread.GetApartmentState() == ApartmentState.MTA, "shortcut test must match the engine's MTA worker");
                try { shortcutEngine.CreateShortcut(shortcutFolder); }
                catch (EngineException ex) { Console.Error.WriteLine(ex.Detail); throw; }
                var linkPath = Path.Combine(shortcutFolder, InstallerEngine.DisplayName + ".lnk");
                Check(File.Exists(linkPath), "shortcut file was not saved");
                var link = (IShellLinkW)new ShellLinkComObject();
                try {
                    ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(linkPath, 0);
                    var target = new System.Text.StringBuilder(32768);
                    link.GetPath(target, target.Capacity, IntPtr.Zero, 4);
                    Check(target.ToString() == shortcutEngine.LaunchPath, "shortcut lost its Unicode executable path");
                    var workingDirectory = new System.Text.StringBuilder(32768);
                    link.GetWorkingDirectory(workingDirectory, workingDirectory.Capacity);
                    Check(workingDirectory.ToString() == shortcutInstall, "shortcut lost its Unicode working directory");
                    var icon = new System.Text.StringBuilder(32768);
                    link.GetIconLocation(icon, icon.Capacity, out var iconIndex);
                    Check(icon.ToString() == shortcutEngine.LaunchPath && iconIndex == 0, "shortcut lost its Unicode icon path");
                } finally {
                    System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
                }
            }).GetAwaiter().GetResult();
        }
        Console.WriteLine("PASS: actual Unicode shortcut creation and target readback on MTA worker");
        foreach (var folder in new[] { Environment.SpecialFolder.Windows, Environment.SpecialFolder.System, Environment.SpecialFolder.SystemX86 }) {
            var systemRoot = Environment.GetFolderPath(folder);
            Check(!string.IsNullOrEmpty(systemRoot), "Windows system folder could not be resolved: " + folder);
            foreach (var target in new[] { systemRoot, Path.Combine(systemRoot, "ZhiYuan-contract"), Path.Combine(systemRoot, "nested", "ZhiYuan-contract") }) {
                refused = false;
                try { InstallDirectoryTransaction.ValidateRoots(target, runtime, data); } catch (EngineException) { refused = true; }
                Check(refused, "system folder or descendant accepted: " + target);
            }
        }
        foreach (var folder in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 }) {
            var programsRoot = Environment.GetFolderPath(folder);
            Check(!string.IsNullOrEmpty(programsRoot), "Windows program folder could not be resolved: " + folder);
            refused = false;
            try { InstallDirectoryTransaction.ValidateRoots(programsRoot, runtime, data); } catch (EngineException) { refused = true; }
            Check(refused, "Program Files root accepted");
            InstallDirectoryTransaction.ValidateRoots(Path.Combine(programsRoot, "ZhiYuan-contract-" + Guid.NewGuid().ToString("n")), runtime, data);
        }
        Console.WriteLine("PASS: Windows system descendants rejected and Program Files app children accepted");
    }

    var source = Path.Combine(root, "setup.exe");
    var destination = Path.Combine(root, "uninstall.exe");
    var host = new byte[] { 77, 90, 1, 2, 3 };
    var payload = new byte[] { 9, 8, 7, 6 };
    File.WriteAllBytes(source, host.Concat(payload).Concat(BitConverter.GetBytes((long)payload.Length)).Concat("ZYP1"u8.ToArray()).ToArray());
    InstallerEngine.CopyUninstallerHost(source, destination);
    Check(File.ReadAllBytes(destination).SequenceEqual(host), "uninstaller retained the SFX payload");
    File.WriteAllBytes(source, host);
    InstallerEngine.CopyUninstallerHost(source, destination);
    Check(File.ReadAllBytes(destination).SequenceEqual(host), "standalone host copy changed bytes");
    Console.WriteLine("PASS: transaction recovery, retention, path guards and SFX truncation");
} finally { Directory.Delete(root, recursive: true); }
`,
      );
      const result = spawnSync(
        dotnet,
        ['run', '--project', path.join(root, 'Contracts.csproj'), '--configuration', 'Release'],
        {
          encoding: 'utf8',
          timeout: 110_000,
          env: {
            ...process.env,
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
            DOTNET_CLI_HOME: path.join(root, '.dotnet-home'),
            NUGET_PACKAGES: path.join(root, '.nuget-packages'),
          },
        },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('PASS: transaction recovery');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  120_000,
);
