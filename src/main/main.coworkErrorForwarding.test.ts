import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');

test('awaits native admission and returns rejected startup or continuation through IPC', () => {
  const start = source.slice(
    source.indexOf('await runtime.startSession(session.id'),
    source.indexOf('ipcMain.handle(CoworkSessionIpc.Continue'),
  );
  const continuation = source.slice(
    source.indexOf('ipcMain.handle(CoworkSessionIpc.Continue'),
    source.indexOf("ipcMain.handle('cowork:session:stop'"),
  );
  expect(start).toContain('catch (error)');
  expect(start).toContain('success: false');
  expect(continuation).toContain('await runtime.continueSession(');
  expect(continuation).toContain('success: false');
  expect(source).not.toContain('reportPiSessionFailure');
  expect(source).not.toContain('CoworkStreamIpc.Error');
});

test('persists terminal errors before forwarding the error event', () => {
  const forwarder = source.slice(source.indexOf('const forwardPiWorkbenchRuntimeToRenderer'));
  const errorListener = forwarder.slice(
    forwarder.indexOf("runtime.on('error'"),
    forwarder.indexOf('const bindPiWorkbenchRuntimeForwarder'),
  );
  expect(errorListener).toContain('persistCoworkTerminalError(');
  expect(errorListener).toContain("runtime.emit('message', sessionId, message)");
  expect(errorListener.indexOf('persistCoworkTerminalError(')).toBeLessThan(
    errorListener.indexOf('emitUiEvent({ type: PiUiEventType.Error'),
  );
});

test('native retry forwarding is shared by Work and Coding without retired runtime listeners', () => {
  const forwarder = source.slice(source.indexOf('const forwardPiWorkbenchRuntimeToRenderer'));
  expect(forwarder).toContain("runtime.on('nativeRetry'");
  expect(forwarder).toContain('RuntimeNoticeIpc.Notice, payload');
  expect(source).toContain('bindBuiltinCodingRuntime(runtime,');
  for (const retired of ['toolActivity', 'retryNotice', 'sessionInterrupted']) {
    expect(source).not.toContain(`runtime.on('${retired}'`);
  }
  expect(source).toContain('if (!runtime.respondToPermission(options.requestId, options.result))');
});
