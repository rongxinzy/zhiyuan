param([Parameter(Mandatory = $true)][string]$InstallerScriptPath)

# Parse and execute the production NSIS process helpers against real disposable
# executables. This catches invalid embedded PowerShell before a full package.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Get-Content -LiteralPath $InstallerScriptPath -Raw -Encoding UTF8
# CIM reports long executable paths; TEMP on hosted Windows may use RUNNER~1.
$tempRoot = [IO.Path]::GetFullPath((Get-Item -LiteralPath $env:TEMP).FullName)
$fixture = Join-Path $tempRoot ('zhiyuan-process-test-' + [guid]::NewGuid().ToString())
$installRoot = Join-Path $fixture ('Install ' + [char]0x5b89 + [char]0x88c5)
$localRoot = Join-Path $fixture 'LocalAppData'
$runtimeRoot = Join-Path $localRoot 'ZhiYuanAgent/runtimes'
$siblingRoot = "$installRoot-other"
$processes = @()

function Get-EmbeddedCommand {
  param([string]$Name, [int]$ExcludedProcessId)
  $macro = [regex]::Match($source, "(?s)!macro $Name\b(.*?)!macroend").Groups[1].Value
  $match = [regex]::Match($macro, '(?s)nsExec::ExecTo(?:Log|Stack)\s+''powershell -NoProfile -NonInteractive -Command "(.*)"''')
  if (-not $match.Success) { throw "Cannot extract the production $Name command" }
  $command = $match.Groups[1].Value -replace '\\\r?\n\s*', ' '
  $command = $command.Replace('\"', '"').Replace('$$', '$')
  $command = $command.Replace('$INSTDIR', $installRoot).Replace('$LOCALAPPDATA', $localRoot).Replace('$9', "$ExcludedProcessId")
  $parseErrors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseInput($command, [ref]$null, [ref]$parseErrors)
  if ($parseErrors.Count) { throw "Production $Name has invalid PowerShell: $($parseErrors | Out-String)" }
  return $command
}

function Invoke-EmbeddedCommand {
  param([string]$Name, [int]$ExcludedProcessId)
  $command = Get-EmbeddedCommand $Name $ExcludedProcessId
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $stdout = Join-Path $fixture "$Name.out"
  $stderr = Join-Path $fixture "$Name.err"
  $helper = Start-Process -FilePath "$PSHOME/powershell.exe" -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  try {
    if (-not $helper.WaitForExit(20000)) { throw "Production $Name timed out" }
    $errors = Get-Content -LiteralPath $stderr -Raw
    if ($errors) { throw "Production $Name failed: $errors" }
    [pscustomobject]@{ exitCode = $helper.ExitCode; output = (Get-Content -LiteralPath $stdout -Raw) }
  } finally {
    if (-not $helper.HasExited) { Stop-Process -Id $helper.Id -Force -ErrorAction SilentlyContinue }
  }
}

try {
  # Parse before creating processes, including the formerly unmatched ')'.
  $null = Get-EmbeddedCommand 'StopAppProcesses' $PID
  $null = Get-EmbeddedCommand 'CountInstallDirProcesses' $PID
  New-Item -ItemType Directory -Path $installRoot,$runtimeRoot,$siblingRoot -Force | Out-Null
  $executable = Join-Path $installRoot 'app.exe'
  # Compile without loading the output into this harness, which would retain
  # an assembly file handle and interfere with the real process-only cleanup.
  Add-Type -AssemblyName Microsoft.CSharp
  $compiler = New-Object Microsoft.CSharp.CSharpCodeProvider
  try {
    $options = New-Object System.CodeDom.Compiler.CompilerParameters
    $options.GenerateExecutable = $true
    $options.OutputAssembly = $executable
    $compiled = $compiler.CompileAssemblyFromSource($options, 'public static class AcceptanceSleeper { public static void Main() { System.Threading.Thread.Sleep(60000); } }')
    if ($compiled.Errors.HasErrors) { throw ($compiled.Errors | Out-String) }
  } finally { $compiler.Dispose() }
  $paths = @($executable, (Join-Path $installRoot 'sidecar.exe'), (Join-Path $runtimeRoot 'runtime.exe'), (Join-Path $installRoot 'uninstaller.exe'), (Join-Path $siblingRoot 'app.exe'))
  foreach ($path in $paths) {
    if ($path -ne $executable) { Copy-Item -LiteralPath $executable -Destination $path }
    $processes += Start-Process -FilePath $path -WindowStyle Hidden -PassThru
  }
  $excluded = $processes[3].Id
  $countBefore = Invoke-EmbeddedCommand 'CountInstallDirProcesses' $excluded
  if ($countBefore.exitCode -ne 3) { throw "Expected three real processes under the Unicode install root, got $($countBefore.exitCode)" }
  $stopped = Invoke-EmbeddedCommand 'StopAppProcesses' $excluded
  if ($stopped.exitCode -ne 0 -or $stopped.output -notmatch 'stopped=3 remaining=0') {
    throw "Production process stop did not report success: exit=$($stopped.exitCode) output=$($stopped.output)"
  }
  foreach ($process in $processes[0..2]) {
    if (-not $process.WaitForExit(5000)) { throw "Production helper did not stop app/sidecar/runtime process $($process.Id)" }
  }
  foreach ($process in $processes[3..4]) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Production helper killed the excluded installer or similarly named sibling installation' }
  }
  $countAfter = Invoke-EmbeddedCommand 'CountInstallDirProcesses' $excluded
  if ($countAfter.exitCode -ne 1) { throw 'The process counter did not retain the excluded installer at its actual path' }
  Write-Output 'PASS: production NSIS commands parse and stop only real owned processes'
} finally {
  foreach ($process in $processes) {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $null = $process.WaitForExit(5000)
    }
  }
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
