; Native, DPI-scaled installer pages. All page controls belong to the inner
; dialog: destroying a page cannot leave a bitmap over the next page.
!ifdef ZY_PREVIEW
  !addplugindir /x86-unicode "${PROJECT_DIR}\build\nsis-resources\plugins\x86-unicode"
!endif
!ifdef BUILD_UNINSTALLER
  !define ZY_UNPREFIX un.
!else
  !define ZY_UNPREFIX ``
!endif
Var /GLOBAL zyLicenseAvailable
Var /GLOBAL zyFont
Var /GLOBAL zyDialog
!ifndef BUILD_UNINSTALLER
Var /GLOBAL zyLaunchApp
Var /GLOBAL heroDirText
Var /GLOBAL heroLicense
Var /GLOBAL heroInstall
Var /GLOBAL zyPhaseLabel
!endif

!macro ZY_LangStringEn NAME VALUE
!ifdef ZY_PREVIEW
  LangString ${NAME} 1033 "${VALUE}"
!else
  LangString ${NAME} 1033 "${VALUE}"
  LangString ${NAME} 1031 "${VALUE}"
  LangString ${NAME} 1036 "${VALUE}"
  LangString ${NAME} 3082 "${VALUE}"
  LangString ${NAME} 1041 "${VALUE}"
  LangString ${NAME} 1042 "${VALUE}"
  LangString ${NAME} 1040 "${VALUE}"
  LangString ${NAME} 1043 "${VALUE}"
  LangString ${NAME} 1030 "${VALUE}"
  LangString ${NAME} 1053 "${VALUE}"
  LangString ${NAME} 1044 "${VALUE}"
  LangString ${NAME} 1035 "${VALUE}"
  LangString ${NAME} 1049 "${VALUE}"
  LangString ${NAME} 2070 "${VALUE}"
  LangString ${NAME} 1046 "${VALUE}"
  LangString ${NAME} 1045 "${VALUE}"
  LangString ${NAME} 1058 "${VALUE}"
  LangString ${NAME} 1029 "${VALUE}"
  LangString ${NAME} 1038 "${VALUE}"
  LangString ${NAME} 1025 "${VALUE}"
  LangString ${NAME} 1055 "${VALUE}"
  LangString ${NAME} 1054 "${VALUE}"
  LangString ${NAME} 1066 "${VALUE}"
  LangString ${NAME} 1051 "${VALUE}"
!endif
!macroend

!macro ZY_LangString NAME ZHCN ZHTW EN
!ifdef ZY_PREVIEW
  ; The preview loads only the zh-CN and English MUI language tables.
  LangString ${NAME} 2052 "${ZHCN}"
  LangString ${NAME} 1033 "${EN}"
!else
  LangString ${NAME} 2052 "${ZHCN}"
  LangString ${NAME} 1028 "${ZHTW}"
  !insertmacro ZY_LangStringEn ${NAME} "${EN}"
!endif
!macroend

; Shared process/root checks run in both compiler passes, including the
; early silent-uninstaller hook. Keep their strings outside the install-only
; customHeader macro so every bundled language exists in the uninstaller.
!insertmacro ZY_LangString ZY_UNSAFE_INSTALL_ROOT "请选择空目录或已有的知远安装目录，不能选择系统、个人数据或目录链接。未修改已有文件。" "請選擇空目錄或已有的知遠安裝目錄，不能選擇系統、個人資料或目錄連結。未修改已有檔案。" "Choose an empty folder or an existing ZhiYuan installation. System folders, personal data and directory links are protected. Existing files were not changed."
!insertmacro ZY_LangString ZY_APP_UNCLOSABLE \
  "检测到知远进程仍在运行，且无法自动关闭。$\r$\n$\r$\n可能是以管理员身份运行的。请手动退出知远（右键点击任务栏托盘图标并选择退出），然后点击“重试”。" \
  "偵測到知遠處理程序仍在執行，且無法自動關閉。$\r$\n$\r$\n可能是以系統管理員身分執行的。請手動結束知遠（在工作列通知區域圖示上按一下右鍵並選擇結束），然後按一下「重試」。" \
  "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."

!insertmacro ZY_LangString ZY_UI_TITLE \
  "准备安装" \
  "準備安裝" \
  "Ready to install"
!insertmacro ZY_LangString ZY_UI_TAGLINE \
  "选择安装位置，阅读并同意许可协议后开始安装。" \
  "選擇安裝位置，閱讀並同意授權協議後開始安裝。" \
  "Choose a location and review the license to continue."
