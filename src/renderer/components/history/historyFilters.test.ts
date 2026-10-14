import { expect, test } from 'vitest';
import { historyTimeFilter } from './historyFilters';

test('calendar ranges include today and use local midnight across daylight-saving boundaries', () => {
  for (const month of [2, 10]) {
    const now = new Date(2026, month, 9, 12, 34, 56, 789).getTime();
    for (const [range, days] of [
      ['week', 7],
      ['month', 30],
    ] as const) {
      const result = historyTimeFilter(range, now);
      const expected = new Date(2026, month, 9 - days + 1);
      expect(result).toEqual({ since: expected.getTime(), until: now });
      expect(new Date(result.since!).getHours()).toBe(0);
    }
  }
  expect(historyTimeFilter('all', Date.now())).toEqual({});
});
