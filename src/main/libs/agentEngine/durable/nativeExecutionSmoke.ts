/** Fixed, account-free acceptance cases executed by the actual native tools.
 * This subprocess exposes no arbitrary command or Main IPC interface. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
import { createNativeExecutionEnv, nativeCodingTools } from './nativeExecutionEnv';
import { authorizeNativeTool } from './toolBridge';

const UNIX_COMMAND = "printf 'zhiyuan-native-bash-中文\\n'; printf '%s\\n' \"$PWD\"; git --version";
const WINDOWS_COMMAND = `@{ marker='zhiyuan-native-powershell-中文'; quote='quoted ''value'' "double"'; cwd=(Get-Location).Path; major=$PSVersionTable.PSVersion.Major; minor=$PSVersionTable.PSVersion.Minor; git=(& git --version) } | ConvertTo-Json -Compress`;
const NONZERO_COMMAND = 'Write-Output "expected nonzero"; exit 17';
const DENIED_COMMAND = "Set-Content -LiteralPath 'denied.txt' -Value 'must not execute'";
const CHILD_COMMAND = `$child=Start-Process -FilePath $env:ComSpec -ArgumentList '/d /s /c "ping -n 120 127.0.0.1 >NUL"' -PassThru; Set-Content -LiteralPath 'child.pid' -Value $child.Id; Start-Sleep -Seconds 120`;
const WORKTREE_COMMAND = `git init --quiet; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git -c user.name=Acceptance -c user.email=acceptance@example.invalid -c commit.gpgsign=false commit --allow-empty --quiet -m acceptance; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git worktree add --quiet --detach '../linked 工作树' HEAD; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git -C '../linked 工作树' rev-parse --is-inside-work-tree`;

async function fixedCase(
  cwd: string,
  resourcesRoot: string,
  command: string,
  options: {
    signal?: AbortSignal;
    deny?: boolean;
    cancelAfterChild?: boolean;
  } = {},
) {
  const context = options.signal
    ? withAbortSignal(options.signal, BACKGROUND_CONTEXT)
    : BACKGROUND_CONTEXT;
  const toolName = process.platform === 'win32' ? 'powershell' : 'bash';
  const environment = await createNativeExecutionEnv(cwd, resourcesRoot);
  const registry = createRegistry();
  const tools = nativeCodingTools();
  let approvals = 0;
  registry.install({
    ...tools,
    tools: tools.tools?.map(tool =>
      authorizeNativeTool(tool, {
        authorize: async call => {
          assert.equal(call.toolName, toolName);
          assert.equal(call.toolInput.command, command);
          approvals++;
          return options.deny
            ? { allow: false, terminateRun: true, reason: 'Acceptance refusal' }
            : { allow: true };
        },
      }),
    ),
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
                arguments: { command, timeout: options.cancelAfterChild ? 120 : 20 },
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
      const deadline = Date.now() + 15_000;
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
    // Verify Stop itself reaps descendants, before close/cleanup can mask it.
    if (options.cancelAfterChild) await assertChildExited(childPid!);
    return { receipt, result: results[0], output, approvals, calls, childPid, entries };
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await environment.cleanup(BACKGROUND_CONTEXT);
  }
}

async function assertChildExited(pid: number) {
  const deadline = Date.now() + 10_000;
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
) {
  const workspace = join(cwd, 'native shell 中文 space');
  await mkdir(workspace, { recursive: true });
  const windows = process.platform === 'win32';
  const basic = await fixedCase(
    workspace,
    resourcesRoot,
    windows ? WINDOWS_COMMAND : UNIX_COMMAND,
    { signal },
  );
  assert.equal(basic.receipt.status, 'done');
  assert.equal(basic.result.isError, false, basic.output);
  assert.equal(basic.calls, 2);
  if (!windows) {
    assert.ok(basic.output.includes('zhiyuan-native-bash-中文'));
    assert.match(basic.output, /git version \d/);
    return { passed: true, tool: 'bash', approvals: basic.approvals, output: basic.output };
  }
  const parsed = JSON.parse(basic.output.trim());
  assert.equal(parsed.marker, 'zhiyuan-native-powershell-中文');
  assert.equal(parsed.quote, `quoted 'value' "double"`);
  assert.equal(await realpath(parsed.cwd), await realpath(workspace));
  assert.equal(parsed.major, expectedPowerShellMajor);
  if (expectedPowerShellMajor === 5) assert.equal(parsed.minor, 1);
  assert.match(parsed.git, /^git version \d/);
  const nonzero = await fixedCase(workspace, resourcesRoot, NONZERO_COMMAND, { signal });
  assert.equal(nonzero.result.isError, true);
  assert.ok(nonzero.output.includes('expected nonzero'));
  assert.ok(JSON.stringify(nonzero.entries).includes('Command exited with code 17'));
  // Ordinary tool errors may be followed by the model; they are not cancellation.
  assert.equal(nonzero.receipt.status, 'done');
  const denied = await fixedCase(workspace, resourcesRoot, DENIED_COMMAND, { signal, deny: true });
  assert.equal(denied.receipt.status, 'unanswered');
  if (denied.receipt.status === 'unanswered') assert.equal(denied.receipt.reason, 'aborted');
  assert.equal(denied.calls, 1);
  assert.equal(denied.result.isError, true);
  assert.ok(denied.output.includes('Acceptance refusal'));
  await assert.rejects(stat(join(workspace, 'denied.txt')), { code: 'ENOENT' });
  const cancelled = await fixedCase(workspace, resourcesRoot, CHILD_COMMAND, {
    signal,
    cancelAfterChild: true,
  });
  assert.equal(cancelled.receipt.status, 'unanswered');
  if (cancelled.receipt.status === 'unanswered') assert.equal(cancelled.receipt.reason, 'aborted');
  assert.equal(cancelled.result.isError, true);
  assert.equal(cancelled.calls, 1);
  const repository = join(workspace, 'repository');
  await mkdir(repository, { recursive: true });
  const worktree = await fixedCase(repository, resourcesRoot, WORKTREE_COMMAND, { signal });
  assert.equal(worktree.result.isError, false, worktree.output);
  assert.ok(worktree.output.includes('true'));
  return {
    passed: true,
    tool: 'powershell',
    approvals: basic.approvals,
    output: basic.output,
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
      ).then(
        result => finish({ success: true, result }),
        error =>
          finish({ success: false, error: error instanceof Error ? error.message : String(error) }),
      );
    },
  );
}
