import { useState } from 'react';
import { api, type ComparePeriod, type DaySummary, type Totals } from '../api';
import { Panel, Segmented } from '../ds/katsudo';
import { bytes, formatDuration, isoDay, parseDay, shiftDay, shortCount, shortDay, todayIso, useData } from '../lib';
import './compare.css';

type PresetId = 'week' | 'month' | 'month-ly' | 'year' | '7' | '30' | 'custom';
const PRESETS: { value: PresetId; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'month-ly', label: 'Month vs last year' },
  { value: 'year', label: 'This year' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'custom', label: 'Custom' },
];
interface Range { from: string; to: string }
interface Pair { a: Range; b: Range; aName: string; bName: string }

const lastDayOf = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
/** The same day of the month in another month, kept inside it (31 Mar → 30 Apr). */
const sameDay = (y: number, m: number, d: number) => isoDay(new Date(y, m, Math.min(d, lastDayOf(y, m))));

/** Periods still running compare "to date": Monday to today against last Monday to the same weekday. */
function presetRanges(id: Exclude<PresetId, 'custom'>): Pair {
  const today = todayIso();
  const t = parseDay(today);
  const [y, m, d] = [t.getFullYear(), t.getMonth(), t.getDate()];
  switch (id) {
    case 'week': {
      const from = shiftDay(today, -((t.getDay() + 6) % 7));
      return { a: { from, to: today }, b: { from: shiftDay(from, -7), to: shiftDay(today, -7) }, aName: 'This week', bName: 'Last week' };
    }
    case 'month':
      return { a: { from: sameDay(y, m, 1), to: today }, b: { from: sameDay(y, m - 1, 1), to: sameDay(y, m - 1, d) }, aName: 'This month', bName: 'Last month' };
    case 'month-ly':
      return { a: { from: sameDay(y, m, 1), to: today }, b: { from: sameDay(y - 1, m, 1), to: sameDay(y - 1, m, d) }, aName: 'This month', bName: 'A year ago' };
    case 'year':
      return { a: { from: `${y}-01-01`, to: today }, b: { from: `${y - 1}-01-01`, to: sameDay(y - 1, m, d) }, aName: String(y), bName: String(y - 1) };
    case '7':
    case '30': {
      const n = Number(id);
      return { a: { from: shiftDay(today, -(n - 1)), to: today }, b: { from: shiftDay(today, -(2 * n - 1)), to: shiftDay(today, -n) }, aName: `Last ${n} days`, bName: `${n} days before` };
    }
  }
}

