'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const baseHooks = require('../electron-builder-hooks.cjs');
const { verifyRuntime, sha256File, upstream } = require('../magpie-runtime.cjs');
const { checkElectronRuntimeDependencies } = require('./check-electron-runtime-dependencies.mjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BUNDLES = [
  'main.js',
  'preload.js',
  'llamacppModelDaemonEntry.js',
  'contentWorker.js',
  'archiveWorker.js',
  'catalogWorker.js',
  'hashWorker.js',
  'appUpdateHashWorker.js',
  'python-runtime-runner.js',
  'native-execution-smoke.js',
];
const ADAPTERS = [
  ['@agentclientprotocol/codex-acp', 'codex-acp'],
  ['@agentclientprotocol/claude-agent-acp', 'claude-agent-acp'],
];

function regularFile(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || !stat.size) throw new Error(`Required nonempty regular file: ${filename}`);
  return fs.readFileSync(filename);
}

function readArchiveFile(archive, relativePath) {
  // ASAR's lookup splits directories on the host path.sep, even for archive members.
  return asar.extractFile(archive, path.normalize(relativePath));
}

function assertPeBytes(bytes, label, machines = [0x8664]) {
  if (bytes.length < 128 || bytes.toString('ascii', 0, 2) !== 'MZ')
    throw new Error(`Missing PE executable header: ${label}`);
  const offset = bytes.readUInt32LE(0x3c);
  if (offset > bytes.length - 24 || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0')
    throw new Error(`Invalid PE executable header: ${label}`);
  if (!machines.includes(bytes.readUInt16LE(offset + 4)))
    throw new Error(`Expected Windows x64 executable: ${label}`);
}

function assertPe(filename, machines) {
  assertPeBytes(regularFile(filename), filename, machines);
}

function nativeFiles(nodeModules) {
  const find = (name, filename) => {
    const candidates = [
      path.join(nodeModules, name, 'build/Release', filename),
      path.join(nodeModules, name, 'prebuilds/win32-x64', filename),
    ];
    const found = candidates.find(candidate => fs.existsSync(candidate));
    if (!found) throw new Error(`Missing Windows native binding: ${name}/${filename}`);
    assertPe(found);
    return found;
  };
  return [
    find('better-sqlite3', 'better_sqlite3.node'),
    find('node-pty', 'pty.node'),
    find('node-pty', 'conpty.node'),
    find('node-pty', 'conpty_console_list.node'),
  ];
}

function verifyPreparedResources(projectRoot = ROOT) {
  const report = JSON.parse(
    regularFile(path.join(projectRoot, 'build-tar/windows-acceptance/prepared.json')),
  );
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.target, 'win32-x64');
  assert.equal(report.magpieSourceCommit, upstream.commit);
  assert.equal(report.go.url, `https://go.dev/dl/${upstream.toolchains['win32-x64'].archive}`);
  assert.equal(report.go.sha256, upstream.toolchains['win32-x64'].sha256);
  assert.equal(report.vcRedist.url, 'https://aka.ms/vc14/vc_redist.x64.exe');
  assert.equal(new URL(report.vcRedist.resolvedUrl).protocol, 'https:');
  assert.equal(report.vcRedist.signatureStatus, 'Valid');
  assert.match(report.vcRedist.publisher, /(^|,\s*)O=Microsoft Corporation(,|$)/);
  assert.match(report.vcRedist.certificateThumbprint, /^[A-Fa-f0-9]{40}$/);
  const vc = path.join(projectRoot, 'resources/vc_redist.x64.exe');
  assertPe(vc, [0x14c, 0x8664]); // The x64 redistributable has a 32-bit bootstrapper.
  assert.equal(sha256File(vc), report.vcRedist.sha256, 'VC runtime changed after verification');
  const helper = path.join(projectRoot, 'resources/python-runtime/job-runner.exe');
  assertPe(helper);
  assert.equal(sha256File(helper), report.jobRunnerSha256, 'Job helper changed after compilation');
  const magpie = verifyRuntime(path.join(projectRoot, 'resources/magpie'), 'win32-x64');
  assertPe(path.join(projectRoot, 'resources/magpie/win32-x64/magpie.exe'));
  assert.deepEqual(
    JSON.parse(regularFile(path.join(projectRoot, 'resources/modelscope.tokens.local.json'))),
    { tokens: [] },
  );
  assert.equal(
    report.portableGit.url,
    'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/PortableGit-2.47.1-64-bit.7z.exe',
  );
  assertPe(path.join(projectRoot, 'resources/mingit/usr/bin/bash.exe'));
  assertPe(path.join(projectRoot, 'resources/mingit/cmd/git.exe'));
  assert.equal(
    sha256File(path.join(projectRoot, 'resources/mingit/usr/bin/bash.exe')),
    report.portableGit.bashSha256,
  );
  assert.equal(
    sha256File(path.join(projectRoot, 'resources/mingit/cmd/git.exe')),
    report.portableGit.gitSha256,
  );
  return { report, magpie };
}

