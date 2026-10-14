import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { projectDurableWork } from './snapshot';
import type {
  AgentChange,
  Conversation,
  Harness,
  HarnessOptions,
  Cursor,
  EntryId,
  EntryRecord,
  Page,
} from '@earendil-works/pi-durable';

export interface DurableSession {
  readonly sessionId: string;
  readonly harness: Harness;
  readonly conversation: Conversation;
}

// Storage has no cross-process lock. The Electron main process is its sole owner.
// Sharing this map also prevents two owner instances opening the same database.
const owners = new Map<string, Promise<DurableSession>>();
const historyReaders = new Map<string, Promise<unknown>>();

/** Owns native persistence only; Pi remains responsible for execution and checkpoints. */
export class DurableSessionOwner {
  private readonly sessions = new Map<string, Promise<DurableSession>>();
  private closing: Promise<void> | undefined;
  private readonly reads = new Set<Promise<unknown>>();

  constructor(
    private readonly directory: string,
    private readonly options: (sessionId: string) => Promise<HarnessOptions>,
  ) {}

  private databasePath(sessionId: string): string {
    const filename = `${createHash('sha256').update(sessionId).digest('hex')}.sqlite`;
    return resolve(join(this.directory, filename));
  }

  async exists(sessionId: string): Promise<boolean> {
    if (this.sessions.has(sessionId)) return true;
    try {
      await access(this.databasePath(sessionId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async inspect(sessionId: string) {
    if (!(await this.exists(sessionId))) return undefined;
    const session = await this.open(sessionId);
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const watch = await session.conversation.watch(BACKGROUND_CONTEXT);
    try {
      return projectDurableWork(
        sessionId,
        await session.harness.inspect(BACKGROUND_CONTEXT),
        watch.value,
      );
    } finally {
      await watch.stop();
    }
  }

  /** Opening, inspecting and watching do not start the native scheduler. */
  open(sessionId: string, agent?: AgentChange): Promise<DurableSession> {
    if (!sessionId.trim()) return Promise.reject(new Error('A session ID is required.'));
    if (this.closing) return Promise.reject(new Error('Durable sessions are closing.'));
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const path = this.databasePath(sessionId);
    const reading = historyReaders.get(path);
    if (reading) return reading.then(() => this.open(sessionId, agent));
    if (owners.has(path)) {
      return Promise.reject(new Error('This durable session already has an owner.'));
    }
    const pending = this.openStorage(sessionId, path, agent);
    this.sessions.set(sessionId, pending);
    owners.set(path, pending);
    void pending.catch(() => {
      if (this.sessions.get(sessionId) === pending) this.sessions.delete(sessionId);
      if (owners.get(path) === pending) owners.delete(path);
    });
    return pending;
  }

  /** Full fork-aware native history, including entries before reset/compaction. Never schedules work. */
  readHistory(
    sessionId: string,
    limit: number,
    cursor?: Cursor,
    anchor?: EntryId,
  ): Promise<Page<EntryRecord, Cursor>> {
    if (this.closing) return Promise.reject(new Error('Durable sessions are closing.'));
    const path = this.databasePath(sessionId);
    const previous = historyReaders.get(path);
    const reading = (async () => {
      await previous;
      const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
      const active = this.sessions.get(sessionId);
      if (active) {
        const session = await active;
        return session.conversation.entries(
          { maxEntryId: anchor },
          limit,
          cursor,
          BACKGROUND_CONTEXT,
        );
      }
      if (owners.has(path)) throw new Error('This durable session already has an owner.');
      await access(path); // A history read must never create a missing database.
      const { openNodeSqliteStorage } =
        await import('@earendil-works/pi-durable/storage/sqlite/node');
      const storage = await openNodeSqliteStorage(path);
      try {
        const roots = await storage.scanConversations({}, 1, undefined, BACKGROUND_CONTEXT);
        const root = roots.items[0];
        if (!root) return { items: [] };
        return await storage.scanEntries(
          { conversationId: root.id, maxEntryId: anchor },
          limit,
          cursor,
          BACKGROUND_CONTEXT,
        );
      } finally {
        await storage.close(BACKGROUND_CONTEXT);
      }
    })();
    historyReaders.set(path, reading);
    this.reads.add(reading);
    const cleanup = () => {
      this.reads.delete(reading);
      if (historyReaders.get(path) === reading) historyReaders.delete(path);
    };
    void reading.then(cleanup, cleanup);
    return reading;
  }

  private async openStorage(
    sessionId: string,
    path: string,
    agent?: AgentChange,
  ): Promise<DurableSession> {
    const [{ Harness }, { openNodeSqliteStorage }, { BACKGROUND_CONTEXT }] = await Promise.all([
      import('@earendil-works/pi-durable'),
      import('@earendil-works/pi-durable/storage/sqlite/node'),
      import('@earendil-works/chord/context'),
    ]);
    const options = await this.options(sessionId);
    const storage = await openNodeSqliteStorage(path);
    let harness: Harness | undefined;
    try {
      harness = await Harness.open(storage, options, BACKGROUND_CONTEXT);
      const conversation = await harness.root(BACKGROUND_CONTEXT, { agent });
      return { sessionId, harness, conversation };
    } catch (error) {
      await (harness ?? storage).close(BACKGROUND_CONTEXT);
      throw error;
    }
  }

  async release(sessionId: string): Promise<void> {
    const pending = this.sessions.get(sessionId);
    if (!pending) return;
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const session = await pending;
    await session.harness.close(BACKGROUND_CONTEXT);
    this.sessions.delete(sessionId);
    const path = this.databasePath(sessionId);
    if (owners.get(path) === pending) owners.delete(path);
  }

  /** Application shutdown preserves unfinished work. User cancellation uses conversation.abort. */
  close(): Promise<void> {
    this.closing ??= this.closeSessions();
    return this.closing;
  }

  private async closeSessions(): Promise<void> {
    await Promise.allSettled([...this.reads]);
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const results = await Promise.allSettled(
      [...this.sessions.values()].map(async pending => {
        const session = await pending;
        try {
          await session.harness.close(BACKGROUND_CONTEXT);
        } finally {
          for (const [path, owner] of owners) {
            if (owner === pending) owners.delete(path);
          }
        }
      }),
    );
    this.sessions.clear();
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason));
  }
}