!insertmacro ZY_LangString ZY_UI_INSTALL_LOCATION \
  "安装位置" \
  "安裝位置" \
  "Install location"
!insertmacro ZY_LangString ZY_UI_BROWSE \
  "更改…" \
  "變更…" \
  "Change..."
!insertmacro ZY_LangString ZY_UI_LICENSE_AGREE \
  "我已阅读并同意许可协议" \
  "我已閱讀並同意授權協議" \
  "I have read and agree to the license agreement"
!insertmacro ZY_LangString ZY_UI_LICENSE_LINK \
  "查看许可协议" \
  "檢視授權協議" \
  "View license agreement"
!insertmacro ZY_LangString ZY_UI_INSTALL \
  "安装" \
  "安裝" \
  "Install"
!insertmacro ZY_LangString ZY_UI_CANCEL \
  "取消" \
  "取消" \
  "Cancel"
!insertmacro ZY_LangString ZY_UI_INSTALLING_TITLE \
  "正在安装知远智能体" \
  "正在安裝知遠智能體" \
  "Installing ZhiYuan Agent"
!insertmacro ZY_LangString ZY_UI_FINISH_TITLE \
  "安装完成" \
  "安裝完成" \
  "Installation complete"
!insertmacro ZY_LangString ZY_UI_FINISH \
  "关闭" \
  "關閉" \
  "Close"
!insertmacro ZY_LangString ZY_UI_LAUNCH \
  "启动知远智能体" \
  "啟動知遠智能體" \
  "Launch ZhiYuan Agent"
!insertmacro ZY_LangString ZY_UI_UNINSTALL_TITLE \
  "确定要卸载知远智能体吗？" \
  "確定要解除安裝知遠智能體嗎？" \
  "Are you sure you want to uninstall ZhiYuan Agent?"
!insertmacro ZY_LangString ZY_UI_UNINSTALL_CONFIRM \
  "此操作将删除知远智能体及其本地离线运行环境。" \
  "此操作將刪除知遠智能體及其本機離線執行環境。" \
  "This will remove ZhiYuan Agent and its local offline runtime environment."
!insertmacro ZY_LangString ZY_UI_UNINSTALL_BUTTON \
  "卸载" \
  "解除安裝" \
  "Uninstall"
!insertmacro ZY_LangString ZY_LICENSE_MISSING \
  "安装包中未找到许可协议文本。" \
  "安裝套件中找不到授權協議文字。" \
  "The license agreement text could not be found in this installer."
!insertmacro ZY_LangString ZY_PHASE_VALIDATING \
  "正在校验离线组件…" \
  "正在驗證離線元件…" \
  "Validating offline components..."
!insertmacro ZY_LangString ZY_PHASE_STAGING \
  "正在准备离线组件…" \
  "正在準備離線元件…" \
  "Preparing offline components..."
!insertmacro ZY_LangString ZY_PHASE_EXPANDING \
  "正在展开离线组件…" \
  "正在展開離線元件…" \
  "Expanding offline components..."
!insertmacro ZY_LangString ZY_PHASE_ACTIVATING \
  "正在激活离线组件…" \
  "正在啟用離線元件…" \
  "Activating offline components..."
!insertmacro ZY_LangString ZY_PHASE_CONNECTING \
  "正在连接运行环境…" \
  "正在連線執行環境…" \
  "Connecting runtime environment..."
!insertmacro ZY_LangString ZY_PHASE_VERIFYING \
  "正在校验运行环境…" \
  "正在驗證執行環境…" \
  "Verifying runtime environment..."
!insertmacro ZY_LangString ZY_PHASE_VC \
  "正在安装 Microsoft Visual C++ 运行时…" \
  "正在安裝 Microsoft Visual C++ 執行階段…" \
  "Installing Microsoft Visual C++ Runtime..."
!insertmacro ZY_LangString ZY_PHASE_CLEANUP \
  "正在清理旧版本…" \
  "正在清理舊版本…" \
  "Cleaning up previous version..."
!insertmacro ZY_LangString ZY_PHASE_FINALIZING \
  "正在完成安装…" \
  "正在完成安裝…" \
  "Finalizing installation..."
!insertmacro ZY_LangString ZY_PHASE_DONE \
  "安装完成" \
  "安裝完成" \
  "Installation complete"

!insertmacro ZY_LangString ZY_UI_READY \
  "知远智能体 (ZhiYuan Agent) 已安装，可以开始使用。" \
  "知遠智能體 (ZhiYuan Agent) 已安裝，可以開始使用。" \
  "ZhiYuan Agent is installed and ready to use."
