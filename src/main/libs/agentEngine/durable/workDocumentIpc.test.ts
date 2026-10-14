import { test, expect, vi } from 'vitest';
import { registerWorkDocumentIpc } from './workDocumentIpc';

test('work Document IPC rejects unknown sessions and unbounded updates before opening storage', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const runtime = { getWorkDocument: vi.fn(), updateWorkDocument: vi.fn() };
  registerWorkDocumentIpc(
    {
      handle: (name, handler) => {
        handlers.set(name, handler);
      },
    },
    () => runtime,
    id => id === 'known',
  );
  expect(await handlers.get('cowork:workDocument:get')!({}, 'other')).toMatchObject({
    success: false,
  });
  expect(
    await handlers.get('cowork:workDocument:update')!({}, 'known', {
      expectedRevision: 0,
      goal: 'x'.repeat(8001),
    }),
  ).toMatchObject({ success: false });
  expect(runtime.getWorkDocument).not.toHaveBeenCalled();
  expect(runtime.updateWorkDocument).not.toHaveBeenCalled();
});
