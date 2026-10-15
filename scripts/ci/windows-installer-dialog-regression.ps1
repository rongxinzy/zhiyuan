$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'windows-installer-ui.cs') -ReferencedAssemblies System,System.Core,System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'windows-installer-dialog-fixture.cs')
$body = 'The app could not be started. Retry, or close setup and use the Start menu.'
$pattern = '\A' + [regex]::Escape($body) + '\z'
$title = 'ZhiYuan acknowledgement regression ' + [guid]::NewGuid().ToString()

foreach ($id in @(1, 2)) {
  $fixture = [ZhiYuan.Acceptance.DialogFixture]::new($title, $body)
  try {
    $dialog = $null
    $deadline = (Get-Date).AddSeconds(5)
    do {
      $dialog = @([ZhiYuan.Acceptance.InstallerUi]::Windows() | Where-Object {
        $_.ProcessId -eq $PID -and $_.ClassName -eq '#32770' -and $_.Text -eq $title -and $_.OwnerHandle -eq $fixture.Owner
      }) | Select-Object -First 1
      if (-not $dialog) { Start-Sleep -Milliseconds 30 }
    } while (-not $dialog -and (Get-Date) -lt $deadline)
    if (-not $dialog) { throw 'Real native message box did not appear' }
    $button = [ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, $fixture.Owner)
    if (-not $button) { throw 'Real native acknowledgement was not recognized' }
    [ZhiYuan.Acceptance.DialogFixture]::SetId($button.Handle, $id)
    foreach ($owner in @($fixture.Owner, 0)) {
      $selected = [ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, $owner)
      if (-not $selected -or $selected.ControlId -ne $id -or $selected.Handle -ne $button.Handle) { throw "Real OK with control ID $id was rejected" }
    }
    if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, ($PID + 1), $title, $pattern, 0)) { throw 'Wrong process was accepted' }
    if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, 'wrong title', $pattern, 0)) { throw 'Wrong dialog title was accepted' }
    if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, '^wrong body$', 0)) { throw 'Wrong message body was accepted' }
    if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, $dialog.Handle)) { throw 'Wrong modal owner was accepted' }
    [ZhiYuan.Acceptance.DialogFixture]::SetEnabled($fixture.Owner, $true)
    if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, $fixture.Owner)) { throw 'Nonmodal owner was accepted' }
    [ZhiYuan.Acceptance.DialogFixture]::SetEnabled($fixture.Owner, $false)
    [ZhiYuan.Acceptance.DialogFixture]::SetEnabled($button.Handle, $false)
    if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, 0)) { throw 'Disabled acknowledgement was accepted' }
    [ZhiYuan.Acceptance.DialogFixture]::SetEnabled($button.Handle, $true)
    [ZhiYuan.Acceptance.DialogFixture]::SetVisible($button.Handle, $false)
    if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, 0)) { throw 'Hidden acknowledgement was accepted' }
    [ZhiYuan.Acceptance.DialogFixture]::SetVisible($button.Handle, $true)
    [ZhiYuan.Acceptance.DialogFixture]::SetText($button.Handle, 'Cancel')
    if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, 0)) { throw 'Cancel was accepted as OK' }
    [ZhiYuan.Acceptance.DialogFixture]::SetText($button.Handle, '&OK')
    $duplicate = [ZhiYuan.Acceptance.DialogFixture]::AddButton($dialog.Handle)
    try {
      if ([ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, 0)) { throw 'Multiple visible OK buttons were accepted' }
      $rejected = $false
      try { [ZhiYuan.Acceptance.InstallerUi]::ClickDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, $fixture.Owner) } catch { $rejected = $true }
      if (-not $rejected) { throw 'Click did not revalidate the changed dialog' }
    } finally { [ZhiYuan.Acceptance.DialogFixture]::RemoveButton($duplicate) }
    [ZhiYuan.Acceptance.InstallerUi]::ClickDialogAcknowledgement($dialog.Handle, $PID, $title, $pattern, $fixture.Owner)
    if (-not $fixture.WaitForExit(5000)) { throw "Real BM_CLICK did not close OK dialog with control ID $id" }
    # MessageBox(MB_OK) returns its semantic IDOK result (1). GetDlgCtrlID
    # describes the child control and can be 2 without changing that result.
    if ($fixture.Result -ne 1) { throw "Unexpected native MB_OK dialog result $($fixture.Result), expected IDOK (1)" }
  } finally { $fixture.Dispose() }
}
Write-Output 'PASS: real modal OK dialogs with control IDs 1 and 2 preserve process, owner, body and unique-action checks'

function Wait-FixtureDialog {
  param($Fixture, [string]$Title)
  $deadline = (Get-Date).AddSeconds(5)
  do {
    $window = [ZhiYuan.Acceptance.InstallerUi]::Windows() | Where-Object {
      $_.ProcessId -eq $PID -and $_.ClassName -eq '#32770' -and $_.Text -eq $Title -and $_.OwnerHandle -eq $Fixture.Owner
    } | Select-Object -First 1
    if ($window) { return $window }
    Start-Sleep -Milliseconds 30
  } while ((Get-Date) -lt $deadline)
  throw "Real fixture dialog did not appear: $Title"
}

$target = [ZhiYuan.Acceptance.DialogFixture]::new($title, $body)
$distraction = $null
try {
  $targetWindow = Wait-FixtureDialog $target $title
  $targetButton = [ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($targetWindow.Handle, $PID, $title, $pattern, $target.Owner)
  $otherTitle = "$title other foreground window"
  $distraction = [ZhiYuan.Acceptance.DialogFixture]::new($otherTitle, $body)
  $otherWindow = Wait-FixtureDialog $distraction $otherTitle
  $otherButton = [ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($otherWindow.Handle, $PID, $otherTitle, $pattern, $distraction.Owner)
  $rejected = $false
  try { $null = [ZhiYuan.Acceptance.InstallerUi]::ClickActiveDialogButton($targetWindow.Handle, $otherButton.Handle) } catch { $rejected = $true }
  if (-not $rejected) { throw 'A button belonging to another dialog was accepted' }
  $deadline = (Get-Date).AddSeconds(5)
  do {
    [ZhiYuan.Acceptance.DialogFixture]::Foreground($otherWindow.Handle)
    if ([ZhiYuan.Acceptance.InstallerUi]::ForegroundWindowHandle() -eq $otherWindow.Handle) { break }
    Start-Sleep -Milliseconds 30
  } while ((Get-Date) -lt $deadline)
  if ([ZhiYuan.Acceptance.InstallerUi]::ForegroundWindowHandle() -ne $otherWindow.Handle) { throw 'Could not establish the real background-dialog precondition' }
  $receipt = [ZhiYuan.Acceptance.InstallerUi]::ClickActiveDialogButton($targetWindow.Handle, $targetButton.Handle)
  if ($receipt.ForegroundBefore -ne $otherWindow.Handle -or $receipt.ActiveAtClick -ne $targetWindow.Handle -or
      $receipt.ForegroundAtClick -ne $targetWindow.Handle -or $receipt.ButtonHandle -ne $targetButton.Handle) {
    throw "Target dialog was not activated before the one real click: $($receipt | ConvertTo-Json -Compress)"
  }
  if (-not $target.WaitForExit(5000)) { throw 'Activated real button click did not close the target dialog' }
  if ($distraction.WaitForExit(0)) { throw 'Activated click closed the unrelated foreground dialog' }
  Write-Output 'PASS: one activated real button click closes only the bound background dialog'
} finally {
  if ($null -ne $distraction) { $distraction.Dispose() }
  $target.Dispose()
}
