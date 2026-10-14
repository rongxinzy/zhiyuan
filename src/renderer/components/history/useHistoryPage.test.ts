// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import type { HistoryPage, HistoryResult } from '@shared/history';
import { useHistoryPage } from './useHistoryPage';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let page: ReturnType<typeof useHistoryPage<string>>;
const deferred = () => {
  let resolve!: (value: HistoryResult<HistoryPage<string>>) => void;
  const promise = new Promise<HistoryResult<HistoryPage<string>>>(done => {
    resolve = done;
  });
  return { promise, resolve };
};
const success = (items: string[], nextCursor?: string): HistoryResult<HistoryPage<string>> => ({
  success: true,
  data: { items, nextCursor },
});
function Harness({
  scope,
  load,
}: {
  scope: string;
  load: (cursor?: string) => Promise<HistoryResult<HistoryPage<string>>>;
}) {
  page = useHistoryPage(scope, load);
  return createElement('div', null, page.items.join(','));
}
async function render(
  scope: string,
  load: (cursor?: string) => Promise<HistoryResult<HistoryPage<string>>>,
) {
  if (!root) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(createElement(Harness, { scope, load }));
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
});

test('switching conversations discards late old IPC responses', async () => {
  const old = deferred();
  const current = deferred();
  await render('old', () => old.promise);
  await render('new', () => current.promise);
  await act(async () => current.resolve(success(['new message'])));
  await act(async () => old.resolve(success(['stale message'])));
  expect(page.items).toEqual(['new message']);
});

test('only one page remains rendered and backwards navigation uses saved cursor', async () => {
  const load = vi.fn(async (cursor?: string) =>
    cursor ? success(['older']) : success(['recent'], 'older-page'),
  );
  await render('conversation', load);
  await act(async () => page.next());
  expect(load).toHaveBeenLastCalledWith('older-page');
  expect(page.items).toEqual(['older']);
  await act(async () => page.previous());
  expect(load).toHaveBeenLastCalledWith(undefined);
  expect(page.items).toEqual(['recent']);
});

test('failed older-page reads keep visible content and retry the same cursor', async () => {
  let fail = true;
  const load = vi.fn(async (cursor?: string): Promise<HistoryResult<HistoryPage<string>>> => {
    if (!cursor) return success(['recent'], 'older');
    if (fail) return { success: false, error: 'unavailable' };
    return success(['old']);
  });
  await render('conversation', load);
  await act(async () => page.next());
  expect(page.failed).toBe(true);
  expect(page.items).toEqual(['recent']);
  fail = false;
  await act(async () => page.retry());
  expect(load).toHaveBeenLastCalledWith('older');
  expect(page.items).toEqual(['old']);
  expect(page.failed).toBe(false);
});

test('empty results clear old search results and rejected IPC can be retried', async () => {
  await render('old query', async () => success(['old result']));
  await render('中文', async () => success([]));
  expect(page.items).toEqual([]);
  expect(page.failed).toBe(false);
  await render('failed', async () => {
    throw new Error('offline');
  });
  expect(page.failed).toBe(true);
  expect(page.loading).toBe(false);
});
