import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import {
  createHistoryArchive,
  validateHistoryArchive,
  restoreHistoryArchive,
  recoverHistoryRestore,
} from './historyArchive';
import { inventoryArchive } from './archiveFiles';
const roots: string[] = [];
const options = { workerPath: join(__dirname, 'archiveWorker.ts') };
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'history-archive-'));
  roots.push(root);
  const data = join(root, 'data');
  await mkdir(data);
  const db = new Database(join(data, 'zhiyuan.sqlite'));
  db.pragma('journal_mode=WAL');
  db.pragma('wal_autocheckpoint=0');
  db.exec(`CREATE TABLE cowork_sessions(id TEXT PRIMARY KEY,title TEXT);CREATE TABLE cowork_messages(id TEXT PRIMARY KEY,content TEXT);
 CREATE TABLE auth_tokens(secret TEXT); CREATE TABLE kv(key TEXT,value TEXT);INSERT INTO auth_tokens VALUES('SECRET-NEVER-EXPORT');INSERT INTO kv VALUES('model','private-api-key');
 INSERT INTO cowork_sessions VALUES('s','Original title');INSERT INTO cowork_messages VALUES('m','原始历史');`);
  await mkdir(join(data, 'cowork-images'));
  await writeFile(join(data, 'cowork-images', 'photo.png'), 'fixture-image');
  return { root, data, db, archive: join(root, 'backup') };
}
test('WAL snapshots export only history; worker verifies every managed attachment and excludes credentials', async () => {
  const { data, db, archive } = await fixture();
  // WAL contains committed records even though the main database has not checkpointed.
  expect((await readFile(join(data, 'zhiyuan.sqlite-wal'))).length).toBeGreaterThan(0);
  const result = await createHistoryArchive(data, archive, options);
  db.close();
  expect(result.files).toBe(2);
  const manifest = await validateHistoryArchive(archive, options);
  expect(manifest.tables.sort()).toEqual(['cowork_messages', 'cowork_sessions']);
  const copy = new Database(join(archive, 'zhiyuan.sqlite'), { readonly: true });
  expect(copy.prepare('SELECT content FROM cowork_messages').get()).toEqual({
    content: '原始历史',
  });
  copy.close();
  const bytes = await readFile(join(archive, 'zhiyuan.sqlite'));
  expect(bytes.includes(Buffer.from('SECRET-NEVER-EXPORT'))).toBe(false);
  expect(bytes.includes(Buffer.from('private-api-key'))).toBe(false);
});
test('restore preserves current authentication, stages history, and retains a recoverable original snapshot', async () => {
  const { data, db, archive } = await fixture();
  await createHistoryArchive(data, archive, options);
  db.exec(
    "UPDATE cowork_messages SET content='new';UPDATE auth_tokens SET secret='CURRENT-SECRET';",
  );
  db.close();
  const restored = await restoreHistoryArchive(data, archive, options);
  const current = new Database(join(data, 'zhiyuan.sqlite'));
  expect(current.prepare('SELECT content FROM cowork_messages').get()).toEqual({
    content: '原始历史',
  });
  expect(current.prepare('SELECT secret FROM auth_tokens').get()).toEqual({
    secret: 'CURRENT-SECRET',
  });
  current.close();
  const previous = new Database(join(restored.rollbackPath, 'zhiyuan.sqlite'));
  expect(previous.prepare('SELECT content FROM cowork_messages').get()).toEqual({ content: 'new' });
  previous.close();
  expect(await readFile(join(data, 'cowork-images', 'photo.png'), 'utf8')).toBe('fixture-image');
  expect((await readdir(data)).includes('.history-restore-journal.json')).toBe(false);
});
test('corrupt or traversal archives leave original database and attachments untouched', async () => {
  const { data, db, archive } = await fixture();
  await createHistoryArchive(data, archive, options);
  db.close();
  const before = await readFile(join(data, 'zhiyuan.sqlite'));
  await writeFile(join(archive, 'cowork-images', 'photo.png'), 'tampered');
  await expect(restoreHistoryArchive(data, archive, options)).rejects.toThrow('checksum');
  expect(await readFile(join(data, 'zhiyuan.sqlite'))).toEqual(before);
  const path = join(archive, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.files[0].path = '../outside';
  await writeFile(path, JSON.stringify(manifest));
  await expect(validateHistoryArchive(archive, options)).rejects.toThrow('Unsafe');
  expect(await readFile(join(data, 'zhiyuan.sqlite'))).toEqual(before);
});
test('inventory rejects symlink attachments', async () => {
  const { data, db } = await fixture();
  db.close();
  await symlink(join(data, 'zhiyuan.sqlite'), join(data, 'cowork-images', 'link'));
  await expect(inventoryArchive(data, ['cowork-images'], options)).rejects.toThrow('symbolic');
});
test('interrupted multi-root swap rolls original roots back before startup', async () => {
  const { data, db } = await fixture();
  db.close();
  const rollback = '.history-rollback-abcd';
  const stage = '.history-restore-abcd';
  await mkdir(join(data, rollback));
  await mkdir(join(data, stage));
  const { rename } = await import('node:fs/promises');
  await rename(join(data, 'zhiyuan.sqlite'), join(data, rollback, 'zhiyuan.sqlite'));
  await writeFile(join(data, 'zhiyuan.sqlite'), 'partial-new-file');
  await writeFile(
    join(data, '.history-restore-journal.json'),
    JSON.stringify({
      version: 1,
      rollback,
      stage,
      roots: [
        { name: 'zhiyuan.sqlite', existed: true },
        { name: 'cowork-images', existed: true },
      ],
    }),
  );
  expect(await recoverHistoryRestore(data)).toBe(true);
  const original = new Database(join(data, 'zhiyuan.sqlite'));
  expect(original.prepare('SELECT content FROM cowork_messages').get()).toEqual({
    content: '原始历史',
  });
  original.close();
  expect(await readFile(join(data, 'cowork-images', 'photo.png'), 'utf8')).toBe('fixture-image');
});

test('native SQLite checkpoints and pre-reset entries survive archive without running model work', async () => {
  const { data, db, archive } = await fixture();
  db.close();
  const { createHash } = await import('node:crypto');
  const { Harness, createRegistry } = await import('@earendil-works/pi-durable');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
  await mkdir(join(data, 'durable-work'));
  const file = `${createHash('sha256').update('session').digest('hex')}.sqlite`;
  const harness = await Harness.open(
    await openNodeSqliteStorage(join(data, 'durable-work', file)),
    { models: {} as never, registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  const conversation = await harness.root(BACKGROUND_CONTEXT);
  const entry = await conversation.commit(
    tx =>
      tx.appendEntry(conversation.id, { kind: 'history.fixture', data: { value: 'checkpoint' } }),
    BACKGROUND_CONTEXT,
  );
  await harness.close(BACKGROUND_CONTEXT);
  await createHistoryArchive(data, archive, options);
  expect(
    (await validateHistoryArchive(archive, options)).files.some(
      x => x.path === `durable-work/${file}`,
    ),
  ).toBe(true);
  await restoreHistoryArchive(data, archive, options);
  const restored = await openNodeSqliteStorage(join(data, 'durable-work', file));
  expect((await restored.entry(entry.id, BACKGROUND_CONTEXT))?.entry.data).toEqual({
    value: 'checkpoint',
  });
  await restored.close(BACKGROUND_CONTEXT);
});
test('incompatible table schema refuses restore before replacing any root', async () => {
  const { data, db, archive } = await fixture();
  await createHistoryArchive(data, archive, options);
  db.exec('ALTER TABLE cowork_messages ADD COLUMN added TEXT');
  db.close();
  const before = await readFile(join(data, 'zhiyuan.sqlite'));
  await expect(restoreHistoryArchive(data, archive, options)).rejects.toThrow('Incompatible');
  expect(await readFile(join(data, 'zhiyuan.sqlite'))).toEqual(before);
});

test('exported files contain neither current credential sentinels nor deleted-page remnants', async () => {
  const { data, db, archive } = await fixture();
  db.pragma('secure_delete=OFF');
  db.exec(
    "CREATE TABLE history_index_revisions(source TEXT,id TEXT,revision INTEGER);CREATE TRIGGER history_revision_test AFTER INSERT ON cowork_messages BEGIN INSERT INTO history_index_revisions VALUES('cowork',NEW.id,1); END;",
  );
  db.prepare('INSERT INTO auth_tokens VALUES(?)').run('DELETED-CREDENTIAL-SENTINEL-'.repeat(500));
  db.exec("DELETE FROM auth_tokens WHERE secret LIKE 'DELETED-%'");
  const result = await createHistoryArchive(data, archive, options);
  db.close();
  const manifest = await validateHistoryArchive(result.path, options);
  for (const file of manifest.files) {
    const bytes = await readFile(join(archive, file.path));
    expect(bytes.includes(Buffer.from('DELETED-CREDENTIAL-SENTINEL'))).toBe(false);
    expect(bytes.includes(Buffer.from('SECRET-NEVER-EXPORT'))).toBe(false);
    expect(bytes.includes(Buffer.from('private-api-key'))).toBe(false);
  }
  expect((await readdir(data)).some(name => name.startsWith('.history-export-'))).toBe(false);
  expect(
    (await readdir(archive)).some(name => name.endsWith('-wal') || name.endsWith('-shm')),
  ).toBe(false);
});

test('successful restore returns a verified rollback archive that the same restore flow can select', async () => {
  const { data, db, archive } = await fixture();
  await createHistoryArchive(data, archive, options);
  db.exec("UPDATE cowork_messages SET content='later history'");
  db.close();
  const result = await restoreHistoryArchive(data, archive, options);
  await validateHistoryArchive(result.rollbackPath, options);
  await restoreHistoryArchive(data, result.rollbackPath, options);
  const back = new Database(join(data, 'zhiyuan.sqlite'));
  expect(back.prepare('SELECT content FROM cowork_messages').get()).toEqual({
    content: 'later history',
  });
  back.close();
});

test('restored native sessions remain excluded from automatic resume across startups; fresh session ids are unaffected', async () => {
  const { data, db, archive } = await fixture();
  db.close();
  const { createHash } = await import('node:crypto');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
  const { loadRestoredNativeGuard } = await import('./restoredNativeGuard');
  expect((await loadRestoredNativeGuard(data, options)).has('scheduled-run:r1')).toBe(false);
  await mkdir(join(data, 'durable-work'));
  const file = `${createHash('sha256').update('scheduled-run:r1').digest('hex')}.sqlite`;
  const storage = await openNodeSqliteStorage(join(data, 'durable-work', file));
  await storage.close(BACKGROUND_CONTEXT);
  await createHistoryArchive(data, archive, options);
  await restoreHistoryArchive(data, archive, options);
  const firstStart = await loadRestoredNativeGuard(data, options);
  expect(firstStart.has('scheduled-run:r1')).toBe(true);
  expect(firstStart.has('scheduled-run:new')).toBe(false);
  const secondStart = await loadRestoredNativeGuard(data, options);
  expect(secondStart.has('scheduled-run:r1')).toBe(true);
});
