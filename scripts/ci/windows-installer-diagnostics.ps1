[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][DateTime]$StartedAt
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-NormalizedPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd([char[]]'\/')
}

# This collector is only for the two NSIS acceptance callers' exact installs.
# Do not accept a prefix, arbitrary descendants, or every path under RUNNER_TEMP.
if (-not $env:RUNNER_TEMP) {
  throw 'Installer diagnostics require an exact CI-owned acceptance directory under RUNNER_TEMP.'
}
$InstallRoot = Get-NormalizedPath $InstallRoot
$ownedInstallRoots = @(
  'zhiyuan-acceptance-installed',
  'zhiyuan-interactive-acceptance/安装路径'
) | ForEach-Object { Get-NormalizedPath (Join-Path $env:RUNNER_TEMP $_) }
if ($ownedInstallRoots -inotcontains $InstallRoot) {
  throw 'Installer diagnostics require an exact CI-owned acceptance directory under RUNNER_TEMP.'
}
# An allowlisted spelling must not redirect the file probes through a junction.
for ($directory = [IO.DirectoryInfo]::new($InstallRoot); $null -ne $directory; $directory = $directory.Parent) {
  if ($directory.Exists -and ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Installer diagnostics require a physical CI-owned acceptance directory without directory links.'
  }
}
$startedUtc = $StartedAt.ToUniversalTime()
$outputRoot = Join-Path $ProjectRoot 'acceptance-diagnostics'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$encoding = [Text.UTF8Encoding]::new($false)

function Read-FreshTail([string]$Path, [int]$MaximumBytes) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LastWriteTimeUtc -lt $startedUtc -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $null }
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read,
    ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try {
    $offset = [Math]::Max(0, $stream.Length - $MaximumBytes)
    $null = $stream.Seek($offset, [IO.SeekOrigin]::Begin)
    $buffer = New-Object byte[] $MaximumBytes
    $count = 0
    while ($count -lt $buffer.Length) {
      $read = $stream.Read($buffer, $count, $buffer.Length - $count)
      if ($read -eq 0) { break }
      $count += $read
    }
    $text = $encoding.GetString($buffer, 0, $count).TrimStart([char]0xfeff)
    if ($offset -gt 0) {
      # Never treat a partial line at the bounded tail's start as a run marker.
      $newline = $text.IndexOf("`n")
      if ($newline -lt 0) { return $null }
      $text = $text.Substring($newline + 1)
    }
    return $text
  } finally {
    $stream.Dispose()
  }
}

# NSIS shell folders can differ from overridden process environment variables.
# Probe only exact installer-owned names; never enumerate profile directories.
$roots = @(
  [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData),
  [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData),
  [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData),
  $env:APPDATA, $env:LOCALAPPDATA, $env:PROGRAMDATA
) | Where-Object { $_ } | ForEach-Object { Get-NormalizedPath $_ } | Select-Object -Unique
$results = @()
$ownedRunFound = $false
$index = 0
foreach ($root in $roots) {
  $index++
  $logPath = Join-Path $root 'ZhiYuanAgent\install-timing.log'
  $entry = [ordered]@{ path = $logPath; status = 'missing-or-stale'; output = $null }
  try {
    $text = Read-FreshTail $logPath 1048576
    if ($null -ne $text) {
      $lines = @($text -split '\r?\n')
      $lastStart = -1
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^phase=run-start(?:\s|$)') { $lastStart = $i }
      }
      $entry.status = 'no-current-owned-run'
      # Do not fall back to an earlier matching run if another install followed it.
      if ($lastStart -ge 0 -and
          $lines[$lastStart] -match '^phase=run-start\s+tick_ms=(\d+)\s+mode=\S+\s+instdir=(.+)$') {
        $tick = $Matches[1]
        $runRoot = Get-NormalizedPath $Matches[2]
        if ($runRoot -ieq $InstallRoot) {
          $ownedRunFound = $true
          $entry.output = "installer-timing-$index.log"
          [IO.File]::WriteAllText((Join-Path $outputRoot $entry.output),
            ($lines[$lastStart..($lines.Count - 1)] -join "`n"), $encoding)
          $entry.status = 'collected'
          $tickText = Read-FreshTail (Join-Path $root 'ZhiYuanAgent\install-start-tick.txt') 128
          if ($null -ne $tickText -and $tickText.Trim() -ceq $tick) {
            [IO.File]::WriteAllText((Join-Path $outputRoot "installer-start-tick-$index.txt"), $tick, $encoding)
          }
        }
      }
    }
  } catch {
    $entry.status = 'read-failed'
  }
  $results += [pscustomobject]$entry
}

# Rollback state has no run ID. Require an owned fresh timing run, fresh state,
# and the exact current protocol; never export arbitrary contents from this file.
if ($ownedRunFound) {
  $index = 0
  foreach ($root in $roots) {
    $index++
    $statePath = Join-Path $root 'ZhiYuanAgent\runtimes\component-switch-state.txt'
    $entry = [ordered]@{ path = $statePath; status = 'missing-or-stale'; output = $null }
    try {
      $text = Read-FreshTail $statePath 8192
      if ($null -ne $text) {
        $entry.status = 'unrecognized-state'
        if ($text.Trim() -cmatch '\Aportable-git\|(True|False)\z') {
          $entry.output = "installer-component-switch-state-$index.txt"
          [IO.File]::WriteAllText((Join-Path $outputRoot $entry.output), $text.Trim(), $encoding)
          $entry.status = 'collected'
        }
      }
    } catch {
      $entry.status = 'read-failed'
    }
    $results += [pscustomobject]$entry
  }
}

$files = @('知远.exe', 'resources\app.asar', 'resources\mingit\cmd\git.exe') | ForEach-Object {
  $path = Join-Path $InstallRoot $_
  [pscustomobject]@{ path = $path; exists = [bool](Test-Path -LiteralPath $path -PathType Leaf) }
}
$summary = [ordered]@{
  startedAtUtc = $startedUtc.ToString('o')
  installRoot = $InstallRoot
  ownedRunFound = $ownedRunFound
  files = @($files)
  sources = @($results)
}
[IO.File]::WriteAllText((Join-Path $outputRoot 'installer-summary.json'),
  ($summary | ConvertTo-Json -Depth 5), $encoding)
Write-Host "[WindowsInstallerDiagnostics] Saved bounded installer diagnostics to $outputRoot"
