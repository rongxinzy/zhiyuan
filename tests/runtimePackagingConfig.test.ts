import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { prerelease } from 'semver';
import { afterEach, test } from 'vitest';

import { beforePack, afterPack } from '../scripts/electron-builder-hooks.cjs';
import { sha256File, upstream } from '../scripts/magpie-runtime.cjs';
import { checkProductionDependencyManifest } from '../scripts/ci/check-electron-runtime-dependencies.mjs';
import pythonManifest from '../src/main/pythonRuntime/manifest.json';

const root = path.resolve(__dirname, '..');
const temporaryDirectories: string[] = [];
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');
const readJson = <T>(file: string): T => JSON.parse(read(file)) as T;

interface ResourceConfig {
  extraResources?: Array<{ from?: string; to?: string }>;
}
interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}
interface WorkflowJob {
  'runs-on': string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
}
interface Workflow {
  on: Record<string, { branches?: string[]; tags?: string[]; paths?: string[] } | null>;
  permissions: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}
function workflow(file = 'lightweight-ci.yml'): Workflow {
  return loadYaml(read(`.github/workflows/${file}`)) as Workflow;
}
function requiredStep(job: WorkflowJob, predicate: (step: WorkflowStep) => boolean): WorkflowStep {
  const step = job.steps.find(predicate);
  assert.ok(step, 'required verification step is missing');
  return step;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test('desktop packages exclude retired managed tools and retain only the native Python helper', () => {
  const config = readJson<ResourceConfig & Record<'mac' | 'linux' | 'win', ResourceConfig>>(
    'electron-builder.json',
  );
  const helper = 'resources/python-runtime/job-runner.exe';
  for (const [target, settings] of Object.entries({
    common: config,
    mac: config.mac,
    linux: config.linux,
    win: config.win,
  })) {
    for (const resource of settings.extraResources ?? []) {
      const source = resource.from ?? '';
      assert.doesNotMatch(source, /(?:SKILLs|MCPs|^vendor\/)/);
      if (/resources\/(?:python|skill-python|uv)(?:[-/]|$)/.test(source)) {
        assert.equal(target, 'win');
        assert.equal(source, helper);
        assert.equal(resource.to, 'python-runtime/job-runner.exe');
      }
    }
  }
  assert.ok(config.win.extraResources?.some(resource => resource.from === helper));
  const hooks = read('scripts/electron-builder-hooks.cjs');
  assert.doesNotMatch(hooks, /setup-(?:python|mac-python|uv|mac-uv|skill-python)-runtime/);
  assert.doesNotMatch(hooks, /installSkillDependencies/);
  assert.match(hooks, /ensurePortableGit/);
  for (const file of ['vite.config.ts', 'scripts/build-electron-development.mjs']) {
    const build = read(file);
    assert.match(build, /src\/main\/pythonRuntime\/runner\.ts/);
    assert.match(build, /entryFileNames: 'python-runtime-runner\.js'/);
  }
  assert.equal(pythonManifest.id, 'cpython-3.12.15-pbs20261013-uv0.13.0');
  assert.deepEqual(Object.keys(pythonManifest.platforms).sort(), [
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-x64',
    'win32-x64',
  ]);
  for (const assets of Object.values(pythonManifest.platforms)) {
    for (const [kind, asset] of Object.entries(assets)) {
      const repository = kind === 'python' ? 'python-build-standalone' : 'uv';
      const version = kind === 'python' ? pythonManifest.pythonRelease : pythonManifest.uvVersion;
      const url = new URL(asset.url);
      assert.equal(url.origin, 'https://github.com');
      assert.ok(url.pathname.startsWith(`/astral-sh/${repository}/releases/download/${version}/`));
      assert.equal(decodeURIComponent(path.posix.basename(url.pathname)), asset.archive);
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    }
  }
});

test('unpacks npm for the retained host command shims without a system Node.js runtime', () => {
  const config = readJson<{ asarUnpack?: string[] }>('electron-builder.json');
  assert.ok(config.asarUnpack?.includes('node_modules/npm/**'));
  const utility = read('src/main/libs/coworkUtil.ts');
  assert.match(utility, /app\.asar\.unpacked', 'node_modules', 'npm', 'bin'/);
  assert.match(utility, /npm-cli\.js/);
  assert.match(utility, /npx-cli\.js/);
});

test('unpacks ACP adapters without bundling external agent binaries', () => {
  const config = readJson<{ files?: string[]; asarUnpack?: string[] }>('electron-builder.json');
  assert.ok(config.asarUnpack?.includes('node_modules/@agentclientprotocol/codex-acp/**'));
  assert.ok(config.asarUnpack?.includes('node_modules/@agentclientprotocol/claude-agent-acp/**'));
  assert.ok(config.asarUnpack?.includes('node_modules/@anthropic-ai/claude-agent-sdk/**'));
  assert.ok(config.asarUnpack?.includes('node_modules/zod/**'));
  assert.ok(!config.asarUnpack?.includes('node_modules/@anthropic-ai/**'));
  assert.ok(!config.asarUnpack?.includes('node_modules/@agentclientprotocol/**'));
  assert.ok(!config.asarUnpack?.includes('node_modules/@openai/**'));
  assert.ok(config.files?.includes('!node_modules/zod/src/**'));
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.ok(
      config.files?.includes(`!node_modules/@anthropic-ai/claude-agent-sdk-${platform}-*/**`),
    );
    assert.ok(config.files?.includes(`!node_modules/@openai/codex-${platform}-*/**`));
  }
});

test('macOS Launchpad uses icon.icns instead of an asset-catalog icon name', () => {
  const config = readJson<{ mac?: { icon?: string; extendInfo?: Record<string, unknown> } }>(
    'electron-builder.json',
  );
  assert.equal(config.mac?.icon, 'build/icons/mac/icon.icns');
  assert.equal(config.mac?.extendInfo?.CFBundleIconName, undefined);
  const hooks = read('scripts/electron-builder-hooks.cjs');
  assert.match(hooks, /'-remove', 'CFBundleIconName'/);
  assert.doesNotMatch(hooks, /'-insert', 'CFBundleIconName'/);
  const fixScript = read('scripts/fix-mac-icon-display.sh');
  assert.match(fixScript, /plutil -remove CFBundleIconName/);
  assert.doesNotMatch(fixScript, /plutil -insert CFBundleIconName/);
});

test('stable release metadata does not inherit the build prerelease channel', () => {
  const config = readJson<{
    detectUpdateChannel?: boolean;
    linux?: { publish?: Array<{ url?: string }> };
    mac?: { publish?: Array<{ url?: string }> };
    win?: { publish?: Array<{ url?: string }> };
  }>('electron-builder.json');
  assert.deepEqual(prerelease('2026.8.6-build.1'), ['build', 1]);
  assert.equal(config.detectUpdateChannel, false);
  for (const target of [config.win, config.mac, config.linux])
    assert.match(target?.publish?.[0]?.url || '', /\/v2\/electron\/stable\//);
});

test('standalone updater metadata normalization preserves each target artifact identity', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-updater-contract-'));
  temporaryDirectories.push(directory);
  const input = path.join(directory, 'input.yml');
  const output = path.join(directory, 'output.yml');
  const version = '2026.8.6';
  const sha512 = Buffer.alloc(64, 7).toString('base64');
  const targets = [
    ['win32', 'x64', 'lite', '知远 Setup.exe'],
    ['darwin', 'x64', 'default', '知远 x64.zip'],
    ['darwin', 'arm64', 'default', '知远 arm64.zip'],
    ['linux', 'x64', 'appimage', '知远.AppImage'],
    ['linux', 'x64', 'deb', '知远.deb'],
  ];
  for (const [platform, arch, variant, filename] of targets) {
    writeFileSync(input, dumpYaml({ version, files: [{ url: filename, sha512, size: 123 }] }));
    execFileSync(process.execPath, [
      path.join(root, 'scripts/release/normalize-electron-updater-metadata.mjs'),
      version,
      platform,
      arch,
      variant,
      input,
      output,
    ]);
    const metadata = loadYaml(readFileSync(output, 'utf8')) as {
      version: string;
      path: string;
      sha512: string;
      files: unknown[];
    };
    const url = `https://updates.rongxzyai.com/v2/electron/releases/${version}/${platform}/${arch}/${variant}/${encodeURIComponent(filename)}`;
    assert.deepEqual(metadata, { version, files: [{ url, sha512, size: 123 }], path: url, sha512 });
  }
});

test('lightweight CI checks the production manifest and builds clean desktop outputs', () => {
  const { scripts } = readJson<{ scripts: Record<string, string> }>('package.json');
  assert.deepEqual(
    scripts.build.split('&&').map(command => command.trim()),
    [
      'bun run clean:build',
      'bun run build:tsc',
      'bun run build:vite',
      'bun run check:electron-runtime-dependencies',
    ],
  );
  assert.equal(scripts['clean:build'], 'rimraf dist dist-electron');
  const declared = checkProductionDependencyManifest(root);
  for (const name of ['@earendil-works/chord', '@earendil-works/pi-durable'])
    assert.ok(declared.includes(name));
  assert.ok(!declared.includes('@firecrawl/anydoc'));
  const job = workflow().jobs['source-checks'];
  const manifest = requiredStep(job, step => step.run?.includes('--manifest-only') === true);
  const build = requiredStep(job, step => step.run?.trim() === 'bun run build');
  const budget = requiredStep(job, step => step.run?.trim() === 'bun run test:bundle-budget');
  assert.ok(job.steps.indexOf(manifest) < job.steps.indexOf(build));
  assert.ok(job.steps.indexOf(build) < job.steps.indexOf(budget));
  assert.equal(job.env?.VITE_SKIP_ELECTRON, undefined);
  assert.equal(build.env?.VITE_SKIP_ELECTRON, undefined);
});

test('supply-chain validation covers committed npm locks and CI installs the frozen Bun graph', () => {
  const trackedLockfiles = execFileSync('git', ['ls-files', '*package-lock.json'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  const policy = read('scripts/ci/check-supply-chain-inputs.mjs');
  const policyLockfiles = Array.from(
    policy.matchAll(/'([^']+package-lock\.json)'/g),
    match => match[1],
  );
  assert.deepEqual(policyLockfiles.sort(), trackedLockfiles);
  const output = execFileSync(process.execPath, ['scripts/ci/check-supply-chain-inputs.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(output, /Supply-chain input policy passed/);
  for (const file of ['lightweight-ci.yml', 'python-runtime.yml']) {
    for (const job of Object.values(workflow(file).jobs))
      requiredStep(
        job,
        step => step.run?.trim() === 'bun install --frozen-lockfile --ignore-scripts',
      );
  }
});

test('active source and Python workflows have read-only permissions without signing or publishing', () => {
  const files = readdirSync(path.join(root, '.github/workflows'))
    .filter(file => /\.ya?ml$/.test(file))
    .sort();
  assert.deepEqual(files, ['lightweight-ci.yml', 'python-runtime.yml']);
  const policy = readJson<{ workflows: Array<{ path: string }> }>('.github/devops-ci.json');
  assert.deepEqual(policy.workflows.map(item => path.basename(item.path)).sort(), files);
  for (const file of files) {
    const config = workflow(file);
    assert.deepEqual(config.permissions, { contents: 'read' });
    assert.deepEqual(config.on.push?.branches, ['main']);
    assert.equal(config.on.push?.tags, undefined);
    assert.ok(Object.hasOwn(config.on, 'pull_request'));
    assert.ok(Object.hasOwn(config.on, 'workflow_dispatch'));
    assert.ok(!Object.hasOwn(config.on, 'schedule'));
    assert.doesNotMatch(
      read(`.github/workflows/${file}`),
      /secrets\.|CSC_LINK|CERTUM_CERT_THUMBPRINT|APPLE_ID|R2_ACCESS_KEY/,
    );
    for (const job of Object.values(config.jobs)) {
      if (job.permissions) assert.deepEqual(job.permissions, { contents: 'read' });
      for (const step of job.steps) {
        assert.doesNotMatch(step.uses ?? '', /signing|publish|release/i);
        assert.doesNotMatch(
          step.run ?? '',
          /\belectron-builder(?:\s|$)|\brun\s+dist(?::|\s|$)|(?:^|\s)(?:\S*\/)?(?:package-windows\.ps1|publish-update-manifest\.mjs|upload-update-artifacts\.mjs)(?:\s|$)|\baws\s+s3\b/,
        );
      }
    }
  }
});

test('Windows packaging retains the clean-path host runtime smoke tool', () => {
  const smoke = read('scripts/ci/windows-runtime-smoke.ps1');
  assert.doesNotMatch(smoke, /skill-python|python-win|uv-win|SKILLs/);
  assert.match(smoke, /packaged Electron Node version probe/);
  assert.match(smoke, /electron-builder\.json/);
  assert.match(smoke, /release\\win-unpacked/);
  assert.match(smoke, /packaged Electron Node runtime/);
  assert.doesNotMatch(smoke, /node_modules\\electron\\dist\\electron\.exe/);
  assert.match(smoke, /ELECTRON_RUN_AS_NODE/);
  assert.match(smoke, /Start-Process[\s\S]*-Wait[\s\S]*-PassThru/);
  assert.doesNotMatch(smoke, /Invoke-Checked \$electron/);
  assert.match(smoke, /External command unexpectedly remains discoverable/);
  assert.match(smoke, /mingit\\usr\\bin\\bash\.exe/);
  assert.match(smoke, /PATH = "\$env:SystemRoot\\System32;\$env:SystemRoot"/);
  assert.match(read('scripts/ci/package-windows.ps1'), /windows-runtime-smoke\.ps1/);
});

test('manual Windows signing remains explicit and preserves unchanged Magpie executables', () => {
  const { scripts } = readJson<{ scripts: Record<string, string> }>('package.json');
  assert.match(scripts['dist:win:signed'], /electron-builder\.windows-signed\.cjs/);
  assert.match(scripts['dist:win:offline'], /electron-builder\.json/);
  for (const name of ['dist:win:signed', 'dist:win:offline'])
    assert.match(scripts[name], /--publish never/);
  const args = [
    '-e',
    'process.stdout.write(JSON.stringify(require(process.argv[1])));',
    path.join(root, 'electron-builder.windows-signed.cjs'),
  ];
  for (const thumbprint of ['', 'invalid']) {
    const rejected = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      env: { ...process.env, CERTUM_CERT_THUMBPRINT: thumbprint },
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /40-character SHA-1 thumbprint/);
  }
  const signed = JSON.parse(
    execFileSync(process.execPath, args, {
      encoding: 'utf8',
      env: { ...process.env, CERTUM_CERT_THUMBPRINT: '0123456789abcdef0123456789abcdef01234567' },
    }),
  ) as { win: { signExts: string[]; signtoolOptions: Record<string, unknown> } };
  assert.deepEqual(signed.win.signtoolOptions, {
    certificateSha1: '0123456789ABCDEF0123456789ABCDEF01234567',
    signingHashAlgorithms: ['sha256'],
    rfc3161TimeStampServer: 'http://time.certum.pl',
  });
  assert.ok(signed.win.signExts.includes('!magpie.exe'));
  const config = readJson<{ mac: { sign: string; x64ArchFiles: string } }>('electron-builder.json');
  assert.equal(config.mac.sign, 'scripts/sign-magpie-macos.cjs');
  assert.equal(config.mac.x64ArchFiles, '**/magpie/darwin-*/magpie');
  assert.match(
    read('scripts/ci/verify-windows-authenticode.ps1'),
    /electron-builder\.json'[\s\S]*-Raw -Encoding UTF8 \| ConvertFrom-Json/,
  );
});

test('manual installer smoke tools retain lifecycle coverage while CI exercises native Python containment', () => {
  const smoke = read('scripts/ci/windows-installer-smoke.ps1');
  for (const pattern of [
    /'cold installation'/,
    /'cache-hit upgrade'/,
    /phase=component-cache-miss/,
    /phase=component-cache-hit/,
    /'uninstall'/,
    /function Invoke-Checked/,
    /verify-packaged-acp-resources\.mjs/,
  ])
    assert.match(smoke, pattern);
  assert.doesNotMatch(smoke, /phase=defender-exclusion/);
  const sizeSmoke = read('scripts/ci/windows-installer-size-smoke.ps1');
  assert.match(sizeSmoke, /\$_\.archiveSizeBytes/);
  assert.doesNotMatch(sizeSmoke, /\$_\.archiveBytes\b/);
  assert.match(sizeSmoke, /component archive bytes/);
  assert.match(sizeSmoke, /MaximumInstallerBytes = 450MB/);
  assert.match(sizeSmoke, /MaximumComponentBytes = 300MB/);
  assert.match(sizeSmoke, /MaximumNonComponentBytes = 150MB/);
  const python = workflow('python-runtime.yml');
  const windows = python.jobs['windows-job-object'];
  assert.equal(windows['runs-on'], 'windows-latest');
  assert.equal(windows.env?.PYTHON_RUNTIME_INTEGRATION, '1');
  assert.match(
    windows.env?.PYTHON_RUNTIME_JOB_HELPER ?? '',
    /resources\/python-runtime\/job-runner\.exe$/,
  );
  const buildHelper = requiredStep(
    windows,
    step => step.run?.includes('build-job-runner.ps1') === true,
  );
  const containment = requiredStep(
    windows,
    step => step.run?.includes('node --test scripts/python-runtime/job-runner.test.cjs') === true,
  );
  assert.ok(windows.steps.indexOf(buildHelper) < windows.steps.indexOf(containment));
  for (const job of [windows, python.jobs['linux-standalone-runtime']]) {
    const bundle = requiredStep(
      job,
      step => step.run?.includes('--outfile=dist-electron/python-runtime-runner.js') === true,
    );
    const integration = requiredStep(
      job,
      step => step.run?.includes('runtime.integration.test.ts') === true,
    );
    assert.ok(job.steps.indexOf(bundle) < job.steps.indexOf(integration));
    assert.equal(job.env?.PYTHON_RUNTIME_INTEGRATION, '1');
  }
});

test('real packaging hooks require pinned Magpie bytes before packaging and recheck them afterward', async () => {
  const projectDir = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-package-contract-'));
  temporaryDirectories.push(projectDir);
  const context = {
    electronPlatformName: 'linux',
    arch: 1,
    appOutDir: path.join(projectDir, 'packaged'),
    packager: { projectDir, config: { extraResources: [] as ResourceConfig['extraResources'] } },
  };
  await assert.rejects(beforePack(context), /Magpie linux-x64 is unavailable or invalid/);
  const directory = path.join(projectDir, 'resources/magpie/linux-x64');
  mkdirSync(directory, { recursive: true });
  const binary = path.join(directory, 'magpie');
  writeFileSync(binary, 'test-only compiler output, never executed', { mode: 0o755 });
  copyFileSync(path.join(root, 'resources/magpie/LICENSE'), path.join(directory, 'LICENSE'));
  writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      platform: 'linux',
      arch: 'x64',
      binary: 'magpie',
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
  await beforePack(context);
  assert.deepEqual(context.packager.config.extraResources, [
    { from: 'resources/magpie/upstream.json', to: 'magpie/upstream.json' },
    {
      from: 'resources/magpie/linux-x64',
      to: 'magpie/linux-x64',
      filter: ['magpie', 'manifest.json', 'LICENSE'],
    },
  ]);
  await assert.rejects(afterPack(context), /Magpie linux-x64 is unavailable or invalid/);
  const packagedRuntime = path.join(context.appOutDir, 'resources/magpie');
  cpSync(path.join(projectDir, 'resources/magpie'), packagedRuntime, { recursive: true });
  await afterPack(context);
  const sourceHash = sha256File(binary);
  appendFileSync(path.join(packagedRuntime, 'linux-x64/magpie'), 'tampered');
  await assert.rejects(afterPack(context), /SHA-256 mismatch/);
  assert.equal(sha256File(binary), sourceHash);
});

test('deployment CI resolves every generated bundle from a separate production-only install', () => {
  const job = workflow().jobs['source-checks'];
  const build = requiredStep(job, step => step.run?.trim() === 'bun run build');
  const probe = requiredStep(job, step => step.run?.includes('RUNTIME_PROBE_ROOT=') === true);
  assert.ok(job.steps.indexOf(build) < job.steps.indexOf(probe));
  const commands = probe.run ?? '';
  assert.match(commands, /probe=\$\(mktemp -d\)/);
  assert.match(commands, /trap 'rm -rf "\$probe"' EXIT/);
  assert.match(commands, /cp package\.json bun\.lock "\$probe\/"/);
  assert.match(
    commands,
    /cd "\$probe".*bun install --frozen-lockfile --production --ignore-scripts/,
  );
  assert.match(commands, /cp -R dist-electron "\$probe\/"/);
  assert.match(
    commands,
    /checkElectronRuntimeDependencies\(process\.env\.RUNTIME_PROBE_ROOT, \{ resolve: true \}\)/,
  );
  assert.doesNotMatch(commands, /(?:cp|ln).*node_modules/);
});
