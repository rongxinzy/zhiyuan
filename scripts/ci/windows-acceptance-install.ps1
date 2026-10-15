param([switch]$NativeOnly)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$diagnostics = Join-Path $project 'acceptance-diagnostics'
$output = Join-Path $project 'acceptance-output'
$installRoot = Join-Path $env:RUNNER_TEMP 'zhiyuan-acceptance-installed'
New-Item -ItemType Directory -Force $diagnostics | Out-Null
$nativeInstallers = @(Get-ChildItem -LiteralPath (Join-Path $project 'release') -Filter '*.exe' -File)
if ($nativeInstallers.Count -ne 1) { throw "Expected one underlying NSIS installer, found $($nativeInstallers.Count)" }
$nativeInstaller = $nativeInstallers[0]
$nativeHash = (Get-FileHash -LiteralPath $nativeInstaller.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
# NSIS remains the updater/underlying regression, never the final first-install artifact.
$interactivePath = Join-Path $diagnostics 'interactive/report.json'
if (-not (Test-Path -LiteralPath $interactivePath)) { throw 'Real interactive installer acceptance evidence is required' }
$interactive = Get-Content -LiteralPath $interactivePath -Raw | ConvertFrom-Json
if ($interactive.kind -ne 'nsis-interactive-acceptance' -or $interactive.passed -ne $true -or
    $interactive.installerSha256 -ne $nativeHash -or $interactive.commit -ne $env:GITHUB_SHA -or
    $interactive.runId -ne $env:GITHUB_RUN_ID) {
  throw 'Underlying NSIS interactive acceptance did not pass for this installer and CI run'
}
foreach ($check in @('freshInstall', 'closeWithoutLaunch', 'cancelPreservesRunningInstallation', 'lockedDirectoryRetry', 'launchFailureRecovery', 'finishLaunchesInstalledApplication', 'visibleActionsFitActualDpi', 'chineseAndEnglish')) {
  if ($interactive.checks.$check -ne $true) { throw "Missing underlying NSIS interactive acceptance check: $check" }
}
foreach ($page in @('fresh-welcome', 'fresh-progress', 'fresh-finish', 'existing-install-before-cancel', 'recovery-locked-directory', 'recovery-finish', 'finish-launch-error', 'finish-launch-recovered', 'launched-installed-app')) {
  $png = Join-Path $diagnostics "interactive/$page.png"
  if (-not (Test-Path -LiteralPath $png) -or (Get-Item -LiteralPath $png).Length -eq 0) {
    throw "Missing real underlying NSIS screenshot: $page"
  }
}
$nativeResultPath = Join-Path $diagnostics 'native-installation.json'
if ($NativeOnly) {
  if ((Get-AuthenticodeSignature -LiteralPath $nativeInstaller.FullName).Status -ne 'NotSigned') { throw 'Expected an explicitly unsigned acceptance installer' }
  New-Item -ItemType Directory -Force $installRoot | Out-Null
  # /D must be the final NSIS argument. Keep the real silent regression in a
  # distinct, CI-owned directory. Never use this installation for shell proof.
  $started = Get-Date
  try {
    $process = Start-Process -FilePath $nativeInstaller.FullName -ArgumentList "/S /D=$installRoot" -PassThru
    if (-not $process.WaitForExit(900000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw 'Underlying NSIS installation exceeded 15 minutes'
    }
    if ($process.ExitCode -ne 0) { throw "Underlying NSIS installer exited with $($process.ExitCode)" }
  } finally {
    & (Join-Path $PSScriptRoot 'windows-installer-diagnostics.ps1') -ProjectRoot $project -InstallRoot $installRoot -StartedAt $started
  }
  if (-not (Test-Path -LiteralPath (Join-Path $installRoot '知远.exe'))) { throw 'Underlying NSIS did not install the application' }
  @{
    kind='underlying-nsis-silent-regression'; passed=$true; exitCode=$process.ExitCode;
    commit=$env:GITHUB_SHA; runId=$env:GITHUB_RUN_ID; installerSha256=$nativeHash;
    installedExecutable=(Join-Path $installRoot '知远.exe'); elapsedSeconds=((Get-Date)-$started).TotalSeconds
  } | ConvertTo-Json | Set-Content -Encoding utf8 $nativeResultPath
  return
}
if (-not (Test-Path -LiteralPath $nativeResultPath)) { throw 'Underlying NSIS silent regression evidence is required' }
$nativeResult = Get-Content -LiteralPath $nativeResultPath -Raw | ConvertFrom-Json
if ($nativeResult.kind -ne 'underlying-nsis-silent-regression' -or $nativeResult.passed -ne $true -or
    $nativeResult.installerSha256 -ne $nativeHash -or $nativeResult.commit -ne $env:GITHUB_SHA -or $nativeResult.runId -ne $env:GITHUB_RUN_ID) {
  throw 'Underlying NSIS silent regression evidence does not match this build'
}

# The only deliverable is the distinct, real WebView2 single-file setup.
$installers = @(Get-ChildItem -LiteralPath (Join-Path $project 'release/setup') -Filter 'ZhiYuanAgent-Setup-*.exe' -File)
if ($installers.Count -ne 1) { throw "Expected one final WebView2 setup, found $($installers.Count)" }
$installer = $installers[0]
if ((Get-AuthenticodeSignature -LiteralPath $installer.FullName).Status -ne 'NotSigned') { throw 'Expected an explicitly unsigned acceptance installer' }
$app = Join-Path $env:RUNNER_TEMP 'zhiyuan-shell-acceptance/安装路径/知远.exe'
$shellEvidence = Join-Path $diagnostics 'shell-interactive'
node (Join-Path $PSScriptRoot 'windows-shell-evidence.mjs') $shellEvidence $installer.FullName $app
if ($LASTEXITCODE -ne 0) { throw 'Real hash-bound WebView2 install/finish/launch evidence is required before delivery' }
$shellReport = Get-Content -LiteralPath (Join-Path $shellEvidence 'report.json') -Raw | ConvertFrom-Json
Copy-Item -Path (Join-Path $project 'build-tar/windows-acceptance/*.json') -Destination $diagnostics
# Full Magpie, Python, PowerShell, SQLite and Electron UI checks run against the
# actual app installed by visible shell actions, not win-unpacked or /S output.
node (Join-Path $PSScriptRoot 'windows-app-smoke.mjs') --app $app --output $diagnostics
if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed; no acceptance installer will be uploaded' }
# Recheck identity/evidence after the full application smoke before publication.
node (Join-Path $PSScriptRoot 'windows-shell-evidence.mjs') $shellEvidence $installer.FullName $app
if ($LASTEXITCODE -ne 0) { throw 'Shell acceptance evidence changed during application smoke' }
New-Item -ItemType Directory -Force $output | Out-Null
Copy-Item -LiteralPath $installer.FullName -Destination $output
Copy-Item -LiteralPath "$($installer.FullName).manifest.json" -Destination $output
Copy-Item -LiteralPath $diagnostics -Destination (Join-Path $output 'evidence') -Recurse
$hash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $($installer.Name)" | Set-Content -Encoding utf8 (Join-Path $output 'SHA256SUMS.txt')
@{
  commit=$env:GITHUB_SHA; runId=$env:GITHUB_RUN_ID; architecture='x64'; platform='win32';
  signed=$false; installerKind='webview2-single-file-shell'; installer=$installer.Name;
  installerBytes=$installer.Length; sha256=$hash; verifiedAt=(Get-Date).ToUniversalTime().ToString('o');
  installedAppSha256=$shellReport.installedAppSha256; installedAsarSha256=$shellReport.installedAsarSha256;
  underlyingNsis=@{ sha256=$nativeHash; role='updater and regression only; not delivered as first-install setup' };
  shellEvidence='evidence/shell-interactive/report.json';
  checks=@('clean build','production-only dependency resolution','real WebView2 visible install/progress/finish/launch',
    'missing WebView2 explicit failure','existing-install cancellation safety','locked-directory failure and retry',
    'user-data preservation','actual-DPI action layout','underlying NSIS UI and silent regression',
    'shell-installed Electron UI','packaged Magpie','packaged Python Runner','packaged PowerShell 7 and 5.1','native package hygiene')
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $output 'build-manifest.json')
Get-Content -LiteralPath (Join-Path $output 'build-manifest.json') -Raw | Write-Output
@'
Windows x64 acceptance build, unsigned. This artifact ZIP contains the real single-file WebView2 setup, SHA-256 checksum, source commit and acceptance evidence.
Windows may display an unsigned-app or reputation warning. This build does not have a verified publisher signature.
Microsoft Edge WebView2 Runtime is required. If it is missing, setup shows an explicit error and exits without automatically downloading or accepting an agreement.
The NSIS updater package is tested separately and is not the first-install executable delivered in this ZIP.
Python downloads and verifies its pinned interpreter and uv on first use; this requires network access. Installing new third-party packages may also require network access.
No account sign-in or paid model call was used in CI. Model sources and subscription accounts require explicit configuration by the user.
Actual runner DPI is recorded. Automated checks do not establish high-DPI coverage beyond that recorded value, desktop acceptance or signing/release certification.
'@ | Set-Content -Encoding utf8 (Join-Path $output 'READ-ME.txt')
