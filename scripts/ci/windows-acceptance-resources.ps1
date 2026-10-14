param([string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
  throw 'Acceptance resources must be prepared on Windows x64 with PowerShell 7.'
}

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

function Download-Official {
  param([string]$Url, [string]$Destination, [string]$ExpectedSha256 = '')
  $temporary = "$Destination.download"
  try {
    $response = Invoke-WebRequest -Uri $Url -OutFile $temporary -PassThru -MaximumRedirection 5
    $resolved = $response.BaseResponse.RequestMessage.RequestUri
    if ($resolved.Scheme -ne 'https') { throw 'A runtime download redirected away from HTTPS.' }
    $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ExpectedSha256 -and $actualHash -ne $ExpectedSha256) { throw "SHA-256 mismatch: $Url" }
    Move-Item -LiteralPath $temporary -Destination $Destination -Force
    return @{ url = $Url; resolvedUrl = $resolved.AbsoluteUri; sha256 = $actualHash }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

Push-Location $ProjectRoot
try {
  Get-Command node, cl.exe, git, tar -ErrorAction Stop | Out-Null
  $cache = Join-Path $ProjectRoot '.cache\windows-acceptance'
  $reportDirectory = Join-Path $ProjectRoot 'build-tar\windows-acceptance'
  New-Item -ItemType Directory -Force -Path $cache, $reportDirectory | Out-Null

  # Download the exact official compiler pinned by the unchanged Magpie builder.
  # Extraction is local to this checkout; no SDK installer or global PATH change.
  $upstream = Get-Content -LiteralPath 'resources/magpie/upstream.json' -Raw | ConvertFrom-Json
  $toolchain = $upstream.toolchains.'win32-x64'
  $goArchive = Join-Path $cache $toolchain.archive
  $goDownload = Download-Official "https://go.dev/dl/$($toolchain.archive)" $goArchive $toolchain.sha256
  $goRoot = Join-Path $cache $upstream.goVersion
  if (Test-Path -LiteralPath $goRoot) { Remove-Item -LiteralPath $goRoot -Recurse -Force }
  Expand-Archive -LiteralPath $goArchive -DestinationPath $goRoot
  $go = Join-Path $goRoot 'go\bin\go.exe'
  Invoke-Checked 'node' @('scripts/build-magpie-runtime.cjs', '--target', 'win32-x64', '--go', $go)
  Invoke-Checked 'node' @('scripts/verify-magpie-runtime.cjs', '--target', 'win32-x64')

  Invoke-Checked 'pwsh' @('-NoProfile', '-File', 'scripts/python-runtime/build-job-runner.ps1')

  # Official Microsoft permalink, authenticated by the Windows trust provider.
  # This downloads and verifies the redistributable; it does not install it.
  # https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist
  $vcPath = Join-Path $ProjectRoot 'resources\vc_redist.x64.exe'
  $vc = Download-Official 'https://aka.ms/vc14/vc_redist.x64.exe' $vcPath
  $signature = Get-AuthenticodeSignature -LiteralPath $vcPath
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
      $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
    throw 'The official VC redistributable must have a valid Microsoft Authenticode signature.'
  }
  $vc.signatureStatus = $signature.Status.ToString()
  $vc.publisher = $signature.SignerCertificate.Subject
  $vc.certificateThumbprint = $signature.SignerCertificate.Thumbprint

  # Pin the existing PortableGit preparer to its official Git for Windows source.
  # The preparer only extracts an archive; it does not run an installer.
  $gitArchive = Join-Path $cache 'PortableGit-2.47.1-64-bit.7z.exe'
  $gitDownload = Download-Official 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/PortableGit-2.47.1-64-bit.7z.exe' $gitArchive
  $oldArchive = $env:ZHIYUAN_PORTABLE_GIT_ARCHIVE
  $oldUrl = $env:ZHIYUAN_PORTABLE_GIT_URL
  try {
    $env:ZHIYUAN_PORTABLE_GIT_ARCHIVE = $gitArchive
    $env:ZHIYUAN_PORTABLE_GIT_URL = $gitDownload.url
    $gitResources = Join-Path $ProjectRoot 'resources\mingit'
    if (Test-Path -LiteralPath $gitResources) { Remove-Item -LiteralPath $gitResources -Recurse -Force }
    Invoke-Checked 'node' @('scripts/setup-mingit.js', '--required')
  } finally {
    $env:ZHIYUAN_PORTABLE_GIT_ARCHIVE = $oldArchive
    $env:ZHIYUAN_PORTABLE_GIT_URL = $oldUrl
  }
  $gitDownload.bashSha256 = (Get-FileHash -LiteralPath 'resources/mingit/usr/bin/bash.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
  $gitDownload.gitSha256 = (Get-FileHash -LiteralPath 'resources/mingit/cmd/git.exe' -Algorithm SHA256).Hash.ToLowerInvariant()

  # Never consult .env or account-bearing environment variables for this build.
  [System.IO.File]::WriteAllText((Join-Path $ProjectRoot 'resources\modelscope.tokens.local.json'), "{`"tokens`":[]}`n", [System.Text.UTF8Encoding]::new($false))
  $manifest = @{
    schemaVersion = 1
    target = 'win32-x64'
    go = $goDownload
    vcRedist = $vc
    portableGit = $gitDownload
    jobRunnerSha256 = (Get-FileHash -LiteralPath 'resources/python-runtime/job-runner.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
    magpieSourceCommit = $upstream.commit
  }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportDirectory 'prepared.json') -Encoding utf8NoBOM
  Write-Host 'Windows x64 resources prepared. Rebuild Electron native modules, then run verify-inputs.'
} finally {
  Pop-Location
}
