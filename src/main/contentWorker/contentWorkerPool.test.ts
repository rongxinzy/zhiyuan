import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { ContentWorkerPool } from './contentWorkerPool';
import { ContentWorkerLimit } from './contentWorkerConstants';
import { TextWorkerKind } from './textWorkerOperations';
import { CoworkRunPolicy } from '../../shared/cowork/runState';

const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'content-worker-test-')));
const compiled = path.join(fixture, 'compiled');
let pool: ContentWorkerPool;
beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ESNext',
      '--types',
      'node',
      '--skipLibCheck',
      '--esModuleInterop',
      '--rootDir',
      'src',
      '--outDir',
      compiled,
      'src/main/contentWorker/contentWorker.ts',
    ],
    { stdio: 'inherit' },
  );
  pool = new ContentWorkerPool(path.join(compiled, 'main/contentWorker/contentWorker.js'));
});
afterAll(() => {
  pool?.dispose();
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('workspace content hashing and decoding stay within the shared worker boundary', async () => {
  const bytes = Buffer.alloc(ContentWorkerLimit.WorkspaceContentBytes, 65);
  bytes[0] = 0;
  const inspectSync = () => ({
    sha256: createHash('sha256').update(bytes).digest('hex'),
    text: bytes.toString('utf8'),
    binary: bytes.includes(0),
  });
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
  }, 1);
  try {
    const startedSync = performance.now();
    let baseline = inspectSync();
    for (let index = 0; index < 32; index += 1) baseline = inspectSync();
    const syncMs = performance.now() - startedSync;
    expect(ticks).toBe(0);
    const startedWorker = performance.now();
    for (let index = 0; index < 32; index += 1) {
      const transferred = Uint8Array.from(bytes).buffer;
      expect(await pool.inspectContent(transferred)).toEqual(baseline);
      expect(transferred.byteLength).toBe(0);
    }
    expect(ticks).toBeGreaterThan(0);
    console.log(
      `[WorkspaceContentTest] synchronous inspection blocked for ${Math.round(syncMs)} ms; worker inspection took ${Math.round(performance.now() - startedWorker)} ms with ${ticks} main-thread timer ticks`,
    );
  } finally {
    clearInterval(interval);
  }
  await expect(
    pool.inspectContent(new ArrayBuffer(ContentWorkerLimit.WorkspaceContentBytes + 1)),
  ).rejects.toThrow('input limit');
  const cancellation = new AbortController();
  const pending = pool.inspectContent(Uint8Array.from(bytes).buffer, cancellation.signal);
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
  expect((await pool.inspectContent(Uint8Array.from(bytes).buffer)).sha256).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
});
test('tool display and content comparison share the bounded worker pool and support cancellation', async () => {
  const content = '中文\n'.repeat(60_000) + 'END';
  expect(
    await pool.transform({
      kind: TextWorkerKind.Content,
      content,
      previous: content.slice(0, 90_000),
      reset: false,
    }),
  ).toMatchObject({ content: content.slice(90_000), offset: 90_000, truncated: false });
  expect(
    await pool.transform({
      kind: TextWorkerKind.Tool,
      result: { content: [{ text: 'first' }, { text: 'last' }] },
    }),
  ).toMatchObject({ content: 'first\nlast' });
  const cancellation = new AbortController();
  const pending = pool.transform(
    { kind: TextWorkerKind.Content, content, previous: content, reset: false },
    cancellation.signal,
  );
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
  await expect(
    pool.transform({
      kind: TextWorkerKind.Content,
      content: 'x'.repeat(CoworkRunPolicy.MaximumContentCharacters + 2),
      previous: '',
      reset: false,
    }),
  ).rejects.toThrow('input limit');
});
