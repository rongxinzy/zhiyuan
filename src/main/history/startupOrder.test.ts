import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('history desktop startup wiring', () => {
  const source = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const init = source.slice(source.indexOf('const initApp = async'));
  it('completes maintenance and loads persistent restore guard before any application database opens', () => {
    expect(init.indexOf('await runPendingHistoryMaintenance')).toBeLessThan(
      init.indexOf('await initStore'),
    );
    expect(init.indexOf('await loadRestoredNativeGuard')).toBeLessThan(
      init.indexOf('await initStore'),
    );
    expect(init.indexOf('initializeHistoryService();')).toBeGreaterThan(
      init.indexOf('await initStore'),
    );
  });
  it('passes the persistent native guard to automatic scheduled reattachment', () => {
    expect(source).toContain('restoredNativeGuard?.has(run.sessionId');
    expect(source).toContain('restoredNativeGuard?.has(`scheduled-run:${run.id}`)');
  });
});