type MetricKey = 'active_secs' | 'keys' | 'clicks' | 'scrolls' | 'distance_m' | 'download' | 'upload' | 'uptime_ms';
const METRICS: { key: MetricKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'active_secs', label: 'Active time', fmt: (v) => (v >= 360_000 ? `${Math.round(v / 3600).toLocaleString()} h` : formatDuration(v)) },
  { key: 'keys', label: 'Keys', fmt: shortCount },
  { key: 'clicks', label: 'Clicks', fmt: shortCount },
  { key: 'scrolls', label: 'Scrolls', fmt: shortCount },
  { key: 'distance_m', label: 'Pointer travel', fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`) },
  { key: 'download', label: 'Downloaded', fmt: (v) => bytes(v).join(' ') },
  { key: 'upload', label: 'Uploaded', fmt: (v) => bytes(v).join(' ') },
  { key: 'uptime_ms', label: 'Machine on', fmt: (v) => `${(v / 3_600_000).toFixed(1)} h` },
];
const CHART_METRICS = [
  { value: 'keys', label: 'Keys' },
  { value: 'active_secs', label: 'Active time' },
  { value: 'clicks', label: 'Clicks' },
];

const change = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
function Delta({ a, b }: { a: number; b: number }) {
  const d = change(a, b);
  if (d === null) return <span className="cmp-delta">new</span>;
  const r = Math.round(d);
  return <span className="cmp-delta">{r === 0 ? '±0%' : `${r > 0 ? '▲' : '▼'} ${Math.abs(r)}%`}</span>;
}

function span(r: Range) {
  return r.from === r.to ? shortDay(r.from) : `${shortDay(r.from)} – ${shortDay(r.to)}`;
}

/** Paired bars, A beside B, aligned from each period's first day; long periods are summed by week. */
function DayBars({ a, b, metric }: { a: DaySummary[]; b: DaySummary[]; metric: MetricKey }) {
  const every = Math.max(a.length, b.length) > 62 ? 7 : 1;
  const sum = (days: DaySummary[]) => {
    const out: number[] = [];
    for (let i = 0; i < days.length; i += every) out.push(days.slice(i, i + every).reduce((s, d) => s + d[metric], 0));
    return out;
  };
  const [sa, sb] = [sum(a), sum(b)];
  const n = Math.max(sa.length, sb.length);
  const top = Math.max(1, ...sa, ...sb);
  const fmt = METRICS.find((m) => m.key === metric)!.fmt;
  const label = (i: number) => (every === 7 ? `wk ${i + 1}` : a[i] ? parseDay(a[i].day).toLocaleDateString(undefined, n > 14 ? { day: 'numeric' } : { weekday: 'short' }) : '');
  return (
    <div className="cmp-bars" role="img" aria-label="Each day of the first period beside the same day of the second">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="cmp-bar-group" data-tip={`${label(i)}: ${fmt(sa[i] ?? 0)} vs ${fmt(sb[i] ?? 0)}`}>
          <div className="cmp-bar-pair">
            <span className="cmp-bar is-a" style={{ height: `${((sa[i] ?? 0) / top) * 100}%` }} />
            <span className="cmp-bar is-b" style={{ height: `${((sb[i] ?? 0) / top) * 100}%` }} />
          </div>
          {(n <= 31 || i % Math.ceil(n / 16) === 0) && <span className="cmp-bar-label data-sm">{label(i)}</span>}
        </div>
      ))}
    </div>
  );
}

function Hours({ a, b }: { a: ComparePeriod; b: ComparePeriod }) {
  const per = (p: ComparePeriod) => p.hours.map((k) => k / Math.max(1, p.active_days));
  const [ha, hb] = [per(a), per(b)];
  const top = Math.max(1, ...ha, ...hb);
  return (
    <div className="cmp-hours" role="img" aria-label="Keys per hour of the day, per active day, both periods">
      {ha.map((v, i) => (
        <div key={i} className="cmp-hour" data-tip={`${i}:00 · ${Math.round(v).toLocaleString()} vs ${Math.round(hb[i]).toLocaleString()} keys a day`}>
          <span className="cmp-bar is-b" style={{ height: `${(hb[i] / top) * 100}%` }} />
          <span className="cmp-bar is-a" style={{ height: `${(v / top) * 100}%` }} />
        </div>
      ))}
      <div className="cmp-hours-axis data-sm"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
    </div>
  );
}

function Versus({ a, b, kind }: { a: { name: string; secs: number }[]; b: { name: string; secs: number }[]; kind: string }) {
  const names = [...new Set([...a.slice(0, 12).map((x) => x.name), ...b.slice(0, 6).map((x) => x.name)])];
  const of = (list: typeof a, name: string) => list.find((x) => x.name === name)?.secs ?? 0;
  const rows = names.map((name) => ({ name, a: of(a, name), b: of(b, name) })).sort((x, y) => y.a - x.a || y.b - x.b);
  const top = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b)));
  if (!rows.length) return <p className="muted panel-empty">No {kind} in either period.</p>;
  return (
    <table className="table cmp-table">
      <thead><tr><th className="kt-label">{kind}</th><th className="kt-label cmp-num">A</th><th className="kt-label cmp-num">B</th><th className="kt-label cmp-num">Change</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>
              <div className="cmp-name">{r.name}</div>
              <div className="cmp-mini"><span className="is-a" style={{ width: `${(r.a / top) * 100}%` }} /><span className="is-b" style={{ width: `${(r.b / top) * 100}%` }} /></div>
            </td>
            <td className="data-md cmp-num">{r.a ? formatDuration(r.a) : '–'}</td>
            <td className="data-md cmp-num">{r.b ? formatDuration(r.b) : '–'}</td>
            <td className="data-md cmp-num">{!r.a ? <span className="cmp-delta">gone</span> : <Delta a={r.a} b={r.b} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CompareView() {
  const [preset, setPreset] = useState<PresetId>('week');
  const [custom, setCustom] = useState<Pair>(() => ({ ...presetRanges('30'), aName: 'A', bName: 'B' }));
  const [perDay, setPerDay] = useState(false);
  const [chart, setChart] = useState<MetricKey>('keys');
  const pair = preset === 'custom' ? custom : presetRanges(preset);
  const data = useData(() => api.compare(pair.a, pair.b), [pair.a.from, pair.a.to, pair.b.from, pair.b.to]);
  const c = data.data;
  const edit = (side: 'a' | 'b', end: keyof Range, v: string) => v && setCustom({ ...custom, [side]: { ...custom[side], [end]: v } });
  const value = (p: ComparePeriod, k: keyof Totals) => (perDay ? p.totals[k] / Math.max(1, p.active_days) : p.totals[k]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Compare</h1>
          <p className="text-body">Two stretches of time side by side. Periods still running are compared to the same point in the other.</p>
        </div>
        <Segmented label="Compare" options={PRESETS} value={preset} onChange={(v) => setPreset(v as PresetId)} />
      </div>

      <div className="cmp-ranges">
        {(['a', 'b'] as const).map((side) => (
          <div key={side} className={`cmp-range is-${side}`}>
            <span className="cmp-swatch" />
            <div>
              <div className="kt-label">{side.toUpperCase()} · {side === 'a' ? pair.aName : pair.bName}</div>
              {preset === 'custom' ? (
                <div className="cmp-dates">
                  <input type="date" value={pair[side].from} max={pair[side].to} onChange={(e) => edit(side, 'from', e.target.value)} aria-label={`${side.toUpperCase()} from`} />
                  <span>to</span>
                  <input type="date" value={pair[side].to} min={pair[side].from} max={todayIso()} onChange={(e) => edit(side, 'to', e.target.value)} aria-label={`${side.toUpperCase()} to`} />
                </div>
              ) : (
                <div className="text-strong">{span(pair[side])}</div>
              )}
              {c && <div className="text-small faint">{c[side].active_days} active {c[side].active_days === 1 ? 'day' : 'days'}</div>}
            </div>
          </div>
        ))}
        <Segmented size="sm" label="Show" value={perDay ? 'day' : 'total'} onChange={(v) => setPerDay(v === 'day')}
          options={[{ value: 'total', label: 'Totals' }, { value: 'day', label: 'Per active day' }]} />
      </div>

      {data.error && <p className="error">{data.error}</p>}
      {c && (
        <>
          <div className="cmp-metrics">
            {METRICS.filter((m) => c.a.totals[m.key] > 0 || c.b.totals[m.key] > 0).map((m) => (
              <div key={m.key} className="kt-stat cmp-metric">
                <div className="kt-label">{m.label}{perDay ? ' · a day' : ''}</div>
                <div className="cmp-metric-a">{m.fmt(value(c.a, m.key))}</div>
                <div className="cmp-metric-b data-sm">vs {m.fmt(value(c.b, m.key))}</div>
                <Delta a={value(c.a, m.key)} b={value(c.b, m.key)} />
              </div>
            ))}
            {(c.a.flow_secs > 0 || c.b.flow_secs > 0) && (() => {
              const f = (p: ComparePeriod) => (perDay ? p.flow_secs / Math.max(1, p.active_days) : p.flow_secs);
              return (
                <div className="kt-stat cmp-metric">
                  <div className="kt-label">Time in flow{perDay ? ' · a day' : ''}</div>
                  <div className="cmp-metric-a">{METRICS[0].fmt(f(c.a))}</div>
                  <div className="cmp-metric-b data-sm">vs {METRICS[0].fmt(f(c.b))}</div>
                  <Delta a={f(c.a)} b={f(c.b)} />
                </div>
              );
            })()}
          </div>

          <Panel title="Day by day" action={<Segmented size="sm" label="Metric" options={CHART_METRICS} value={chart} onChange={(v) => setChart(v as MetricKey)} />}>
            <DayBars a={c.a.days} b={c.b.days} metric={chart} />
          </Panel>

          <div className="split-even">
            <Panel title="Hour of day · keys per active day"><Hours a={c.a} b={c.b} /></Panel>
            <Panel title="Sites" flush><Versus a={c.a.sites} b={c.b.sites} kind="Site" /></Panel>
          </div>
          <Panel title="Apps" flush><Versus a={c.a.apps} b={c.b.apps} kind="App" /></Panel>
        </>
      )}
    </div>
  );
}
