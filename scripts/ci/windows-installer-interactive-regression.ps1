param([Parameter(Mandatory = $true)][string]$DriverPath)

# Real OS regressions for the acceptance driver, not a simulated installer.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($DriverPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Get-RegistrationSnapshot', 'Stop-AcceptanceProcess')) {
  $definition = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $definition) { throw "Missing driver function: $name" }
  . ([scriptblock]::Create($definition.Extent.Text))
}

$id = 'zhiyuan-driver-test-' + [guid]::NewGuid().ToString()
$installRoot = Join-Path $env:TEMP $id
$installKey = "HKCU:/Software/$id"
$uninstallKey = "HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/$id"
$sleeper = $null
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
using System.Text;
public static class AcceptanceShortPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetShortPathName(string path, StringBuilder buffer, uint length);
}
'@
try {
  New-Item -ItemType Directory -Path $installRoot | Out-Null
  $uninstaller = Join-Path $installRoot 'Uninstall acceptance fixture.exe'
  [IO.File]::WriteAllBytes($uninstaller, [byte[]]@(0))
  New-Item -Path $installKey,$uninstallKey -Force | Out-Null
  New-ItemProperty -Path $installKey -Name InstallLocation -Value $installRoot -PropertyType String | Out-Null
  New-ItemProperty -Path $installKey -Name KeepShortcuts -Value 'true' -PropertyType String | Out-Null
  # This intentionally mirrors electron-builder: no InstallLocation value in
  # the Uninstall key. The old driver returned no matching installation.
  $command = '"' + $uninstaller + '" /currentuser'
  New-ItemProperty -Path $uninstallKey -Name UninstallString -Value $command -PropertyType String | Out-Null
  New-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '1.0.0' -PropertyType String | Out-Null
  $before = Get-RegistrationSnapshot
  if (-not $before -or $before -notmatch 'KeepShortcuts' -or $before -notmatch 'DisplayVersion') {
    $observedFile = (Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File).FullName
    throw "Driver failed to snapshot both actual electron-builder registration keys. Registry command: $command; observed file: $observedFile; snapshot: $before"
  }
  # Exercise equivalent path spellings without changing the installed bytes.
  # CI's TEMP itself may contain RUNNER~1; also request a real 8.3 spelling.
  $longUninstaller = [IO.Path]::GetFullPath($uninstaller)
  $shortBuffer = New-Object Text.StringBuilder 4096
  $shortLength = [AcceptanceShortPath]::GetShortPathName($longUninstaller, $shortBuffer, $shortBuffer.Capacity)
  if ($shortLength -eq 0 -or $shortLength -ge $shortBuffer.Capacity) { throw 'Could not resolve the real Windows short path for the regression' }
  $aliases = @($longUninstaller, (Join-Path $installRoot '.\Uninstall acceptance fixture.exe'), $shortBuffer.ToString())
  foreach ($alias in $aliases) {
    Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value ('"' + $alias + '" /currentuser')
    Set-ItemProperty -Path $installKey -Name InstallLocation -Value ([IO.Path]::GetDirectoryName($alias))
    $aliasSnapshot = Get-RegistrationSnapshot
    if (-not $aliasSnapshot -or $aliasSnapshot -notmatch 'KeepShortcuts' -or $aliasSnapshot -notmatch 'DisplayVersion') {
      throw "Equivalent Windows path was not recognized: $alias; snapshot: $aliasSnapshot"
    }
  }
  Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value $command
  Set-ItemProperty -Path $installKey -Name InstallLocation -Value $installRoot
  if ((Get-RegistrationSnapshot) -ne $before) { throw 'Restoring raw registration values changed the snapshot' }
  Set-ItemProperty -Path $installKey -Name KeepShortcuts -Value 'false'
  if ((Get-RegistrationSnapshot) -eq $before) { throw 'Install-key changes were not detected' }
  Set-ItemProperty -Path $installKey -Name KeepShortcuts -Value 'true'
  Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '2.0.0'
  if ((Get-RegistrationSnapshot) -eq $before) { throw 'Uninstall-key changes were not detected' }
  Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '1.0.0'
  Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value '"C:\unrelated\Uninstall.exe" /currentuser'
  if (Get-RegistrationSnapshot) { throw 'An unrelated uninstaller was accepted' }
  $otherExecutable = Join-Path $installRoot 'other.exe'
  [IO.File]::WriteAllBytes($otherExecutable, [byte[]]@(0))
  Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value ('"' + $otherExecutable + '" /currentuser')
  if (Get-RegistrationSnapshot) { throw 'A different existing executable was accepted' }
  Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value $command
  Set-ItemProperty -Path $installKey -Name InstallLocation -Value 'C:\unrelated'
  $rejected = $false
  try { $null = Get-RegistrationSnapshot } catch {
    if ($_.Exception.Message -notlike 'Installer location registration does not match*') { throw }
    $rejected = $true
  }
  if (-not $rejected) { throw 'A mismatched installation location was accepted' }

  $sleeper = Start-Process -FilePath "$PSHOME/powershell.exe" -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 30') -WindowStyle Hidden -PassThru
  Stop-AcceptanceProcess $sleeper.Id
  if (-not $sleeper.WaitForExit(10000)) { throw 'Acceptance cleanup did not stop the real test process' }
  # A /T on the root can remove a later child in the same snapshot. A second
  # cleanup of an already-exited PID must not mask the original test failure.
  Stop-AcceptanceProcess $sleeper.Id
  Write-Output 'PASS: registration and repeated process cleanup regressions'
} finally {
  if ($null -ne $sleeper -and -not $sleeper.HasExited) { Stop-Process -Id $sleeper.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $installKey,$uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}
