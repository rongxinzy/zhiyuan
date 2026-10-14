#!/usr/bin/env node
// Run AFTER installation and BEFORE uninstall on an isolated Windows CI runner:
// node scripts/ci/windows-app-smoke.mjs --app <installed.exe> --output <artifacts>
// Exercises installed bytes only. No account, model request, or security bypass.
import assert from 'node:assert/strict';
import { fork, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, cp, stat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { _electron as electron } from 'playwright';
import magpieRuntime from '../magpie-runtime.cjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_LOG = 256 * 1024;

export async function deadline(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function closeApplication(app, systemRoot) {
  try {
    await deadline(app.close(), 20_000, 'Application shutdown');
  } catch (error) {
    const child = app.process();
    if (child.exitCode === null && child.signalCode === null) {
      await promisify(execFile)(
        path.join(systemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { timeout: 10_000 },
      );
    }
    throw error;
  }
}

export function isolatedEnvironment(root, source = process.env) {
  const env = {};
  // Deliberate allowlist: no API keys, account tokens, agent overrides, Electron
  // switches, inherited NODE_OPTIONS or Python configuration from the CI host.
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'SystemDrive',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
  ]) {
    if (source[key]) env[key] = source[key];
  }
  const systemRoot = source.SystemRoot || source.WINDIR;
  if (!systemRoot) throw new Error('Windows SystemRoot is required');
  return {
    ...env,
    PATH: `${path.win32.join(systemRoot, 'System32')};${systemRoot}`,
    HOME: root,
    USERPROFILE: root,
    APPDATA: path.join(root, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
    TEMP: path.join(root, 'tmp'),
    TMP: path.join(root, 'tmp'),
    HOMEDRIVE: path.win32.parse(root).root.replace(/\\$/, ''),
    HOMEPATH: path.win32.parse(root).root
      ? root.slice(path.win32.parse(root).root.length - 1)
      : root,
    ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: path.join(root, 'user-data'),
  };
}

export function assertPythonResult(response, manifest) {
  assert.equal(response?.success, true, response?.error || 'Runner returned no successful result');
  const result = response.result;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.truncated, false);
  assert.equal(result.runtimeId, manifest.id);
  assert.ok(result.environmentId, 'Missing real Python environment identity');
  const output = JSON.parse(result.stdout.trim());
  assert.deepEqual(output, { value: 42, version: manifest.pythonVersion, isolated: true });
  return result;
}

function runPackagedProbe(
  { executablePath, runnerPath, root, env, timeoutMs },
  request,
  label,
  spawnRunner,
) {
  return new Promise((resolve, reject) => {
    const child = spawnRunner(runnerPath, [], {
      execPath: executablePath,
      execArgv: [],
      cwd: root,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    let response;
    let diagnostics = '';
    let timeout;
    let killTimer;
    let failure;
    const cancel = error => {
      failure ??= error;
      if (child.connected) child.send({ cancel: true }, () => {});
      // The packaged Job helper owns descendants; killing the Runner closes
      // the owner handle. Never fall back to uncontained Python execution.
      killTimer ??= setTimeout(() => child.kill(), 1500);
    };
    child.stderr?.on('data', chunk => {
      diagnostics = (diagnostics + String(chunk)).slice(-4000);
    });
    child.on('message', message => {
      response = message;
    });
    child.once('error', error => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      if (failure) reject(failure);
      else if (code !== 0 || !response)
        reject(new Error(`Packaged Runner exited (${code ?? signal}): ${diagnostics}`));
      else resolve(response);
    });
    timeout = setTimeout(() => cancel(new Error(`${label} timed out`)), timeoutMs);
    child.send(request, error => {
      if (error) cancel(error);
    });
  });
}

export function runPythonProbe(options, spawnRunner = fork) {
  const { root, jobRunnerPath, timeoutMs = 600_000 } = options;
  return runPackagedProbe(
    { ...options, timeoutMs },
    {
      operation: 'execute',
      storageRoot: path.join(root, 'python-runtime'),
      jobRunnerPath,
      input: {
        workspace: root,
        timeoutMs: Math.min(timeoutMs, 600_000),
        code: 'import json, sys\nprint(json.dumps({"value": 6 * 7, "version": ".".join(map(str, sys.version_info[:3])), "isolated": sys.prefix != sys.base_prefix}))',
      },
    },
    'Packaged Python probe',
    spawnRunner,
  );
}

export function runNativeShellProbe(options, spawnRunner = fork) {
  return runPackagedProbe(
    { ...options, timeoutMs: 120_000 },
    {
      cwd: options.root,
      resourcesRoot: options.resourcesRoot,
      expectedPowerShellMajor: options.expectedPowerShellMajor,
    },
    'Packaged native shell probe',
    spawnRunner,
  );
}

export function assertMagpieStatus(status, version) {
  assert.equal(status.state, 'running', status.error || 'Packaged sidecar is not running');
  assert.equal(status.version, version);
  assert.equal(status.subscriptionAccountsEnabled, false, 'Account import must stay disabled');
  const url = new URL(status.gatewayUrl);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
}

export async function runSmoke({ executablePath, outputDirectory }) {
  assert.equal(process.platform, 'win32', 'Installed application smoke requires Windows');
  assert.equal(process.arch, 'x64', 'Pinned Python distribution requires Windows x64');
  executablePath = path.resolve(executablePath);
  outputDirectory = path.resolve(outputDirectory);
  assert.ok((await stat(executablePath)).isFile());
  await mkdir(outputDirectory, { recursive: true });
  const root = await mkdtemp(path.join(os.tmpdir(), 'zhiyuan-installed-smoke-'));
  const env = isolatedEnvironment(root);
  await Promise.all(
    [env.APPDATA, env.LOCALAPPDATA, env.TEMP, env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA].map(dir =>
      mkdir(dir, { recursive: true }),
    ),
  );
  const resources = path.join(path.dirname(executablePath), 'resources');
  const jobRunnerPath = path.join(resources, 'python-runtime', 'job-runner.exe');
  const runnerPath = path.join(resources, 'app.asar', 'dist-electron', 'python-runtime-runner.js');
  const report = { passed: false, executablePath, isolatedHome: root, phases: {}, errors: [] };
  let app;
  let page;
  let health;
  let log = '';
  let expectedExit = false;
  const failures = [];
  const append = value => {
    log = (log + value + '\n').slice(-MAX_LOG);
  };
  try {
    // The build manifest verifier checks pinned source, compiler, original
    // unsigned bytes and license. The app independently repeats verification.
    const magpie = magpieRuntime.verifyRuntime(path.join(resources, 'magpie'), 'win32-x64');
    const beforeHash = createHash('sha256')
      .update(await readFile(path.join(resources, 'magpie', 'win32-x64', 'magpie.exe')))
      .digest('hex');
    assert.ok((await stat(jobRunnerPath)).isFile());
    app = await electron.launch({ executablePath, args: [], env, timeout: 120_000 });
    app.process().stdout?.on('data', chunk => append(String(chunk)));
    app.process().stderr?.on('data', chunk => append(String(chunk)));
    app.process().on('exit', (code, signal) => {
      if (!expectedExit) failures.push(`Unexpected main exit: ${code ?? signal}`);
    });
    health = await deadline(
      app.evaluateHandle(({ app, BrowserWindow }) => {
        const failures = [];
        const observe = window => {
          window.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
            if (mainFrame && failures.length < 20)
              failures.push(`Main-frame load failed: ${code} ${description}`);
          });
          window.webContents.on('render-process-gone', (_event, details) => {
            if (failures.length < 20) failures.push(`Renderer gone: ${details.reason}`);
          });
        };
        for (const window of BrowserWindow.getAllWindows()) observe(window);
        app.on('browser-window-created', (_event, window) => observe(window));
        return failures;
      }),
      10_000,
      'Attach load diagnostics',
    );
    page = await app.firstWindow({ timeout: 120_000 });
    page.on('pageerror', error => failures.push(`Renderer exception: ${error.message}`));
    page.on('crash', () => failures.push('Renderer crashed'));
    page.on('console', message => append(`renderer ${message.type()}: ${message.text()}`));
    await page
      .getByTestId('sidebar-new-conversation')
      .waitFor({ state: 'visible', timeout: 120_000 });
    // Fresh profiles open model settings before any source is configured.
    // Exercise the normal Close action; never fabricate a configured model.
    if (await page.locator('[data-active-view="settings"]').isVisible()) {
      await page.screenshot({
        path: path.join(outputDirectory, 'installed-initial-settings.png'),
        fullPage: true,
      });
      await page
        .locator('form')
        .getByRole('button', { name: /^(Close|关闭)$/ })
        .click();
    }
    await page
      .locator('[data-active-view="cowork"]')
      .waitFor({ state: 'visible', timeout: 30_000 });
    const state = await deadline(
      app.evaluate(({ app, BrowserWindow }) => ({
        userData: app.getPath('userData'),
        appPath: app.getAppPath(),
        packaged: app.isPackaged,
        windows: BrowserWindow.getAllWindows().map(window => ({
          destroyed: window.isDestroyed(),
          crashed: window.webContents.isCrashed(),
          preferences: window.webContents.getLastWebPreferences(),
        })),
      })),
      10_000,
      'Main process health check',
    );
    assert.equal(state.packaged, true);
    assert.equal(
      await realpath(state.userData),
      await realpath(env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA),
    );
    assert.equal(await realpath(state.appPath), await realpath(path.join(resources, 'app.asar')));
    for (const window of state.windows) {
      assert.equal(window.destroyed, false);
      assert.equal(window.crashed, false);
      assert.equal(window.preferences.contextIsolation, true);
      assert.equal(window.preferences.nodeIntegration, false);
      assert.equal(window.preferences.sandbox, true);
    }
    await page.screenshot({ path: path.join(outputDirectory, 'installed-ui.png'), fullPage: true });
    report.phases.ui = { passed: true, packaged: true, isolatedUserData: state.userData };
    const started = await deadline(
      page.evaluate(() => window.electron.magpie.start()),
      45_000,
      'Magpie startup',
    );
    assertMagpieStatus(started, magpie.version);
    const hello = await fetch(`${started.gatewayUrl}/api/hello`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(hello.ok, true);
    const identity = await hello.json();
    assert.equal(identity.name, 'magpie');
    assert.equal(identity.version, magpie.version);
    assertMagpieStatus(
      await deadline(
        page.evaluate(() => window.electron.magpie.status()),
        10_000,
        'Magpie status',
      ),
      magpie.version,
    );
    const stopped = await deadline(
      page.evaluate(() => window.electron.magpie.stop()),
      20_000,
      'Magpie shutdown',
    );
    assert.equal(stopped.state, 'stopped');
    const afterHash = createHash('sha256')
      .update(await readFile(path.join(resources, 'magpie', 'win32-x64', 'magpie.exe')))
      .digest('hex');
    assert.equal(afterHash, beforeHash);
    report.phases.magpie = {
      passed: true,
      version: identity.version,
      sha256: beforeHash,
      stopped: true,
    };
    const manifest = JSON.parse(
      await readFile(path.join(projectRoot, 'src/main/pythonRuntime/manifest.json'), 'utf8'),
    );
    const response = await runPythonProbe({ executablePath, runnerPath, jobRunnerPath, root, env });
    report.phases.python = {
      passed: true,
      ...assertPythonResult(response, manifest),
      runnerPath,
      jobRunnerPath,
    };
    const pwshDirectory = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'PowerShell',
      '7',
    );
    assert.ok(
      (await stat(path.join(pwshDirectory, 'pwsh.exe'))).isFile(),
      'Acceptance requires real PowerShell 7 for priority coverage',
    );
    const shellResults = {};
    for (const [mode, major] of [
      ['pwsh', 7],
      ['windowsPowerShell', 5],
    ]) {
      const shellRoot = path.join(root, mode);
      await mkdir(shellRoot, { recursive: true });
      const nativeShell = await runNativeShellProbe({
        executablePath,
        root: shellRoot,
        env: { ...env, PATH: major === 7 ? `${pwshDirectory};${env.PATH}` : env.PATH },
        resourcesRoot: resources,
        expectedPowerShellMajor: major,
        runnerPath: path.join(resources, 'app.asar', 'dist-electron', 'native-execution-smoke.js'),
      });
      assert.equal(nativeShell.success, true, nativeShell.error);
      assert.equal(nativeShell.result.passed, true);
      assert.equal(nativeShell.result.tool, 'powershell');
      assert.equal(nativeShell.result.powerShellMajor, major);
      assert.equal(nativeShell.result.approvals, 1);
      for (const check of [
        'unicode',
        'quotedText',
        'spaceCwd',
        'nonzero',
        'approvalDenied',
        'cancelledChild',
        'gitWorktree',
      ]) {
        assert.equal(
          nativeShell.result.checks?.[check],
          true,
          `Missing native PowerShell check: ${check}`,
        );
      }
      shellResults[mode] = nativeShell.result;
    }
    report.phases.nativeShell = { passed: true, ...shellResults };
    // Verify the renderer and main remain healthy after real sidecar work.
    const overlay = page.locator('[data-slot="dialog-overlay"]').first();
    if (await overlay.isVisible()) {
      await page.keyboard.press('Escape');
      await overlay.waitFor({ state: 'hidden', timeout: 5000 });
    }
    await page.getByTestId('sidebar-new-conversation').click();
    await page.locator('[data-active-view="cowork"]').waitFor({ state: 'visible' });
    await page.screenshot({
      path: path.join(outputDirectory, 'installed-ui-after.png'),
      fullPage: true,
    });
    failures.push(...(await deadline(health.jsonValue(), 10_000, 'Read load diagnostics')));
    assert.deepEqual(failures, []);
    expectedExit = true;
    await closeApplication(app, env.SystemRoot || env.WINDIR);
    app = undefined;
    report.passed = true;
  } catch (error) {
    report.errors.push(error.stack || String(error));
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(outputDirectory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    expectedExit = true;
    if (app)
      await closeApplication(app, env.SystemRoot || env.WINDIR).catch(error => {
        report.errors.push(`Close failed: ${error.message}`);
      });
    report.errors.push(...failures);
    await cp(
      path.join(env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA, 'logs'),
      path.join(outputDirectory, 'app-logs'),
      { recursive: true },
    ).catch(() => {});
    await writeFile(path.join(outputDirectory, 'process.log'), log);
    await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
    // Preserve isolated data for diagnosis on this disposable CI machine. Never
    // upload the entire profile or delete a real user's application directory.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: { app: { type: 'string' }, output: { type: 'string' } },
  });
  if (!values.app || !values.output)
    throw new Error('Usage: --app <installed.exe> --output <artifact-directory>');
  await runSmoke({ executablePath: values.app, outputDirectory: values.output });
}
