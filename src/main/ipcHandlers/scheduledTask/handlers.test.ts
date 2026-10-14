import { beforeEach, expect, test, vi } from 'vitest';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import { IpcChannel, PayloadKind, SessionTarget } from '../../../scheduledTask/constants';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
}));
import { registerScheduledTaskHandlers } from './handlers';

beforeEach(() => electronMocks.handlers.clear());
function register(service: Partial<ScheduledTaskService>) {
  registerScheduledTaskHandlers({ getCronJobService: () => service as ScheduledTaskService });
}

test('lists application schedules without an IM gateway dependency', async () => {
  const listJobs = vi.fn(async () => []);
  register({ listJobs });
  await expect(electronMocks.handlers.get(IpcChannel.List)?.()).resolves.toEqual({
    success: true,
    tasks: [],
  });
  expect(listJobs).toHaveBeenCalledOnce();
  for (const channel of [
    'scheduledTask:listChannels',
    'scheduledTask:listDeliveries',
    'scheduledTask:listChannelConversations',
    'scheduledTask:preflight',
  ]) {
    expect(electronMocks.handlers.has(channel)).toBe(false);
  }
});

test('preserves task configuration without delivery normalization', async () => {
  const addJob = vi.fn(async input => ({ id: 'task', ...input }));
  register({ addJob });
  const input = {
    name: 'task',
    sessionTarget: SessionTarget.Isolated,
    payload: { kind: PayloadKind.AgentTurn, message: 'Run' },
  };
  await electronMocks.handlers.get(IpcChannel.Create)?.({}, input);
  expect(addJob).toHaveBeenCalledWith(input);
});

test('partial update keeps only the requested fields', async () => {
  const updateJob = vi.fn(async (_id, input) => ({ id: 'task', ...input }));
  register({ updateJob } as unknown as Partial<ScheduledTaskService>);
  await electronMocks.handlers.get(IpcChannel.Update)?.({}, 'task', { enabled: false });
  expect(updateJob).toHaveBeenCalledWith('task', { enabled: false });
});

test('stop awaits the service native-cancellation result', async () => {
  const stopJob = vi.fn(async () => true);
  register({ stopJob });
  await expect(electronMocks.handlers.get(IpcChannel.Stop)?.({}, 'task')).resolves.toEqual({
    success: true,
    result: true,
  });
  expect(stopJob).toHaveBeenCalledWith('task');
  stopJob.mockRejectedValueOnce(new Error('native abort failed'));
  await expect(electronMocks.handlers.get(IpcChannel.Stop)?.({}, 'task')).resolves.toEqual({
    success: false,
    error: 'native abort failed',
  });
});