!insertmacro ZY_LangString ZY_UI_WAIT \
  "正在复制文件并准备运行环境，请稍候。" \
  "正在複製檔案並準備執行環境，請稍候。" \
  "Copying files and preparing the runtime. Please wait."
!insertmacro ZY_LangString ZY_UI_LAUNCH_FAILED \
  "未能启动应用。请重试，或关闭安装器后从开始菜单启动。" \
  "無法啟動應用程式。請重試，或關閉安裝程式後從開始功能表啟動。" \
  "The app could not be started. Retry, or close setup and use the Start menu."

; Reuse the actual wizard action. Posting avoids re-entering nsDialogs.
!macro ZY_ClickWizardNext
  GetDlgItem $0 $HWNDPARENT 1
  System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p $0)'
!macroend

!ifndef BUILD_UNINSTALLER
Function ZYHeroCreate
  nsDialogs::Create 1018
  Pop $zyDialog
  ${If} $zyDialog == error
    Abort
  ${EndIf}
  !insertmacro ZY_Header "$(ZY_UI_TITLE)" "$(ZY_UI_TAGLINE)"
  ${NSD_CreateLabel} 0u 6u 210u 14u "$(ZY_UI_INSTALL_LOCATION)"
  Pop $0
  ${NSD_CreateButton} 232u 0u 68u 22u "$(ZY_UI_BROWSE)"
  Pop $0
  ${NSD_OnClick} $0 ZYHeroBrowse

  ; Multi-line read-only path wraps and scrolls; no ellipsis hides the target.
  nsDialogs::CreateControl "EDIT" ${WS_CHILD}|${WS_VISIBLE}|${WS_TABSTOP}|${ES_MULTILINE}|${ES_READONLY}|${ES_AUTOVSCROLL}|${WS_VSCROLL} ${WS_EX_CLIENTEDGE} 0u 28u 300u 36u "$INSTDIR"
  Pop $heroDirText
  ${NSD_CreateCheckbox} 0u 82u 300u 20u "$(ZY_UI_LICENSE_AGREE)"
  Pop $heroLicense
  ${NSD_SetState} $heroLicense ${BST_UNCHECKED}
  ${NSD_OnClick} $heroLicense ZYHeroLicenseClick
  ${NSD_CreateLink} 0u 108u 200u 16u "$(ZY_UI_LICENSE_LINK)"
  Pop $0
  ${NSD_OnClick} $0 ZYHeroLinkClick

  GetDlgItem $heroInstall $HWNDPARENT 1
  SendMessage $heroInstall ${WM_SETTEXT} 0 "STR:$(ZY_UI_INSTALL)"
  ShowWindow $heroInstall ${SW_SHOW}
  EnableWindow $heroInstall 0
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_SHOW}
  EnableWindow $0 1
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  nsDialogs::Show
FunctionEnd

Function ZYHeroBrowse
  nsDialogs::SelectFolderDialog "$(ZY_UI_INSTALL_LOCATION)" $INSTDIR
  Pop $0
  ${If} $0 != ""
  ${AndIf} $0 != error
    StrCpy $INSTDIR $0
    ; Match electron-builder: browse chooses a parent unless the leaf already
    ; is APP_FILENAME. A drive root never becomes a destructive install root.
    StrLen $1 "${APP_FILENAME}"
    StrLen $2 $INSTDIR
    IntOp $3 $2 - $1
    ${If} $3 > 0
      StrCpy $4 $INSTDIR $1 $3
    ${Else}
      StrCpy $4 ""
    ${EndIf}
    ${If} $4 != "${APP_FILENAME}"
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}
  ${EndIf}
  SendMessage $heroDirText ${WM_SETTEXT} 0 "STR:$INSTDIR"
FunctionEnd

Function ZYHeroLicenseClick
  ${NSD_GetState} $heroLicense $0
  EnableWindow $heroInstall $0
FunctionEnd

Function ZYHeroLinkClick
  ${If} $zyLicenseAvailable == "1"
    ExecShell "open" "${ZY_ASSET_LICENSE}"
  ${Else}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(ZY_LICENSE_MISSING)"
  ${EndIf}
FunctionEnd

Function ZYHeroLeave
  ; Validate here too: keyboard/programmatic Next cannot bypass agreement.
  ${NSD_GetState} $heroLicense $0
  ${If} $0 != ${BST_CHECKED}
    Abort
  ${EndIf}
