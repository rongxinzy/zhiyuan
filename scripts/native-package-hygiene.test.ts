import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createPackageWithOptions } from '@electron/asar';

const require = createRequire(import.meta.url);
const { Minimatch } = require('minimatch');
const { nativePackageExclusions, verifyNativePackage } = require('./native-package-hygiene.cjs');
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })),
);
const target = { platform: 'win32', arch: 'x64' };
function excluded(relative: string, selected = target) {
  return nativePackageExclusions(selected).some((glob: string) =>
    new Minimatch(glob.slice(1), { dot: true }).match(relative),
  );
}
const required = [
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/node-pty/build/Release/pty.node',
  'node_modules/node-pty/build/Release/conpty.node',
  'node_modules/node-pty/build/Release/conpty_console_list.node',
  'node_modules/@earendil-works/pi-tui/native/win32/prebuilds/win32-x64/win32-platform.node',
];
function write(root: string, relative: string, data = 'fixture') {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, data);
}
async function fixture(extras: string[] = [], omit = '', unpack = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-package-hygiene-'));
  temporary.push(root);
  const source = path.join(root, 'source');
  const resources = path.join(root, 'resources');
  fs.mkdirSync(resources);
  for (const relative of [...required, 'package.json', ...extras].filter(value => value !== omit))
    write(source, relative);
  await createPackageWithOptions(
    source,
    path.join(resources, 'app.asar'),
    unpack ? { unpack: '**/*.node' } : {},
  );
  return resources;
}

test.each([
  'node_modules/better-sqlite3/build/Release/better_sqlite3.iobj',
  'node_modules/better-sqlite3/build/Release/better_sqlite3.ipdb',
  'node_modules/better-sqlite3/build/Release/sqlite3.lib',
  'node_modules/better-sqlite3/build/Release/obj/global_intermediate/sqlite3/sqlite3.c',
  'node_modules/better-sqlite3/build/Release/test_extension.node',
  'node_modules/node-pty/build/deps/winpty/src/Release/obj/winpty/winpty.tlog/CL.read.1.tlog',
  'node_modules/node-pty/prebuilds/win32-arm64/pty.node',
  'node_modules/node-pty/third_party/conpty/1.23/win10-arm64/OpenConsole.exe',
  'node_modules/bufferutil/prebuilds/linux-x64/bufferutil.node',
  'node_modules/bufferutil/prebuilds/freebsd-x64/bufferutil.node',
  'node_modules/@earendil-works/pi-tui/native/darwin/src/darwin-platform.m',
  'node_modules/@earendil-works/pi-tui/native/linux/src/linux-platform-x11.c',
  'node_modules/utf-8-validate/prebuilds/win32-ia32/utf-8-validate.node',
  'node_modules/@earendil-works/pi-tui/native/darwin/prebuilds/darwin-arm64/darwin-platform.node',
])('excludes audited unwanted file %s', relative => expect(excluded(relative)).toBe(true));

test.each([
  ...required,
  'node_modules/node-pty/build/Release/winpty.dll',
  'node_modules/node-pty/build/Release/winpty-agent.exe',
  'node_modules/node-pty/third_party/conpty/1.23/win10-x64/OpenConsole.exe',
  'node_modules/node-pty/LICENSE',
  'node_modules/node-pty/third_party/conpty/LICENSE',
  'node_modules/other/build/Release/runtime.lib',
  'node_modules/other/src/index.js',
  'resources/mingit/usr/bin/bash.exe',
])('preserves required or out-of-scope file %s', relative =>
  expect(excluded(relative)).toBe(false),
);

test('arch macro expands without host-platform dependence or shared mutable state', () => {
  const macro = nativePackageExclusions({ platform: 'win32' });
  expect(macro.join('\n')).toContain('${arch}');
  expect(macro.join('\n')).not.toContain('${platform}');
  expect(macro.map((glob: string) => glob.replaceAll('${arch}', 'x64'))).toEqual(
    nativePackageExclusions(target),
  );
  nativePackageExclusions({ platform: 'linux', arch: 'arm64' });
  expect(nativePackageExclusions({ platform: 'win32' })).toEqual(macro);
});

