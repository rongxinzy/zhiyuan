# Shared uninstall cleanup. Reclaim only current-contract component versions
# with matching completion records. Unknown/retired data and previous detached
# backups remain untouched. Both uninstallers pass their owned install root;
# the shell passes its already-detached application directory.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot
)

$ErrorActionPreference = 'Stop'

function Assert-PhysicalDirectoryPath([string]$Path) {
  for ($directory = [IO.DirectoryInfo]::new($Path); $null -ne $directory; $directory = $directory.Parent) {
    if ($directory.Exists -and ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "Unsafe uninstall cleanup directory link: $($directory.FullName)"
    }
  }
}

function Remove-ApplicationLinks([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName) }
    else { [IO.File]::Delete($item.FullName) }
    return
  }
  if ($item.PSIsContainer) {
    foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop)) {
      Remove-ApplicationLinks $child.FullName
    }
  }
}

# Validate every parent before detaching any pointer or component directory.
$componentRoot = Join-Path $RuntimeRoot 'portable-git'
Assert-PhysicalDirectoryPath $InstallDir
Assert-PhysicalDirectoryPath $componentRoot

# Enumerate only the known component's immediate versions, never arbitrary
# runtime component roots. A hash-shaped folder alone is not owned data.
$versions = @()
foreach ($version in @(Get-ChildItem -LiteralPath $componentRoot -Directory -Force -ErrorAction SilentlyContinue)) {
  if ($version.Name -cnotmatch '^[0-9a-f]{64}\z' -or
      ($version.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
  $complete = Join-Path $version.FullName '.complete'
  if (-not (Test-Path -LiteralPath $complete -PathType Leaf)) { continue }
  $completeItem = Get-Item -LiteralPath $complete -Force
  if ($completeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
  $completion = Get-Content -LiteralPath $complete -Raw
  if (-not $completion -or ($completion -split '\|', 2)[0] -cne $version.Name) { continue }
  $versions += $version.FullName
}

# NSIS recursively deletes the application after this script. Strip links
# anywhere inside the validated application tree first, including links outside
# resources. Never enumerate a link target. Scan/unlink errors must propagate
# so the caller cannot continue with an unsafe recursive application removal.
if (Test-Path -LiteralPath $InstallDir -PathType Container) {
  Remove-ApplicationLinks $InstallDir
}
$pointers = @()
foreach ($pointerName in @('current', 'current.next', 'current.previous')) {
  $pointers += Join-Path $componentRoot $pointerName
}
foreach ($pointer in $pointers) {
  if (Test-Path -LiteralPath $pointer) {
    $pointerItem = Get-Item -LiteralPath $pointer -Force
    if ($pointerItem.PSIsContainer -and ($pointerItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      [IO.Directory]::Delete($pointer)
    }
  }
}

# Detach each verified version to a unique path before asynchronous deletion.
# A reinstall can immediately create the original content-addressed directory.
$detached = @()
foreach ($version in $versions) {
  Assert-PhysicalDirectoryPath $version
  $target = $version + '.uninstall.' + [Guid]::NewGuid().ToString('n')
  Rename-Item -LiteralPath $version -NewName ([IO.Path]::GetFileName($target))
  $detached += $target
}

$cleanupScript = @'
$ErrorActionPreference = 'Stop'
function Assert-PhysicalDirectoryPath([string]$Path) {
  for ($directory = [IO.DirectoryInfo]::new($Path); $null -ne $directory; $directory = $directory.Parent) {
    if ($directory.Exists -and ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Uninstall cleanup path became a directory link; preserving it'
    }
  }
}
function Remove-TreeWithoutFollowingLinks([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName) }
    else { [IO.File]::Delete($item.FullName) }
    return
  }
  if ($item.PSIsContainer) {
    foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) {
      Remove-TreeWithoutFollowingLinks $child.FullName
    }
    [IO.Directory]::Delete($item.FullName)
  } else {
    if ($item.IsReadOnly) { $item.IsReadOnly = $false }
    [IO.File]::Delete($item.FullName)
  }
}
foreach ($target in @($env:ZY_UNINSTALL_COMPONENT_TARGETS | ConvertFrom-Json)) {
  Assert-PhysicalDirectoryPath $target
  if (Test-Path -LiteralPath $target -PathType Container) { Remove-TreeWithoutFollowingLinks $target }
}
# Nonrecursive deletion removes only an empty owned root. Any unknown file,
# component, pending journal or manual backup keeps its containing root alive.
foreach ($root in @($env:ZY_UNINSTALL_COMPONENT_ROOT, $env:ZY_UNINSTALL_RUNTIME_ROOT)) {
  Assert-PhysicalDirectoryPath $root
  if (Test-Path -LiteralPath $root -PathType Container) {
    try { [IO.Directory]::Delete($root) } catch [IO.IOException] { }
  }
}
'@
$previousTargets = $env:ZY_UNINSTALL_COMPONENT_TARGETS
$previousComponentRoot = $env:ZY_UNINSTALL_COMPONENT_ROOT
$previousRuntimeRoot = $env:ZY_UNINSTALL_RUNTIME_ROOT
try {
  $env:ZY_UNINSTALL_COMPONENT_TARGETS = ConvertTo-Json -InputObject @($detached) -Compress
  $env:ZY_UNINSTALL_COMPONENT_ROOT = $componentRoot
  $env:ZY_UNINSTALL_RUNTIME_ROOT = $RuntimeRoot
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanupScript))
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', $encoded | Out-Null
} finally {
  $env:ZY_UNINSTALL_COMPONENT_TARGETS = $previousTargets
  $env:ZY_UNINSTALL_COMPONENT_ROOT = $previousComponentRoot
  $env:ZY_UNINSTALL_RUNTIME_ROOT = $previousRuntimeRoot
}