!ifndef ZY_PREVIEW
  !insertmacro PrepareExistingInstallForExtraction INTERACTIVE
!endif
FunctionEnd
!endif

Function ${ZY_UNPREFIX}ZY_MuiPageShow
!ifndef BUILD_UNINSTALLER
  Call ZYProgressShow
!endif
FunctionEnd

!ifndef BUILD_UNINSTALLER
Function ZYProgressShow
  ; MUI's stock Finish GUIInit enables this. A custom finish page must do
  ; so explicitly: NSIS advances only after all sections succeed; Abort
  ; stays on the native failure page. Never advance from a phase update.
  SetAutoClose true
  ; Native progress and details remain visible, keyboard accessible and
  ; scaled by NSIS. Never paint wizard-parent overlays or fabricate progress.
  !insertmacro ZY_Header "$(ZY_UI_INSTALLING_TITLE)" "$(ZY_UI_WAIT)"
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $zyPhaseLabel $0 1006
  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 ${SW_SHOW}
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
FunctionEnd

Function ZY_MuiPageLeave
  ; The status control is owned by the native inner dialog, not HWNDPARENT.
  StrCpy $zyPhaseLabel ""
FunctionEnd

Function ZYFinishCreate
  StrCpy $zyLaunchApp "0"
  nsDialogs::Create 1018
  Pop $zyDialog
  ${If} $zyDialog == error
    Abort
  ${EndIf}
  !insertmacro ZY_Header "$(ZY_UI_FINISH_TITLE)" "$(ZY_UI_READY)"
  ${NSD_CreateLabel} 0u 8u 300u 16u "$(ZY_UI_INSTALL_LOCATION)"
  Pop $0
  nsDialogs::CreateControl "EDIT" ${WS_CHILD}|${WS_VISIBLE}|${WS_TABSTOP}|${ES_MULTILINE}|${ES_READONLY}|${ES_AUTOVSCROLL}|${WS_VSCROLL} ${WS_EX_CLIENTEDGE} 0u 30u 300u 36u "$INSTDIR"
  Pop $0
!ifndef HIDE_RUN_AFTER_FINISH
  ${NSD_CreateButton} 0u 88u 190u 26u "$(ZY_UI_LAUNCH)"
  Pop $0
  ${NSD_OnClick} $0 ZYFinishLaunchClick
!endif
  ; A visible native Close is always available, independently of launch.
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(ZY_UI_FINISH)"
  ShowWindow $0 ${SW_SHOW}
  EnableWindow $0 1
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  nsDialogs::Show
FunctionEnd

!ifndef HIDE_RUN_AFTER_FINISH
Function ZYFinishLaunchClick
  StrCpy $zyLaunchApp "1"
  !insertmacro ZY_ClickWizardNext
FunctionEnd
!endif

; Emit after electron-builder registers StdUtils, not at header include time.
!macro ZY_DefineFinishLeave
Function ZYFinishLeave
  ${If} $zyLaunchApp == "1"
    ; Reset before launching: repeated clicks cannot launch twice.
    StrCpy $zyLaunchApp "0"
    ${if} ${isUpdated}
      StrCpy $0 "--updated"
    ${else}
      StrCpy $0 ""
    ${endif}
!ifdef ZY_PREVIEW
    DetailPrint "preview launch: $INSTDIR\${APP_EXECUTABLE_FILENAME} $0"
!else
    ${StdUtils.ExecShellAsUser} $1 "$INSTDIR\${PRODUCT_FILENAME}.exe" "open" "$0"
    ${If} $1 != "ok"
    ${AndIf} $1 != "fallback"
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(ZY_UI_LAUNCH_FAILED)"
      Abort
    ${EndIf}
!endif
  ${EndIf}
FunctionEnd
!macroend
!endif

!ifdef BUILD_UNINSTALLER
Function ${ZY_UNPREFIX}ZYUnWelcomeCreate
  nsDialogs::Create 1018
  Pop $zyDialog
  ${If} $zyDialog == error
    Abort
  ${EndIf}
  !insertmacro ZY_Header "$(ZY_UI_UNINSTALL_TITLE)" "$(ZY_UI_UNINSTALL_CONFIRM)"
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(ZY_UI_UNINSTALL_BUTTON)"
  ShowWindow $0 ${SW_SHOW}
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  nsDialogs::Show
FunctionEnd

Function ${ZY_UNPREFIX}ZYUnWelcomeLeave
FunctionEnd
!endif
