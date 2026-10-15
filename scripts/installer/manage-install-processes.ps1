# Prefix-bounded process management. All paths arrive as literal -File args.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][int]$SelfPid,
  [Parameter(Mandatory = $true)][ValidateSet('stop', 'count')][string]$Mode
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$installPrefix = [IO.Path]::GetFullPath($InstallDir).TrimEnd([char]0x5c) + [char]0x5c
$runtimePrefix = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd([char]0x5c) + [char]0x5c
function Get-InstallProcesses([bool]$IncludeRuntime) {
  return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $image = $_.ExecutablePath
    $_.ProcessId -ne $SelfPid -and $image -and ($image.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      ($IncludeRuntime -and $image.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)))
  })
}
if ($Mode -eq 'count') {
  # The uninstaller can itself live inside the install directory.
  exit [Math]::Min(200, @(Get-InstallProcesses $false).Count)
}
$stopped = 0
$ownedHandles = New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
try {
  foreach ($candidate in @(Get-InstallProcesses $true)) {
    try { $process = [Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId) }
    catch [ArgumentException] { continue } # Already exited before opening it.
    $ownedHandles.Add($process)
    try {
      # Retain the real process object before rechecking identity. A PID alone
      # can be reused; an open handle continues to identify this exact process.
      $null = $process.Handle
      if ($process.HasExited) { continue }
      $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.ProcessId)" -ErrorAction Stop
      if (-not $current -or $current.ProcessId -eq $SelfPid -or
          -not [string]::Equals($current.ExecutablePath, $candidate.ExecutablePath, [StringComparison]::OrdinalIgnoreCase)) {
        if ($process.HasExited) { continue }
        throw "Owned process identity changed before termination: $($candidate.ProcessId)"
      }
      $process.Kill()
      $stopped += 1
    } catch {
      if (-not $process.HasExited) { throw }
    }
  }
  # TerminateProcess is asynchronous. CIM can stop listing an exiting image
  # before its I/O and file handles have finished closing. Require the retained
  # kernel process handles to signal, rather than inferring that from count=0.
  $wait = [Diagnostics.Stopwatch]::StartNew()
  foreach ($process in $ownedHandles) {
    $remainingMs = [Math]::Max(0, 10000 - [int]$wait.ElapsedMilliseconds)
    if (-not $process.WaitForExit($remainingMs)) {
      throw "Owned process did not finish terminating: $($process.Id)"
    }
  }
} finally {
  foreach ($process in $ownedHandles) { $process.Dispose() }
}
$remaining = @()
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $remaining = @(Get-InstallProcesses $true | Where-Object { $_.ProcessId -ne $SelfPid })
  if ($remaining.Count -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
Write-Output "stopped=$stopped remaining=$($remaining.Count)"
if ($remaining.Count -gt 0) { exit 1 }
