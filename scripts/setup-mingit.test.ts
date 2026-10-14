import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { findPortableGit } = require('./setup-mingit.js');
const required: string[] = require('./portable-git-required-files.json');
const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('requires the Git launcher, real executable and all bundled DLL imports rather than Bash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-portable-git-'));
  temporary.push(root);
  expect(findPortableGit(root)).toBe(null);
  for (const relative of required) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixture');
  }
  expect(findPortableGit(root)).toBe(path.join(root, 'cmd/git.exe'));
  expect(fs.existsSync(path.join(root, 'usr/bin/bash.exe'))).toBe(false);
  for (const relative of required) {
    fs.writeFileSync(path.join(root, relative), '');
    expect(findPortableGit(root)).toBe(null);
    fs.writeFileSync(path.join(root, relative), 'fixture');
  }
});

test('keeps the full official distribution and verifies the same installed Git DLLs', () => {
  const setup = fs.readFileSync(path.join(__dirname, 'setup-mingit.js'), 'utf8');
  expect(setup).toContain("['x', archivePath, `-o${OUTPUT_DIR}`, '-y']");
  expect(setup).not.toContain('pruneUnneededFiles');
  const hooks = fs.readFileSync(path.join(__dirname, 'electron-builder-hooks.cjs'), 'utf8');
  expect(hooks).toContain('if (!portableGit.gitPath)');
  expect(hooks).not.toContain('bash.exe');
  const installer = fs.readFileSync(path.join(__dirname, 'nsis-installer.nsh'), 'utf8');
  for (const relative of required) {
    expect(installer).toContain(
      `IfFileExists "$INSTDIR\\resources\\mingit\\${relative.replaceAll('/', '\\')}" 0 InstalledRuntimeVerificationFailed`,
    );
  }
});