test('macOS universal preserves both slices; single arch excludes the other', () => {
  const intel = 'node_modules/node-pty/prebuilds/darwin-x64/pty.node';
  const arm = 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node';
  expect(excluded(intel, { platform: 'darwin', arch: 'arm64' })).toBe(true);
  for (const relative of [intel, arm])
    expect(excluded(relative, { platform: 'darwin', arch: 'universal' })).toBe(false);
  expect(
    excluded('node_modules/node-pty/prebuilds/win32-x64/pty.node', {
      platform: 'darwin',
      arch: 'universal',
    }),
  ).toBe(true);
});

test('real ASAR inventory counts unpacked contents once and preserves required modules', async () => {
  const resources = await fixture();
  const report = verifyNativePackage(resources, target);
  expect(report.checkedFiles).toBe(6);
  expect(report.unpackedBytes).toBe(5 * 7);
  expect(report.requiredModules).toEqual(required);
  expect(report.asarBytes).toBe(fs.statSync(path.join(resources, 'app.asar')).size);
  expect(report.forbidden).toEqual([]);
});

test.each([
  'node_modules/better-sqlite3/build/Release/sqlite3.lib',
  'node_modules/node-pty/build/Release/pty.ipdb',
  'node_modules/bufferutil/prebuilds/linux-x64/bufferutil.node',
  'node_modules/bufferutil/prebuilds/freebsd-x64/bufferutil.node',
  'node_modules/better-sqlite3/build/Release/test_extension.node',
])('final gate rejects dirty ASAR/unpacked fixture %s', async relative => {
  const resources = await fixture([relative]);
  expect(() => verifyNativePackage(resources, target)).toThrow('Forbidden native package files');
});

test('final gate also catches physical files absent from ASAR header', async () => {
  const resources = await fixture();
  write(
    `${path.join(resources, 'app.asar')}.unpacked`,
    'node_modules/node-pty/build/Release/pty.iobj',
  );
  expect(() => verifyNativePackage(resources, target)).toThrow('Forbidden native package files');
});

test.each(required)('final gate rejects missing required module %s', async relative => {
  const resources = await fixture([], relative);
  expect(() => verifyNativePackage(resources, target)).toThrow('Missing target native module');
});

test('final gate rejects missing or truncated physical unpacked files', async () => {
  const resources = await fixture();
  fs.writeFileSync(path.join(resources, 'app.asar.unpacked', required[0]), '');
  expect(() => verifyNativePackage(resources, target)).toThrow(
    'Missing or truncated unpacked file',
  );
});

test('required native modules cannot be hidden only inside ASAR', async () => {
  const resources = await fixture([], '', false);
  expect(() => verifyNativePackage(resources, target)).toThrow('Missing target native module');
});

test('final gate rejects a missing ASAR or unknown target rather than skipping', () => {
  expect(() => verifyNativePackage('/not-a-package', target)).toThrow();
  expect(() => nativePackageExclusions({ platform: 'win32', arch: 'universal' })).toThrow();
});

test('universal final ASAR gate requires both platform slices and rejects foreign ones', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-package-universal-'));
  temporary.push(root);
  const source = path.join(root, 'source');
  const resources = path.join(root, 'resources');
  fs.mkdirSync(resources);
  for (const arch of ['x64', 'arm64']) {
    write(source, `node_modules/better-sqlite3/prebuilds/darwin-${arch}/better_sqlite3.node`);
    write(source, `node_modules/node-pty/prebuilds/darwin-${arch}/pty.node`);
    write(
      source,
      `node_modules/@earendil-works/pi-tui/native/darwin/prebuilds/darwin-${arch}/darwin-platform.node`,
    );
  }
  await createPackageWithOptions(source, path.join(resources, 'app.asar'), { unpack: '**/*.node' });
  const report = verifyNativePackage(resources, { platform: 'darwin', arch: 'universal' });
  expect(report.requiredModules).toHaveLength(6);
  expect(() => verifyNativePackage(resources, { platform: 'darwin', arch: 'arm64' })).toThrow(
    'Forbidden native package files',
  );
});

