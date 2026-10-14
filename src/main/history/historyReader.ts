import type Database from 'better-sqlite3';
import type { Cursor, EntryId, EntryRecord, Page } from '@earendil-works/pi-durable';
import type {
  HistoryConversation,
  HistoryListRequest,
  HistoryLocator,
  HistoryMessage,
  HistoryPage,
  HistoryReadRequest,
} from '../../shared/history';
import {
  historyMetadata,
  boundHistoryPreview,
  HISTORY_METADATA_CHARS,
  HISTORY_PREVIEW_CHARS,
} from './historyPreview';
import { relocateHistoryAttachments } from './managedAttachments';
import { projectDurableEntry } from '../libs/agentEngine/durable/messageProjection';
import { decodeCursor, encodeCursor, locatorKey, pageLimit } from './cursor';

export interface NativeHistoryReader {
  historyExists(id: string): Promise<boolean>;
  readHistory(
    id: string,
    limit: number,
    cursor?: Cursor,
    anchor?: EntryId,
  ): Promise<Page<EntryRecord, Cursor>>;
}
interface DirectoryRow {
  source: 'cowork' | 'coding';
  id: string;
  title: string;
  workspace: string;
  updated_at: number;
  room_id?: string;
}
const DIRECTORY = `SELECT 'cowork' AS source, id, title, cwd AS workspace, updated_at, NULL AS room_id FROM cowork_sessions
 UNION ALL SELECT 'coding', l.id, m.title, r.workspace_root, MAX(l.updated_at,m.updated_at), r.id
 FROM coding_agent_lanes l JOIN coding_missions m ON m.id=l.mission_id JOIN coding_rooms r ON r.id=m.room_id`;
