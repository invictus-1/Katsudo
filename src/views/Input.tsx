import { useState } from 'react';
import { api, type DaySummary, type Undated } from '../api';
import { CalendarHeatmap, KeyboardHeatmap, Panel, Segmented, StatTile } from '../ds/katsudo';
import { formatCount, formatDuration, shiftDay, shortCount, todayIso, useData, weekdayMon0 } from '../lib';
import { RANGE_OPTIONS, rangeDays, type RangeId } from './range';
import { LivePanel } from './Widgets';
import { MouseHeatmap, type MouseMetric } from './MouseMap';
import { HandsPanel } from './Hands';
import { keyLabel } from '../hands';

type Metric = 'keys' | 'clicks' | 'active_secs';
type Layout = 'compact' | 'tkl' | 'full';
const LAYOUTS = [
  { value: 'compact', label: '60%' },
  { value: 'tkl', label: 'TKL' },
  { value: 'full', label: 'Full' },
];
const LAYOUT_KEY = 'katsudo.keyboard-layout';

function savedLayout(): Layout {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === 'compact' || v === 'tkl' || v === 'full') return v;
  } catch { /* storage unavailable: use the default */ }
  return 'full';
}

const MOUSE_METRICS = [
  { value: 'clicks', label: 'Clicks' },
  { value: 'moves', label: 'Movement' },
];

const METRICS = [
  { value: 'keys', label: 'Keys' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'active_secs', label: 'Active time' },
];

