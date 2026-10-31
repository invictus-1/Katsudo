import { shiftDay, todayIso } from '../lib';

export type RangeId = 'day' | 'week' | 'month' | 'year' | 'all';
export const RANGE_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
];

/** Inclusive [from, to] ending today. */
export function rangeDays(id: RangeId, firstDay: string | null): [string, string] {
  const to = todayIso();
  const back = { day: 0, week: 6, month: 29, year: 364, all: 0 }[id];
  const from = id === 'all' ? firstDay ?? to : shiftDay(to, -back);
  return [from, to];
}
