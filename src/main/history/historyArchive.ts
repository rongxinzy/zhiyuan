import Database from 'better-sqlite3';
import { copyFile, mkdir, readFile, rename, rm, lstat, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DB_FILENAME } from '../appConstants';
import {
  inventoryArchive,
  readArchiveManifest,
  encodeArchiveManifest,
  type ArchiveFile,
  type ArchiveInventoryOptions,
} from './archiveFiles';

const TABLES = [
  'workspaces',
  'workspace_folders',
  'cowork_sessions',
  'cowork_messages',
  'cowork_session_experts',
  'coding_rooms',
  'coding_workspace_sources',
  'coding_missions',
  'coding_agent_lanes',
  'coding_assignments',
  'coding_events',
  'coding_elicitations',
  'coding_handoffs',
] as const;
const ROOTS = [DB_FILENAME, 'durable-work', 'cowork-images', 'history-files'] as const;
const MANIFEST = 'manifest.json';

export interface HistoryArchiveManifest {
  format: 'zhiyuan-history';
  version: 1;
  createdAt: number;
  sourceDataRoot: string;
  attachmentSourceRoots: string[];
  externalReferencesIncluded: false;
  files: ArchiveFile[];
  tables: string[];
  nativeSchemaVersion: 1;
  attachmentScope: 'managed-attachments-only';
}
export interface HistoryArchiveResult {
  path: string;
  files: number;
  attachmentScope: 'managed-attachments-only';
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
function safePath(path: string): boolean {
  return (
    !!path &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    !path.split('/').some(p => !p || p === '.' || p === '..') &&
    (path === DB_FILENAME ||
      path.startsWith('durable-work/') ||
      path.startsWith('cowork-images/') ||
      path.startsWith('history-files/'))
  );
}
function validateDb(db: Database.Database, trustedApplication = false): void {
  if (db.pragma('quick_check', { simple: true }) !== 'ok')
    throw new Error('History database integrity check failed');
  if (
    !trustedApplication &&
    db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view') LIMIT 1").get()
  )
    throw new Error('History database contains unsupported executable schema');
}
function tables(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map(x => x.name);
}
function columns(
  db: Database.Database,
  table: string,
): Array<{ name: string; type: string; notnull: number; pk: number }> {
  return (
    db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>
  ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
}
async function sqliteSnapshot(
  source: string,
  target: string,
  trustedApplication = false,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    validateDb(db, trustedApplication);
    await db.backup(target);
    // Standalone archive databases must not create WAL/SHM sidecars merely when validated read-only.
    const snapshot = new Database(target);
    try {
      snapshot.pragma('wal_checkpoint(TRUNCATE)');
      snapshot.pragma('journal_mode = DELETE');
    } finally {
      snapshot.close();
    }
  } finally {
    db.close();
  }
}
function exportStagingPath(root: string, target: string): string {
  return join(
    root,
    `.history-export-${createHash('sha256').update(resolve(target)).digest('hex')}`,
  );
}
/** Only an interrupted, app-authored backup intent may call this cleanup. */
export async function cleanupInterruptedHistoryExport(root: string, target: string): Promise<void> {
  await rm(exportStagingPath(root, target), { recursive: true, force: true });
  await rm(`${target}.pending`, { recursive: true, force: true });
}
/** Must run in startup maintenance, before any application database/owner/scheduler opens. */
export async function createHistoryArchive(
  dataRoot: string,
  destination: string,
  options: ArchiveInventoryOptions = {},
  internalRollback = false,
): Promise<HistoryArchiveResult> {
  const root = resolve(dataRoot);
  const target = resolve(destination);
  const rel = relative(root, target);
  const allowedRollback =
    internalRollback && /^\.history-rollback-[a-f0-9-]+\/archive$/.test(rel.split('\\').join('/'));
  if (
    !allowedRollback &&
    (!rel ||
      (rel !== '..' &&
        !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
        !isAbsolute(rel)))
  )
    throw new Error('Choose a backup location outside application data');
  if (await exists(target)) throw new Error('Backup destination already exists');
  // Raw SQLite backup may contain credentials until sanitization/VACUUM. Keep it inside app data.
  const stage = exportStagingPath(root, target);
  const publish = `${target}.pending`;
  let publishedStageCreated = false;
  await mkdir(stage);
  try {
    await sqliteSnapshot(join(root, DB_FILENAME), join(stage, DB_FILENAME), true);
    const sanitized = new Database(join(stage, DB_FILENAME));
    let included: string[];
    try {
      sanitized.pragma('foreign_keys = OFF');
      for (const trigger of sanitized
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
        .all() as { name: string }[])
        sanitized.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
      for (const table of tables(sanitized))
        if (!(TABLES as readonly string[]).includes(table))
          sanitized.exec(`DROP TABLE "${table.replaceAll('"', '""')}"`);
      // Rebuild the file before it is published: removed credentials must not remain in free pages.
      sanitized.exec('VACUUM');
      included = tables(sanitized);
      sanitized.pragma('wal_checkpoint(TRUNCATE)');
      sanitized.pragma('journal_mode = DELETE');
    } finally {
      sanitized.close();
    }
    for (const folder of ROOTS.slice(1)) {
      if (!(await exists(join(root, folder)))) continue;
      const files = await inventoryArchive(root, [folder], options);
      for (const file of files) {
        if (folder === 'history-files' && /\/\.staging-/.test(file.path)) continue;
        if (folder === 'durable-work') {
          if (file.path.endsWith('-wal') || file.path.endsWith('-shm')) continue;
          if (!/^durable-work\/[a-f0-9]{64}\.sqlite$/.test(file.path))
            throw new Error('Unexpected native history filename');
          await sqliteSnapshot(join(root, file.path), join(stage, file.path));
        } else {
          await mkdir(dirname(join(stage, file.path)), { recursive: true });
          await copyFile(join(root, file.path), join(stage, file.path));
        }
      }
    }
    const present: string[] = [];
    for (const item of ROOTS) if (await exists(join(stage, item))) present.push(item);
    const files = await inventoryArchive(stage, present, options);
    let priorRoots: string[] = [];
    try {
      const relocation = JSON.parse(
        await readFile(join(root, 'history-attachment-roots.json'), 'utf8'),
      );
      priorRoots = relocation.sourceRoots ?? (relocation.sourceRoot ? [relocation.sourceRoot] : []);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const attachmentSourceRoots = [...new Set([root, ...priorRoots])];
    if (
      attachmentSourceRoots.length > 32 ||
      attachmentSourceRoots.some(p => typeof p !== 'string' || !isAbsolute(p))
    )
      throw new Error('Invalid attachment relocation roots');
    const manifest: HistoryArchiveManifest = {
      format: 'zhiyuan-history',
      version: 1,
      createdAt: Date.now(),
      sourceDataRoot: root,
      attachmentSourceRoots,
      externalReferencesIncluded: false,
      files,
      tables: included!,
      nativeSchemaVersion: 1,
      attachmentScope: 'managed-attachments-only',
    };
    await writeFile(join(stage, MANIFEST), await encodeArchiveManifest(manifest, options), {
      flag: 'wx',
      flush: true,
    });
    await mkdir(publish);
    publishedStageCreated = true;
    for (const file of files) {
      await mkdir(dirname(join(publish, file.path)), { recursive: true });
      await copyFile(join(stage, file.path), join(publish, file.path));
    }
    await copyFile(join(stage, MANIFEST), join(publish, MANIFEST));
    await validateHistoryArchive(publish, options);
    await rename(publish, target);
    await rm(stage, { recursive: true, force: true });
    return { path: target, files: files.length, attachmentScope: 'managed-attachments-only' };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    if (publishedStageCreated) await rm(publish, { recursive: true, force: true });
    throw error;
  }
}
export async function validateHistoryArchive(
  directory: string,
  options: ArchiveInventoryOptions = {},
): Promise<HistoryArchiveManifest> {
  const root = resolve(directory);
  const manifest = await readArchiveManifest<HistoryArchiveManifest>(root, options);
  if (
    manifest.format !== 'zhiyuan-history' ||
    manifest.version !== 1 ||
    manifest.nativeSchemaVersion !== 1 ||
    manifest.attachmentScope !== 'managed-attachments-only' ||
    typeof manifest.sourceDataRoot !== 'string' ||
    !isAbsolute(manifest.sourceDataRoot) ||
    !Array.isArray(manifest.attachmentSourceRoots) ||
    manifest.attachmentSourceRoots.length > 32 ||
    manifest.attachmentSourceRoots.some(p => typeof p !== 'string' || !isAbsolute(p)) ||
    manifest.externalReferencesIncluded !== false ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 100000 ||
    !Array.isArray(manifest.tables) ||
    manifest.tables.some(t => !(TABLES as readonly string[]).includes(t)) ||
    !manifest.tables.includes('cowork_sessions') ||
    !manifest.tables.includes('cowork_messages') ||
    new Set(manifest.tables).size !== manifest.tables.length
  )
    throw new Error('Unsupported history archive schema');
  const unique = new Set<string>();
  for (const file of manifest.files) {
    if (
      !safePath(file.path) ||
      unique.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error('Unsafe history archive manifest');
    unique.add(file.path);
  }
  if (!unique.has(DB_FILENAME)) throw new Error('History database is missing');
  const names = await readdir(root);
  if (names.some(name => name !== MANIFEST && !(ROOTS as readonly string[]).includes(name)))
    throw new Error('Unexpected history archive content');
  const actual = await inventoryArchive(
    root,
    names.filter(name => name !== MANIFEST),
    options,
  );
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  if (
    actual.length !== manifest.files.length ||
    actual.some(file => {
      const wanted = expected.get(file.path);
      return !wanted || wanted.size !== file.size || wanted.sha256 !== file.sha256;
    })
  )
    throw new Error('History archive checksum mismatch');
  for (const file of actual.filter(
    file => file.path === DB_FILENAME || file.path.startsWith('durable-work/'),
  )) {
    if (file.path !== DB_FILENAME && !/^durable-work\/[a-f0-9]{64}\.sqlite$/.test(file.path))
      throw new Error('Unsafe native history file');
    const db = new Database(join(root, file.path), { readonly: true, fileMustExist: true });
    try {
      validateDb(db);
      if (file.path === DB_FILENAME) {
        const found = tables(db);
        if (
          found.some(t => !manifest.tables.includes(t)) ||
          manifest.tables.some(t => !found.includes(t))
        )
          throw new Error('History table manifest mismatch');
      } else {
        const version = db.prepare('SELECT version FROM durable_schema WHERE singleton=1').get() as
          | { version: number }
          | undefined;
        if (version?.version !== 1) throw new Error('Incompatible native history schema');
      }
    } finally {
      db.close();
    }
  }
  return manifest;
}

interface RestoreJournal {
  version: 1;
  rollback: string;
  stage: string;
  roots: Array<{ name: string; existed: boolean }>;
}
const JOURNAL = '.history-restore-journal.json';
/** On interruption, put all original roots back before normal startup is permitted. */
export async function recoverHistoryRestore(dataRoot: string): Promise<boolean> {
  const journalPath = join(dataRoot, JOURNAL);
  if (!(await exists(journalPath))) return false;
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RestoreJournal;
  const allowed = [
    ...ROOTS,
    'history-attachment-roots.json',
    'history-restored-native.json',
    `${DB_FILENAME}-wal`,
    `${DB_FILENAME}-shm`,
  ];
  if (
    journal.version !== 1 ||
    !journal.rollback.startsWith('.history-rollback-') ||
    !/^\.history-rollback-[a-f0-9-]+$/.test(journal.rollback) ||
    !journal.stage.startsWith('.history-restore-') ||
    !/^\.history-restore-[a-f0-9-]+$/.test(journal.stage) ||
    journal.roots.some(item => !allowed.includes(item.name))
  )
    throw new Error('Invalid restore recovery journal');
  for (const item of [...journal.roots].reverse()) {
    const original = join(dataRoot, item.name),
      saved = join(dataRoot, journal.rollback, item.name);
    if (await exists(saved)) {
      await rm(original, { recursive: true, force: true });
      await rename(saved, original);
    } else if (!item.existed) await rm(original, { recursive: true, force: true });
  }
  await rm(join(dataRoot, journal.stage), { recursive: true, force: true });
  await rm(journalPath);
  return true;
}
export async function restoreHistoryArchive(
  dataRoot: string,
  directory: string,
  options: ArchiveInventoryOptions = {},
): Promise<{ rollbackPath: string }> {
  const root = resolve(dataRoot);
  let manifest = await validateHistoryArchive(directory, options);
  if (await exists(join(root, JOURNAL))) throw new Error('Finish pending restore recovery first');
  const stageName = `.history-restore-${randomUUID()}`,
    rollbackName = `.history-rollback-${randomUUID()}`;
  const stage = join(root, stageName),
    rollback = join(root, rollbackName);
  await mkdir(stage, { recursive: true });
  const input = join(stage, 'verified-import');
  try {
    await mkdir(input);
    for (const file of manifest.files) {
      await mkdir(dirname(join(input, file.path)), { recursive: true });
      await copyFile(join(directory, file.path), join(input, file.path));
    }
    await writeFile(join(input, MANIFEST), await encodeArchiveManifest(manifest, options));
    manifest = await validateHistoryArchive(input, options);
    directory = input;
    // Restore into a copy of the current app database. Authentication/model settings never leave this machine.
    await sqliteSnapshot(join(root, DB_FILENAME), join(stage, DB_FILENAME), true);
    const db = new Database(join(stage, DB_FILENAME));
    try {
      validateDb(db, true);
      db.pragma('foreign_keys = OFF');
      const source = new Database(join(directory, DB_FILENAME), {
        readonly: true,
        fileMustExist: true,
      });
      try {
        for (const table of manifest.tables)
          if (JSON.stringify(columns(db, table)) !== JSON.stringify(columns(source, table)))
            throw new Error(`Incompatible history table: ${table}`);
      } finally {
        source.close();
      }
      db.prepare('ATTACH DATABASE ? AS history_import').run(join(directory, DB_FILENAME));
      db.transaction(() => {
        for (const table of TABLES)
          if (tables(db).includes(table)) db.prepare(`DELETE FROM main."${table}"`).run();
        for (const table of manifest.tables)
          db.exec(`INSERT INTO main."${table}" SELECT * FROM history_import."${table}"`);
      })();
      db.exec('DETACH DATABASE history_import');
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.pragma('journal_mode = DELETE');
    } finally {
      db.close();
    }
    for (const file of manifest.files) {
      if (file.path === DB_FILENAME) continue;
      await mkdir(dirname(join(stage, file.path)), { recursive: true });
      await copyFile(join(directory, file.path), join(stage, file.path));
    }
    for (const folder of ROOTS.slice(1)) await mkdir(join(stage, folder), { recursive: true });
    await writeFile(
      join(stage, 'history-attachment-roots.json'),
      JSON.stringify({ sourceRoots: manifest.attachmentSourceRoots, targetRoot: root }),
    );
    await writeFile(
      join(stage, 'history-restored-native.json'),
      await encodeArchiveManifest(
        {
          version: 1,
          files: manifest.files
            .filter(file => file.path.startsWith('durable-work/'))
            .map(file => file.path.slice('durable-work/'.length)),
        },
        options,
      ),
      { flush: true },
    );
    const roots: RestoreJournal['roots'] = [];
    for (const name of [
      ...ROOTS,
      'history-attachment-roots.json',
      'history-restored-native.json',
      `${DB_FILENAME}-wal`,
      `${DB_FILENAME}-shm`,
    ])
      roots.push({ name, existed: await exists(join(root, name)) });
    await mkdir(rollback);
    const rollbackArchive = join(rollback, 'archive');
    await createHistoryArchive(root, rollbackArchive, options, true);
    await writeFile(
      join(root, JOURNAL),
      JSON.stringify({
        version: 1,
        rollback: rollbackName,
        stage: stageName,
        roots,
      } satisfies RestoreJournal),
      { flag: 'wx', flush: true },
    );
    for (const item of roots) {
      if (item.existed) await rename(join(root, item.name), join(rollback, item.name));
      if (await exists(join(stage, item.name)))
        await rename(join(stage, item.name), join(root, item.name));
    }
    await rm(join(root, JOURNAL));
    await rm(stage, { recursive: true, force: true });
    return { rollbackPath: rollbackArchive };
  } catch (error) {
    if (await exists(join(root, JOURNAL))) await recoverHistoryRestore(root);
    else await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
