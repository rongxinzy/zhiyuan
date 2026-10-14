import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');

test('renderer builds have no retired Office screenshot entry or workflow policy', () => {
  const viteConfig = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  assert.doesNotMatch(viteConfig, /office-preview|officePreview/);
  assert.match(viteConfig, /main: path\.resolve\(projectRoot, 'index\.html'\)/);

  for (const file of [
    'office-preview.html',
    'src/renderer/officePreview.ts',
    'src/main/libs/officePreviewRenderer.ts',
    'src/main/libs/agentEngine/piShortcutWorkflowPolicy.ts',
  ]) {
    assert.equal(existsSync(path.join(root, file)), false, `${file} must remain retired`);
  }
});

test('desktop packaging does not unpack the removed AnyDoc runtime', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    asarUnpack?: string[];
  };

  assert.ok(!config.asarUnpack?.some(pattern => pattern.includes('@firecrawl')));
});

test('retired VM image builders cannot install unused WSL dependencies', () => {
  for (const file of ['scripts/setup-wsl.ps1', 'scripts/wsl-build-image.sh']) {
    assert.equal(existsSync(path.join(root, file)), false, `${file} must remain retired`);
  }
});

test('document and spreadsheet artifact previews keep their existing renderer dependencies', () => {
  const renderer = readFileSync(
    path.join(root, 'src/renderer/components/artifacts/renderers/DocumentRenderer.tsx'),
    'utf8',
  );
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>;
  };

  for (const dependency of ['docx-preview', 'xlsx']) {
    assert.ok(packageJson.devDependencies[dependency]);
    assert.ok(renderer.includes(`import('${dependency}')`));
  }
});

test('test transforms do not retain a removed agent runtime', () => {
  assert.doesNotMatch(
    readFileSync(path.join(root, 'vitest.config.ts'), 'utf8'),
    /@earendil-works\/pi-coding-agent/,
  );
});
