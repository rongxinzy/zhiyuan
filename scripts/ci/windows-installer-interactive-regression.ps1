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
    throw 'Driver failed to snapshot both actual electron-builder registration keys'
  }
  Set-ItemProperty -Path $installKey -Name KeepShortcuts -Value 'false'
  if ((Get-RegistrationSnapshot) -eq $before) { throw 'Install-key changes were not detected' }
  Set-ItemProperty -Path $installKey -Name KeepShortcuts -Value 'true'
  Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '2.0.0'
  if ((Get-RegistrationSnapshot) -eq $before) { throw 'Uninstall-key changes were not detected' }
  Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '1.0.0'
  Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value '"C:\unrelated\Uninstall.exe" /currentuser'
  if (Get-RegistrationSnapshot) { throw 'An unrelated uninstaller was accepted' }
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