test('foreign-platform source exclusions preserve license and notice documents', () => {
  for (const relative of [
    'node_modules/@earendil-works/pi-tui/native/darwin/src/LICENSE',
    'node_modules/@earendil-works/pi-tui/native/linux/NOTICE',
    'node_modules/better-sqlite3/build/LICENSE',
  ])
    expect(excluded(relative)).toBe(false);
  expect(excluded('node_modules/better-sqlite3/build/Debug/test_extension.node')).toBe(true);
});

test('re-verification reads a replaced archive rather than cached clean metadata', async () => {
  const resources = await fixture();
  verifyNativePackage(resources, target);
  const source = path.join(path.dirname(resources), 'source');
  write(source, 'node_modules/node-pty/build/Release/pty.ipdb');
  await createPackageWithOptions(source, path.join(resources, 'app.asar'), { unpack: '**/*.node' });
  expect(() => verifyNativePackage(resources, target)).toThrow('Forbidden native package files');
});

test.each([
  ['win', 'win32', 'x64'],
  ['win', 'win32', 'arm64'],
  ['mac', 'darwin', 'x64'],
  ['mac', 'darwin', 'arm64'],
  ['linux', 'linux', 'x64'],
  ['linux', 'linux', 'arm64'],
])('actual builder %s %s %s filters retain target binaries only', (key, platform, arch) => {
  const config = require('../electron-builder.json');
  const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
  expect(config[key].files).toEqual([
    'package.json',
    'resources/SYSTEM_PROMPT.md',
    ...nativePackageExclusions({ platform }),
  ]);
  const root = path.resolve('/fixture');
  const matcher = getNodeModuleFileMatcher(
    root,
    '/output',
    (value: string) => value.replaceAll('${arch}', arch),
    config[key],
    { config, debugLogger: { isEnabled: false } },
  );
  const filter = matcher.createFilter();
  const accepts = (relative: string) =>
    filter(path.join(root, relative), { isDirectory: () => false });
  expect(accepts(`node_modules/node-pty/prebuilds/${platform}-${arch}/pty.node`)).toBe(true);
  const other = arch === 'x64' ? 'arm64' : 'x64';
  expect(accepts(`node_modules/node-pty/prebuilds/${platform}-${other}/pty.node`)).toBe(false);
  expect(accepts('node_modules/better-sqlite3/build/Release/better_sqlite3.node')).toBe(true);
  expect(accepts('node_modules/better-sqlite3/build/Release/better_sqlite3.iobj')).toBe(false);
  expect(accepts('node_modules/better-sqlite3/build/Debug/test_extension.node')).toBe(false);
  expect(accepts('node_modules/node-pty/LICENSE')).toBe(true);
});

test.each([
  'src/main.ts',
  'scripts/dev.js',
  'build-tar/portable-git.7z',
  'resources/toolchain/go.zip',
  'resources/vc_redist.x64.exe',
  'research/scratch.html',
  'arbitrary-new-folder/data.bin',
])('final archive gate rejects unapproved application root payload %s', async relative => {
  const resources = await fixture([relative]);
  expect(() => verifyNativePackage(resources, target)).toThrow(
    'Unexpected application payload files',
  );
});

test('root gate covers physical unpacked files absent from the archive header', async () => {
  const resources = await fixture();
  write(path.join(resources, 'app.asar.unpacked'), 'build-tar/toolchain.zip');
  expect(() => verifyNativePackage(resources, target)).toThrow(
    'Unexpected application payload files',
  );
});

test('root gate preserves bundled application paths and license notices', async () => {
  const resources = await fixture([
    'dist/index.html',
    'dist/assets/app.js',
    'dist-electron/main.js',
    'resources/SYSTEM_PROMPT.md',
    'LICENSE',
    'LICENSE.txt',
    'NOTICE',
    'COPYING',
  ]);
  expect(verifyNativePackage(resources, target).forbidden).toEqual([]);
});

