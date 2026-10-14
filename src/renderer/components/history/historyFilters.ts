export type HistoryTimeRange = 'all' | 'week' | 'month';

/** Local calendar days including today; fixed bounds survive paging and DST changes. */
export function historyTimeFilter(range: HistoryTimeRange, now: number) {
  if (range === 'all') return {};
  const days = range === 'week' ? 7 : 30;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return { since: Math.max(0, start.getTime()), until: now };
}
