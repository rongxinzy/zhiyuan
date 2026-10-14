'use strict';

const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { Minimatch } = require('minimatch');

// Only audited native packages are in scope. Never prune arbitrary src/build trees.
const NATIVE_PACKAGES = [
  'better-sqlite3',
  'node-pty',
  'bufferutil',
  'utf-8-validate',
  '@earendil-works/pi-tui',
];
const BUILD_EXTENSIONS = [
  'iobj',
  'ipdb',
  'obj',
  'pdb',
  'lib',
  'exp',
  'vcxproj',
  'vcxproj.filters',
  'tlog',
  'recipe',
  'lastbuildstate',
  'sln',
  'mk',
  'gypi',
  'nativecodeanalysis.xml',
  'c',
  'h',
  'cc',
  'cpp',
];
const PLATFORMS = ['win32', 'darwin', 'linux'];

function validateTarget(target, allowMacro = false) {
  if (!target || !PLATFORMS.includes(target.platform))
    throw new Error('Unsupported native package platform');
  const arches = ['x64', 'arm64', 'ia32', 'armv7l', 'universal'];
  if (allowMacro) arches.push('${arch}');
  if (!arches.includes(target.arch))
    throw new Error('Explicit native package architecture is required');
  if (target.arch === 'universal' && target.platform !== 'darwin')
    throw new Error('Universal is only supported on macOS');
}

function nativePackageExclusions({ platform, arch = '${arch}' }) {
  validateTarget({ platform, arch }, true);
  const patterns = [];
  for (const name of ['better-sqlite3', 'node-pty']) {
    const root = `node_modules/${name}`;
    for (const extension of BUILD_EXTENSIONS) patterns.push(`!${root}/build/**/*.${extension}`);
    patterns.push(`!${root}/build/**/Makefile`, `!${root}/build/**/makefile`);
  }
  patterns.push('!node_modules/better-sqlite3/build/**/test_extension.node');
  // Platform literals avoid electron-builder's host-dependent ${platform}.
  // The universal final gate allows both separately filtered macOS slices.
  const allowedDirectory = arch === 'universal' ? 'darwin-x64|darwin-arm64' : `${platform}-${arch}`;
  for (const name of NATIVE_PACKAGES) {
    const root = `node_modules/${name}`;
    for (const other of PLATFORMS.filter(value => value !== platform)) {
      if (name === '@earendil-works/pi-tui')
        patterns.push(`!${root}/native/${other}/src/**/*.{m,c,h,cc,cpp}`);
    }
    patterns.push(`!${root}/**/prebuilds/!(${allowedDirectory})/**`);
  }
  // node-pty also ships its ConPTY runtime outside prebuilds.
  if (platform === 'win32') {
    patterns.push(`!node_modules/node-pty/third_party/conpty/**/win10-!(${arch})/**`);
  } else {
    patterns.push('!node_modules/node-pty/third_party/conpty/**');
  }
  return patterns;
}

