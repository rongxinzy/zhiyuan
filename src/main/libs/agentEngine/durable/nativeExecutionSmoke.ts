/** Fixed, account-free acceptance cases executed by the actual native tools.
 * This subprocess exposes no arbitrary command or Main IPC interface. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, stat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context';
import {
  createRegistry,
  Harness,
  MemoryStorage,
  type HarnessOptions,
} from '@earendil-works/pi-durable';
import {
  createNativeExecutionEnv,
  nativeCodingTools,
  nativeExecutionOptions,
} from './nativeExecutionEnv';
import { authorizeNativeTool } from './toolBridge';

const UNIX_COMMAND = "printf 'zhiyuan-native-bash-中文\\n'; printf '%s\\n' \"$PWD\"; git --version";
const WINDOWS_COMMAND = `Write-Output '[native-smoke] basic-enter'; Write-Output '[native-smoke] git-discovery'; $gitSource=(Get-Command git -CommandType Application -ErrorAction Stop).Source; Write-Output '[native-smoke] git-version'; $gitVersion=(& git --version); Write-Output '[native-smoke] git-version-returned'; @{ marker='zhiyuan-native-powershell-中文'; quote='quoted ''value'' "double"'; cwd=(Get-Location).Path; major=$PSVersionTable.PSVersion.Major; minor=$PSVersionTable.PSVersion.Minor; gitSource=$gitSource; git=$gitVersion } | ConvertTo-Json -Compress`;
const NONZERO_COMMAND = 'Write-Output "expected nonzero"; exit 17';
const DENIED_COMMAND = "Set-Content -LiteralPath 'denied.txt' -Value 'must not execute'";
const CHILD_COMMAND = `$child=Start-Process -FilePath $env:ComSpec -ArgumentList '/d /s /c "ping -n 120 127.0.0.1 >NUL"' -PassThru; Set-Content -LiteralPath 'child.pid' -Value $child.Id; Start-Sleep -Seconds 120`;
const WORKTREE_COMMAND = `Write-Output '[native-smoke] git-init'; git init --quiet; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Output '[native-smoke] git-commit'; git -c user.name=Acceptance -c user.email=acceptance@example.invalid -c commit.gpgsign=false commit --allow-empty --quiet -m acceptance; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Output '[native-smoke] git-worktree-add'; git worktree add --quiet --detach '../linked 工作树' HEAD; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Output '[native-smoke] git-worktree-check'; git -C '../linked 工作树' rev-parse --is-inside-work-tree`;

export interface NativeSmokeProgress {
  case: string;
  stage: string;
  elapsedMs: number;
  detail?: string;
}
type ReportProgress = (progress: NativeSmokeProgress) => void;

/** Diagnostic only: same upstream argv/stdio, fixed harmless command, no model.
 * Run after a failed native case so first-start timing cannot mask that failure. */
