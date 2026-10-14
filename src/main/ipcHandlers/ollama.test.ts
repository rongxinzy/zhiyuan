import { expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { OllamaIpcChannel } from '../../shared/ollama';
import type { OllamaManager } from '../libs/ollamaManager';
const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => Promise<any>>() }));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: any) => mock.handlers.set(name, fn) },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
}));
import { registerOllamaIpcHandlers } from './ollama';
const setup = () => {
  mock.handlers.clear();
  let loaded = true;
  const client = {
    runningModels: vi.fn(async () =>
      loaded ? [{ name: 'fixture-local', context_length: 8192 }] : [],
    ),
    preloadModel: vi.fn(async () => {
      loaded = true;
      return { runningModels: await client.runningModels() };
    }),
    unloadModel: vi.fn(async () => {
      loaded = false;
    }),
    deleteModel: vi.fn(async () => {
      loaded = false;
    }),
  };
  const manager = Object.assign(new EventEmitter(), {
    client: async () => client,
    start: async () => ({ status: 'running' }),
    stop: async () => {
      loaded = false;
      return { status: 'stopped' };
    },
    restart: async () => ({ status: 'running' }),
  });
  const changed = vi.fn();
  const store = { get: vi.fn(), set: vi.fn() };
  registerOllamaIpcHandlers(manager as unknown as OllamaManager, {
    getStore: () => store as never,
    onModelBindingsChanged: changed,
  });
  return {
    client,
    manager,
    changed,
    store,
    call: (name: string, ...args: unknown[]) => mock.handlers.get(name)!(...args),
  };
};
test('syncs start/load/unload/stop through the unified provider callback without old AppConfig writes', async () => {
  const { changed, store, call } = setup();
  await call(OllamaIpcChannel.Start);
  expect(changed).toHaveBeenLastCalledWith({
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: [{ id: 'fixture-local', name: 'fixture-local', contextWindow: 8192, input: ['text'] }],
  });
  await call(OllamaIpcChannel.UnloadModel, undefined, 'fixture-local');
  expect(changed).toHaveBeenLastCalledWith({ baseUrl: 'http://127.0.0.1:11434/v1', models: [] });
  await call(OllamaIpcChannel.PreloadModel, undefined, { model: 'fixture-local' });
  expect(changed.mock.lastCall?.[0].models).toHaveLength(1);
  await call(OllamaIpcChannel.Stop);
  expect(changed).toHaveBeenLastCalledWith({ baseUrl: null, models: [] });
  expect(store.set).not.toHaveBeenCalled();
});
test('runtime failure removes stale choices and an in-flight read cannot restore them after stop', async () => {
  const { client, changed, call } = setup();
  let finish!: (models: any[]) => void;
  client.runningModels.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const starting = call(OllamaIpcChannel.Start);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await call(OllamaIpcChannel.Stop);
  finish([{ name: 'stale-model' }]);
  await starting;
  expect(changed).toHaveBeenLastCalledWith({ baseUrl: null, models: [] });
  client.runningModels.mockRejectedValueOnce(new Error('offline'));
  await call(OllamaIpcChannel.Restart);
  expect(changed).toHaveBeenLastCalledWith({ baseUrl: null, models: [] });
});
