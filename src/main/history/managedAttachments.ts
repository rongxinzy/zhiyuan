import { copyFile, mkdir, lstat, readFile, rm, rename } from 'node:fs/promises';
import { join, dirname, basename, extname, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inventoryArchive, type ArchiveInventoryOptions } from './archiveFiles';
export interface SelectedHistoryFile {
  name: string;
  path: string;
  [key: string]: unknown;
}
/** Snapshot only files explicitly supplied as attachments. Never discovers files from message text or workspace scans. */
export async function persistHistoryFileAttachments<T extends SelectedHistoryFile>(
  dataRoot: string,
  files: readonly T[],
  options: ArchiveInventoryOptions = {},
): Promise<T[]> {
  if (files.length > 20) throw new Error('Attach at most 20 files at a time');
  const root = join(dataRoot, 'history-files');
  const output: T[] = [];
  let totalBytes = 0;
  for (const file of files) {
    options.signal?.throwIfAborted();
    if (!file || typeof file.path !== 'string') throw new Error('Invalid file attachment');
    totalBytes += (await lstat(file.path)).size;
    if (totalBytes > 250 * 1024 * 1024)
      throw new Error('Total file attachments must not exceed 250 MB');
  }
  if (files.length) await mkdir(root, { recursive: true });
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !isAbsolute(file.path) ||
      typeof file.name !== 'string'
    )
      throw new Error('Invalid file attachment');
    options.signal?.throwIfAborted();
    const stat = await lstat(file.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100 * 1024 * 1024)
      throw new Error('File attachments must be regular files up to 100 MB');
    const source = await inventoryArchive(dirname(file.path), [basename(file.path)], options);
    const info = source[0];
    const extension = extname(file.name)
      .replace(/[^a-zA-Z0-9.]/g, '')
      .slice(0, 16)
      .toLowerCase();
    const path = join(root, `${info.sha256}${extension}`);
    const temporary = join(root, `.staging-${randomUUID()}`);
    try {
      options.signal?.throwIfAborted();
      await copyFile(file.path, temporary);
      options.signal?.throwIfAborted();
      const copied = (await inventoryArchive(root, [basename(temporary)], options))[0];
      if (copied.sha256 !== info.sha256 || copied.size !== info.size)
        throw new Error('The attached file changed while it was being copied; attach it again');
      options.signal?.throwIfAborted();
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    output.push({ ...file, path, size: info.size, sha256: info.sha256 });
  }
  return output;
}
/** Rebase only managed attachments in read output. Immutable native entries remain untouched. */
export async function relocateHistoryAttachments(
  dataRoot: string,
  metadata?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  if (!metadata) return metadata;
  let map: { sourceRoot?: string; sourceRoots?: string[] };
  try {
    const raw = await readFile(join(dataRoot, 'history-attachment-roots.json'), 'utf8');
    if (raw.length > 16384) throw new Error('Invalid attachment relocation map');
    map = JSON.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return metadata;
    throw error;
  }
  const sourceRoots = map.sourceRoots ?? (map.sourceRoot ? [map.sourceRoot] : []);
  if (
    !sourceRoots.length ||
    sourceRoots.length > 32 ||
    sourceRoots.some(p => typeof p !== 'string' || !isAbsolute(p))
  )
    throw new Error('Invalid attachment relocation map');
  const result = { ...metadata };
  for (const key of ['imageAttachments', 'fileAttachments'])
    if (Array.isArray(metadata[key]))
      result[key] = metadata[key].map((item: unknown) => {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof (item as { path?: unknown }).path !== 'string'
        )
          return item;
        const record = item as { path: string };
        for (const sourceRoot of sourceRoots) {
          const rel = relative(sourceRoot, record.path);
          if (
            isAbsolute(rel) ||
            rel === '..' ||
            rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
          )
            continue;
          const first = rel.split(/[\\/]/)[0];
          if (first !== 'cowork-images' && first !== 'history-files') continue;
          return { ...item, path: join(dataRoot, rel) };
        }
        return item;
      });
  return result;
}
