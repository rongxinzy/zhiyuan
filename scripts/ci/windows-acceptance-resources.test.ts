import assert from 'node:assert/strict';
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createPackageWithOptions } from '@electron/asar';
import { afterEach, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  BUNDLES,
  assertPeBytes,
  verifyInputs,
  verifyPackage,
  beforePack,
} = require('./windows-acceptance-resources.cjs');
const { upstream, sha256File } = require('../magpie-runtime.cjs');
const root = path.resolve(__dirname, '../..');
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function write(rootPath: string, relative: string, content: string | Buffer) {
  const filename = path.join(rootPath, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, content);
  return filename;
}

// Synthetic headers test structure checks only. These bytes are never executed.
function pe(machine = 0x8664): Buffer {
  const result = Buffer.alloc(512);
  result.write('MZ');
  result.writeUInt32LE(0x80, 0x3c);
  result.write('PE\0\0', 0x80);
  result.writeUInt16LE(machine, 0x84);
  return result;
}

function fixture() {
  const project = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-acceptance-test-'));
  temporary.push(project);
  for (const file of [
    'package.json',
    'electron-builder.json',
    'resources/SYSTEM_PROMPT.md',
    'resources/acp/registry.json',
    'resources/magpie/upstream.json',
  ])
    write(project, file, readFileSync(path.join(root, file)));
  const packageJson = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'));
  for (const bundle of BUNDLES) write(project, `dist-electron/${bundle}`, '// synthetic bundle\n');
  write(project, 'dist-electron/photon_rs_bg.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  write(project, 'dist/index.html', '<!doctype html><title>Test</title>');
  write(project, 'resources/modelscope.tokens.local.json', '{"tokens":[]}');
  const vc = write(project, 'resources/vc_redist.x64.exe', pe(0x14c));
  const helper = write(project, 'resources/python-runtime/job-runner.exe', pe());
  const bash = write(project, 'resources/mingit/usr/bin/bash.exe', pe());
  const git = write(project, 'resources/mingit/cmd/git.exe', pe());
  const binary = write(project, 'resources/magpie/win32-x64/magpie.exe', pe());
  copyFileSync(
    path.join(root, 'resources/magpie/LICENSE'),
    path.join(project, 'resources/magpie/win32-x64/LICENSE'),
  );
  write(
    project,
    'resources/magpie/win32-x64/manifest.json',
    JSON.stringify({
      schemaVersion: 1,
      platform: 'win32',
      arch: 'x64',
      binary: 'magpie.exe',
      version: upstream.version,
      sha256: sha256File(binary),
      buildSha256: sha256File(binary),
      sizeBytes: statSync(binary).size,
      source: {
        commit: upstream.commit,
        tree: upstream.tree,
        archiveSha256: upstream.archiveSha256,
      },
      toolchain: { version: upstream.goVersion },
      build: { version: upstream.version, cgoEnabled: false, tags: 'nogui' },
      license: { sha256: upstream.licenseSha256 },
    }),
  );
  write(
    project,
    'build-tar/windows-acceptance/prepared.json',
    JSON.stringify({
      schemaVersion: 1,
      target: 'win32-x64',
      magpieSourceCommit: upstream.commit,
      go: {
        url: `https://go.dev/dl/${upstream.toolchains['win32-x64'].archive}`,
        sha256: upstream.toolchains['win32-x64'].sha256,
      },
      vcRedist: {
        url: 'https://aka.ms/vc14/vc_redist.x64.exe',
        resolvedUrl: 'https://download.visualstudio.microsoft.com/test.exe',
        signatureStatus: 'Valid',
        publisher: 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US',
        certificateThumbprint: '1'.repeat(40),
        sha256: sha256File(vc),
      },
      portableGit: {
        url: 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/PortableGit-2.47.1-64-bit.7z.exe',
        bashSha256: sha256File(bash),
        gitSha256: sha256File(git),
      },
      jobRunnerSha256: sha256File(helper),
    }),
  );
  for (const [name, filename] of [
    ['better-sqlite3', 'better_sqlite3.node'],
    ['node-pty', 'pty.node'],
    ['node-pty', 'conpty.node'],
    ['node-pty', 'conpty_console_list.node'],
  ])
    write(project, `node_modules/${name}/build/Release/${filename}`, pe());
  for (const name of [
    '@earendil-works/pi-durable',
    '@earendil-works/chord',
    '@agentclientprotocol/sdk',
  ])
    write(
      project,
      `node_modules/${name}/package.json`,
      JSON.stringify({
        name,
        version: packageJson.dependencies[name],
        exports: {
          '.': { import: './dist/index.js' },
          './context': { import: './dist/context.js' },
          './storage/sqlite/node': { import: './dist/sqlite.js' },
        },
      }),
    );
  for (const name of ['@earendil-works/pi-durable', '@earendil-works/chord'])
    for (const entry of ['index.js', 'context.js', 'sqlite.js'])
      write(project, `node_modules/${name}/dist/${entry}`, '// synthetic export');
  for (const [name, bin] of [
    ['@agentclientprotocol/codex-acp', 'codex-acp'],
    ['@agentclientprotocol/claude-agent-acp', 'claude-acp'],
  ]) {
    const binName = name.includes('claude') ? 'claude-agent-acp' : bin;
    write(
      project,
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, bin: { [binName]: 'dist/index.js' } }),
    );
    write(project, `node_modules/${name}/dist/index.js`, '// synthetic adapter');
  }
  for (const cli of ['npm-cli.js', 'npx-cli.js'])
    write(project, `node_modules/npm/bin/${cli}`, '// synthetic npm');
  return project;
}

