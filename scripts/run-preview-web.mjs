#!/usr/bin/env node
/**
 * Starts the browser-only UI preview without requiring Bun.
 * Sets VITE_BROWSER_PREVIEW / VITE_SKIP_ELECTRON and delegates to the local Vite CLI.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const viteBin =
  process.platform === 'win32'
    ? path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
    : path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const env = {
  ...process.env,
  VITE_BROWSER_PREVIEW: '1',
  VITE_SKIP_ELECTRON: '1',
};

const child = spawn(
  process.execPath,
  [viteBin, '--force', '--open', '/index.browser-preview.html'],
  {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  },
);

child.on('exit', code => {
  process.exit(code ?? 1);
});

child.on('error', error => {
  console.error('[preview:web] failed to start Vite:', error);
  process.exit(1);
});
