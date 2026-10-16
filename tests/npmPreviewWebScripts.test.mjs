import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

test('postinstall applies patches without requiring Bun', () => {
  assert.match(packageJson.scripts.postinstall, /patch-package/);
  assert.doesNotMatch(packageJson.scripts.postinstall, /\bbun run\b/);
});

test('preview:web starts through a Node launcher', () => {
  assert.equal(packageJson.scripts['preview:web'], 'node scripts/run-preview-web.mjs');
});

test('cross-env remains available for npm installs', () => {
  assert.ok(packageJson.devDependencies?.['cross-env']);
});