function verifyInputs(projectRoot = ROOT) {
  const prepared = verifyPreparedResources(projectRoot);
  const runtime = checkElectronRuntimeDependencies(projectRoot);
  for (const bundle of BUNDLES) regularFile(path.join(projectRoot, 'dist-electron', bundle));
  regularFile(path.join(projectRoot, 'dist/index.html'));
  const wasm = regularFile(path.join(projectRoot, 'dist-electron/photon_rs_bg.wasm'));
  assert.ok(
    wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])),
    'Invalid Photon WASM',
  );
  const natives = nativeFiles(path.join(projectRoot, 'node_modules'));
  return { ...prepared, runtime, natives };
}

function verifyPackage(appOutDir, projectRoot = ROOT) {
  const prepared = verifyPreparedResources(projectRoot);
  const config = JSON.parse(regularFile(path.join(projectRoot, 'electron-builder.json')));
  assertPe(path.join(appOutDir, `${config.executableName}.exe`));
  const resources = path.join(appOutDir, 'resources');
  const archive = path.join(resources, 'app.asar');
  regularFile(archive);
  asar.uncache(archive);
  const entries = asar
    .listPackage(archive)
    .map(entry => entry.replaceAll('\\', '/').replace(/^\//, ''));
  for (const entry of entries) {
    assert.doesNotMatch(
      entry,
      /^(?:vendor|SKILLs|MCPs)\/|^node_modules\/@firecrawl\/|^dist\/office-preview\.html$|^dist\/assets\/officePreview-/,
    );
    assert.ok(!entry.endsWith('.map'), `Source map shipped: ${entry}`);
  }
  const packagedJson = JSON.parse(readArchiveFile(archive, 'package.json'));
  const sourceJson = JSON.parse(regularFile(path.join(projectRoot, 'package.json')));
  assert.equal(
    packagedJson.version,
    sourceJson.version,
    'Packaged version differs from this build',
  );
  assert.equal(packagedJson.zhiyuanAcceptanceBuild, true, 'Not an acceptance build');
  assert.equal(packagedJson.main, 'dist-electron/main.js');
  for (const bundle of [...BUNDLES, 'photon_rs_bg.wasm']) {
    assert.ok(
      readArchiveFile(archive, `dist-electron/${bundle}`).equals(
        regularFile(path.join(projectRoot, 'dist-electron', bundle)),
      ),
      `Packaged bundle differs: ${bundle}`,
    );
  }
  assert.ok(
    readArchiveFile(archive, 'dist/index.html').equals(
      regularFile(path.join(projectRoot, 'dist/index.html')),
    ),
  );
  assert.ok(
    readArchiveFile(archive, 'resources/SYSTEM_PROMPT.md').equals(
      regularFile(path.join(projectRoot, 'resources/SYSTEM_PROMPT.md')),
    ),
  );
  for (const name of [
    '@earendil-works/pi-durable',
    '@earendil-works/chord',
    '@agentclientprotocol/sdk',
  ]) {
    const manifest = JSON.parse(readArchiveFile(archive, `node_modules/${name}/package.json`));
    assert.equal(manifest.version, sourceJson.dependencies[name]);
    const exports =
      name === '@earendil-works/pi-durable'
        ? ['.', './storage/sqlite/node']
        : name === '@earendil-works/chord'
          ? ['.', './context']
          : [];
    for (const key of exports) {
      const entry = manifest.exports?.[key];
      const target = typeof entry === 'string' ? entry : (entry?.import ?? entry?.default);
      assert.equal(typeof target, 'string', `Missing native export: ${name}${key}`);
      assert.ok(
        target.startsWith('./') && !target.split('/').includes('..'),
        'Unsafe package export',
      );
      assert.ok(
        readArchiveFile(archive, `node_modules/${name}/${target.slice(2)}`).length,
        `Empty native export: ${name}${key}`,
      );
    }
  }
  const unpacked = path.join(resources, 'app.asar.unpacked/node_modules');
  const natives = nativeFiles(unpacked);
  for (const [name, bin] of ADAPTERS) {
    const adapterRoot = path.join(unpacked, name);
    const manifest = JSON.parse(regularFile(path.join(adapterRoot, 'package.json')));
    const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[bin];
    assert.equal(typeof entry, 'string', `Adapter has no ${bin} entry`);
    const resolved = path.resolve(adapterRoot, entry);
    assert.ok(
      resolved.startsWith(`${adapterRoot}${path.sep}`),
      'Adapter entry escapes its package',
    );
    regularFile(resolved);
  }
  for (const cli of ['npm-cli.js', 'npx-cli.js']) regularFile(path.join(unpacked, 'npm/bin', cli));
  for (const relative of [
    'acp/registry.json',
    'vc_redist.x64.exe',
    'python-runtime/job-runner.exe',
    'magpie/upstream.json',
    'modelscope.tokens.local.json',
  ]) {
    assert.ok(
      regularFile(path.join(resources, relative)).equals(
        regularFile(path.join(projectRoot, 'resources', relative)),
      ),
      `Packaged resource differs: ${relative}`,
    );
  }
  const magpie = verifyRuntime(path.join(resources, 'magpie'), 'win32-x64');
  assert.equal(
    magpie.sha256,
    prepared.magpie.sha256,
    'Magpie compiler output changed during packaging',
  );
  return {
    schemaVersion: 1,
    target: 'win32-x64',
    version: packagedJson.version,
    signingPolicy: 'disabled',
    magpieSha256: magpie.sha256,
    vcRedistSha256: prepared.report.vcRedist.sha256,
    nativeBindings: natives.map(filename => path.relative(resources, filename)),
    bundleCount: BUNDLES.length,
  };
}

function assertTarget(context) {
  if (context.electronPlatformName !== 'win32' || ![1, 'x64'].includes(context.arch))
    throw new Error('Acceptance packaging supports Windows x64 only');
}

function probeRuntime(appOutDir, projectRoot = ROOT) {
  if (process.platform !== 'win32') throw new Error('The packaged runtime probe requires Windows');
  verifyPackage(appOutDir, projectRoot);
  const config = JSON.parse(regularFile(path.join(projectRoot, 'electron-builder.json')));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-acceptance-runtime-'));
  try {
    asar.extractAll(path.join(appOutDir, 'resources/app.asar'), temporary);
    const probe = path.join(temporary, 'acceptance-probe.mjs');
    fs.copyFileSync(path.join(__dirname, 'windows-acceptance-resources-probe.mjs'), probe);
    const env = {
      ELECTRON_RUN_AS_NODE: '1',
      HOME: temporary,
      USERPROFILE: temporary,
      TEMP: temporary,
      TMP: temporary,
    };
    for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC'])
      if (process.env[key]) env[key] = process.env[key];
    env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
    env.APPDATA = path.join(temporary, 'AppData/Roaming');
    env.LOCALAPPDATA = path.join(temporary, 'AppData/Local');
    const result = spawnSync(path.resolve(appOutDir, `${config.executableName}.exe`), [probe], {
      cwd: temporary,
      env,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `Packaged runtime probe failed: ${result.error?.message || result.stderr || result.stdout}`,
      );
    const line = result.stdout
      .split(/\r?\n/)
      .find(value => value.startsWith('WINDOWS_ACCEPTANCE_RUNTIME_OK '));
    if (!line) throw new Error('Packaged runtime probe did not report successful native checks');
    const verified = JSON.parse(line.slice('WINDOWS_ACCEPTANCE_RUNTIME_OK '.length));
    assert.equal(
      verified.electron,
      JSON.parse(regularFile(path.join(projectRoot, 'electron-builder.json'))).electronVersion,
    );
    fs.writeFileSync(
      path.join(projectRoot, 'build-tar/windows-acceptance/runtime-verification.json'),
      `${JSON.stringify(verified, null, 2)}\n`,
    );
    return verified;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function beforePack(context) {
  assertTarget(context);
  verifyInputs(context.packager.projectDir);
  await baseHooks.beforePack(context);
}

async function afterPack(context) {
  assertTarget(context);
  await baseHooks.afterPack(context);
  verifyPackage(context.appOutDir, context.packager.projectDir);
}

module.exports = {
  BUNDLES,
  readArchiveFile,
  assertPeBytes,
  nativeFiles,
  verifyPreparedResources,
  verifyInputs,
  verifyPackage,
  probeRuntime,
  beforePack,
  afterPack,
};

if (require.main === module) {
  try {
    const [command, argument] = process.argv.slice(2);
    if (command === 'verify-inputs') verifyInputs(ROOT);
    else if (command === 'verify-package') {
      const result = verifyPackage(path.resolve(argument || 'release/win-unpacked'), ROOT);
      const output = path.join(ROOT, 'build-tar/windows-acceptance/package-verification.json');
      fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
      console.log(JSON.stringify(result));
    } else if (command === 'probe-runtime')
      console.log(
        JSON.stringify(probeRuntime(path.resolve(argument || 'release/win-unpacked'), ROOT)),
      );
    else
      throw new Error(
        'Usage: windows-acceptance-resources.cjs verify-inputs|verify-package|probe-runtime [win-unpacked]',
      );
  } catch (error) {
    console.error(`[WindowsAcceptance] ${error.message}`);
    process.exitCode = 1;
  }
}
