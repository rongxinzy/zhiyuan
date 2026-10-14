import type Database from 'better-sqlite3';
import type { HistoryLocator } from '../../shared/history';
/** Same-transaction invalidation only: no transcript, task state or resume authority. */
export function installHistoryRevisions(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS history_index_revisions(source TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(source,id));`,
  );
  const sources = [
    ['cowork_sessions', 'cowork', 'id'],
    ['cowork_messages', 'cowork', 'session_id'],
    ['coding_agent_lanes', 'coding', 'id'],
    ['coding_events', 'coding', 'lane_id'],
  ] as const;
  for (const [table, source, id] of sources)
    for (const [event, ref] of [
      ['INSERT', 'NEW'],
      ['UPDATE', 'NEW'],
      ['DELETE', 'OLD'],
    ] as const) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS history_revision_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN
    INSERT INTO history_index_revisions(source,id,revision) VALUES('${source}',${ref}.${id},1) ON CONFLICT(source,id) DO UPDATE SET revision=revision+1;
    ${event === 'UPDATE' ? `INSERT INTO history_index_revisions(source,id,revision) SELECT '${source}',OLD.${id},1 WHERE OLD.${id}<>NEW.${id} ON CONFLICT(source,id) DO UPDATE SET revision=revision+1;` : ''}
  END;`);
    }
  // Catalog-only changes need no transcript invalidation; they are reconciled directly from the directory.
}
export function historyRevision(db: Database.Database, locator: HistoryLocator): number {
  return (
    (
      db
        .prepare('SELECT revision FROM history_index_revisions WHERE source=? AND id=?')
        .get(locator.source, locator.id) as { revision: number } | undefined
    )?.revision ?? 0
  );
}
