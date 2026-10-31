import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppTotal, LaneSeg } from './api';
import type { DataTone, TimelineSegment } from './ds/katsudo';

export { formatClock, formatCount, formatDuration } from './ds/katsudo';

// ---- dates (local calendar days as "YYYY-MM-DD") ------------------------------

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function shiftDay(day: string, delta: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + delta);
  return isoDay(d);
}
export function todayIso(): string {
  return isoDay(new Date());
}
/** Weekday with Monday = 0, as CalendarHeatmap expects. */
export function weekdayMon0(day: string): number {
  return (parseDay(day).getDay() + 6) % 7;
}
export function longDay(day: string): string {
  return parseDay(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
export function shortDay(day: string): string {
  return parseDay(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export function weekdayName(day: string): string {
  return parseDay(day).toLocaleDateString(undefined, { weekday: 'long' });
}
export function dateTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d.toTimeString().slice(0, 5)}`;
}

// ---- numbers -------------------------------------------------------------------

export function shortCount(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
}
export function bytes(n: number): [string, string] {
  if (n >= 1e12) return [(n / 1e12).toFixed(2), 'TB'];
  if (n >= 1e9) return [(n / 1e9).toFixed(1), 'GB'];
  if (n >= 1e6) return [(n / 1e6).toFixed(0), 'MB'];
  return [(n / 1e3).toFixed(0), 'KB'];
}
export function bytesText(n: number): string {
  return bytes(n).join(' ');
}

// ---- tones ---------------------------------------------------------------------

const RANKED: DataTone[] = ['amber', 'cyan', 'rose', 'lime', 'sky'];

/** Tone per app by rank of time (design system: top five get the data tones, the rest sky). */
export function toneMap(apps: AppTotal[]): Map<number, DataTone> {
  const m = new Map<number, DataTone>();
  apps.forEach((a, i) => m.set(a.app_id, RANKED[i] ?? 'sky'));
  return m;
}

export function rankRefs(segs: LaneSeg[]): Map<number, DataTone> {
  const totals = new Map<number, number>();
  for (const s of segs) totals.set(s.ref, (totals.get(s.ref) ?? 0) + (s.to - s.from));
  const m = new Map<number, DataTone>();
  [...totals.entries()].sort((a, b) => b[1] - a[1]).forEach(([ref], i) => m.set(ref, RANKED[i] ?? 'sky'));
  return m;
}

/** Merge touching segments with the same ref so the DOM stays small. */
export function toSegments(
  segs: LaneSeg[],
  tone: (s: LaneSeg) => TimelineSegment['tone'],
  title: (s: LaneSeg) => string,
): TimelineSegment[] {
  const out: (TimelineSegment & { ref: number })[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.ref === s.ref && s.from - last.to < 1 / 120) last.to = s.to;
    else out.push({ from: s.from, to: s.to, tone: tone(s), title: title(s), ref: s.ref });
  }
  return out;
}

// ---- data loading ----------------------------------------------------------------

/** Load data, reload when `deps` change, and refresh every `everyMs` while visible. */
export function useData<T>(load: () => Promise<T>, deps: unknown[], everyMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    load().then(
      (d) => { if (id === seq.current) { setData(d); setError(null); } },
      (e) => { if (id === seq.current) setError(String(e)); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
    if (!everyMs) return;
    const t = setInterval(() => { if (!document.hidden) run(); }, everyMs);
    return () => clearInterval(t);
  }, [run, everyMs]);
  return { data, error, reload: run };
}