function mainMatcherAccepts(config: any, key: string, arch: string) {
  const { doMergeConfigs } = require('app-builder-lib/out/util/config/config');
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
  // getConfig uses this normalization before platformPackager constructs matchers.
  // Raw JSON alone misses the platform-negative-only default matcher regression.
  const normalized = doMergeConfigs([structuredClone(config)]);
  const projectDir = path.resolve('/fixture');
  const matchers = getMainFileMatchers(
    projectDir,
    '/output',
    (value: string) => value.replaceAll('${arch}', arch),
    normalized[key],
    {
      info: {
        config: normalized,
        projectDir,
        buildResourcesDir: 'build',
        debugLogger: { isEnabled: false },
      },
    },
    '/release',
    false,
  );
  return (relative: string) => {
    const absolute = path.join(projectDir, relative);
    return matchers.some((matcher: any) => {
      // Walkers only visit each matcher's own source tree, not unrelated roots.
      const fromRelative = path.relative(matcher.from, absolute);
      if (
        fromRelative === '..' ||
        fromRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(fromRelative)
      )
        return false;
      return matcher.createFilter()(absolute, { isDirectory: () => false });
    });
  };
}

test.each([
  ['win', 'x64'],
  ['win', 'arm64'],
  ['mac', 'x64'],
  ['mac', 'arm64'],
  ['linux', 'x64'],
  ['linux', 'arm64'],
])('normalized builder main matchers preserve the application allowlist for %s %s', (key, arch) => {
  const config = require('../electron-builder.json');
  const accepts = mainMatcherAccepts(config, key, arch);
  for (const relative of [
    'package.json',
    'resources/SYSTEM_PROMPT.md',
    'dist/index.html',
    'dist/assets/main.js',
    'dist-electron/main.js',
  ]) {
    expect(accepts(relative), relative).toBe(true);
  }
  for (const relative of [
    'src/main.ts',
    'scripts/dev.js',
    'build-tar/portable-git.7z',
    'resources/toolchain/go.zip',
    'resources/vc_redist.x64.exe',
    'docs/private.txt',
    'node_modules/typescript/lib/typescript.js',
    'node_modules/vitest/package.json',
    'dist/assets/main.js.map',
  ]) {
    expect(accepts(relative), relative).toBe(false);
  }
  const broken = structuredClone(config);
  broken[key].files = broken[key].files.filter((entry: string) => entry.startsWith('!'));
  const previouslyAccepted = mainMatcherAccepts(broken, key, arch);
  // Discriminating regression: the previous negative-only configuration admits
  // source files and large offline inputs through its implicit **/* matcher.
  for (const relative of [
    'src/main.ts',
    'build-tar/portable-git.7z',
    'resources/toolchain/go.zip',
  ]) {
    expect(previouslyAccepted(relative), relative).toBe(true);
  }
});

test('Windows x64 archive budget rejects an oversized real file before parsing', async () => {
  const resources = await fixture();
  fs.truncateSync(path.join(resources, 'app.asar'), 128 * 1024 * 1024 + 1);
  expect(() => verifyNativePackage(resources, target)).toThrow(
    'Application archive exceeds size budget',
  );
});

test('Windows x64 unpacked budget rejects sparse oversized payload without reading it', async () => {
  const resources = await fixture();
  const relative = 'node_modules/unexpected-size/data.bin';
  write(path.join(resources, 'app.asar.unpacked'), relative);
  fs.truncateSync(path.join(resources, 'app.asar.unpacked', relative), 128 * 1024 * 1024 + 1);
  expect(() => verifyNativePackage(resources, target)).toThrow(
    'Unpacked application exceeds size budget',
  );
});

test('hygiene report records reviewed size budgets', async () => {
  const resources = await fixture();
  expect(verifyNativePackage(resources, target).sizeLimits).toEqual({
    asarBytes: 128 * 1024 * 1024,
    unpackedBytes: 128 * 1024 * 1024,
  });
});
