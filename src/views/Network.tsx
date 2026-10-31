import { useState } from 'react';
import { api, type DaySummary, type Undated } from '../api';
import { CalendarHeatmap, Panel, Segmented, StatTile, UsageList } from '../ds/katsudo';
import { bytes, bytesText, shiftDay, shortDay, todayIso, useData, weekdayMon0 } from '../lib';
import { RANGE_OPTIONS, rangeDays, type RangeId } from './range';

type Metric = 'download' | 'upload' | 'uptime_ms';

/** At most `n` points for a sparkline: long ranges are summed into equal buckets. */
function buckets(values: number[], n = 60): number[] {
  if (values.length <= n) return values;
  const size = values.length / n;
  return Array.from({ length: n }, (_, i) => values.slice(Math.floor(i * size), Math.floor((i + 1) * size)).reduce((s, v) => s + v, 0));
}

export function Network({ firstDay, undated }: { firstDay: string | null; undated: Undated | null }) {
  const [metric, setMetric] = useState<Metric>('download');
  const [range, setRange] = useState<RangeId>('week');
  const yearTo = todayIso();
  const yearFrom = shiftDay(yearTo, -363);
  const year = useData(() => api.days(yearFrom, yearTo), [yearFrom, yearTo]);
  const [from, to] = rangeDays(range, firstDay);
  const { data, error } = useData(() => api.days(from, to), [from, to], range === 'day' ? 15000 : 0);
  const days = data ?? [];
  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === range)?.label.toLowerCase();

  // All-time also counts what WhatPulse knows only as lifetime totals, with no day to show it on.
  const extra = range === 'all' && undated && undated.download + undated.upload + undated.uptime_ms > 0 ? undated : null;
  const sum = (f: (d: DaySummary | Undated) => number) => days.reduce((s, d) => s + f(d), extra ? f(extra) : 0);
  const [down, downUnit] = bytes(sum((d) => d.download));
  const [up, upUnit] = bytes(sum((d) => d.upload));
  const hours = sum((d) => d.uptime_ms) / 3_600_000;
  const spark = (f: (d: DaySummary) => number) => (range === 'day' ? undefined : buckets(days.map(f)));
  const busiest = [...days].sort((a, b) => b[metric] - a[metric]).slice(0, 10).filter((d) => d[metric] > 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Network</h1>
          <p className="text-body">Traffic on hardware network adapters, and how long this machine was on.</p>
        </div>
        <Segmented label="Range" options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as RangeId)} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tiles">
        <StatTile label={`Downloaded · ${rangeLabel}`} icon="network" tone="lime" value={down} unit={downUnit} data={spark((d) => d.download)} />
        <StatTile label={`Uploaded · ${rangeLabel}`} icon="network" tone="lime" value={up} unit={upUnit} data={spark((d) => d.upload)} />
        <StatTile label={`Uptime · ${rangeLabel}`} icon="clock" tone="sky" value={hours >= 1000 ? Math.round(hours).toLocaleString() : hours.toFixed(1)} unit="h"
          data={spark((d) => d.uptime_ms)} />
        <StatTile label={`Per day · ${rangeLabel}`} icon="network" tone="sky"
          {...(() => {
            const [v, u] = bytes(days.length ? sum((d) => d.download + d.upload) / days.length : 0);
            return { value: v, unit: u };
          })()} />
      </div>
      {extra && (
        <p className="tiles-note">
          Includes {bytesText(extra.download)} down, {bytesText(extra.upload)} up and {Math.round(extra.uptime_ms / 3_600_000).toLocaleString()} h of uptime
          WhatPulse has only as lifetime totals, with no dates. They count here but not on any day, calendar or chart.
        </p>
      )}
      <div className="split">
        <Panel title="Last 52 weeks"
          action={<Segmented size="sm" label="Metric" value={metric} onChange={(v) => setMetric(v as Metric)}
            options={[{ value: 'download', label: 'Download' }, { value: 'upload', label: 'Upload' }, { value: 'uptime_ms', label: 'Uptime' }]} />}>
          {year.data && (
            <div className="scroll-x">
              {/* Traffic is spiky (one big transfer dwarfs a normal day), so shade on a square-root scale. */}
              <CalendarHeatmap values={year.data.map((d) => Math.sqrt(d[metric]))} startWeekday={weekdayMon0(yearFrom)}
                format={(v) => (metric === 'uptime_ms' ? `${((v * v) / 3_600_000).toFixed(1)} h on` : bytesText(v * v))} />
            </div>
          )}
        </Panel>
        <Panel title={`Busiest days · ${metric === 'uptime_ms' ? 'uptime' : metric} · ${rangeLabel}`} flush>
          {busiest.length ? (
            <UsageList
              items={busiest.map((d, i) => ({
                name: shortDay(d.day),
                seconds: d[metric],
                value: metric === 'uptime_ms' ? `${(d[metric] / 3_600_000).toFixed(1)} h` : bytesText(d[metric]),
                tone: i === 0 ? 'lime' : 'sky',
              }))}
            />
          ) : (
            <p className="muted panel-empty">Nothing recorded in this range.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
