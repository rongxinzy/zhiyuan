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

/** Disposable text index. No model context, task checkpoint, permissions or live state are stored here. */
export class HistoryIndex {
  private refreshing?: Promise<{ indexedAt: number; conversations: number }>;
  private indexedAt = 0;
  private dirty = true;
  private sourceVersion = '';
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
    db.exec(`CREATE TABLE IF NOT EXISTS history_index_catalog (
      conversation_key TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
      title TEXT NOT NULL, generation TEXT NOT NULL, updated_at INTEGER NOT NULL,
      room_id TEXT, lane_id TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS history_search USING fts5(
      content, conversation_key UNINDEXED, message_id UNINDEXED, entry_id UNINDEXED,
      timestamp UNINDEXED, generation UNINDEXED, tokenize='trigram'
    );`);
  }
  invalidate(): void {
    this.dirty = true;
  }
  /** Restart/rebuild reconstructs all text from the existing authorities, not from the previous index. */
  rebuild(): Promise<{ indexedAt: number; conversations: number }> {
    if (this.refreshing) return this.refreshing;
    this.dirty = false;
    const pending = this.build();
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
  private async build(): Promise<{ indexedAt: number; conversations: number }> {
    const generation = randomUUID();
    const sourceVersion = this.version();
    const catalog: HistoryConversation[] = [];
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
          catalog.push(conversation);
          let cursor: string | undefined;
          do {
            const entries = await this.reader.readPage({
              locator: conversation.locator,
              limit: 100,
              cursor,
            });
            writePage(conversation, entries.items);
            cursor = entries.nextCursor;
            await yieldTurn();
          } while (cursor);
        }
        listCursor = page.nextCursor;
      } while (listCursor);
      const publish = this.db.transaction(() => {
        this.db.prepare('DELETE FROM history_index_catalog').run();
        const add = this.db.prepare('INSERT INTO history_index_catalog VALUES (?,?,?,?,?,?,?,?)');
        for (const item of catalog)
          add.run(
            locatorKey(item.locator),
            item.locator.source,
            item.locator.id,
            item.title,
            generation,
            item.updatedAt,
            item.openTarget?.roomId ?? null,
            item.openTarget?.laneId ?? null,
          );
        this.db.prepare('DELETE FROM history_search WHERE generation <> ?').run(generation);
      });
      publish();
      this.indexedAt = Date.now();
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
      await this.rebuild();
    else if (this.refreshing) await this.refreshing;
    const scope = `search:${query}`;
    const cursor = decodeCursor<{ timestamp: number; rowid: number; generation: string }>(
      scope,
      request.cursor,
    );
    const current = this.db
      .prepare('SELECT generation FROM history_index_catalog LIMIT 1')
      .get() as { generation: string } | undefined;
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