export function InputView({ firstDay, undated }: { firstDay: string | null; undated: Undated | null }) {
  const [metric, setMetric] = useState<Metric>('keys');
  const [range, setRange] = useState<RangeId>('month');
  const [layout, setLayoutState] = useState<Layout>(savedLayout);
  const setLayout = (v: Layout) => {
    setLayoutState(v);
    try { localStorage.setItem(LAYOUT_KEY, v); } catch { /* not remembered, still applied */ }
  };
  const yearTo = todayIso();
  const yearFrom = shiftDay(yearTo, -363);
  const year = useData(() => api.days(yearFrom, yearTo), [yearFrom, yearTo]);
  const [from, to] = rangeDays(range, firstDay);
  const keys = useData(() => api.keys(from, to), [from, to]);
  const appKeys = useData(() => api.appKeys(from, to), [from, to]);
  // The keyboard for one app (Katsudō counts keys per app from 0.17 on), or all of them.
  const [kbApp, setKbApp] = useState<number | null>(null);
  const appKb = kbApp === null ? null : appKeys.data?.find((a) => a.app_id === kbApp) ?? null;
  const kbCounts = appKb ? appKb.keys : keys.data;
  const topKeys = appKb ? Object.entries(appKb.keys).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const days = useData(() => api.days(from, to), [from, to]);
  const mouse = useData(() => api.mouse(from, to), [from, to]);
  const [mouseMetric, setMouseMetric] = useState<MouseMetric>('clicks');
  const mouseTotal = (mouse.data?.cells ?? []).reduce((n, c) => n + (mouseMetric === 'clicks' ? c[2] : c[3]), 0);

  // All-time also counts what WhatPulse knows only as lifetime totals, with no day to show it on.
  const extra = range === 'all' && undated && undated.keys + undated.clicks > 0 ? undated : null;
  const sum = (f: (d: DaySummary | Undated) => number) => (days.data ?? []).reduce((s, d) => s + f(d), extra ? f(extra) : 0);
  const fmt = (v: number) => (metric === 'active_secs' ? formatDuration(v) : `${formatCount(v)} ${metric}`);
  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === range)?.label.toLowerCase();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Input</h1>
          <p className="text-body">Counts only. Katsudō never records what you type.</p>
        </div>
        <Segmented label="Range" options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as RangeId)} />
      </div>
      <div className="tiles">
        <StatTile label={`Keys · ${rangeLabel}`} icon="keyboard" tone="cyan" value={shortCount(sum((d) => d.keys))} />
        <StatTile label={`Clicks · ${rangeLabel}`} icon="mouse" tone="rose" value={shortCount(sum((d) => d.clicks))} />
        <StatTile label={`Scrolls · ${rangeLabel}`} icon="mouse" tone="sky" value={shortCount(sum((d) => d.scrolls))} />
        <StatTile label={`Pointer travel · ${rangeLabel}`} icon="mouse" tone="lime"
          value={sum((d) => d.distance_m) >= 1000 ? (sum((d) => d.distance_m) / 1000).toFixed(1) : Math.round(sum((d) => d.distance_m)).toString()}
          unit={sum((d) => d.distance_m) >= 1000 ? 'km' : 'm'} />
      </div>
      {extra && (
        <p className="tiles-note">
          Includes {shortCount(extra.keys)} keys and {shortCount(extra.clicks)} clicks WhatPulse has only as lifetime totals,
          with no dates. They count here but not on any day, calendar or chart.
        </p>
      )}
      <div className="split-even">
        <LivePanel />
        <Panel title="Last 52 weeks"
          action={<Segmented size="sm" label="Metric" options={METRICS} value={metric} onChange={(v) => setMetric(v as Metric)} />}>
          {year.data && (
            <div className="scroll-x">
              <CalendarHeatmap values={year.data.map((d) => d[metric])} startWeekday={weekdayMon0(yearFrom)} format={fmt} />
            </div>
          )}
        </Panel>
      </div>
      <Panel title={`Keyboard · ${appKb ? appKb.name : rangeLabel}`}
        action={<div className="kb-actions">
          <select className="kb-app" aria-label="Keyboard for one app" value={kbApp ?? ''} onChange={(e) => setKbApp(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All apps</option>
            {(appKeys.data ?? []).map((a) => <option key={a.app_id} value={a.app_id}>{a.name} · {shortCount(a.total)}</option>)}
          </select>
          <Segmented size="sm" label="Keyboard layout" options={LAYOUTS} value={layout} onChange={(v) => setLayout(v as Layout)} />
        </div>}>
        {kbCounts && Object.keys(kbCounts).length ? (
          <>
            <div className="scroll-x">
              <KeyboardHeatmap counts={kbCounts} layout={layout} label={`Key presses${appKb ? ` in ${appKb.name}` : ''}, ${rangeLabel}`} />
            </div>
            {appKb && (
              <p className="text-small faint kb-top">
                Most pressed in {appKb.name}: {topKeys.map(([k, n]) => `${keyLabel(k)} ${shortCount(n)}`).join(' · ')}
                {' '}· {formatCount(appKb.total)} presses, {Math.round((appKb.total / Math.max(1, Object.values(keys.data ?? {}).reduce((a, b) => a + b, 0))) * 100)}% of all
              </p>
            )}
          </>
        ) : (
          <p className="muted">No key presses recorded in this range.</p>
        )}
        {!appKeys.data?.length && keys.data && Object.keys(keys.data).length > 0 && (
          <p className="text-small faint kb-top">Keyboards per app start with 0.17: they fill in as you type.</p>
        )}
      </Panel>
      {keys.data && Object.keys(keys.data).length > 0 && (
        <HandsPanel keys={keys.data} apps={appKeys.data ?? []} label={rangeLabel ?? ''}
          clicks={(days.data ?? []).reduce((s, d) => s + d.clicks, 0)} scrolls={(days.data ?? []).reduce((s, d) => s + d.scrolls, 0)} />
      )}
      <Panel title={`Mouse · ${rangeLabel}`}
        action={<Segmented size="sm" label="Mouse heatmap" options={MOUSE_METRICS} value={mouseMetric} onChange={(v) => setMouseMetric(v as MouseMetric)} />}>
        {mouse.data && mouseTotal > 0 ? (
          <>
            <MouseHeatmap map={mouse.data} metric={mouseMetric} />
            <p className="text-small faint mouse-note">
              {mouseMetric === 'clicks'
                ? `${formatCount(mouseTotal)} clicks placed. Any imported from WhatPulse are fitted to your monitors as they are now.`
                : 'Where the pointer travels: each 32-pixel square counts how often the pointer passed into it.'}
            </p>
          </>
        ) : (
          <p className="muted">
            {mouseMetric === 'clicks' ? 'No clicks placed in this range yet.' : 'No pointer movement mapped in this range yet.'} Katsudō maps clicks and
            movement from 0.5.1 on; import your WhatPulse database again to add its last three months of clicks.
          </p>
        )}
      </Panel>
    </div>
  );
}
