param([Parameter(Mandatory = $true)][string]$InstallerScriptPath)

# Parse and execute the production NSIS process helpers against real disposable
# executables. This catches invalid embedded PowerShell before a full package.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Get-Content -LiteralPath $InstallerScriptPath -Raw -Encoding UTF8
# CIM reports long executable paths; TEMP on hosted Windows may use RUNNER~1.
$tempRoot = [IO.Path]::GetFullPath((Get-Item -LiteralPath $env:TEMP).FullName)
$fixture = Join-Path $tempRoot ('zhiyuan-process-test-' + [guid]::NewGuid().ToString())
$installRoot = Join-Path $fixture ('Install [' + [char]0x5b89 + [char]0x88c5 + '] $literal `tick $(never)')
$localRoot = Join-Path $fixture 'LocalAppData'
$runtimeRoot = Join-Path $localRoot 'ZhiYuanAgent/runtimes'
$siblingRoot = "$installRoot-other"
$processes = @()

function Get-ProductionHelper {
  param([string]$Name, [string]$Mode)
  $macro = [regex]::Match($source, "(?s)!macro $Name\b(.*?)!macroend").Groups[1].Value
  if (-not $macro.Contains('-File "$PLUGINSDIR\manage-install-processes.ps1"') -or
      $macro -notmatch ('-Mode\s+' + [regex]::Escape($Mode) + '(?:\s|[\x22\x27])') -or
      -not $macro.Contains('-InstallDir "$INSTDIR"') -or
      -not $macro.Contains('-RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes"') -or
      -not $macro.Contains('-SelfPid $9') -or $macro -match '-Command\b') {
    throw "Production $Name must pass literal paths to the shared -File helper"
  }
  $helper = Join-Path (Split-Path $InstallerScriptPath) 'installer/manage-install-processes.ps1'
  $parseErrors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($helper, [ref]$null, [ref]$parseErrors)
  if ($parseErrors.Count) { throw "Production $Name has invalid PowerShell: $($parseErrors | Out-String)" }
  return $helper
}

function Assert-NoErrorStream {
  param([string]$Text, [string]$Name)
  if ([string]::IsNullOrWhiteSpace($Text)) { return }
  # Windows PowerShell serializes first-use module progress to stderr. Ignore
  # only actual CLIXML progress records; plain stderr and error records fail.
  if ($Text -match '^#< CLIXML\s*') {
    try {
      [xml]$xml = $Text -replace '^#< CLIXML\s*', ''
      $records = @($xml.DocumentElement.ChildNodes | Where-Object NodeType -eq Element)
      if ($xml.DocumentElement.LocalName -eq 'Objs' -and $records.Count -gt 0 -and
          @($records | Where-Object { $_.GetAttribute('S') -ne 'progress' }).Count -eq 0) { return }
    } catch { }
  }
  throw "Production $Name failed: $Text"
}

function Invoke-BoundedHelper {
  param([string]$Name, [string]$Arguments)
  # Own the native handle from creation through get_ExitCode(). Windows
  # PowerShell 5.1 Start-Process -PassThru can return a Process whose handle
  # was not retained, yielding a null ExitCode after the child has exited.
  $helper = New-Object System.Diagnostics.Process
  $helper.StartInfo.FileName = "$PSHOME/powershell.exe"
  $helper.StartInfo.Arguments = $Arguments
  $helper.StartInfo.UseShellExecute = $false
  $helper.StartInfo.CreateNoWindow = $true
  $helper.StartInfo.RedirectStandardOutput = $true
  $helper.StartInfo.RedirectStandardError = $true
  $started = $false
  try {
    $started = $helper.Start()
    if (-not $started) { throw "Could not start $Name; arguments=$Arguments" }
    $null = $helper.Handle
    $stdout = $helper.StandardOutput.ReadToEndAsync()
    $stderr = $helper.StandardError.ReadToEndAsync()
    if (-not $helper.WaitForExit(20000)) {
      throw "$Name timed out; pid=$($helper.Id); arguments=$Arguments"
    }
    if (-not $stdout.Wait(5000) -or -not $stderr.Wait(5000)) {
      throw "$Name output pipes did not close; pid=$($helper.Id); arguments=$Arguments"
    }
    # Call the getter explicitly so an invalid handle throws instead of a
    # PowerShell property-adapter failure being mistaken for an empty count.
    $exitCode = $helper.get_ExitCode()
    if ($null -eq $exitCode) {
      throw "$Name returned no exit code; pid=$($helper.Id); stdout=$($stdout.Result); stderr=$($stderr.Result)"
    }
    [pscustomobject]@{ exitCode = $exitCode; output = $stdout.Result; errorOutput = $stderr.Result; processId = $helper.Id }
  } finally {
    if ($started -and -not $helper.HasExited) {
      $helper.Kill()
      $null = $helper.WaitForExit(5000)
    }
    $helper.Dispose()
  }
}

