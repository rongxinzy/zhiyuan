import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';
import { HistoryReader, type NativeHistoryReader } from './historyReader';
import { HistoryIndex } from './historyIndex';
import { initializeCodingAgentSchema } from '../codingAgent/schema';
import { registerHistoryIpc } from './registerHistoryIpc';
import { HistoryIpc } from '../../shared/history';
const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture(
  native: NativeHistoryReader = {
    historyExists: async () => false,
    readHistory: async () => ({ items: [] }),
  },
) {
  const db = new Database(':memory:');
  databases.push(db);
  initializeCodingAgentSchema(db);
  db.exec(`CREATE TABLE cowork_sessions(id TEXT PRIMARY KEY,title TEXT,cwd TEXT,updated_at INTEGER);
    CREATE TABLE cowork_messages(id TEXT PRIMARY KEY,session_id TEXT,type TEXT,content TEXT,metadata TEXT,created_at INTEGER,sequence INTEGER);
    INSERT INTO cowork_sessions VALUES('old','旧会话','/workspace',100);
    INSERT INTO cowork_messages VALUES('m1','old','user','你好世界，测试中文搜索',NULL,1,1),('m2','old','assistant','第二条消息',NULL,2,2),('m3','old','assistant','第三条消息',NULL,3,3);
    INSERT INTO coding_rooms(id,workspace_root,created_at,updated_at) VALUES('r','/coding',1,1);
    INSERT INTO coding_missions(id,room_id,title,goal,status,created_at,updated_at) VALUES('mission','r','Coding task','','idle',1,100);
    INSERT INTO coding_agent_lanes(id,mission_id,profile_id,local_session_id,status,created_at,updated_at) VALUES('lane','mission','external','local','idle',1,100);
    INSERT INTO coding_events VALUES('e1','lane',1,'message','{"role":"user","content":"中文搜索 coding"}',5),('e2','lane',2,'message_delta','{"content":"修复历史记录"}',6);`);
  const indexDb = new Database(':memory:');
  databases.push(indexDb);
  const reader = new HistoryReader(db, native);
  const index = new HistoryIndex(indexDb, reader);
  return { db, indexDb, reader, index };
}
test('catalog keyset ties are stable, sources remain distinct, pages and anchors are scoped', async () => {
  const { reader } = fixture();
  const first = await reader.list({ limit: 1 });
  expect(first.items[0].locator.source).toBe('coding');
  const second = await reader.list({ limit: 1, cursor: first.nextCursor });
  expect(second.items[0].backend).toBe('legacy');
  const page = await reader.readPage({ locator: { source: 'cowork', id: 'old' }, limit: 2 });
  expect(page.items.map(x => x.id)).toEqual(['m2', 'm3']);
  const older = await reader.readPage({
    locator: { source: 'cowork', id: 'old' },
    limit: 2,
    cursor: page.nextCursor,
  });
  expect(older.items.map(x => x.id)).toEqual(['m1']);
  await expect(
    reader.readPage({ locator: { source: 'coding', id: 'lane' }, cursor: page.nextCursor }),
  ).rejects.toThrow('foreign');
  const anchored = await reader.readPage({
    locator: { source: 'cowork', id: 'old' },
    anchor: 'm2',
    limit: 1,
  });
  expect(anchored.items[0].id).toBe('m2');
  expect((await reader.get({ source: 'coding', id: 'lane' })).openTarget).toEqual({
    roomId: 'r',
    laneId: 'lane',
  });
});
test('real FTS5 finds two and three Chinese characters and literal punctuation; rebuild uses source changes', async () => {
  const { reader, index, db, indexDb } = fixture();
  expect((await index.search({ query: '中文' })).items).toHaveLength(2);
  expect((await index.search({ query: '中文搜' })).items).toHaveLength(2);
  const first = await index.search({ query: '中文', limit: 1 });
  expect(first.nextCursor).toBeTruthy();
  expect(
    (await index.search({ query: '中文', limit: 1, cursor: first.nextCursor })).items,
  ).toHaveLength(1);
  db.prepare('UPDATE cowork_messages SET content=? WHERE id=?').run('完全不同的内容', 'm1');
  index.invalidate();
  expect((await index.search({ query: '中文' })).items).toHaveLength(1);
  await expect(index.search({ query: '中文', cursor: first.nextCursor })).rejects.toThrow(
    'changed',
  );
  indexDb.exec('DELETE FROM history_search; DELETE FROM history_index_catalog');
  await index.rebuild();
  expect((await index.search({ query: '不同' })).items[0].messageId).toBe('m1');
  expect((await reader.readPage({ locator: { source: 'cowork', id: 'old' } })).items).toHaveLength(
    3,
  );
  expect((await index.search({ query: '" OR' })).items).toHaveLength(0);
});
test('failed rebuild retains the last complete index and discards partial generation', async () => {
  const { index, reader, indexDb } = fixture();
  await index.rebuild();
  const spy = vi.spyOn(reader, 'readPage').mockRejectedValueOnce(new Error('read failure'));
  await expect(index.rebuild()).rejects.toThrow('read failure');
  spy.mockRestore();
  expect(
    indexDb.prepare('SELECT COUNT(DISTINCT generation) AS n FROM history_search').get(),
  ).toEqual({ n: 1 });
  expect(indexDb.prepare('SELECT COUNT(*) AS n FROM history_index_catalog').get()).toEqual({
    n: 2,
  });
});
test('IPC enforces trusted sender before every operation and reports malformed inputs', async () => {
  const { db, indexDb } = fixture();
  const handlers = new Map<string, Function>();
  const service = registerHistoryIpc({
    db,
    indexDb,
    native: { historyExists: async () => false, readHistory: async () => ({ items: [] }) },
    ipcMain: {
      handle: (name, fn) => {
        handlers.set(name, fn);
      },
      removeHandler: name => {
        handlers.delete(name);
      },
    },
    assertTrustedSender: event => {
      if (!event) throw new Error('Untrusted sender');
    },
  });
  expect(await handlers.get(HistoryIpc.List)!(undefined, {})).toEqual({
    success: false,
    error: 'Untrusted sender',
  });
  expect((await handlers.get(HistoryIpc.List)!({}, { limit: 100000 })).success).toBe(false);
  expect((await handlers.get(HistoryIpc.ReadPage)!({}, null)).success).toBe(false);
  await service.dispose();
  expect(handlers.size).toBe(0);
});
