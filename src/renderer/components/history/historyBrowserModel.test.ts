import { expect, test } from 'vitest';
import { historyAttachments, historyLocatorKey, HistoryRequestGate } from './historyBrowserModel';

test('a newer search or conversation invalidates pending results', () => {
  const gate = new HistoryRequestGate();
  const first = gate.begin();
  const second = gate.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
  gate.invalidate();
  expect(second()).toBe(false);
});

test('source identity does not collide across native and coding records', () => {
  expect(historyLocatorKey({ source: 'cowork', id: 'same' })).not.toBe(
    historyLocatorKey({ source: 'coding', id: 'same' }),
  );
});

test('reads valid attachment records without assuming a surviving local file', () => {
  expect(
    historyAttachments({
      metadata: {
        imageAttachments: [
          { name: '图片.png', mimeType: 'image/png', path: '/removed/image.png' },
          null,
          {},
        ],
        fileAttachments: [{ name: 'plan.pdf' }, 'invalid'],
      },
    }),
  ).toEqual([
    { name: '图片.png', mimeType: 'image/png', path: '/removed/image.png' },
    { name: 'plan.pdf', mimeType: 'application/octet-stream', path: undefined },
  ]);
  expect(historyAttachments({})).toEqual([]);
});
