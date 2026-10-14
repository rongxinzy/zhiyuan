import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Api, Model, ModelsStore, ModelsStoreEntry } from '@earendil-works/pi-ai';
import type { Provider } from '@earendil-works/pi-ai/models';

const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAX_CATALOG_BYTES = 512 * 1024;
const MAX_CATALOG_MODELS = 2000;

function isChatModel(value: unknown): value is Model<Api> {
  if (!value || typeof value !== 'object') return false;
  const model = value as Record<string, unknown>;
  const cost = model.cost;
  return (
    (model.type === undefined || model.type === 'chat') &&
    ['id', 'name', 'api', 'provider', 'baseUrl'].every(key => typeof model[key] === 'string') &&
    typeof model.reasoning === 'boolean' &&
    typeof model.contextWindow === 'number' &&
    typeof model.maxTokens === 'number' &&
    Array.isArray(model.input) &&
    model.input.every(item => item === 'text' || item === 'image') &&
    !!cost &&
    typeof cost === 'object' &&
    ['input', 'output', 'cacheRead', 'cacheWrite'].every(
      key => typeof Reflect.get(cost, key) === 'number',
    )
  );
}

/** Catalog data only. Credentials never enter this store or public catalog requests. */
export class NativeCatalogStore implements ModelsStore {
  constructor(private readonly directory: string) {}

  private file(provider: string): string {
    if (!/^[a-z0-9_-]+$/i.test(provider)) throw new Error('Invalid catalog provider id.');
    return join(this.directory, `${provider}.json`);
  }

  async read(
    provider: string,
    options?: { signal?: AbortSignal },
  ): Promise<ModelsStoreEntry | undefined> {
    options?.signal?.throwIfAborted();
    try {
      const bytes = await readFile(this.file(provider), { signal: options?.signal });
      if (bytes.length > MAX_CATALOG_BYTES) return undefined;
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      if (
        !value ||
        typeof value !== 'object' ||
        !('models' in value) ||
        !Array.isArray(value.models)
      )
        return undefined;
      return {
        models: value.models.filter(isChatModel).slice(0, MAX_CATALOG_MODELS),
        ...('etag' in value && typeof value.etag === 'string' ? { etag: value.etag } : {}),
        ...('checkedAt' in value && typeof value.checkedAt === 'number'
          ? { checkedAt: value.checkedAt }
          : {}),
        ...('lastModified' in value && typeof value.lastModified === 'number'
          ? { lastModified: value.lastModified }
          : {}),
      };
    } catch (error) {
      options?.signal?.throwIfAborted();
      if (
        error instanceof SyntaxError ||
        (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      )
        return undefined;
      throw error;
    }
  }

  async write(
    provider: string,
    entry: ModelsStoreEntry,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    const text = JSON.stringify(entry);
    if (Buffer.byteLength(text) > MAX_CATALOG_BYTES)
      throw new Error('Model catalog exceeds its storage limit.');
    await mkdir(this.directory, { recursive: true });
    const target = this.file(provider);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { signal: options?.signal, mode: 0o600 });
      options?.signal?.throwIfAborted();
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async delete(provider: string, options?: { signal?: AbortSignal }): Promise<void> {
    options?.signal?.throwIfAborted();
    await rm(this.file(provider), { force: true });
  }
}

let appStore: Promise<NativeCatalogStore> | undefined;
export function getNativeCatalogStore(): Promise<NativeCatalogStore> {
  return (appStore ??= import('electron').then(
    ({ app }) => new NativeCatalogStore(join(app.getPath('userData'), 'native-model-catalog')),
  ));
}

/** Native Provider decorator for the public static-catalog overlay formerly owned by coding-agent. */
export function withNativeRemoteCatalog(
  provider: Provider,
  options: { fetch?: typeof globalThis.fetch; now?: () => number; generatedAt?: number } = {},
): Provider {
  let overlay: readonly Model<Api>[] = [];
  const now = options.now ?? Date.now;
  const merge = () => [
    ...new Map([...provider.getModels(), ...overlay].map(model => [model.id, model])).values(),
  ];
  const freshModels = (entry?: ModelsStoreEntry) =>
    entry && (options.generatedAt === undefined || (entry.lastModified ?? 0) > options.generatedAt)
      ? entry.models.filter(isChatModel).filter(model => model.provider === provider.id)
      : [];
  return {
    ...provider,
    getModels: merge,
    getAllModels: () => [
      ...(provider.getAllModels?.() ?? []).filter(model => model.type && model.type !== 'chat'),
      ...merge(),
    ],
    refreshModels: async context => {
      const stored = context.stored;
      if (
        !(await context.publish({
          update: () => {
            overlay = freshModels(stored);
          },
        }))
      )
        return;
      if (!context.allowNetwork || context.signal.aborted) return;
      if (
        !context.force &&
        stored?.checkedAt !== undefined &&
        now() - stored.checkedAt < REFRESH_INTERVAL_MS
      )
        return;
      const response = await (options.fetch ?? globalThis.fetch)(
        `https://pi.dev/api/models/providers/${encodeURIComponent(provider.id)}?types=chat`,
        {
          headers: {
            accept: 'application/json',
            ...(stored?.etag && stored.models.length ? { 'if-none-match': stored.etag } : {}),
          },
          signal: context.signal,
        },
      );
      context.signal.throwIfAborted();
      if (response.status === 304 && stored) {
        await context.publish({ persist: { ...stored, checkedAt: now() } });
        return;
      }
      if (response.status === 404 || response.status === 501) return;
      if (!response.ok)
        throw new Error(`Model catalog request failed for ${provider.id}: ${response.status}`);
      // Bound before parsing and retain the previous cache if a server returns an oversized shard.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Model catalog response is empty.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_CATALOG_BYTES)
            throw new Error('Model catalog response exceeds its size limit.');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const entries = Array.isArray(value)
        ? value
        : value && typeof value === 'object'
          ? 'models' in value && Array.isArray(value.models)
            ? value.models
            : Object.values(value)
          : undefined;
      if (!entries || entries.length > MAX_CATALOG_MODELS)
        throw new Error('Invalid model catalog.');
      const models = entries
        .map(entry =>
          entry && typeof entry === 'object' ? { ...entry, provider: provider.id } : entry,
        )
        .filter(isChatModel);
      if (entries.length && models.length === 0)
        throw new Error('Model catalog contains no valid models.');
      const entry: ModelsStoreEntry = {
        models,
        checkedAt: now(),
        lastModified: Date.parse(response.headers.get('last-modified') ?? '') || 0,
        etag: response.headers.get('etag') ?? undefined,
      };
      await context.publish({
        persist: entry,
        update: () => {
          overlay = freshModels(entry);
        },
      });
    },
  };
}
