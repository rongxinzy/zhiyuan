import { mkdtemp, writeFile, readFile, rm, symlink, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { persistHistoryFileAttachments, relocateHistoryAttachments } from './managedAttachments';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const options = { workerPath: join(__dirname, 'archiveWorker.ts') };
test('selected files have stable snapshots after originals change; hash dedup and explicit cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-files-'));
  roots.push(root);
  const source = join(root, 'selected.txt');
  const data = join(root, 'data');
  await writeFile(source, 'selected content');
  const files = [{ name: 'selected.txt', path: source }];
  const first = await persistHistoryFileAttachments(data, files, options);
  const second = await persistHistoryFileAttachments(data, files, options);
  expect(first[0].path).toBe(second[0].path);
  expect(await readdir(join(data, 'history-files'))).toHaveLength(1);
  await writeFile(source, 'edited original');
  expect(await readFile(first[0].path, 'utf8')).toBe('selected content');
  await expect(
    persistHistoryFileAttachments(data, files, { ...options, signal: AbortSignal.abort() }),
  ).rejects.toThrow();
  await symlink(source, join(root, 'link.txt'));
  await expect(
    persistHistoryFileAttachments(data, [{ name: 'link', path: join(root, 'link.txt') }], options),
  ).rejects.toThrow('regular files');
  await expect(
    persistHistoryFileAttachments(data, Array(21).fill(files[0]), options),
  ).rejects.toThrow('20 files');
});
test('relocation only rebases managed attachment references and preserves external paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-relocate-'));
  roots.push(root);
  await mkdir(join(root, 'history-files'));
  await writeFile(
    join(root, 'history-attachment-roots.json'),
    JSON.stringify({ sourceRoots: ['/previous', '/earlier'] }),
  );
  const metadata = {
    fileAttachments: [
      { name: 'a', path: '/earlier/history-files/a.txt' },
      { name: 'external', path: '/workspace/code.ts' },
    ],
    imageAttachments: [{ name: 'image', path: '/previous/cowork-images/s/a.png' }],
  };
  const relocated = await relocateHistoryAttachments(root, metadata);
  expect((relocated!.fileAttachments as { path: string }[]).map(x => x.path)).toEqual([
    join(root, 'history-files/a.txt'),
    '/workspace/code.ts',
  ]);
  expect(metadata.fileAttachments[0].path).toBe('/earlier/history-files/a.txt');
});