export async function diagnoseWindowsPowerShell(
  cwd: string,
  resourcesRoot: string,
  report: ReportProgress,
  spawnProcess = spawn,
) {
  const options = await nativeExecutionOptions(cwd, resourcesRoot, 'win32');
  const env = { ...process.env, ...options.shellEnv };
  const executable = join(
    env.SystemRoot || env.WINDIR || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\nWrite-Output 'native-direct-enter'; $PSVersionTable.PSVersion.ToString()`,
  ];
  for (const mode of ['same-environment', 'without-electron-node-flag']) {
    const childEnv = { ...env };
    if (mode === 'without-electron-node-flag') delete childEnv.ELECTRON_RUN_AS_NODE;
    const startedAt = Date.now();
    const emit = (stage: string, detail?: unknown) =>
      report({
        case: `direct-${mode}`,
        stage,
        elapsedMs: Date.now() - startedAt,
        detail: JSON.stringify(detail)?.slice(0, 6000),
      });
    emit('started', { executable, electronNodeFlag: childEnv.ELECTRON_RUN_AS_NODE === '1' });
    await new Promise<void>((resolve, reject) => {
      const child = spawnProcess(executable, args, {
        cwd,
        env: childEnv,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // Only this known child; fixed diagnostic never launches descendants.
        child.kill();
      }, 20_000);
      const closedTimer = setTimeout(() => {
        child.kill();
        reject(new Error('Direct PowerShell diagnostic did not close after timeout'));
      }, 25_000);
      child.stdout?.on('data', chunk => {
        output = (output + String(chunk)).slice(-4000);
      });
      child.stderr?.on('data', chunk => {
        output = (output + String(chunk)).slice(-4000);
      });
      child.once('error', error => emit('spawn_error', { message: error.message }));
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        clearTimeout(closedTimer);
        emit('closed', { code, signal, timedOut, output });
        resolve();
      });
    });
  }
}

/** Acceptance budgets only. Windows 5.1 took 25–27s per launch on the
 * official CI host, with and without Electron's Node flag. */
export function nativeSmokeBudgets(expectedPowerShellMajor?: number) {
  return {
    commandSeconds: expectedPowerShellMajor === 5 ? 60 : 20,
    childReadyMs: expectedPowerShellMajor === 5 ? 60_000 : 15_000,
    childExitMs: 10_000,
  };
}

async function fixedCase(
  cwd: string,
  resourcesRoot: string,
  command: string,
  options: {
    signal?: AbortSignal;
    deny?: boolean;
    cancelAfterChild?: boolean;
    expectedPowerShellMajor?: number;
    report?: ReportProgress;
    caseName?: string;
  } = {},
) {
  const budgets = nativeSmokeBudgets(options.expectedPowerShellMajor);
  const startedAt = Date.now();
  const report = (stage: string, detail?: unknown) =>
    options.report?.({
      case: options.caseName ?? 'unknown',
      stage,
      elapsedMs: Date.now() - startedAt,
      ...(detail === undefined ? {} : { detail: JSON.stringify(detail).slice(0, 6000) }),
    });
  report('started');
  const context = options.signal
    ? withAbortSignal(options.signal, BACKGROUND_CONTEXT)
    : BACKGROUND_CONTEXT;
  const toolName = process.platform === 'win32' ? 'powershell' : 'bash';
  const environment = await createNativeExecutionEnv(cwd, resourcesRoot);
  const originalExec = environment.exec.bind(environment);
  environment.exec = async (command, executionOptions, executionContext) => {
    const program = Array.isArray(command) ? command[0] : 'shell';
    report('exec_started', { program });
    const result = await originalExec(command, executionOptions, executionContext);
    report(
      'exec_returned',
      result.ok
        ? { program, ok: true, exitCode: result.value.exitCode }
        : { program, ok: false, code: result.error.code, message: result.error.message },
    );
    return result;
  };
  const registry = createRegistry();
  const tools = nativeCodingTools();
  let approvals = 0;
  registry.install({
    ...tools,
    tools: tools.tools?.map(tool => {
      const authorized = authorizeNativeTool(tool, {
        authorize: async call => {
          assert.equal(call.toolName, toolName);
          assert.equal(call.toolInput.command, command);
          approvals++;
          return options.deny
            ? { allow: false, terminateRun: true, reason: 'Acceptance refusal' }
            : { allow: true };
        },
      });
      return {
        ...authorized,
        async execute(args, api, executionContext) {
          report('tool_started');
          try {
            const result = await authorized.execute(args, api, executionContext);
            report('tool_returned', {
              isError: result.isError,
              structuredOutput: result.structuredOutput,
              diagnostics: result.diagnostics,
            });
            return result;
          } catch (error) {
            report('tool_threw', error instanceof Error ? error.message : String(error));
            throw error;
          }
        },
      };
    }),
  });
  const model = {
    id: 'acceptance',
    name: 'Acceptance fixture',
    provider: 'acceptance',
    api: 'openai-completions' as const,
    baseUrl: 'http://unused.invalid',
    input: ['text' as const],
    reasoning: false,
    contextWindow: 32000,
    maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let calls = 0;
  // Only the two model methods used by this fixed native run; no network client.
  const models = {
    getModel: () => model,
    streamSimple: () => {
      const invoke = calls++ === 0;
      const message = {
        role: 'assistant' as const,
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: invoke
          ? [
              {
                type: 'toolCall' as const,
                id: 'native-shell-1',
                name: toolName,
                arguments: {
                  command,
                  timeout: options.cancelAfterChild ? 120 : budgets.commandSeconds,
                },
              },
            ]
          : [{ type: 'text' as const, text: 'Acceptance complete' }],
        stopReason: invoke ? ('toolUse' as const) : ('stop' as const),
        timestamp: Date.now(),
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done' as const, reason: message.stopReason, message };
        },
        result: async () => message,
      };
    },
  };
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      registry,
      models: models as unknown as HarnessOptions['models'],
      env: () => environment,
      settings: { retry: { enabled: false } },
    },
    BACKGROUND_CONTEXT,
  );
  let childPid: number | undefined;
  try {
    const conversation = await harness.root(context, {
      agent: { model: { provider: model.provider, modelId: model.id }, cwd },
    });
    const submission = await conversation.submit(
      {
        type: 'input',
        content: 'Run fixed acceptance command',
        requestId: 'native-shell-acceptance',
      },
      context,
    );
    if (options.cancelAfterChild) {
      const deadline = Date.now() + budgets.childReadyMs;
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        try {
          childPid = Number(
            (await readFile(join(cwd, 'child.pid'), 'utf8')).replace(/^\uFEFF/, '').trim(),
          );
          if (childPid && Number.isSafeInteger(childPid)) break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await delay(50);
      }
      if (!childPid || !Number.isSafeInteger(childPid)) {
        const diagnostic = await conversation.watch(BACKGROUND_CONTEXT);
        const details = diagnostic.value.entries
          .flatMap(entry => entry.model ?? [])
          .filter(message => message.role === 'toolResult');
        await diagnostic.stop();
        throw new Error(
          `Child process never became ready: ${JSON.stringify(details).slice(0, 4000)}`,
        );
      }
      await conversation.abort(context);
    }
    const receipt = await submission.wait(context);
    const watch = await conversation.watch(BACKGROUND_CONTEXT);
    const entries = watch.value.entries;
    const results = entries
      .flatMap(entry => entry.model ?? [])
      .filter(message => message.role === 'toolResult');
    await watch.stop();
    assert.equal(results.length, 1);
    assert.equal(results[0].toolName, toolName);
    assert.equal(approvals, 1);
    const output = results[0].content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
    report('native_settled', { receipt, isError: results[0].isError, output });
    // Verify Stop itself reaps descendants, before close/cleanup can mask it.
    if (options.cancelAfterChild) await assertChildExited(childPid!, budgets.childExitMs);
    return { receipt, result: results[0], output, approvals, calls, childPid, entries };
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await environment.cleanup(BACKGROUND_CONTEXT);
    report('closed');
  }
}

async function assertChildExited(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await delay(100);
  }
  // Cleanup only after observing and recording the native cancellation failure.
  // This cannot make the check pass; scope is the PID created by this fixture.
  await promisify(execFile)(
    join(process.env.SystemRoot!, 'System32', 'taskkill.exe'),
    ['/PID', String(pid), '/T', '/F'],
    { timeout: 5000 },
  ).catch(() => {});
  throw new Error(`Native cancellation left child process ${pid} running`);
}

export async function runNativeExecutionSmoke(
  cwd: string,
  resourcesRoot: string,
  signal?: AbortSignal,
  expectedPowerShellMajor?: number,
  report?: ReportProgress,
) {
  const workspace = join(cwd, 'native shell 中文 space');
  await mkdir(workspace, { recursive: true });
  const windows = process.platform === 'win32';
  const basic = await fixedCase(
    workspace,
    resourcesRoot,
    windows ? WINDOWS_COMMAND : UNIX_COMMAND,
    { signal, report, expectedPowerShellMajor, caseName: 'basic' },
  );
  if (windows && basic.result.isError && report) {
    await diagnoseWindowsPowerShell(workspace, resourcesRoot, report);
  }
  assert.equal(basic.receipt.status, 'done');
  assert.equal(basic.result.isError, false, `basic: ${basic.output}`);
  assert.equal(basic.calls, 2);
  if (!windows) {
    assert.ok(basic.output.includes('zhiyuan-native-bash-中文'));
    assert.match(basic.output, /git version \d/);
    return { passed: true, tool: 'bash', approvals: basic.approvals, output: basic.output };
  }
  const parsed = JSON.parse(
    basic.output.split(/\r?\n/).find(line => line.trim().startsWith('{')) ?? '',
  );
  assert.equal(parsed.marker, 'zhiyuan-native-powershell-中文');
  assert.equal(parsed.quote, `quoted 'value' "double"`);
  assert.equal(await realpath(parsed.cwd), await realpath(workspace));
  assert.equal(parsed.major, expectedPowerShellMajor);
  if (expectedPowerShellMajor === 5) assert.equal(parsed.minor, 1);
  assert.match(parsed.git, /^git version \d/);
  assert.equal(typeof parsed.gitSource, 'string');
  const gitExecutable = await realpath(parsed.gitSource);
  assert.equal(gitExecutable, await realpath(join(resourcesRoot, 'mingit', 'cmd', 'git.exe')));
  const nonzero = await fixedCase(workspace, resourcesRoot, NONZERO_COMMAND, {
    signal,
    report,
    expectedPowerShellMajor,
    caseName: 'nonzero',
  });
  assert.equal(nonzero.result.isError, true);
  assert.ok(nonzero.output.includes('expected nonzero'));
  assert.ok(JSON.stringify(nonzero.entries).includes('Command exited with code 17'));
  // Ordinary tool errors may be followed by the model; they are not cancellation.
  assert.equal(nonzero.receipt.status, 'done');
  const denied = await fixedCase(workspace, resourcesRoot, DENIED_COMMAND, {
    signal,
    deny: true,
    report,
    expectedPowerShellMajor,
    caseName: 'denied',
  });
  assert.equal(denied.receipt.status, 'unanswered');
  if (denied.receipt.status === 'unanswered') assert.equal(denied.receipt.reason, 'aborted');
  assert.equal(denied.calls, 1);
  assert.equal(denied.result.isError, true);
  assert.ok(denied.output.includes('Acceptance refusal'));
  await assert.rejects(stat(join(workspace, 'denied.txt')), { code: 'ENOENT' });
  const cancelled = await fixedCase(workspace, resourcesRoot, CHILD_COMMAND, {
    signal,
    cancelAfterChild: true,
    report,
    expectedPowerShellMajor,
    caseName: 'cancel',
  });
  assert.equal(cancelled.receipt.status, 'unanswered');
  if (cancelled.receipt.status === 'unanswered') assert.equal(cancelled.receipt.reason, 'aborted');
  assert.equal(cancelled.result.isError, true);
  assert.equal(cancelled.calls, 1);
  const repository = join(workspace, 'repository');
  await mkdir(repository, { recursive: true });
  const worktree = await fixedCase(repository, resourcesRoot, WORKTREE_COMMAND, {
    signal,
    report,
    expectedPowerShellMajor,
    caseName: 'worktree',
  });
  assert.equal(worktree.result.isError, false, `worktree: ${worktree.output}`);
  assert.ok(worktree.output.includes('true'));
  return {
    passed: true,
    tool: 'powershell',
    approvals: basic.approvals,
    output: basic.output,
    gitExecutable,
    powerShellMajor: parsed.major,
    powerShellMinor: parsed.minor,
    checks: {
      unicode: true,
      quotedText: true,
      spaceCwd: true,
      nonzero: true,
      approvalDenied: true,
      cancelledChild: true,
      gitWorktree: true,
    },
  };
}

if (typeof require !== 'undefined' && require.main === module && process.send) {
  const controller = new AbortController();
  process.once('disconnect', () => controller.abort());
  let started = false;
  process.on(
    'message',
    (
      input:
        | { cwd: string; resourcesRoot: string; expectedPowerShellMajor?: number }
        | { cancel: true },
    ) => {
      if ('cancel' in input) {
        controller.abort();
        return;
      }
      if (started) return;
      started = true;
      const finish = (response: unknown) => {
        if (process.connected) process.send?.(response, () => process.disconnect());
      };
      void runNativeExecutionSmoke(
        input.cwd,
        input.resourcesRoot,
        controller.signal,
        input.expectedPowerShellMajor,
        progress => {
          if (process.connected) process.send?.({ type: 'native-smoke-progress', progress });
        },
      ).then(
        result => finish({ success: true, result }),
        error =>
          finish({
            success: false,
            error: error instanceof Error ? (error.stack ?? error.message) : String(error),
          }),
      );
    },
  );
}
