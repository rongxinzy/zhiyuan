param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$ComponentsDir = ''
)

$ErrorActionPreference = 'Stop'

function Assert-Path {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing ${Label}: $Path"
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$Label = $FilePath
  )
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Invoke-PackagedElectronChecked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$Label = $FilePath
  )
  # The packaged Electron binary is a Windows GUI executable even when
  # ELECTRON_RUN_AS_NODE is set. Start-Process -Wait provides deterministic
  # process-tree completion and an explicit exit code on Windows PowerShell 5.1.
  $quotedArguments = @($ArgumentList | ForEach-Object {
    if ($_ -match '"') {
      throw "$Label received an argument containing an unsupported double quote: $_"
    }
    '"' + $_ + '"'
  })
  $process = Start-Process -FilePath $FilePath -ArgumentList $quotedArguments `
    -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Label failed with exit code $($process.ExitCode)"
  }
}

$osVersion = [Environment]::OSVersion.Version
if ($osVersion.Major -ne 10) {
  throw "This gate requires a Windows 10/11-compatible host; detected $osVersion"
}

if (-not $ComponentsDir) {
  $ComponentsDir = Join-Path $ProjectRoot 'build-tar\windows-components'
}
$componentManifestPath = Join-Path $ComponentsDir 'manifest.json'
Assert-Path $componentManifestPath 'Windows component manifest'
$componentManifest = Get-Content -LiteralPath $componentManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($componentManifest.offline -ne $true) {
  throw 'Windows component manifest must declare offline=true'
}
if (@($componentManifest.components).Count -ne 1 -or $componentManifest.components[0].key -ne 'portable-git') {
  throw "Windows component manifest must contain only PortableGit"
}

$systemTar = Join-Path $env:SystemRoot 'System32\tar.exe'
Assert-Path $systemTar 'Windows system tar.exe'

$smokeRoot = Join-Path $env:TEMP ("zhiyuan-runtime-smoke-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))
$oldPath = $env:PATH
try {
  New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
  foreach ($component in @($componentManifest.components)) {
    if ($component.key -match 'llama' -or $component.prefix -match 'llama') {
      throw "The offline component manifest must not include llama.cpp: $($component.key)"
    }
    $archivePath = Join-Path $ComponentsDir $component.archive
    Assert-Path $archivePath "Windows component archive $($component.key)"
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $component.archiveSha256) {
      throw "SHA-256 mismatch for Windows component $($component.key)"
    }
    if ((Get-Item -LiteralPath $archivePath).Length -ne $component.archiveSizeBytes) {
      throw "Size mismatch for Windows component $($component.key)"
    }
    Invoke-Checked $systemTar @('-xf', $archivePath, '-C', $smokeRoot) "Windows component extraction: $($component.key)"
    $sentinelPath = Join-Path $smokeRoot $component.sentinel
    Assert-Path $sentinelPath "Windows component sentinel $($component.key)"
    if ($component.sentinelSha256 -notmatch '^[0-9a-f]{64}$') {
      throw "Missing sentinel SHA-256 for Windows component $($component.key)"
    }
    $sentinelHash = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sentinelHash -ne $component.sentinelSha256) {
      throw "Sentinel SHA-256 mismatch for Windows component $($component.key)"
    }
  }

  $resourcesRoot = $smokeRoot
  $bash = Join-Path $resourcesRoot 'mingit\usr\bin\bash.exe'
  if (-not (Test-Path -LiteralPath $bash)) {
    $bash = Join-Path $resourcesRoot 'mingit\bin\bash.exe'
  }
  $appExecutableName = $env:ZHIYUAN_ELECTRON_EXECUTABLE_NAME
  if (-not $appExecutableName) {
    $builderConfigPath = Join-Path $ProjectRoot 'electron-builder.json'
    Assert-Path $builderConfigPath 'electron-builder configuration'
    $builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $appExecutableName = $builderConfig.executableName
    if (-not $appExecutableName) {
      $appExecutableName = $builderConfig.productName
    }
  }
  if (-not $appExecutableName) {
    throw 'electron-builder.json must define executableName or productName'
  }
  # Exercise the packaged Electron binary instead of relying on the optional
  # node_modules Electron download that bun install --ignore-scripts omits.
  $electron = Join-Path $ProjectRoot ("release\win-unpacked\{0}.exe" -f $appExecutableName)

  Assert-Path $bash 'bundled PortableGit Bash'
  Assert-Path $electron 'packaged Electron Node runtime'

  # Remove Git, Node, and user-installed tool directories from PATH.
  # The smoke test invokes only explicit package paths below.
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  $env:ELECTRON_RUN_AS_NODE = '1'
  foreach ($externalCommand in @('git.exe', 'node.exe')) {
    if (Get-Command $externalCommand -ErrorAction SilentlyContinue) {
      throw "External command unexpectedly remains discoverable on the clean PATH: $externalCommand"
    }
  }

  Invoke-Checked $bash @('-lc', 'printf "portable-git-bash-ok\n"') 'bundled Bash probe'
  Invoke-PackagedElectronChecked $electron @('--version') 'packaged Electron Node version probe'
  Write-Host "Windows runtime smoke passed on Windows $osVersion"
} finally {
  $env:PATH = $oldPath
  if (Test-Path -LiteralPath $smokeRoot) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
  }
}