async function packaged(project: string) {
  const application = path.join(project, 'application');
  const output = path.join(project, 'release/win-unpacked');
  const resources = path.join(output, 'resources');
  for (const directory of ['dist', 'dist-electron', 'node_modules'])
    cpSync(path.join(project, directory), path.join(application, directory), { recursive: true });
  const packageJson = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'));
  write(
    application,
    'package.json',
    JSON.stringify({ ...packageJson, zhiyuanAcceptanceBuild: true }),
  );
  write(
    application,
    'resources/SYSTEM_PROMPT.md',
    readFileSync(path.join(project, 'resources/SYSTEM_PROMPT.md')),
  );
  cpSync(path.join(project, 'resources'), resources, { recursive: true });
  rmSync(path.join(resources, 'mingit'), { recursive: true }); // NSIS carries PortableGit separately.
  write(output, '知远.exe', pe());
  await createPackageWithOptions(application, path.join(resources, 'app.asar'), {
    unpackDir: 'node_modules',
  });
  return output;
}

test('acceptance overlay disables signing and publishing while retaining icons and safe installer defaults', () => {
  const config = require('../../electron-builder.windows-acceptance.cjs');
  assert.equal(config.forceCodeSigning, false);
  assert.equal(config.publish, null);
  assert.equal(config.afterSign, null);
  assert.equal(config.win.publish, null);
  assert.equal(config.win.signExecutable, false);
  assert.notEqual(config.win.signAndEditExecutable, false);
  assert.equal(config.win.signtoolOptions, null);
  assert.equal(config.win.azureSignOptions, null);
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(config.nsis.runAfterFinish, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.beforePack, './scripts/ci/windows-acceptance-resources.cjs');
  assert.equal(config.afterPack, config.beforePack);
});

