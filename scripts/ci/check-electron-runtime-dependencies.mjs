import fs from 'node:fs';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELECTRON_RUNTIME_DEPENDENCIES } from '../electron-runtime-dependencies.mjs';

const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map(moduleName => `node:${moduleName}`),
  'electron',
]);
const DAEMON_FORBIDDEN_EXTERNALS = ['electron', 'extract-zip', 'tar'];

function packageRoot(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

export function collectLiteralExternalRoots(source) {
  const roots = new Set();
  const patterns = [
    /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        BUILTIN_MODULES.has(specifier)
      ) {
        continue;
      }
      roots.add(packageRoot(specifier));
    }
  }
  return [...roots].sort();
}

function findFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const matches = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(entryPath, predicate));
    if (entry.isFile() && predicate(entryPath)) matches.push(entryPath);
  }
  return matches;
}

function assertDaemonIsNodeSafe(source) {
  const forbidden = DAEMON_FORBIDDEN_EXTERNALS.filter(specifier =>
    new RegExp(`\\brequire\\s*\\(\\s*(['"])${specifier}\\1\\s*\\)`).test(source),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `Llama.cpp daemon bundle references Electron-only dependencies: ${forbidden.join(', ')}`,
    );
  }
}

export function checkProductionDependencyManifest(projectRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const declared = Object.keys(packageJson.dependencies ?? {}).sort();
  const expected = [...ELECTRON_RUNTIME_DEPENDENCIES].sort();
  if (JSON.stringify(declared) !== JSON.stringify(expected)) {
    throw new Error(
      `Production dependencies must match the Electron runtime allowlist.\nExpected: ${expected.join(', ')}\nActual: ${declared.join(', ')}`,
    );
  }

  return declared;
}

export function checkElectronRuntimeDependencies(projectRoot, { resolve = false } = {}) {
  const declared = checkProductionDependencyManifest(projectRoot);
  const outputDirectory = path.join(projectRoot, 'dist-electron');
  const mainPath = path.join(outputDirectory, 'main.js');
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Electron main bundle is missing: ${mainPath}`);
  }

  const daemonPath = path.join(outputDirectory, 'llamacppModelDaemonEntry.js');
  if (!fs.existsSync(daemonPath)) {
    throw new Error(`Llama.cpp daemon bundle is missing: ${daemonPath}`);
  }
  assertDaemonIsNodeSafe(fs.readFileSync(daemonPath, 'utf8'));

  const bundles = findFiles(outputDirectory, filePath => /\.[cm]?js$/.test(filePath));
  const externalRoots = [
    ...new Set(
      bundles.flatMap(filePath => collectLiteralExternalRoots(fs.readFileSync(filePath, 'utf8'))),
    ),
  ].sort();
  const undeclared = externalRoots.filter(root => !declared.includes(root));
  if (undeclared.length > 0) {
    throw new Error(
      `Electron main bundle references undeclared runtime dependencies: ${undeclared.join(', ')}`,
    );
  }

  const sourceMaps = findFiles(outputDirectory, filePath => filePath.endsWith('.map'));
  if (sourceMaps.length > 0) {
    throw new Error(
      `Production Electron output contains source maps: ${sourceMaps.map(filePath => path.relative(projectRoot, filePath)).join(', ')}`,
    );
  }

  if (resolve) {
    // Resolve from the deployment root, not this checker's development tree.
    const code = [
      "import { createRequire } from 'node:module';",
      "import path from 'node:path';",
      "const require = createRequire(path.join(process.cwd(), 'package.json'));",
      'for (const specifier of ' + JSON.stringify(externalRoots) + ') require.resolve(specifier);',
      "const { Harness } = await import('@earendil-works/pi-durable');",
      "const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');",
      "const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');",
      "require('@earendil-works/chord/context');",
      "require('@earendil-works/pi-ai/utils/validation');",
      "if (typeof Harness.open !== 'function' || typeof openNodeSqliteStorage !== 'function' || !BACKGROUND_CONTEXT) throw new Error('Native execution exports are unavailable');",
    ].join('\n');
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (probe.error || probe.status !== 0)
      throw new Error(
        'Desktop runtime resolution failed: ' + (probe.error?.message ?? probe.stderr),
      );
  }

  console.log(
    `[ElectronRuntimeDependencies] verified ${declared.length} production dependencies and ${externalRoots.length} generated external roots`,
  );
  return { declared, externalRoots };
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptPath === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--manifest-only')) checkProductionDependencyManifest(process.cwd());
  else
    checkElectronRuntimeDependencies(process.cwd(), {
      resolve: process.argv.includes('--resolve'),
    });
}
