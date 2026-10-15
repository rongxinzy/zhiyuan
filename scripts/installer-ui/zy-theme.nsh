; Native NSIS design: one header, system controls, dialog-unit geometry.
; No bitmap backgrounds, overlapping labels, fixed-pixel progress or animation.
!ifndef ZY_THEME_INCLUDED
!define ZY_THEME_INCLUDED
!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"
!define ZY_FONT_FAMILY "Microsoft YaHei UI"
!define ZY_ASSET_LICENSE "$PLUGINSDIR\zy-license.txt"

!macro ZY_StageUiAssets
  ; Keep CWD away from INSTDIR until the existing-install detach has run.
  SetOutPath "$PLUGINSDIR"
  !if /fileexists "${PROJECT_DIR}\build\installer-assets\license.txt"
    File /oname=zy-license.txt "${PROJECT_DIR}\build\installer-assets\license.txt"
    StrCpy $zyLicenseAvailable "1"
  !else
    StrCpy $zyLicenseAvailable "0"
  !endif
!macroend

!macro ZY_Header TITLE SUBTITLE
  ; Use the existing MUI header controls, never create wizard-parent overlays.
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:${TITLE}"
  CreateFont $zyFont "${ZY_FONT_FAMILY}" 12 600
  SendMessage $0 ${WM_SETFONT} $zyFont 1
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:${SUBTITLE}"
!macroend

!macro ZY_ProgressPhase TOKEN TEXT
  ${IfNot} ${Silent}
  ${AndIf} $zyPhaseLabel != ""
    ; Native NSIS owns the progress range. Phases update status only.
    SendMessage $zyPhaseLabel ${WM_SETTEXT} 0 "STR:${TEXT}"
  ${EndIf}
!macroend
!endif
