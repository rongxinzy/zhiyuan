import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type {
  HistoryConversation,
  HistoryMessage,
  HistorySearchPage,
  HistorySearchRequest,
} from '../../shared/history';
import { decodeCursor, encodeCursor, locatorKey, pageLimit } from './cursor';
import { HistoryReader } from './historyReader';
import { installHistoryRevisions, historyRevision } from './historyRevisions';

/** Disposable text index. No model context, task checkpoint, permissions or live state are stored here. */
export class HistoryIndex {
  private refreshing?: Promise<{ indexedAt: number; conversations: number }>;
  private indexedAt = 0;
  private dirty = true;
  private sourceVersion = '';
  private indexRevision = randomUUID();
  private version(): string {
    const row = this.reader.db.prepare('SELECT total_changes() AS changes').get() as {
      changes: number;
    };
    return `${row.changes}:${this.reader.db.pragma('data_version', { simple: true })}`;
  }
  constructor(
    private readonly db: Database.Database,
    private readonly reader: HistoryReader,
  ) {
    installHistoryRevisions(reader.db);
    db.exec(`CREATE TABLE IF NOT EXISTS history_index_catalog (
      conversation_key TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
      title TEXT NOT NULL, generation TEXT NOT NULL, updated_at INTEGER NOT NULL,
      room_id TEXT, lane_id TEXT, revision INTEGER NOT NULL DEFAULT -1, native_marker TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS history_search USING fts5(
      content, conversation_key UNINDEXED, message_id UNINDEXED, entry_id UNINDEXED,
      timestamp UNINDEXED, generation UNINDEXED, tokenize='trigram'
    );`);
    const fields = db.pragma('table_info(history_index_catalog)') as { name: string }[];
    if (!fields.some(f => f.name === 'revision'))
      db.exec('ALTER TABLE history_index_catalog ADD COLUMN revision INTEGER NOT NULL DEFAULT -1');
    if (!fields.some(f => f.name === 'native_marker'))
      db.exec('ALTER TABLE history_index_catalog ADD COLUMN native_marker TEXT');
  }
  invalidate(): void {
    this.dirty = true;
  }
  /** Restart/rebuild reconstructs all text from the existing authorities, not from the previous index. */
  rebuild(force = true): Promise<{ indexedAt: number; conversations: number }> {
    if (this.refreshing) return this.refreshing;
    this.dirty = false;
    const pending = this.build(force);
    this.refreshing = pending;
    void pending.then(
      () => {
        this.refreshing = undefined;
      },
      () => {
        this.refreshing = undefined;
        this.dirty = true;
      },
    );
    return pending;
  }
  private async build(force: boolean): Promise<{ indexedAt: number; conversations: number }> {
    const generation = randomUUID();
    const sourceVersion = this.version();
    const catalog: Array<{
      conversation: HistoryConversation;
      generation: string;
      revision: number;
      marker: string | null;
    }> = [];
    const lookup = this.db.prepare(
      'SELECT generation,revision,native_marker FROM history_index_catalog WHERE conversation_key=?',
    );
    let listCursor: string | undefined;
    const insert = this.db.prepare(
      'INSERT INTO history_search(content,conversation_key,message_id,entry_id,timestamp,generation) VALUES (?,?,?,?,?,?)',
    );
    const writePage = this.db.transaction(
      (conversation: HistoryConversation, messages: HistoryMessage[]) => {
        for (const message of messages) {
          if (!message.content.trim() || message.metadata?.isThinking) continue;
          insert.run(
            message.content,
            locatorKey(conversation.locator),
            message.id,
            message.entryId,
            message.timestamp,
            generation,
          );
        }
      },
    );
    try {
      do {
        const page = await this.reader.list({ limit: 100, cursor: listCursor });
        for (const conversation of page.items) {
          const key = locatorKey(conversation.locator);
          const revision = historyRevision(this.reader.db, conversation.locator);
          const previous = lookup.get(key) as
            | { generation: string; revision: number; native_marker: string | null }
            | undefined;
          let marker = previous?.native_marker ?? null;
          const native = conversation.backend === 'pi';
          // On the first search after restart, reconcile native heads even if the app-side invalidation was lost.
          if (native && (force || !this.indexedAt || !previous || previous.revision !== revision)) {
            const head = await this.reader.native.readHistory(conversation.locator.id, 1);
            marker = String(head.items[0]?.id ?? 0);
          }
          const unchanged =
            !force &&
            previous &&
            (native ? marker === previous.native_marker : revision === previous.revision);
          catalog.push({
            conversation,
            generation: unchanged ? previous.generation : generation,
            revision,
            marker,
          });
          if (unchanged) continue;
          const appendFrom =
            native &&
            !force &&
            previous?.native_marker &&
            Number(marker) > Number(previous.native_marker)
              ? Number(previous.native_marker)
              : undefined;
          if (appendFrom !== undefined) {
            this.db
              .prepare(
                'INSERT INTO history_search(content,conversation_key,message_id,entry_id,timestamp,generation) SELECT content,conversation_key,message_id,entry_id,timestamp,? FROM history_search WHERE conversation_key=? AND generation=?',
              )
              .run(generation, key, previous!.generation);
          }
          let cursor: string | undefined;
          do {
            const entries = await this.reader.readIndexPage({
              locator: conversation.locator,
              limit: 100,
              cursor,
              ...(native && !cursor && Number(marker) > 0 ? { anchor: marker! } : {}),
            });
            writePage(
              conversation,
              appendFrom === undefined
                ? entries.items
                : entries.items.filter(item => Number(item.entryId) > appendFrom),
            );
            cursor =
              appendFrom !== undefined &&
              entries.items.some(item => Number(item.entryId) <= appendFrom)
                ? undefined
                : entries.nextCursor;
            await yieldTurn();
          } while (cursor);
        }
        listCursor = page.nextCursor;
      } while (listCursor);
      const publish = this.db.transaction(() => {
        this.db.prepare('DELETE FROM history_index_catalog').run();
        const add = this.db.prepare(
          'INSERT INTO history_index_catalog VALUES (?,?,?,?,?,?,?,?,?,?)',
        );
        for (const record of catalog) {
          const item = record.conversation;
          add.run(
            locatorKey(item.locator),
            item.locator.source,
            item.locator.id,
            item.title,
            record.generation,
            item.updatedAt,
            item.openTarget?.roomId ?? null,
            item.openTarget?.laneId ?? null,
            record.revision,
            record.marker,
          );
        }
        this.db
          .prepare(
            'DELETE FROM history_search WHERE NOT EXISTS (SELECT 1 FROM history_index_catalog c WHERE c.conversation_key=history_search.conversation_key AND c.generation=history_search.generation)',
          )
          .run();
      });
      publish();
      this.indexedAt = Date.now();
      this.indexRevision = randomUUID();
      this.sourceVersion = sourceVersion;
      return { indexedAt: this.indexedAt, conversations: catalog.length };
    } catch (error) {
      this.db.prepare('DELETE FROM history_search WHERE generation = ?').run(generation);
      throw error;
    }
  }
  async search(request: HistorySearchRequest): Promise<HistorySearchPage> {
    const limit = pageLimit(request.limit);
    if (
      typeof request.query !== 'string' ||
      request.query.trim().length < 2 ||
      request.query.length > 256
    )
      throw new Error('Search requires 2–256 characters');
    const query = request.query.trim();
    if (!request.cursor && (this.dirty || !this.indexedAt || this.sourceVersion !== this.version()))
      await this.rebuild(false);
    else if (this.refreshing) await this.refreshing;
    const scope = `search:${query}`;
    const cursor = decodeCursor<{ timestamp: number; rowid: number; generation: string }>(
      scope,
      request.cursor,
    );
    const current = { generation: this.indexRevision };
    if (
      cursor &&
      (!Number.isFinite(cursor.timestamp) ||
        !Number.isSafeInteger(cursor.rowid) ||
        cursor.generation !== current?.generation)
    )
      throw new Error('History index changed; restart the search');
    // Trigram MATCH handles >=3 Unicode characters. Two-character Chinese terms use an exact substring fallback.
    const trigram = [...query].length >= 3;
    const match = trigram ? 'history_search MATCH ?' : 'instr(lower(s.content),lower(?)) > 0';
    const needle = trigram ? `"${query.replaceAll('"', '""')}"` : query;
    const bound = cursor
      ? ' AND (CAST(s.timestamp AS INTEGER) < ? OR (CAST(s.timestamp AS INTEGER)=? AND s.rowid < ?))'
      : '';
    const values: (string | number)[] = [needle];
    if (cursor) values.push(cursor.timestamp, cursor.timestamp, cursor.rowid);
    values.push(limit + 1);
    const rows = this.db
      .prepare(`SELECT s.rowid,s.content,s.entry_id,s.message_id,CAST(s.timestamp AS INTEGER) AS timestamp,c.*
      FROM history_search s JOIN history_index_catalog c ON c.conversation_key=s.conversation_key AND c.generation=s.generation
      WHERE ${match}${bound} ORDER BY CAST(s.timestamp AS INTEGER) DESC,s.rowid DESC LIMIT ?`)
      .all(...values) as Array<Record<string, unknown>>;
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    return {
      items: selected.map(row => ({
        locator: { source: row.source as 'cowork' | 'coding', id: String(row.source_id) },
        title: String(row.title),
        entryId: String(row.entry_id),
        messageId: String(row.message_id),
        content: searchExcerpt(String(row.content), query),
        timestamp: Number(row.timestamp),
        ...(row.room_id
          ? { openTarget: { roomId: String(row.room_id), laneId: String(row.lane_id) } }
          : {}),
      })),
      indexedAt: this.indexedAt,
      ...(rows.length > limit && last
        ? {
            nextCursor: encodeCursor(scope, {
              timestamp: last.timestamp,
              rowid: last.rowid,
              generation: current?.generation,
            }),
          }
        : {}),
    };
  }
}

function searchExcerpt(content: string, query: string): string {
  const match = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, match - 120);
  const end = Math.min(content.length, start + 800);
  return `${start ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}