function Invoke-ProductionHelper {
  param([string]$Name, [string]$Mode, [int]$ExcludedProcessId, [string]$TargetInstallRoot = $installRoot)
  $path = Get-ProductionHelper $Name $Mode
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $path + '" -Mode ' + $Mode + ' -InstallDir "' + $TargetInstallRoot + '" -RuntimeRoot "' + $runtimeRoot + '" -SelfPid ' + $ExcludedProcessId
  $result = Invoke-BoundedHelper $Name $arguments
  Assert-NoErrorStream $result.errorOutput "$Name (pid=$($result.processId), exit=$($result.exitCode), stdout=$($result.output))"
  return $result
}

function Format-ProcessFailure {
  param([object]$Result)
  $states = @($processes | ForEach-Object {
    $_.Refresh()
    [pscustomobject]@{ processId = $_.Id; exited = $_.HasExited }
  })
  return ([pscustomobject]@{ result = $Result; installRoot = $installRoot; runtimeRoot = $runtimeRoot; children = $states } | ConvertTo-Json -Depth 5 -Compress)
}

try {
  $null = Get-ProductionHelper 'StopAppProcesses' 'stop'
  $null = Get-ProductionHelper 'CountInstallDirProcesses' 'count'
  Assert-NoErrorStream '#< CLIXML
<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress"><MS><S N="Activity">Preparing modules for first use</S></MS></Obj></Objs>' 'progress fixture'
  foreach ($errorFixture in @('real native stderr', '#< CLIXML
<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="error">real error</S></Objs>')) {
    $rejected = $false
    try { Assert-NoErrorStream $errorFixture 'error fixture' } catch { $rejected = $true }
    if (-not $rejected) { throw 'A real error stream was ignored as progress' }
  }
  foreach ($directory in @($installRoot,$runtimeRoot,$siblingRoot)) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
  # A real short-lived child proves the wrapper preserves zero AND nonzero
  # statuses. Never cast a missing status to 0 or infer success from stdout.
  $exitFixture = Join-Path $fixture 'exit-status.ps1'
  [IO.File]::WriteAllText($exitFixture, 'param([int]$Code) [Console]::Out.Write("exit-fixture=$Code"); [Console]::Error.Write("stderr-fixture=$Code"); exit $Code')
  foreach ($code in @(0, 3, 200)) {
    $probe = Invoke-BoundedHelper 'exit-status fixture' ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $exitFixture + '" -Code ' + $code)
    if ($probe.exitCode -ne $code -or $probe.output -cne "exit-fixture=$code" -or $probe.errorOutput -cne "stderr-fixture=$code") {
      throw "Native exit-status/output capture regression: $($probe | ConvertTo-Json -Compress)"
    }
  }
  Write-Output 'PASS: real bounded helper preserves exit codes 0, 3, 200 and both output streams'
  $executable = Join-Path $installRoot 'app.exe'
  # Compile without loading the output into this harness, which would retain
  # an assembly file handle and interfere with the real process-only cleanup.
  Add-Type -AssemblyName Microsoft.CSharp
  $compiler = New-Object Microsoft.CSharp.CSharpCodeProvider
  try {
    $options = New-Object System.CodeDom.Compiler.CompilerParameters
    $options.GenerateExecutable = $true
    $options.OutputAssembly = $executable
    $compiled = $compiler.CompileAssemblyFromSource($options, @'
public static class AcceptanceSleeper {
  public static void Main(string[] args) {
    if (args.Length == 0) {
      System.Threading.Thread.Sleep(60000);
      return;
    }
    using (var held = System.IO.File.Open(args[0], System.IO.FileMode.OpenOrCreate,
        System.IO.FileAccess.ReadWrite, System.IO.FileShare.None)) {
      System.IO.File.WriteAllText(args[1], "ready");
      System.Threading.Thread.Sleep(60000);
    }
  }
}
'@)
    if ($compiled.Errors.HasErrors) { throw ($compiled.Errors | Out-String) }
  } finally { $compiler.Dispose() }
  $paths = @($executable, (Join-Path $installRoot 'sidecar.exe'), (Join-Path $runtimeRoot 'runtime.exe'), (Join-Path $installRoot 'uninstaller.exe'), (Join-Path $siblingRoot 'app.exe'))
  foreach ($path in $paths) {
    if ($path -ne $executable) { Copy-Item -LiteralPath $executable -Destination $path }
    $processes += Start-Process -FilePath $path -WindowStyle Hidden -PassThru
  }
  $excluded = $processes[3].Id
  $countBefore = Invoke-ProductionHelper 'CountInstallDirProcesses' 'count' $PID
  if ($countBefore.exitCode -ne 3) { throw "Expected three real processes under the Unicode install root: $(Format-ProcessFailure $countBefore)" }
  $countBeforeWithoutSelf = Invoke-ProductionHelper 'CountInstallDirProcesses' 'count' $excluded
  if ($countBeforeWithoutSelf.exitCode -ne 2) { throw "The process counter included the current uninstaller before stopping: $(Format-ProcessFailure $countBeforeWithoutSelf)" }
  $stopped = Invoke-ProductionHelper 'StopAppProcesses' 'stop' $excluded
  if ($stopped.exitCode -ne 0 -or $stopped.output -notmatch 'stopped=3 remaining=0') {
    throw "Production process stop did not report success: $(Format-ProcessFailure $stopped)"
  }
  foreach ($process in $processes[0..2]) {
    if (-not $process.WaitForExit(5000)) { throw "Production helper did not stop app/sidecar/runtime process $($process.Id)" }
  }
  foreach ($process in $processes[3..4]) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Production helper killed the excluded installer or similarly named sibling installation' }
  }
  $countAfter = Invoke-ProductionHelper 'CountInstallDirProcesses' 'count' $PID
  if ($countAfter.exitCode -ne 1) { throw "The process counter did not retain the excluded installer: $(Format-ProcessFailure $countAfter)" }
  $countWithoutSelf = Invoke-ProductionHelper 'CountInstallDirProcesses' 'count' $excluded
  if ($countWithoutSelf.exitCode -ne 0) { throw "The process counter did not exclude the current uninstaller: $(Format-ProcessFailure $countWithoutSelf)" }
  Write-Output 'PASS: production NSIS commands parse and stop only real owned processes'

  # A separate owned root proves that successful stop means the filesystem is
  # ready for NSIS's very next operation, rather than only absent from CIM.
  # Keep this caller's real process handle open across the rename. Process
  # object lifetime must not be confused with the child's live file handles.
  $lockedRoot = Join-Path $fixture ('Locked [' + [char]0x5b89 + [char]0x88c5 + '] $literal `tick $(never)')
  $lockedSiblingRoot = "$lockedRoot-other"
  $detachedRoot = "$lockedRoot.detached"
  [IO.Directory]::CreateDirectory($lockedRoot) | Out-Null
  [IO.Directory]::CreateDirectory($lockedSiblingRoot) | Out-Null
  $lockerPath = Join-Path $lockedRoot 'app.exe'
  $lockedSiblingPath = Join-Path $lockedSiblingRoot 'app.exe'
  $heldFile = Join-Path $lockedRoot 'held-file.bin'
  $readyFile = Join-Path $fixture 'locked-child-ready.txt'
  Copy-Item -LiteralPath $executable -Destination $lockerPath
  Copy-Item -LiteralPath $executable -Destination $lockedSiblingPath
  $lockedSibling = Start-Process -FilePath $lockedSiblingPath -WindowStyle Hidden -PassThru
  $processes += $lockedSibling
  $locker = Start-Process -FilePath $lockerPath -ArgumentList ('"' + $heldFile + '" "' + $readyFile + '"') -WindowStyle Hidden -PassThru
  $processes += $locker
  $retainedHandle = $locker.Handle
  if ($retainedHandle -eq [IntPtr]::Zero) { throw 'The caller did not retain the locked child process handle' }
  $readyDeadline = (Get-Date).AddSeconds(10)
  while (-not [IO.File]::Exists($readyFile)) {
    $locker.Refresh()
    if ($locker.HasExited) { throw 'The lock fixture exited before holding its file' }
    if ((Get-Date) -ge $readyDeadline) { throw 'The lock fixture did not signal its real open file handle' }
    Start-Sleep -Milliseconds 50
  }
  if ([IO.File]::ReadAllText($readyFile) -cne 'ready') { throw 'The lock fixture readiness marker is invalid' }
  $renameBlocked = $false
  try { [IO.Directory]::Move($lockedRoot, $detachedRoot) } catch {
    # Static .NET calls can wrap the filesystem exception in a PowerShell
    # MethodInvocationException. Only real native access/sharing errors count.
    $failure = $_.Exception.GetBaseException()
    $nativeCode = $failure.HResult -band 0xffff
    if (($failure -isnot [IO.IOException] -and $failure -isnot [UnauthorizedAccessException]) -or
        $nativeCode -notin @(5, 32, 33)) { throw }
    $renameBlocked = $true
  }
  if (-not $renameBlocked -or -not [IO.Directory]::Exists($lockedRoot) -or [IO.Directory]::Exists($detachedRoot)) {
    throw 'The running fixture did not produce a genuine blocked directory rename'
  }
  $released = Invoke-ProductionHelper 'StopAppProcesses' 'stop' $PID $lockedRoot
  if ($released.exitCode -ne 0 -or $released.output -notmatch 'stopped=1 remaining=0') {
    throw "Production helper did not stop the file-lock owner: $(Format-ProcessFailure $released)"
  }
  # No polling, WaitForExit or retry here: the production stop owns the wait.
  [IO.Directory]::Move($lockedRoot, $detachedRoot)
  $locker.Refresh()
  if (-not $locker.HasExited -or $locker.Handle -ne $retainedHandle) {
    throw 'The child was not terminated while its caller-owned process handle remained open'
  }
  if ([IO.Directory]::Exists($lockedRoot) -or -not [IO.File]::Exists((Join-Path $detachedRoot 'held-file.bin'))) {
    throw 'The released installation directory was not immediately detached with its contents'
  }
  foreach ($process in $processes[3..4]) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Scoped lock-owner cleanup killed an excluded or outside-prefix process' }
  }
  $lockedSibling.Refresh()
  if ($lockedSibling.HasExited) { throw 'Scoped lock-owner cleanup killed the similarly named sibling installation' }
  Write-Output 'PASS: production process stop releases file locks before returning with caller handles retained'
} finally {
  foreach ($process in $processes) {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $null = $process.WaitForExit(5000)
    }
    $process.Dispose()
  }
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