function messageType(value: unknown): HistoryMessage['type'] {
  return ['user', 'assistant', 'tool_use', 'tool_result', 'system'].includes(String(value))
    ? (value as HistoryMessage['type'])
    : 'system';
}
/** One read facade over existing sources. Does not persist a second transcript or schedule an agent. */
export class HistoryReader {
  constructor(
    readonly db: Database.Database,
    readonly native: NativeHistoryReader,
    private readonly dataRoot?: string,
  ) {}
  private async describe(row: DirectoryRow): Promise<HistoryConversation> {
    const backend =
      row.source === 'coding'
        ? 'coding'
        : (await this.native.historyExists(row.id))
          ? 'pi'
          : 'legacy';
    return {
      locator: { source: row.source, id: row.id },
      title: row.title,
      workspace: row.workspace,
      updatedAt: row.updated_at,
      backend,
      readOnly: backend === 'legacy',
      ...(row.room_id ? { openTarget: { roomId: row.room_id, laneId: row.id } } : {}),
    };
  }
  async get(locator: HistoryLocator): Promise<HistoryConversation> {
    locatorKey(locator);
    const row = this.db
      .prepare(`SELECT * FROM (${DIRECTORY}) WHERE source=? AND id=?`)
      .get(locator.source, locator.id) as DirectoryRow | undefined;
    if (!row) throw new Error('History conversation no longer exists');
    return this.describe(row);
  }
  async list(request: HistoryListRequest = {}): Promise<HistoryPage<HistoryConversation>> {
    const limit = pageLimit(request.limit);
    if (
      request.workspace !== undefined &&
      (typeof request.workspace !== 'string' || request.workspace.length > 4096)
    )
      throw new Error('Invalid workspace filter');
    const scope = `list:${request.workspace ?? ''}`;
    const cursor = decodeCursor<{ time: number; source: string; id: string }>(
      scope,
      request.cursor,
    );
    if (
      cursor &&
      (!Number.isFinite(cursor.time) ||
        !['cowork', 'coding'].includes(cursor.source) ||
        typeof cursor.id !== 'string')
    )
      throw new Error('Invalid history cursor');
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (request.workspace !== undefined) {
      clauses.push('workspace = ?');
      values.push(request.workspace);
    }
    if (cursor) {
      clauses.push(
        '(updated_at < ? OR (updated_at = ? AND (source > ? OR (source = ? AND id > ?))))',
      );
      values.push(cursor.time, cursor.time, cursor.source, cursor.source, cursor.id);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM (${DIRECTORY}) ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC, source ASC, id ASC LIMIT ?`,
      )
      .all(...values, limit + 1) as DirectoryRow[];
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    return {
      items: await Promise.all(selected.map(row => this.describe(row))),
      ...(rows.length > limit && last
        ? {
            nextCursor: encodeCursor(scope, {
              time: last.updated_at,
              source: last.source,
              id: last.id,
            }),
          }
        : {}),
    };
  }
  private async attachments(items: HistoryMessage[], forIndex = false): Promise<HistoryMessage[]> {
    if (!forIndex) items = boundHistoryPreview(items);
    if (!this.dataRoot) return items;
    return Promise.all(
      items.map(async item => ({
        ...item,
        metadata: await relocateHistoryAttachments(this.dataRoot!, item.metadata),
      })),
    );
  }
  readIndexPage(request: HistoryReadRequest): Promise<HistoryPage<HistoryMessage>> {
    return this.readPage(request, true);
  }
  async readPage(
    request: HistoryReadRequest,
    forIndex = false,
  ): Promise<HistoryPage<HistoryMessage>> {
    const key = locatorKey(request.locator);
    const limit = pageLimit(request.limit);
    if (
      request.anchor !== undefined &&
      (typeof request.anchor !== 'string' ||
        request.anchor.length > 256 ||
        request.cursor !== undefined)
    )
      throw new Error('Invalid history anchor');
    const descriptor = await this.get(request.locator);
    const scope = `entries:${key}:${descriptor.backend}`;
    if (descriptor.backend === 'pi') {
      const cursor = decodeCursor<Cursor>(scope, request.cursor);
      const anchor = request.anchor === undefined ? undefined : Number(request.anchor);
      if (anchor !== undefined && (!Number.isSafeInteger(anchor) || anchor < 1))
        throw new Error('Invalid native entry anchor');
      const page = await this.native.readHistory(
        request.locator.id,
        limit,
        cursor,
        anchor as EntryId | undefined,
      );
      const items = [...page.items].reverse().flatMap(entry =>
        projectDurableEntry(request.locator.id, entry).map(message => ({
          ...message,
          entryId: String(entry.id),
          type: messageType(message.type),
        })),
      );
      return { items, ...(page.next ? { nextCursor: encodeCursor(scope, page.next) } : {}) };
    }
    const cursor = decodeCursor<{ sequence: number; id: string }>(scope, request.cursor);
    if (cursor && (!Number.isFinite(cursor.sequence) || typeof cursor.id !== 'string'))
      throw new Error('Invalid history cursor');
    const coding = descriptor.backend === 'coding';
    const table = coding ? 'coding_events' : 'cowork_messages';
    const owner = coding ? 'lane_id' : 'session_id';
    const seq = 'COALESCE(sequence,created_at)';
    const values: (string | number)[] = [request.locator.id];
    let bound = '';
    if (cursor) {
      bound = ` AND (${seq} < ? OR (${seq} = ? AND id < ?))`;
      values.push(cursor.sequence, cursor.sequence, cursor.id);
    }
    if (request.anchor !== undefined) {
      const anchor = this.db
        .prepare(`SELECT ${seq} AS seq FROM ${table} WHERE ${owner}=? AND id=?`)
        .get(request.locator.id, request.anchor) as { seq: number } | undefined;
      if (!anchor) throw new Error('History search result no longer exists');
      bound = ` AND (${seq} < ? OR (${seq} = ? AND id <= ?))`;
      values.push(anchor.seq, anchor.seq, request.anchor);
    }
    const rows = this.db
      .prepare(
        `SELECT id,created_at,${seq} AS sort_sequence, ${
          coding
            ? `kind, substr(payload_json,1,${HISTORY_METADATA_CHARS + 1}) AS payload_json, json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.role') AS history_role, ${forIndex ? "COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.content'),json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.text'),json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.error'),'')" : `substr(COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.content'),json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.text'),json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.error'),''),1,${HISTORY_PREVIEW_CHARS + 1})`} AS history_content`
            : `type,${forIndex ? 'content' : `substr(content,1,${HISTORY_PREVIEW_CHARS + 1}) AS content`},substr(metadata,1,${HISTORY_METADATA_CHARS + 1}) AS metadata`
        }
        FROM ${table} WHERE ${owner}=?${bound} ORDER BY ${seq} DESC,id DESC LIMIT ?`,
      )
      .all(...values, limit + 1) as Record<string, unknown>[];
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    const items = selected.reverse().map(row => {
      const payload = historyMetadata(row.payload_json);
      const metadata = coding ? payload : historyMetadata(row.metadata);
      // External ACP stores its own committed event payloads; no attempt to reinterpret them as Pi checkpoints.
      const kind = String(row.kind ?? '');
      const type = coding
        ? kind === 'tool_call'
          ? 'tool_use'
          : kind === 'reasoning'
            ? 'assistant'
            : messageType(
                row.history_role ??
                  (['message_delta', 'message'].includes(kind) ? 'assistant' : 'system'),
              )
        : messageType(row.type);
      const content = coding ? String(row.history_content ?? '') : String(row.content ?? '');
      return {
        id: String(row.id),
        entryId: String(row.id),
        type,
        content,
        timestamp: Number(row.created_at),
        metadata: {
          ...metadata,
          ...(kind === 'reasoning' ? { isThinking: true } : {}),
          ...(coding ? { eventKind: kind } : {}),
        },
      };
    });
    return {
      items: await this.attachments(items, forIndex),
      ...(rows.length > limit && last
        ? { nextCursor: encodeCursor(scope, { sequence: last.sort_sequence, id: last.id }) }
        : {}),
    };
  }
}
