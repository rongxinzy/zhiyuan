!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; Native, DPI-scaled setup pages and translated strings. PROJECT_DIR anchors
; includes because electron-builder compiles from its NSIS staging directory.
; Prepare state is needed before zy-pages.nsh expands the page-leave macro.
!ifndef BUILD_UNINSTALLER
Var /GLOBAL preparedInstallRoot
!endif

; ---------------------------------------------------------------------------
; Macros consumed by the UI includes below. NSIS macros must be defined
; before their first insertion point: ZYHeroLeave (in zy-pages.nsh) inserts
; PrepareExistingInstallForExtraction while that file is still being
; processed, so these live ahead of the includes. StopAppProcesses,
; CountInstallDirProcesses and ForgetOldInstallRegistry stay available to
; the uninstaller pass; the timing-log helper and the extraction itself
; are installer-only.
; ---------------------------------------------------------------------------

; PrepareExistingInstallForExtraction is inserted from ZYHeroLeave (in the
; installer-ui/zy-pages.nsh include below) — ahead of multiUser.nsh, where
; electron-builder defines these keys with the same /ifndef fallback values.
; Mirror the defaults here so registry macros expand correctly at that
; earlier point.
!define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!define /ifndef UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

; This must be usable before customUnInit: electron-builder checks running
; processes earlier in un.onInit for silent uninstall. Stage from every entry
; instead of trusting a previous page or a particular initialization order.
!macro AssertOwnedInstallRoot MODE
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=validate-install-root.ps1 "${PROJECT_DIR}\scripts\installer\validate-install-root.ps1"
  File /oname=manage-install-processes.ps1 "${PROJECT_DIR}\scripts\installer\manage-install-processes.ps1"
  Push $R6
  Push $R7
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-install-root.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -AppDataRoot "$APPDATA\ZhiYuanAgent" -Mode ${MODE}'
  Pop $R6
  Pop $R7
  ${If} $R6 != "0"
    DetailPrint "[Installer] Installation directory rejected: $R7"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "$(ZY_UNSAFE_INSTALL_ROOT)"
    ${EndIf}
    SetErrorLevel 87
    Quit
  ${EndIf}
  Pop $R7
  Pop $R6
!macroend

!macro AssertOwnedInstallRootForBuild
  !ifdef BUILD_UNINSTALLER
    !insertmacro AssertOwnedInstallRoot uninstall
  !else
    !insertmacro AssertOwnedInstallRoot install
  !endif
!macroend

; electron-builder's CHECK_APP_RUNNING treats any process whose image path
; starts with $INSTDIR as "app still running". Helper processes such as
; llama-server and git survive a force-killed main process, so kill by
; install-root/runtime-cache path prefix instead of by process name; otherwise
; orphaned sidecars keep the "cannot be closed" retry dialog up forever.
; The caller itself is excluded: an in-place uninstaller runs from $INSTDIR.
!macro StopAppProcesses
  !insertmacro AssertOwnedInstallRootForBuild
  System::Call 'kernel32::GetCurrentProcessId()i .r9'
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\manage-install-processes.ps1" -Mode stop -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -SelfPid $9'
  Pop $0
  ${If} $0 != "0"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "$(ZY_APP_UNCLOSABLE)"
    ${EndIf}
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

; Counts processes whose image path starts with $INSTDIR (the count is the
; PowerShell exit code, so no stdout parsing is needed). After a failed
; detach this distinguishes "app still running" from "directory held by
; another program" — electron-builder reports both as "cannot be closed".
!macro CountInstallDirProcesses RESULT
  !insertmacro AssertOwnedInstallRootForBuild
  System::Call 'kernel32::GetCurrentProcessId()i .r9'
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\manage-install-processes.ps1" -Mode count -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -SelfPid $9'
  Pop ${RESULT}
  ; Discard the captured stdout without clobbering ${RESULT}: the only caller
  ; passes $R0, and popping stdout into $R0 would overwrite the count.
  Pop $R8
!macroend

; Replace the template's unvalidated path-prefix kill, including its early
; silent-uninstaller entry. Keep a real retry path if an owned process resists.
!macro customCheckAppRunning
  OwnedAppProcessRetry:
  !insertmacro StopAppProcesses
  !insertmacro CountInstallDirProcesses $R0
  ${If} $R0 != "0"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(ZY_APP_UNCLOSABLE)" /SD IDCANCEL IDRETRY OwnedAppProcessRetry
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

