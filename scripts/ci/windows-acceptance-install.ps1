$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$diagnostics = Join-Path $project 'acceptance-diagnostics'
$output = Join-Path $project 'acceptance-output'
$installRoot = Join-Path $env:RUNNER_TEMP 'zhiyuan-acceptance-installed'
New-Item -ItemType Directory -Force $diagnostics,$installRoot | Out-Null
$installers = @(Get-ChildItem -LiteralPath (Join-Path $project 'release') -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw "Expected one NSIS installer, found $($installers.Count)" }
$installer = $installers[0]
$signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
if ($signature.Status -ne 'NotSigned') { throw "Expected an explicitly unsigned acceptance installer: $($signature.Status)" }
# The installer uses Windows Known Folders and the disposable runner profile.
# Do not override USERPROFILE/APPDATA independently of those OS APIs. The actual
# application is launched with its own isolated profile by windows-app-smoke.
Copy-Item -Path (Join-Path $project 'build-tar/windows-acceptance/*.json') -Destination $diagnostics
$started = Get-Date
# /D must be the final NSIS argument. This is a fresh, CI-owned destination.
try {
  $process = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$installRoot" -PassThru
  if (-not $process.WaitForExit(900000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'Acceptance installation exceeded 15 minutes'
  }
  if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
} finally {
  & (Join-Path $PSScriptRoot 'windows-installer-diagnostics.ps1') -ProjectRoot $project -InstallRoot $installRoot -StartedAt $started
}
$app = Join-Path $installRoot '知远.exe'
if (-not (Test-Path -LiteralPath $app)) { throw 'Installer did not create the application executable' }
@{ exitCode=$process.ExitCode; elapsedSeconds=((Get-Date)-$started).TotalSeconds; installedExecutable=$app } |
  ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $diagnostics 'installation.json')
node (Join-Path $PSScriptRoot 'windows-app-smoke.mjs') --app $app --output $diagnostics
if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed; no acceptance installer will be uploaded' }
# Only verified packages enter the downloadable artifact directory.
New-Item -ItemType Directory -Force $output | Out-Null
Copy-Item -LiteralPath $installer.FullName -Destination $output
Copy-Item -LiteralPath $diagnostics -Destination (Join-Path $output 'evidence') -Recurse
$hash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $($installer.Name)" | Set-Content -Encoding utf8 (Join-Path $output 'SHA256SUMS.txt')
@{
  commit=$env:GITHUB_SHA; runId=$env:GITHUB_RUN_ID; architecture='x64'; platform='win32';
  signed=$false; installer=$installer.Name; sha256=$hash; verifiedAt=(Get-Date).ToUniversalTime().ToString('o');
  checks=@('clean build','production-only dependency resolution','installation','packaged Electron UI','packaged Magpie','packaged Python Runner')
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $output 'build-manifest.json')
@'
Windows x64 acceptance build, unsigned. This artifact is a ZIP containing the NSIS installer, SHA-256 checksum, source commit and automated acceptance evidence.
Windows may display an unsigned-app or reputation warning. This build does not have a verified publisher signature.
No account sign-in or paid model call was used in CI. Model sources and subscription accounts require explicit configuration by the user.
Automated CI checks are not a substitute for the user's desktop acceptance or signing/release certification.
'@ | Set-Content -Encoding utf8 (Join-Path $output 'READ-ME.txt')
