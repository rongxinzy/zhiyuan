import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const source = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('does not expose removed skill and MCP operations through preload', () => {
  const preload = source('src/main/preload.ts');
  expect(preload).not.toMatch(/\b(?:skills|mcp):\s*\{/u);
  expect(preload).not.toContain('SkillsIpc');
  expect(preload).not.toContain('McpIpc');
});

test('does not bootstrap or install removed tools during application startup', () => {
  const main = source('src/main/main.ts');
  for (const removedOperation of [
    'syncBundledSkillsToUserData',
    'ensurePythonRuntimeReady',
    'initMcpServers',
    'installFeishuSkills',
    "ipcMain.handle('skills:",
    'ipcMain.handle(McpIpc.',
  ]) {
    expect(main).not.toContain(removedOperation);
  }
});

test('subprocess environment no longer injects managed Python or skill roots', () => {
  const environment = source('src/main/libs/coworkUtil.ts');
  for (const removedEnvironment of [
    'applyManagedPythonEnv',
    'getSkillsRoot',
    'SKILLS_ROOT',
    'getFeishuCliBinDirectory',
    'applyUvPackageIndexDefaults',
  ]) {
    expect(environment).not.toContain(removedEnvironment);
  }
});
