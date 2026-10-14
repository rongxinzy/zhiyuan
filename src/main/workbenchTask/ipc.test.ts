import { expect, test, vi } from 'vitest';
import { WorkbenchTaskIpc, type WorkbenchTask } from '../../shared/workbenchTask';
import { registerWorkbenchTaskIpcHandlers } from './ipc';
import type { WorkbenchTaskService } from './taskService';
const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
}));

test('export audit returns a clean cancellation result from the save dialog', async () => {
  electronMocks.handlers.clear();
  electronMocks.showSaveDialog.mockResolvedValue({ canceled: true });
  const task = { id: 'task-1', sessionId: 'session-1' } as WorkbenchTask;
  const service = {
    on: vi.fn(),
    getDetail: vi.fn(() => ({
      task,
      runs: [],
      events: [],
      artifacts: [],
      approvals: [],
    })),
  } as unknown as WorkbenchTaskService;
  registerWorkbenchTaskIpcHandlers({
    getService: () => service,
  });

  const handler = electronMocks.handlers.get(WorkbenchTaskIpc.ExportAudit);
  await expect(handler?.({ sender: {} }, task.id)).resolves.toEqual({
    success: true,
    canceled: true,
  });
  expect(electronMocks.showSaveDialog).toHaveBeenCalledWith(
    expect.objectContaining({ defaultPath: `workbench-task-audit-${task.id}.json` }),
  );
});

test('legacy history exposes audit and acceptance without any execution IPC', () => {
  electronMocks.handlers.clear();
  const service = { on: vi.fn(), prepareRun: vi.fn() } as unknown as WorkbenchTaskService;
  registerWorkbenchTaskIpcHandlers({ getService: () => service });
  expect(electronMocks.handlers.has('workbenchTask:resume')).toBe(false);
  expect(electronMocks.handlers.has('workbenchTask:retry')).toBe(false);
  expect(electronMocks.handlers.has(WorkbenchTaskIpc.GetDetail)).toBe(true);
  expect(electronMocks.handlers.has(WorkbenchTaskIpc.Accept)).toBe(true);
  expect(service.prepareRun).not.toHaveBeenCalled();
});