function verifyNativePackage(resourcesRoot, target) {
  validateTarget(target);
  const archive = path.join(resourcesRoot, 'app.asar');
  const unpackedRoot = `${archive}.unpacked`;
  const archiveStat = fs.statSync(archive);
  if (!archiveStat.isFile()) throw new Error(`Missing packaged archive: ${archive}`);
  // Explicit reviewed Windows x64 budget; other targets retain structural gates.
  // Increasing this requires reviewing a real artifact's inventory, not disabling
  // the gate in response to an unexpectedly larger build.
  const sizeLimits =
    target.platform === 'win32' && target.arch === 'x64'
      ? { asarBytes: 128 * 1024 * 1024, unpackedBytes: 128 * 1024 * 1024 }
      : null;
  if (sizeLimits && archiveStat.size > sizeLimits.asarBytes)
    throw new Error(
      `Application archive exceeds size budget: ${archiveStat.size} > ${sizeLimits.asarBytes}`,
    );
  const matchers = nativePackageExclusions(target).map(
    pattern => new Minimatch(pattern.slice(1), { dot: true }),
  );
  const inventory = [];
  // afterPack and final verification may inspect a rebuilt archive in one process.
  asar.uncache(archive);
  const header = asar.getRawHeader(archive).header;
  const virtualUnpacked = new Map();
  function visitHeader(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (entry.files) visitHeader(entry, relative);
      else if (entry.link) {
        // Symlinks do not count as data; they must not conceal a forbidden path.
        inventory.push({ path: relative, size: 0, storage: 'link' });
      } else if (entry.unpacked) virtualUnpacked.set(relative, entry.size);
      else inventory.push({ path: relative, size: entry.size, storage: 'asar' });
    }
  }
  visitHeader(header);
  function visitDisk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visitDisk(absolute, relative);
      else if (entry.isSymbolicLink()) inventory.push({ path: relative, size: 0, storage: 'link' });
      else if (entry.isFile())
        inventory.push({ path: relative, size: fs.statSync(absolute).size, storage: 'unpacked' });
      else throw new Error(`Unsupported packaged file: ${relative}`);
    }
  }
  if (fs.existsSync(unpackedRoot)) visitDisk(unpackedRoot);
  const unpackedBytes = inventory
    .filter(item => item.storage === 'unpacked')
    .reduce((sum, item) => sum + item.size, 0);
  if (sizeLimits && unpackedBytes > sizeLimits.unpackedBytes)
    throw new Error(
      `Unpacked application exceeds size budget: ${unpackedBytes} > ${sizeLimits.unpackedBytes}`,
    );
  const physical = new Map(
    inventory.filter(item => item.storage === 'unpacked').map(item => [item.path, item]),
  );
  for (const [relative, size] of virtualUnpacked) {
    if (physical.get(relative)?.size !== size)
      throw new Error(`Missing or truncated unpacked file: ${relative}`);
  }
  // A platform-only negative matcher can silently make electron-builder include
  // the entire repository. Guard the actual archive, independently of filters.
  const unexpectedRootFiles = inventory.filter(
    item =>
      !/^(?:package\.json|resources\/SYSTEM_PROMPT\.md|(?:dist|dist-electron|node_modules)\/.+|(?:LICENSE|NOTICE|COPYING)(?:\.[A-Za-z0-9_-]+)?)$/.test(
        item.path,
      ),
  );
  if (unexpectedRootFiles.length)
    throw new Error(
      `Unexpected application payload files:\n${unexpectedRootFiles.map(item => item.path).join('\n')}`,
    );
  const forbidden = inventory.filter(item => matchers.some(matcher => matcher.match(item.path)));
  if (forbidden.length)
    throw new Error(
      `Forbidden native package files:\n${forbidden.map(item => item.path).join('\n')}`,
    );
  const requiredModules = [];
  const arches = target.arch === 'universal' ? ['x64', 'arm64'] : [target.arch];
  function requireNative(name, filename) {
    const build = `node_modules/${name}/build/Release/${filename}`;
    // Merged macOS universal modules may live in build/Release.
    if (physical.get(build)?.size > 0) {
      requiredModules.push(build);
      return;
    }
    for (const arch of arches) {
      const prebuilt = `node_modules/${name}/prebuilds/${target.platform}-${arch}/${filename}`;
      if (!(physical.get(prebuilt)?.size > 0))
        throw new Error(`Missing target native module: ${build} or ${prebuilt}`);
      requiredModules.push(prebuilt);
    }
  }
  requireNative('better-sqlite3', 'better_sqlite3.node');
  requireNative('node-pty', 'pty.node');
  if (target.platform === 'win32') {
    requireNative('node-pty', 'conpty.node');
    requireNative('node-pty', 'conpty_console_list.node');
  }
  const tuiFilename =
    target.platform === 'linux' ? 'linux-platform-x11.node' : `${target.platform}-platform.node`;
  for (const arch of arches) {
    const relative = `node_modules/@earendil-works/pi-tui/native/${target.platform}/prebuilds/${target.platform}-${arch}/${tuiFilename}`;
    if (!(physical.get(relative)?.size > 0))
      throw new Error(`Missing target native module: ${relative}`);
    requiredModules.push(relative);
  }
  return {
    target: { ...target },
    checkedFiles: inventory.length,
    asarBytes: archiveStat.size,
    unpackedBytes,
    sizeLimits,
    requiredModules,
    forbidden: [],
    inventory,
  };
}

module.exports = { nativePackageExclusions, verifyNativePackage };