test('resource preparation uses official inputs and never installs, uploads or changes security settings', () => {
  const script = readFileSync(path.join(__dirname, 'windows-acceptance-resources.ps1'), 'utf8');
  assert.match(script, /https:\/\/go\.dev\/dl\//);
  assert.match(script, /SHA-256 mismatch/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /O=Microsoft Corporation/);
  assert.match(script, /scripts\/build-magpie-runtime\.cjs/);
  assert.match(script, /scripts\/python-runtime\/build-job-runner\.ps1/);
  assert.doesNotMatch(
    script,
    /Add-MpPreference|Set-ExecutionPolicy|ARTIFACTORY|Read-Host|MODELSCOPE_TOKEN|\.env['"]|package-windows\.ps1|Start-Process/,
  );
});

test('Windows x64 PE inspection rejects missing, malformed and wrong-architecture payloads', () => {
  assert.doesNotThrow(() => assertPeBytes(pe(), 'fixture'));
  assert.throws(() => assertPeBytes(Buffer.from('fake executable'), 'fixture'), /PE executable/);
  assert.throws(() => assertPeBytes(pe(0xaa64), 'fixture'), /Windows x64/);
  const malformed = pe();
  malformed.writeUInt32LE(0xfffffff0, 0x3c);
  assert.throws(() => assertPeBytes(malformed, 'fixture'), /Invalid PE/);
});

test('complete native resource fixture passes without executing any bundled binary', () => {
  const project = fixture();
  assert.equal(verifyInputs(project).natives.length, 4);
});

test('ASAR reads normalize scoped and nested member paths for Windows traversal', () => {
  const source = readFileSync(path.join(__dirname, 'windows-acceptance-resources.cjs'), 'utf8');
  const calls: string[] = [];
  const bytes = Buffer.from('archive member');
  const isolatedModule = {
    exports: {} as { readArchiveFile: (archive: string, member: string) => Buffer },
  };
  runInNewContext(source, {
    __dirname,
    module: isolatedModule,
    require: (name: string) => {
      if (name === 'node:path') return path.win32;
      if (name === '@electron/asar')
        return {
          extractFile: (_archive: string, member: string) => {
            calls.push(member);
            return bytes;
          },
        };
      return require(name);
    },
  });
  for (const member of [
    'node_modules/@earendil-works/pi-durable/package.json',
    'node_modules/@earendil-works/pi-durable/dist/storage/sqlite/node.js',
    'node_modules/@earendil-works/chord/dist/context.js',
    'dist-electron/main.js',
  ]) {
    assert.equal(isolatedModule.exports.readArchiveFile('app.asar', member), bytes);
    assert.equal(calls.at(-1), member.replaceAll('/', '\\'));
  }
});

test('missing preparation, stale hashes, credentials and native bindings fail closed', () => {
  const cases = [
    (project: string) => rmSync(path.join(project, 'build-tar/windows-acceptance/prepared.json')),
    (project: string) =>
      appendFileSync(path.join(project, 'resources/vc_redist.x64.exe'), 'changed'),
    (project: string) =>
      write(project, 'resources/modelscope.tokens.local.json', '{"tokens":["test-only"]}'),
    (project: string) =>
      rmSync(path.join(project, 'node_modules/node-pty/build/Release/conpty.node')),
    (project: string) =>
      write(project, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node', pe(0xaa64)),
    (project: string) => write(project, 'dist-electron/photon_rs_bg.wasm', 'not wasm'),
  ];
  for (const change of cases) {
    const project = fixture();
    change(project);
    assert.throws(() => verifyInputs(project));
  }
});

test('packaged ASAR and unpacked resources match the checked input bytes', async () => {
  const project = fixture();
  const output = await packaged(project);
  const result = verifyPackage(output, project);
  assert.equal(result.signingPolicy, 'disabled');
  assert.equal(result.bundleCount, BUNDLES.length);
  assert.equal(result.nativeBindings.length, 4);
  appendFileSync(path.join(output, 'resources/magpie/win32-x64/magpie.exe'), 'changed');
  assert.throws(() => verifyPackage(output, project), /SHA-256 mismatch/);
});

test('packaged verifier rejects a missing native binding and changed source bundle', async () => {
  const project = fixture();
  const output = await packaged(project);
  const binding = path.join(
    output,
    'resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node',
  );
  rmSync(binding);
  assert.throws(() => verifyPackage(output, project), /Missing Windows native binding/);
  writeFileSync(binding, pe());
  appendFileSync(path.join(project, 'dist-electron/python-runtime-runner.js'), '// stale package');
  assert.throws(() => verifyPackage(output, project), /Packaged bundle differs/);
});

test('acceptance hooks reject non-Windows and non-x64 targets before preparing resources', async () => {
  await assert.rejects(beforePack({ electronPlatformName: 'linux', arch: 1 }), /Windows x64 only/);
  await assert.rejects(beforePack({ electronPlatformName: 'win32', arch: 3 }), /Windows x64 only/);
});

test('packaged verifier requires the actual durable SQLite export inside the archive', async () => {
  const project = fixture();
  rmSync(path.join(project, 'node_modules/@earendil-works/pi-durable/dist/sqlite.js'));
  const output = await packaged(project);
  assert.throws(() => verifyPackage(output, project));
});

test('runtime probe is rooted in extracted package bytes and exercises native engines without accounts', () => {
  const probe = readFileSync(
    path.join(__dirname, 'windows-acceptance-resources-probe.mjs'),
    'utf8',
  );
  assert.match(probe, /from 'node:sqlite'/);
  assert.match(probe, /@earendil-works\/pi-durable\/storage\/sqlite\/node/);
  assert.match(probe, /@earendil-works\/chord\/context/);
  assert.match(probe, /new Database\(':memory:'\)/);
  assert.match(probe, /WebAssembly\.compile/);
  assert.match(probe, /'pty', 'conpty', 'conpty_console_list'/);
  assert.doesNotMatch(probe, /fetch\(|https?:\/\/|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
});
