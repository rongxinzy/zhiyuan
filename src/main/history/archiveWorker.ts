import { parentPort, workerData } from 'node:worker_threads';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

interface Request {
  operation?: string;
  manifest?: unknown;
  root: string;
  paths: string[];
  maxFiles: number;
  maxBytes: number;
}
const request = workerData as Request;
async function run() {
  if (request.operation === 'encodeManifest') return JSON.stringify(request.manifest, null, 2);
  if (request.operation === 'readRestoreGuard') {
    const path = join(request.root, 'history-restored-native.json');
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
        throw new Error('Invalid restored-session guard');
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (
        value.version !== 1 ||
        !Array.isArray(value.files) ||
        value.files.length > 100000 ||
        value.files.some(
          (file: unknown) => typeof file !== 'string' || !/^[a-f0-9]{64}\.sqlite$/.test(file),
        )
      )
        throw new Error('Invalid restored-session guard');
      return value.files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  if (request.operation === 'readManifest') {
    const path = join(request.root, 'manifest.json');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
      throw new Error('Invalid history manifest');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  let bytes = 0;
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('History archives cannot contain symbolic links');
    if (stat.isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry));
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (files.length >= request.maxFiles || bytes > request.maxBytes)
        throw new Error('History archive exceeds its safety limit');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      files.push({
        path: relative(request.root, path).split('\\').join('/'),
        size: stat.size,
        sha256: hash.digest('hex'),
      });
    } else throw new Error('Unsupported history archive file');
  }
  for (const path of request.paths) await visit(join(request.root, path));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
void run().then(
  value => parentPort?.postMessage({ value }),
  error =>
    parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
