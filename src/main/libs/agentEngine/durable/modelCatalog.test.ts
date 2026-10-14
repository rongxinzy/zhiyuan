import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createModels, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { NativeCatalogStore, withNativeRemoteCatalog } from './modelCatalog';
import { PiModelCatalogRefreshCoordinator } from '../piModelCatalogRefresh';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

test('production coordinator uses native providers and writes a credential-free app-owned catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-catalog-coordinator-'));
  directories.push(directory);
  const { app } = await import('electron');
  vi.spyOn(app, 'getPath').mockReturnValue(directory);
  const fixture = fauxProvider({ provider: 'deepseek', models: [{ id: 'refreshed-model' }] });
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(fixture.models), {
      headers: { 'last-modified': 'Wed, 14 Oct 2026 00:00:00 GMT' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const coordinator = new PiModelCatalogRefreshCoordinator({
    resolveApiKeys: () => ({ DEEPSEEK: 'private-key-for-model-access' }),
  });
  try {
    coordinator.start();
    await coordinator.requestRefresh(false);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toContain('/providers/deepseek?types=chat');
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('private-key-for-model-access');
    const cache = await readFile(join(directory, 'native-model-catalog', 'deepseek.json'), 'utf8');
    expect(cache).toContain('refreshed-model');
    expect(cache).not.toContain('private-key-for-model-access');
  } finally {
    await coordinator.stop();
  }
});

test('native provider refreshes public catalog and revalidates cached models without exposing credentials', async () => {
  const fixture = fauxProvider({ provider: 'fixture', models: [{ id: 'baseline' }] });
  const remote = { ...fixture.getModel(), id: 'new-model', contextWindow: 99999 };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify([remote]), {
        headers: { etag: '"v1"', 'last-modified': 'Wed, 14 Oct 2026 00:00:00 GMT' },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 304 }));
  const store = new InMemoryModelsStore();
  const models = createModels({ modelsStore: store });
  models.setProvider(withNativeRemoteCatalog(fixture.provider, { fetch }));
  expect((await models.refresh({ allowNetwork: true })).errors.size).toBe(0);
  expect(models.getModel('fixture', 'new-model')?.contextWindow).toBe(99999);
  await models.refresh({ allowNetwork: true, force: true });
  expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({
    accept: 'application/json',
    'if-none-match': '"v1"',
  });
  expect(fetch.mock.calls[0]?.[0]).toBe('https://pi.dev/api/models/providers/fixture?types=chat');
  expect((await store.read('fixture'))?.models).toEqual([remote]);
});

test('network failure and oversized shards preserve the previous native catalog', async () => {
  const fixture = fauxProvider({ provider: 'fixture' });
  const cached = { ...fixture.getModel(), id: 'cached' };
  const store = new InMemoryModelsStore();
  await store.write('fixture', { models: [cached], etag: '"cached"' });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    .mockResolvedValueOnce(new Response('x'.repeat(512 * 1024 + 1)));
  const models = createModels({ modelsStore: store });
  models.setProvider(withNativeRemoteCatalog(fixture.provider, { fetch }));
  expect((await models.refresh({ allowNetwork: true })).errors.size).toBe(1);
  expect(models.getModel('fixture', 'cached')).toEqual(cached);
  expect((await models.refresh({ allowNetwork: true, force: true })).errors.size).toBe(1);
  expect((await store.read('fixture'))?.etag).toBe('"cached"');
});

test('app-owned catalog store survives reopen and restores offline without a coding-agent runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-catalog-'));
  directories.push(directory);
  const fixture = fauxProvider({ provider: 'fixture' });
  const cached = { ...fixture.getModel(), id: 'cached' };
  await new NativeCatalogStore(directory).write('fixture', {
    models: [cached],
    etag: '"one"',
    checkedAt: 42,
  });
  const reopened = new NativeCatalogStore(directory);
  expect((await reopened.read('fixture'))?.models).toEqual([cached]);
  const fetch = vi.fn<typeof globalThis.fetch>();
  const models = createModels({ modelsStore: reopened });
  models.setProvider(withNativeRemoteCatalog(fixture.provider, { fetch }));
  await models.refresh({ allowNetwork: false });
  expect(models.getModel('fixture', 'cached')).toEqual(cached);
  expect(fetch).not.toHaveBeenCalled();
  expect(await readFile(join(directory, 'fixture.json'), 'utf8')).not.toContain('apiKey');
  await expect(reopened.read('../outside')).rejects.toThrow('Invalid catalog provider');
});

test('newer built-in catalog wins over an obsolete remote overlay', async () => {
  const fixture = fauxProvider({ provider: 'fixture' });
  const store = new InMemoryModelsStore();
  await store.write('fixture', {
    models: [{ ...fixture.getModel(), id: 'obsolete' }],
    lastModified: 1,
  });
  const models = createModels({ modelsStore: store });
  models.setProvider(withNativeRemoteCatalog(fixture.provider, { generatedAt: 2 }));
  await models.refresh({ allowNetwork: false });
  expect(models.getModel('fixture', 'obsolete')).toBeUndefined();
  expect(models.getModel('fixture', fixture.getModel().id)).toBeDefined();
});