; electron-builder's uninstallOldVersion launches the previous uninstaller and
; treats any non-zero exit as "cannot be closed", retrying five times before
; quitting the install. The previous version is already detached (renamed
; away) here, so that uninstaller is redundant — and when the detach could not
; run, a locked file makes the old uninstaller exit with code 2, producing
; exactly that misleading dialog. Remove the old registration so
; uninstallOldVersion returns early; only entries pointing at $INSTDIR are
; touched, an installation in a different directory keeps its entry and is
; removed by electron-builder as usual.
!macro ForgetOwnedInstallRegistration HIVE VIEW TOKEN
  SetRegView ${VIEW}
  ReadRegStr $R7 ${HIVE} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ; Missing or different-location registration is not owned by this detach.
  StrCmp $R7 $INSTDIR 0 ForgetOwnedInstallRegistration_Done_${TOKEN}_${HIVE}_${VIEW}
    DeleteRegKey ${HIVE} "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey ${HIVE} "${INSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegKey ${HIVE} "${UNINSTALL_REGISTRY_KEY_2}"
    !endif
  ForgetOwnedInstallRegistration_Done_${TOKEN}_${HIVE}_${VIEW}:
!macroend

!macro ForgetOldInstallRegistry TOKEN
  !insertmacro ForgetOwnedInstallRegistration HKCU 64 ${TOKEN}
  !insertmacro ForgetOwnedInstallRegistration HKCU 32 ${TOKEN}
  !insertmacro ForgetOwnedInstallRegistration HKLM 64 ${TOKEN}
  !insertmacro ForgetOwnedInstallRegistration HKLM 32 ${TOKEN}
  SetRegView 64
!macroend

!ifndef BUILD_UNINSTALLER
!macro OpenTimingLogForAppend HANDLE
  ; NSIS append mode preserves existing data but starts at offset zero.
  FileOpen ${HANDLE} "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileSeek ${HANDLE} 0 END
!macroend

; Destructive pre-extraction steps: stop the running application and detach
; the previous installation. They must NOT run
; from .onInit — the wizard has not been shown yet, and a cancel on any page
; would leave the user with a killed app and a renamed install directory.
; Interactive installs run this when the options page is left (the user has
; committed to installing); silent installs (/S, e.g. the auto-updater) skip
; pages entirely, so .onInit invokes it directly. The prepared root is
; remembered so returning to the directory page and leaving again only
; re-runs the steps when the target directory actually changed.
!macro PrepareExistingInstallForExtraction TOKEN
  !insertmacro AssertOwnedInstallRoot install
  ${If} $preparedInstallRoot != $INSTDIR
    StrCpy $preparedInstallRoot $INSTDIR

    DetailPrint "[Installer] Stopping running 知远 processes"
    System::Call 'kernel32::GetTickCount()i .r7'
    !insertmacro StopAppProcesses
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    !insertmacro OpenTimingLogForAppend $8
    FileWrite $8 "phase=process-stop-complete elapsed_ms=$5 exit=$0$\r$\n"
    FileClose $8

    ; Rename the old application quickly. Its directory junctions do not copy the
    ; shared resource pack, and physical cleanup is delayed until installation ends.
    DetailPrint "[Installer] Detaching previous application version"
    System::Call 'kernel32::GetTickCount()i .r7'
    OldInstallDetachRetry_${TOKEN}:
    !insertmacro AssertOwnedInstallRoot install
    ${If} ${FileExists} "$INSTDIR\*.*"
      System::Call 'kernel32::GetTickCount()i .r4'
      StrCpy $3 "$INSTDIR.old.$4"
      ClearErrors
      ; Rename uses MoveFile internally, but does not preserve GetLastError.
      ; Use the same no-overwrite Unicode operation and capture its error in
      ; the same System call, before process counting or logging can replace it.
      System::Call 'kernel32::MoveFileW(w "$INSTDIR", w "$3") i .r2 ?e'
      Pop $R5
      ${If} $2 == 0
        DetailPrint "[Installer] Detach failed: win32=$R5 source=$INSTDIR destination=$3"
        !insertmacro OpenTimingLogForAppend $8
        FileWrite $8 "phase=old-install-detach-failed win32=$R5$\r$\n"
        FileClose $8
        ; Running=0 alone does not diagnose a sharing violation. Preserve the
        ; native error in the real dialog as well as the installation log.
        !insertmacro CountInstallDirProcesses $R0
        ${If} $R0 > 0
          DetailPrint "[Installer] Detach blocked by $R0 running app processes"
          !insertmacro StopAppProcesses
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(ZY_APP_UNCLOSABLE)$\r$\n$\r$\nWindows error: $R5" /SD IDCANCEL IDRETRY OldInstallDetachRetry_${TOKEN}
        ${Else}
          DetailPrint "[Installer] Detach blocked: install directory is in use by another program"
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(ZY_DIR_OCCUPIED)$\r$\n$\r$\nWindows error: $R5" /SD IDCANCEL IDRETRY OldInstallDetachRetry_${TOKEN}
        ${EndIf}
        StrCpy $3 "result=detach-aborted processes=$R0"
        !insertmacro OpenTimingLogForAppend $8
        FileWrite $8 "phase=old-install-detach-aborted $3$\r$\n"
        FileClose $8
        ; Matches electron-builder's own cancel handling in CHECK_APP_RUNNING.
        ; Abort would only cancel the page leave in interactive installs.
        Quit
      ${EndIf}
      FileOpen $8 "$APPDATA\ZhiYuanAgent\old-install-path.txt" w
      ; FileWrite converts Unicode paths to the system ANSI codepage. Keep the
      ; exact transaction path on non-Chinese Windows; PowerShell detects BOM.
      FileWriteUTF16LE /BOM $8 "$3"
      FileClose $8
      StrCpy $3 "result=detached path=$3"
    ${Else}
      StrCpy $3 "result=no-previous-install"
    ${EndIf}
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    !insertmacro OpenTimingLogForAppend $8
    FileWrite $8 "phase=old-install-detached elapsed_ms=$5 $3$\r$\n"
    FileClose $8
    ; The old installation is detached or absent at this point; drop its
    ; registration so electron-builder skips the redundant legacy uninstaller
    ; whose exit code 2 would surface as a bogus "cannot be closed" dialog.
    !insertmacro ForgetOldInstallRegistry ${TOKEN}
  ${EndIf}
!macroend
!endif

!ifdef PROJECT_DIR
  !include "${PROJECT_DIR}\scripts\installer-ui\zy-theme.nsh"
  !include "${PROJECT_DIR}\scripts\installer-ui\zy-pages.nsh"
!else
  !include "installer-ui\zy-theme.nsh"
  !include "installer-ui\zy-pages.nsh"
!endif

; electron-builder defines this from allowToChangeInstallationDirectory; the
; native directory page is replaced by the install-location row on the custom
; hero page, so the define is withdrawn before the assisted template runs.
!undef allowToChangeInstallationDirectory

; MUI consumes MUI_PAGE_CUSTOMFUNCTION_* defines at each MUI page insertion
; and undefs them afterwards, so the SHOW hook has to be (re-)defined at
; every insertion point. Uninstaller pass only: MUI_UNPAGE_INSTFILES consumes
; this one (it brands the native uninstaller instfiles page) before
; customUninstallPage re-defines the hook for MUI_UNPAGE_FINISH. In the
; installer pass nothing consumes a define this early — the install-mode page
; is a raw PageEx custom and the native directory page is disabled above — so
; an early define would collide with customPageAfterChangeDir's re-definition
; (NSIS errors on !define of an existing symbol) and must not be set here.
!ifdef BUILD_UNINSTALLER
!define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
!endif

; The native uninstaller finish page is the only remaining MUI welcome/finish
; surface; give it the branded side art instead of the stock wizard bitmap.
; electron-builder passes its default wizard bitmap for this key via -D, so
; withdraw it before defining our own (NSIS errors on redefinition).
!ifdef MUI_UNWELCOMEFINISHPAGE_BITMAP
  !undef MUI_UNWELCOMEFINISHPAGE_BITMAP
!endif
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${PROJECT_DIR}\build\installer-assets\zy-side.bmp"

!define ELEVATED_ACTION_SCRIPT "nsis-elevated-actions.ps1"
!define ELEVATED_ACTION_RESULT "elevated-action-result.txt"





; Safety net for any path where electron-builder still runs the previous
; uninstaller (e.g. it lives in a different install directory). The stock
; handler quits the whole installation on a non-zero exit code after showing
; the "cannot be closed" dialog — even when the failure is a locked file,
; not a running process. Files the old uninstaller could not remove are
; overwritten in place by the extraction that follows, so a failed legacy
; uninstall must never abort the install.
!macro customUnInstallCheck
  IfErrors 0 +3
    DetailPrint "[Installer] Previous uninstaller could not be launched; continuing with in-place upgrade"
    Return
  ${if} $R0 != 0
    DetailPrint "[Installer] Previous uninstaller exited with code $R0; continuing with in-place upgrade"
    !insertmacro OpenTimingLogForAppend $8
    FileWrite $8 "phase=previous-uninstall-ignored exit=$R0$\r$\n"
    FileClose $8
  ${endIf}
  Return
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend

; electron-builder compiles the uninstaller before the installer. Its assisted
; template does not insert installation pages while BUILD_UNINSTALLER is set,
; so keep the page state and callbacks out of that compilation pass.
; $preparedInstallRoot is declared before the UI includes.
!ifndef BUILD_UNINSTALLER


!macro ExtractElevatedActionScript
  SetOutPath "$PLUGINSDIR"
  File /oname=${ELEVATED_ACTION_SCRIPT} "${PROJECT_DIR}\scripts\nsis-elevated-actions.ps1"
!macroend


!macro RunElevatedAction TOKEN ACTION TARGET
  Delete "$PLUGINSDIR\${ELEVATED_ACTION_RESULT}"
  StrCpy $0 "error"
  StrCpy $1 ""
  ClearErrors
  ExecShellWait "runas" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $\"$PLUGINSDIR\${ELEVATED_ACTION_SCRIPT}$\" -Action ${ACTION} -Target $\"${TARGET}$\" -ResultPath $\"$PLUGINSDIR\${ELEVATED_ACTION_RESULT}$\"' SW_HIDE $0
  IfErrors ElevatedActionResult_${TOKEN}
  IfFileExists "$PLUGINSDIR\${ELEVATED_ACTION_RESULT}" 0 ElevatedActionResult_${TOKEN}
    FileOpen $2 "$PLUGINSDIR\${ELEVATED_ACTION_RESULT}" r
    FileRead $2 $1
    FileClose $2
  ElevatedActionResult_${TOKEN}:
!macroend

!macro customHeader
  ManifestDPIAware true
  SetFont "Microsoft YaHei UI" 11
  BrandingText " "
  ; The application and immutable runtime cache are per-user. Elevated helper
  ; processes are used only for the VC++ runtime installer below.
  RequestExecutionLevel user
  ; Long spans of this installer run inside nsExec helpers (process stop,
  ; component validation and expansion). Hiding the details view leaves the
  ; progress page motionless for minutes, which users read as a hang.
  ShowInstDetails show
  ; NSIS startup CRC check reads the entire installer before the UI appears.
  ; Payload integrity is covered by per-entry 7z CRCs during extraction plus
  ; sentinel SHA-256 verification, so the extra full-file scan is redundant.
  CRCCheck off
  ; Detach-failure messages. electron-builder only knows "cannot be closed",
  ; which blames a running app even when the blocker is a directory handle
  ; held by another program (typically an Explorer window); keep the two
  ; causes in separate, translated strings. LCIDs are numeric because the
  ; LANG_* constants are not defined at this point in the generated script.
  ; The build loads every bundled NSIS language, and makensis promotes an
  ; unset-per-language LangString (warning 6040) to an error, so every
  ; bundled language gets an entry; untranslated ones fall back to English.
  LangString ZY_DIR_OCCUPIED 2052 "无法更新安装目录，目录正被其他程序占用。$\r$\n$\r$\n未检测到正在运行的知远进程。最常见的原因是文件资源管理器正在浏览该目录：$\r$\n$INSTDIR$\r$\n$\r$\n请关闭占用该目录的窗口或程序，然后点击“重试”。"
  LangString ZY_DIR_OCCUPIED 1028 "無法更新安裝目錄，目錄正被其他程式佔用。$\r$\n$\r$\n未偵測到正在執行的知遠處理程序。最常見的原因是檔案總管正在瀏覽該目錄：$\r$\n$INSTDIR$\r$\n$\r$\n請關閉佔用該目錄的視窗或程式，然後按一下「重試」。"
  LangString ZY_DIR_OCCUPIED 1033 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1031 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1036 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 3082 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1041 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1042 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1040 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1043 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1030 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1053 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1044 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1035 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1049 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 2070 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1046 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1045 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1058 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1029 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1051 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1038 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1025 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1055 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1054 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1066 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
!macroend

; Welcome, install options and license agreement live on a single custom
; hero page (ZYHeroCreate/Leave in installer-ui/zy-pages.nsh), replacing the
; stock MUI welcome page, the native directory page and the old local
; inference options page.
!macro customWelcomePage
  Page custom ZYHeroCreate ZYHeroLeave
!macroend

; The finish page is the only page whose callbacks touch the StdUtils plugin
; (${isUpdated} / ${StdUtils.ExecShellAsUser} in ZYFinishLeave). Its definition
; must therefore be emitted here, in the installer body, rather than from the
; header-time !include of zy-pages.nsh: electron-builder registers the plugin
; directory from a task concurrent with that include, so the header may not
; have declared it yet (makensis then fails with "Plugin not found, cannot call
; StdUtils::TestParameter"). This mirrors the StartApp function electron-builder
; itself defines at this exact insertion point.
!macro customFinishPage
  !insertmacro ZY_DefineFinishLeave
  Page custom ZYFinishCreate ZYFinishLeave
!macroend

; The old options page used to sit here and ran
; PrepareExistingInstallForExtraction from its leave callback; that duty moved
; to ZYHeroLeave. The hook itself is kept as the only template insertion
; point between PAGE_INSTALL_MODE and MUI_PAGE_INSTFILES, which is where the
; instfiles page callbacks must be defined: MUI undefines
; MUI_PAGE_CUSTOMFUNCTION_* right after consuming them.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE ZY_MuiPageLeave
!macroend
!endif

; The application and its runtime cache are per-user, so the install-mode
; page is skipped unless a per-machine installation actually exists (its
; upgrade/uninstall path needs the all-users flow and elevation). multiUserUi
; consults this macro in both the installer and the uninstaller build, so it
; lives outside the !ifndef BUILD_UNINSTALLER block above.
!macro customInstallMode
  ${if} $hasPerMachineInstallation != "1"
    StrCpy $isForceCurrentInstall "1"
  ${endIf}
!macroend

; Injection point between MUI_UNPAGE_INSTFILES and MUI_UNPAGE_FINISH: the
; uninstaller's native finish page gets the branded background via the SHOW
; hook (consumed there and undefined by MUI).
!macro customUninstallPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
!macroend

; Branded uninstaller confirmation in place of the stock MUI welcome page.
!macro customUnWelcomePage
  ; Uninstaller page callbacks must be un.-prefixed in the uninstaller build.
  UninstPage custom ${ZY_UNPREFIX}ZYUnWelcomeCreate ${ZY_UNPREFIX}ZYUnWelcomeLeave
!macroend

!macro customInit
  ; Explicit locale is useful for deployment and the interactive CI matrix.
  ; Accept only bundled locales; an invalid value keeps the system language.
  ${GetParameters} $R0
  ${GetOptions} $R0 "/LANGUAGE=" $R1
  ${If} $R1 == "2052"
  ${OrIf} $R1 == "1033"
    StrCpy $LANGUAGE $R1
  ${EndIf}
  SetDetailsPrint textonly
  CreateDirectory "$APPDATA\ZhiYuanAgent"
  ; Stage the branded UI bitmaps (and license text) the wizard pages load.
  ; File extraction only: this macro also runs for silent installs, where no
  ; page callback ever fires, so no GUI calls are allowed here.
  !insertmacro ZY_StageUiAssets
  System::Call 'kernel32::GetTickCount()i .r9'
  FileOpen $8 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" w
  FileWrite $8 "$9"
  FileClose $8
  ; The timing log appends across runs (bounded by the run-start markers) so
  ; repeated install attempts on a user machine stay diagnosable.
  StrCpy $5 "interactive"
  ${If} ${Silent}
    StrCpy $5 "silent"
  ${EndIf}
  !insertmacro OpenTimingLogForAppend $8
  FileWrite $8 "phase=run-start tick_ms=$9 mode=$5 instdir=$INSTDIR$\r$\n"
  FileClose $8

  ; Silent installs never show pages, so no leave callback will fire; prepare
  ; for extraction right here. Interactive installs defer the same steps to
  ; the options-page leave, after the user has committed to installing.
  ${If} ${Silent}
    !insertmacro PrepareExistingInstallForExtraction SILENT
  ${EndIf}
!macroend

!macro StageOfflineComponentMetadata KEY
  SetOutPath "$PLUGINSDIR"
  File /oname=component-${KEY}.version "${PROJECT_DIR}\build-tar\windows-components\${KEY}.version"
  File /oname=component-${KEY}.sha256 "${PROJECT_DIR}\build-tar\windows-components\${KEY}.sha256"
  File /oname=component-${KEY}.sentinel-sha256 "${PROJECT_DIR}\build-tar\windows-components\${KEY}.sentinel-sha256"
!macroend

!macro QueueOfflineComponent TOKEN KEY LABEL
  DetailPrint "[Installer] Checking ${LABEL}"
  System::Call 'kernel32::GetTickCount()i .r7'
  IfFileExists "$PLUGINSDIR\component-${KEY}.cache-valid" ComponentCacheHit_${TOKEN} ComponentCacheMiss_${TOKEN}
  ComponentCacheHit_${TOKEN}:
    DetailPrint "[Installer] Reusing ${LABEL}"
    !insertmacro OpenTimingLogForAppend $2
    FileWrite $2 "phase=component-cache-hit component=${KEY}$\r$\n"
    FileClose $2
    Goto ComponentQueued_${TOKEN}

  ComponentCacheMiss_${TOKEN}:
    DetailPrint "[Installer] Expanding ${LABEL}"
    !insertmacro OpenTimingLogForAppend $2
    FileWrite $2 "phase=component-cache-miss component=${KEY}$\r$\n"
    FileClose $2
    SetOutPath "$PLUGINSDIR"
    SetCompress off
    File /oname=component-${KEY}.7z "${PROJECT_DIR}\build-tar\windows-components\${KEY}.7z"
    SetCompress auto
  ComponentQueued_${TOKEN}:
!macroend

!macro RecordOfflineComponentReady KEY
  FileOpen $2 "$PLUGINSDIR\component-${KEY}.version" r
  IfErrors OfflineComponentInstallFailed
  FileRead $2 $R1
  FileClose $2
  StrCpy $R1 $R1 64
    !insertmacro OpenTimingLogForAppend $2
  FileWrite $2 "phase=component-ready component=${KEY} content_id=$R1 validation=batch$\r$\n"
    FileClose $2
!macroend

!macro customInstall
  CreateDirectory "$APPDATA\ZhiYuanAgent"
  CreateDirectory "$LOCALAPPDATA\ZhiYuanAgent\runtimes"
  ; Marks the end of the application file extraction span (customInit up to
  ; here is otherwise uninstrumented, which hid the slowest phase on user
  ; machines behind a motionless progress page).
  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" r
  IfErrors CustomInstallStartMarked
  FileRead $2 $R5
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $R6 $6 - $R5
  !insertmacro OpenTimingLogForAppend $2
  FileWrite $2 "phase=custom-install-start app_files_ms=$R6$\r$\n"
  FileClose $2
  CustomInstallStartMarked:
  ; First custom progress phase: the 7za hash check and the cache validation
  ; below run inside this span.
  !insertmacro ZY_ProgressPhase VALIDATING "$(ZY_PHASE_VALIDATING)"
  SetOutPath "$PLUGINSDIR"
  !insertmacro ExtractElevatedActionScript
  File /oname=7za.exe "${PROJECT_DIR}\node_modules\7zip-bin\win\x64\7za.exe"
  File /oname=7za.sha256 "${PROJECT_DIR}\build-tar\windows-components\7za.sha256"
  File /oname=component-manifest.json "${PROJECT_DIR}\build-tar\windows-components\manifest.json"
  File /oname=recover-component-switch.ps1 "${PROJECT_DIR}\scripts\installer\recover-component-switch.ps1"
  File /oname=validate-offline-components.ps1 "${PROJECT_DIR}\scripts\installer\validate-offline-components.ps1"
  ; The component switch/link/cleanup logic is shared with the WebView2 setup
  ; shell: single sources of truth under scripts\installer, staged here and
  ; invoked with -File below.
  File /oname=activate-components.ps1 "${PROJECT_DIR}\scripts\installer\activate-components.ps1"
  File /oname=link-runtime-junctions.ps1 "${PROJECT_DIR}\scripts\installer\link-runtime-junctions.ps1"
  File /oname=cleanup-after-install.ps1 "${PROJECT_DIR}\scripts\installer\cleanup-after-install.ps1"
  File /oname=uninstall-cleanup.ps1 "${PROJECT_DIR}\scripts\installer\uninstall-cleanup.ps1"
  ; Embed the routing table as a compile-time asset. Building it incrementally
  ; with NSIS FileWrite can split hyphenated component keys on Windows runners.
  File /oname=component-targets.json "${PROJECT_DIR}\scripts\nsis-offline-components.json"
  ; Use .NET directly: Windows PowerShell may inherit pwsh's incompatible module path.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "$$hasher = [System.Security.Cryptography.SHA256]::Create(); try { $$stream = [IO.File]::OpenRead(\"$PLUGINSDIR\7za.exe\"); try { [BitConverter]::ToString($$hasher.ComputeHash($$stream)).Replace([string][char]45, [string]::Empty).ToLowerInvariant() } finally { $$stream.Dispose() } } finally { $$hasher.Dispose() }"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 OfflineComponentInstallFailed
  FileOpen $2 "$PLUGINSDIR\7za.sha256" r
  IfErrors OfflineComponentInstallFailed
  FileRead $2 $R7
  FileClose $2
  StrCpy $R7 $R7 64
  StrCpy $1 $1 64
  StrCmp $1 $R7 0 OfflineComponentInstallFailed
  ; Keep the journal in the persistent cache: $PLUGINSDIR is deleted after a forced quit.
  ; A separate script avoids NSIS macro expansion corrupting PowerShell quotes.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\recover-component-switch.ps1" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 OfflineComponentInstallFailed

  ; Stage the per-component metadata before deciding which archives to queue.
  !insertmacro ZY_ProgressPhase STAGING "$(ZY_PHASE_STAGING)"
  !insertmacro StageOfflineComponentMetadata "portable-git"

  ; Verify all reusable cache entries in one PowerShell process before deciding
  ; which archives NSIS needs to unpack from the installer.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-offline-components.ps1" -Mode cache -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ComponentTargetsPath "$PLUGINSDIR\component-targets.json" -SevenZipPath "$PLUGINSDIR\7za.exe" -TimingLogPath "$APPDATA\ZhiYuanAgent\install-timing.log"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ComponentCacheValidated
    StrCpy $R9 "安装包缺少有效离线组件校验信息：$1"
    Goto OfflineComponentInstallFailed
  ComponentCacheValidated:

  !insertmacro QueueOfflineComponent PORTABLE_GIT "portable-git" "PortableGit"

  ; The changed archives are now present in $PLUGINSDIR. Validate their entries
  ; and sentinels, then extract them in one PowerShell batch. This keeps cache
  ; hits fast while eliminating a PowerShell startup per component; the
  ; per-component phases land in the timing log via -TimingLogPath.
  DetailPrint "[Installer] Validating and expanding offline components"
  !insertmacro ZY_ProgressPhase EXPANDING "$(ZY_PHASE_EXPANDING)"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-offline-components.ps1" -Mode expand -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ComponentTargetsPath "$PLUGINSDIR\component-targets.json" -SevenZipPath "$PLUGINSDIR\7za.exe" -TimingLogPath "$APPDATA\ZhiYuanAgent\install-timing.log"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ComponentBatchExpanded
  StrCmp $0 "3" ComponentBatchArchiveUnsafe
  StrCmp $0 "4" ComponentBatchExtractFailed
  StrCmp $0 "5" ComponentBatchVerificationFailed
    StrCpy $R9 "离线组件批处理失败：$1"
    Goto OfflineComponentInstallFailed

  ComponentBatchArchiveUnsafe:
    StrCpy $R9 "离线组件归档包含不安全路径或链接元数据。"
    Goto OfflineComponentInstallFailed
  ComponentBatchExtractFailed:
    ; Keep the failing component key and the 7za exit code or exception detail
    ; from the validator in the dialog and the install timing log. The validator
    ; already folds newlines, so $1 is a single line.
    StrCpy $R9 "离线组件展开失败：$1。请检查磁盘空间或安全软件后重试。"
    Goto OfflineComponentInstallFailed
  ComponentBatchVerificationFailed:
    StrCpy $R9 "离线组件健康检查失败，哨兵文件缺失或校验不匹配。"
    Goto OfflineComponentInstallFailed
  ComponentBatchExpanded:

  !insertmacro RecordOfflineComponentReady "portable-git"

  DetailPrint "[Installer] Activating offline components"
  !insertmacro ZY_ProgressPhase ACTIVATING "$(ZY_PHASE_ACTIVATING)"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\activate-components.ps1" -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ManifestPath "$PLUGINSDIR\component-manifest.json" -TargetsPath "$PLUGINSDIR\component-targets.json" -StatePath "$LOCALAPPDATA\ZhiYuanAgent\runtimes\component-switch-state.txt"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ComponentPointersReady
    StrCpy $R9 "离线组件切换失败：$1"
    Goto OfflineComponentInstallFailed
  ComponentPointersReady:

  DetailPrint "[Installer] Connecting bundled runtimes"
  !insertmacro ZY_ProgressPhase CONNECTING "$(ZY_PHASE_CONNECTING)"
  SetOutPath "$INSTDIR"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\link-runtime-junctions.ps1" -ResourceRoot "$INSTDIR\resources" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ManifestPath "$PLUGINSDIR\component-manifest.json"'
  Pop $0
  Pop $1
  StrCmp $0 "0" RuntimeLinksReady
    !insertmacro OpenTimingLogForAppend $2
    FileWrite $2 "phase=runtime-link-failed exit=$0 output=$1$\r$\n"
    FileClose $2
    StrCpy $R9 "离线运行环境连接失败：$1"
    Goto OfflineComponentInstallFailed
  RuntimeLinksReady:

  DetailPrint "[Installer] Verifying bundled runtimes"
  !insertmacro ZY_ProgressPhase VERIFYING "$(ZY_PHASE_VERIFYING)"
  ; Verify Git's launcher, implementation and the non-system DLL imports of
  ; the pinned full PortableGit distribution. Agent execution uses native PowerShell.
  IfFileExists "$INSTDIR\resources\mingit\cmd\git.exe" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\mingit\mingw64\bin\git.exe" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\mingit\mingw64\bin\libiconv-2.dll" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\mingit\mingw64\bin\libintl-8.dll" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\mingit\mingw64\bin\libpcre2-8-0.dll" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\mingit\mingw64\bin\libwinpthread-1.dll" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\mingit\mingw64\bin\zlib1.dll" 0 InstalledRuntimeVerificationFailed
  Goto OfflineComponentsReady
  InstalledRuntimeVerificationFailed:
    StrCpy $R9 "离线运行环境连接校验失败。请重新运行安装器。"
    Goto OfflineComponentInstallFailed

  OfflineComponentInstallFailed:
    ; Use the same validated recovery contract as startup; never interpret
    ; arbitrary journal keys in a second inline rollback implementation.
    nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\recover-component-switch.ps1" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes"'
    Pop $0
    !insertmacro OpenTimingLogForAppend $2
    FileWrite $2 "phase=component-set-rollback reason=$R9$\r$\n"
    FileClose $2
    IfSilent OfflineComponentInstallFailedSilent 0
      MessageBox MB_OK|MB_ICONSTOP "$R9"
    OfflineComponentInstallFailedSilent:
    SetErrorLevel 1
    Abort

  OfflineComponentsReady:

  ; The VC runtime is bundled for offline installation, but upgrades skip it
  ; when the supported x64 redistributable is already registered.
  DetailPrint "[Installer] Checking Microsoft Visual C++ Runtime"
  !insertmacro ZY_ProgressPhase VC "$(ZY_PHASE_VC)"
  SetRegView 64
  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  IfErrors InstallVcRuntime
  IntCmp $0 1 VcRuntimeReady InstallVcRuntime InstallVcRuntime
  InstallVcRuntime:
    IfFileExists "$INSTDIR\resources\vc_redist.x64.exe" 0 VcRuntimeReady
    DetailPrint "[Installer] Installing Microsoft Visual C++ Runtime"
    !insertmacro RunElevatedAction INSTALL_VC install-vc-runtime "$INSTDIR\resources\vc_redist.x64.exe"
    StrCmp $0 "0" VcRuntimeReady
    StrCmp $0 "1638" VcRuntimeReady
    StrCmp $0 "3010" VcRuntimeReady
    StrCmp $0 "1223" VcRuntimeReady
      !insertmacro OpenTimingLogForAppend $2
      FileWrite $2 "phase=vc-runtime-install-failed exit=$0 output=$1$\r$\n"
      FileClose $2
      MessageBox MB_OK|MB_ICONEXCLAMATION "Microsoft Visual C++ Runtime 未能自动安装。知远仍会完成安装，但部分本地组件可能暂时不可用。"
  VcRuntimeReady:

  ; Retire the obsolete installer opt-in; runtime setup belongs in the app.
  Delete "$APPDATA\ZhiYuanAgent\pending-local-inference-install"

  ; Cleanup begins only after core application and runtime links are ready, so
  ; it no longer competes with resource expansion on slow disks.
  DetailPrint "[Installer] Scheduling previous version cleanup"
  !insertmacro ZY_ProgressPhase CLEANUP "$(ZY_PHASE_CLEANUP)"
  ; Remove known junctions explicitly before recursive deletion. This prevents
  ; an old installation cleanup from ever walking into an immutable shared pack.
  DetailPrint "[Installer] Cleaning unused offline component versions"
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-after-install.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ManifestPath "$PLUGINSDIR\component-manifest.json" -OldInstallPathFile "$APPDATA\ZhiYuanAgent\old-install-path.txt"'
  Pop $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  !insertmacro OpenTimingLogForAppend $2
  FileWrite $2 "phase=component-cleanup-complete elapsed_ms=$5 exit=$0$\r$\n"
  FileClose $2
  Delete "$LOCALAPPDATA\ZhiYuanAgent\runtimes\component-switch-state.txt"

  !insertmacro ZY_ProgressPhase FINALIZING "$(ZY_PHASE_FINALIZING)"
  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" r
  IfErrors InstallTimingDone
  FileRead $2 $R5
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $R6 $6 - $R5
  !insertmacro OpenTimingLogForAppend $2
  FileWrite $2 "phase=install-complete total_ms=$R6 component_set=ready$\r$\n"
  FileClose $2
  Delete "$APPDATA\ZhiYuanAgent\install-start-tick.txt"
  InstallTimingDone:
  DetailPrint "Installation complete"
  ; Status only. Page navigation waits for the native section-completion transition.
  !insertmacro ZY_ProgressPhase DONE "$(ZY_PHASE_DONE)"
!macroend

; Counts processes whose image path starts with $INSTDIR (the count is the
; PowerShell exit code, so no stdout parsing is needed). After a failed
; detach this distinguishes "app still running" from "directory held by
; another program" — electron-builder reports both as "cannot be closed".
!macro customUnInit
  !insertmacro AssertOwnedInstallRoot uninstall
  ; The uninstaller confirmation page uses the same branded background art.
  !insertmacro ZY_StageUiAssets
  ; This is a fresh uninstaller process with a fresh $PLUGINSDIR: the shared
  ; cleanup script is only extracted during the installer's customInstall,
  ; which this compilation pass never runs, so stage it here — without it
  ; component junctions and the runtime cache would be left behind.
  SetOutPath "$PLUGINSDIR"
  File /oname=uninstall-cleanup.ps1 "${PROJECT_DIR}\scripts\installer\uninstall-cleanup.ps1"
  ; Process termination occurs only at the guarded CHECK_APP_RUNNING entry,
  ; not while opening the uninstaller confirmation page.
!macroend

!macro customUnInstall
  ; Revalidate immediately before shared cleanup and the template's RMDir and
  ; registration removal. Opening a wizard never grants later path ownership.
  !insertmacro AssertOwnedInstallRoot uninstall
  ; Remove component junctions and detach application-owned immutable data.
  ; User data and models remain under userData. Deleting the
  ; expanded runtime tree synchronously can take longer than the uninstaller
  ; itself, so the shared script renames it atomically and reclaims it in the
  ; background. Keep both the uninstaller and spawned cleanup commands outside
  ; $INSTDIR so electron-builder's final RMDir can remove the now-empty
  ; application root. The component junction/link/detach logic is shared with
  ; the WebView2 setup shell via scripts\installer\uninstall-cleanup.ps1.
  SetOutPath "$TEMP"
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\uninstall-cleanup.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes"'
  Pop $0
  ${If} $0 != "0"
    DetailPrint "[Uninstaller] Safe cleanup failed; preserving installation and registration"
    SetErrorLevel 1
    Quit
  ${EndIf}

  ; The real userData directory is always retained, including legacy
  ; --delete-app-data requests. It is not an installation cleanup target.

!macroend
