# Shared uninstall cleanup: component junction removal plus offline runtime
# cache detach/reclamation. Verbatim extraction of the inline PowerShell/cmd
# spans that used to live in scripts/nsis-installer.nsh !macro customUnInstall
# ("Remove component junctions..." through the legacy runtime-packs detach);
# behavior is intentionally unchanged. Both uninstallers orchestrate via this
# script.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot
)

# The original inline spans ran with PowerShell defaults (no Stop/StrictMode)
# and the NSIS caller ignored their exit codes; keep that forgiving shape.

# Detach resource junctions before recursive cleanup so deletion never follows
# a link into an external runtime cache.
$resources = Join-Path $InstallDir 'resources'
Get-ChildItem -LiteralPath $resources -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
  if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    [IO.Directory]::Delete($_.FullName)
  }
}

# Drop current/current.next/current.previous pointer junctions under every
# runtime cache directory (verbatim from the NSIS inline span).
if (Test-Path -LiteralPath $RuntimeRoot) {
  Get-ChildItem -LiteralPath $RuntimeRoot -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
    foreach ($pointerName in @('current', 'current.next', 'current.previous')) {
      $pointer = Join-Path $_.FullName $pointerName
      if (Test-Path -LiteralPath $pointer) {
        $pointerItem = Get-Item -LiteralPath $pointer -Force
        if (($pointerItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($pointer) }
      }
    }
  }
}

# Reclaim previously detached runtime caches (verbatim from the NSIS inline
# span: stale runtimes.uninstall.* sweep, then detach the live cache and hand
# it to a background recursive delete).
$runtimeUninstallGlob = 'for /d %D in ("' + $RuntimeRoot + '.uninstall.*") do @start "" /b cmd /d /c rd /s /q "%~fD"'
& "$env:COMSPEC" /c $runtimeUninstallGlob | Out-Null
if (Test-Path -LiteralPath $RuntimeRoot) {
  if (@(Get-ChildItem -LiteralPath $RuntimeRoot -Force -ErrorAction SilentlyContinue).Count -gt 0) {
    $detachedRuntime = $RuntimeRoot + '.uninstall.' + [Environment]::TickCount
    Rename-Item -LiteralPath $RuntimeRoot -NewName (Split-Path $detachedRuntime -Leaf) -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $detachedRuntime) {
      & "$env:COMSPEC" /c ('start "" /b cmd /d /c rd /s /q "' + $detachedRuntime + '"') | Out-Null
    }
  } else {
    Remove-Item -LiteralPath $RuntimeRoot -Force -ErrorAction SilentlyContinue
  }
}

# Same detach/background-delete treatment for the legacy runtime-packs cache
# (verbatim from the NSIS inline span).
$legacyRoot = Join-Path (Split-Path $RuntimeRoot -Parent) 'runtime-packs'
$legacyUninstallGlob = 'for /d %D in ("' + $legacyRoot + '.uninstall.*") do @start "" /b cmd /d /c rd /s /q "%~fD"'
& "$env:COMSPEC" /c $legacyUninstallGlob | Out-Null
if (Test-Path -LiteralPath $legacyRoot) {
  if (@(Get-ChildItem -LiteralPath $legacyRoot -Force -ErrorAction SilentlyContinue).Count -gt 0) {
    $detachedLegacy = $legacyRoot + '.uninstall.' + [Environment]::TickCount
    Rename-Item -LiteralPath $legacyRoot -NewName (Split-Path $detachedLegacy -Leaf) -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $detachedLegacy) {
      & "$env:COMSPEC" /c ('start "" /b cmd /d /c rd /s /q "' + $detachedLegacy + '"') | Out-Null
    }
  } else {
    Remove-Item -LiteralPath $legacyRoot -Force -ErrorAction SilentlyContinue
  }
}
