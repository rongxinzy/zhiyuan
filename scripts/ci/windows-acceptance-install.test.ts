import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync('scripts/ci/windows-acceptance-install.ps1', 'utf8');
const workflow = readFileSync('.github/workflows/windows-acceptance.yml', 'utf8');

describe('Windows acceptance delivery gate', () => {
  it('keeps NSIS silent regression separate and requires the real shell-installed application smoke', () => {
    expect(script).toContain("Join-Path $env:RUNNER_TEMP 'zhiyuan-acceptance-installed'");
    expect(script).toContain('Expected an explicitly unsigned acceptance installer');
    expect(script).toContain('/S /D=$installRoot');
    expect(script).toContain('windows-app-smoke.mjs');
    expect(script).toContain("Join-Path $project 'release/setup'");
    expect(script).toContain("'zhiyuan-shell-acceptance/安装路径/知远.exe'");
    expect(script).toContain('windows-shell-evidence.mjs');
    expect(script.indexOf('Installed application smoke failed')).toBeLessThan(
      script.indexOf('Copy-Item -LiteralPath $installer.FullName'),
    );
    expect(script).toContain('SHA256SUMS.txt');
    expect(script).toContain('commit=$env:GITHUB_SHA');
    expect(script).toMatch(/finally\s*\{[\s\S]*windows-installer-diagnostics\.ps1/);
    expect(script).toContain('-StartedAt $started');
    expect(script).not.toMatch(/\$env:(?:USERPROFILE|APPDATA|LOCALAPPDATA|HOME)\s*=/);
    expect(script).not.toMatch(/Defender|Add-MpPreference|Set-MpPreference|package-windows\.ps1/);
  });

  it('uploads an installer only after acceptance and keeps failed diagnostics separate', () => {
    expect(workflow).toContain('retention-days: 14');
    expect(workflow).toContain('group: windows-acceptance-${{ github.ref }}');
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && format('-manual-{0}', github.run_id)",
    );
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('path: acceptance-output/');
    expect(workflow).toMatch(/if: failure\(\) \|\| cancelled\(\)[\s\S]*acceptance-diagnostics\//);
    expect(workflow).not.toMatch(/secrets\.|contents: write|softprops|release-action/);
    expect(workflow).toContain('--publish never');
    expect(workflow).toContain('bun run build');
    expect(workflow).toContain('--production --ignore-scripts');
  });
});

it('omits the NSIS launch callback when its button is disabled', () => {
  const pages = readFileSync('scripts/installer-ui/zy-pages.nsh', 'utf8');
  expect(pages).toMatch(
    /!ifndef HIDE_RUN_AFTER_FINISH\s+Function ZYFinishLaunchClick[\s\S]*?FunctionEnd\s+!endif/,
  );
  expect(pages).toMatch(
    /!ifndef HIDE_RUN_AFTER_FINISH[\s\S]*?\$\{NSD_OnClick\} \$0 ZYFinishLaunchClick\s+!endif/,
  );
});
