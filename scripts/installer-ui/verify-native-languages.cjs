// Compile the real production include, not extracted macros or ZY_PREVIEW.
// This catches declarations hidden by BUILD_UNINSTALLER before app packaging.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  LangConfigurator,
  createAddLangsMacro,
} = require('app-builder-lib/out/targets/nsis/nsisLang');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const config = require('../../electron-builder.windows-acceptance.cjs');

function createProbeSource(root, output, languageMacro, paths = path) {
  // Host file paths must retain the compiler platform's separators. In
  // particular, Windows makensis cannot resolve our POSIX-normalized include.
  return `Unicode true
!include "MUI2.nsh"
!define PROJECT_DIR "${root}"
!define APP_GUID "language-compile-probe"
!define UNINSTALL_APP_KEY "language-compile-probe"
!define APP_FILENAME "language-compile-probe"
!define PRODUCT_FILENAME "language-compile-probe"
!define allowToChangeInstallationDirectory
!include "${paths.join(root, 'scripts', 'nsis-installer.nsh')}"
Name "ZhiYuan native language compile probe"
OutFile "${paths.join(output, 'probe.exe')}"
RequestExecutionLevel user
; The probe needs no generated artwork or application payload. Keep real
; page callbacks and all safety hooks; use the compiler's stock finish art.
!undef MUI_UNWELCOMEFINISHPAGE_BITMAP
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "\${NSISDIR}\\Contrib\\Graphics\\Wizard\\nsis3-metro.bmp"
${languageMacro}
!ifdef BUILD_UNINSTALLER
!insertmacro customUnWelcomePage
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro customUninstallPage
!insertmacro MUI_UNPAGE_FINISH
!else
!insertmacro customWelcomePage
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
Page custom ZYFinishCreate
!endif
; Match electron-builder: page definitions, then addLangs, then customHeader.
!insertmacro addLangs
!ifmacrodef customHeader
!insertmacro customHeader
!endif
!ifdef BUILD_UNINSTALLER
Function un.onInit
!insertmacro customCheckAppRunning
!insertmacro customUnInit
FunctionEnd
Section "un.Uninstall"
!insertmacro customCheckAppRunning
!insertmacro customUnInstall
SectionEnd
Section "writer"
WriteUninstaller "${paths.join(output, 'uninstaller.exe')}"
SectionEnd
!else
Section "install"
!insertmacro customInit
!insertmacro customCheckAppRunning
SectionEnd
!endif
`;
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-language-compile-'));
  const languages = new LangConfigurator(config.nsis);
  let languageMacro = '';
  createAddLangsMacro(
    {
      macro: (name, lines) => {
        languageMacro = `!macro ${name}\n${lines.join('\n')}\n!macroend`;
      },
    },
    languages,
  );
  const source = createProbeSource(root, temporary, languageMacro);
  try {
    const filename = path.join(temporary, 'probe.nsi');
    fs.writeFileSync(filename, source, 'utf8');
    const compiler = await getMakeNsisPath(config.toolsets?.nsis, config.nsis.customNsisBinary);
    for (const definitions of [[], ['-DBUILD_UNINSTALLER']]) {
      const result = spawnSync(
        compiler.path,
        ['-WX', '-INPUTCHARSET', 'UTF8', ...definitions, filename],
        {
          env: { ...process.env, ...compiler.env },
          encoding: 'utf8',
          timeout: 60_000,
        },
      );
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(
          `Native language compile failed: ${definitions.join(' ') || 'installer'} (${result.status})`,
        );
    }
    console.log(
      `PASS: production installer and uninstaller compile with all ${languages.langs.length} configured languages and -WX`,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { createProbeSource };
if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
