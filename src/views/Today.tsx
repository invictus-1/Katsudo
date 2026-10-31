import { api, type DayView } from '../api';
import { KeyboardHeatmap, Panel, StatTile, UsageList } from '../ds/katsudo';
import { bytes, formatCount, formatDuration, longDay, todayIso, useData, weekdayName } from '../lib';
import { bucketMax, useLive } from '../live';
import { Hero } from '../themes/Hero';
import type { ThemeId } from '../themes/themes';
import { DayTimeline } from './DayTimeline';
import { HourBars } from './Widgets';

export function Today({ theme }: { theme: ThemeId }) {
  const day = todayIso();
  const { data, error } = useData(() => api.day(day), [day], 10000);
  const keys = useData(() => api.keys(day, day), [day], 15000);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page" />;
  return <TodayBody data={data} theme={theme} keys={keys.data} />;
}

function TodayBody({ data, theme, keys }: { data: DayView; theme: ThemeId; keys: Record<string, number> | null }) {
  const { live, history } = useLive();
  const t = data.totals;
  // Live counters are exact (stored + not yet stored); the day view refreshes every 10 s.
  const keysNow = live?.keys_today ?? t.keys;
  const clicksNow = live?.clicks_today ?? t.clicks;
  const series = (f: (d: DayView['week'][number]) => number) => data.week.map(f);
  const empty = !t.active_secs && !keysNow && !data.apps_lane.length;
  const [down, downUnit] = bytes(t.download);
  const weekday = weekdayName(data.day);

  return (
    <div className="page">
      <Hero
        theme={theme}
        weekday={weekday}
        date={longDay(data.day).replace(`${weekday}, `, '')}
        hourly={data.hourly.map((h) => h.keys)}
        kps={live?.kps ?? 0}
        peak={live?.peak_kps ?? 0}
        keysToday={keysNow}
      />
      {/* No deltas: a day in progress against whole past days would always read as "down". */}
      <div className="tiles">
        <StatTile label="Active time" icon="clock" tone="amber" value={formatDuration(t.active_secs)} data={series((d) => d.active_secs)} />
        {/* Shown instead of the header's readout when the window is too narrow for both it and the art. */}
        <div className="kps-tile">
          <StatTile label={`Keys / sec · peak ${live?.peak_kps ?? 0}`} icon="keyboard" tone="cyan" value={String(live?.kps ?? 0)} unit="live"
            data={bucketMax(history, 5).slice(-24)} />
        </div>
        <StatTile label="Keystrokes" icon="keyboard" tone="cyan" value={formatCount(keysNow)} data={series((d) => d.keys)} />
        <StatTile label="Clicks" icon="mouse" tone="rose" value={formatCount(clicksNow)} data={series((d) => d.clicks)} />
        <StatTile label="Downloaded" icon="network" tone="lime" value={down} unit={downUnit} data={series((d) => d.download)} />
        <StatTile label="Uptime" icon="clock" tone="sky" value={(t.uptime_ms / 3_600_000).toFixed(1)} unit="h" data={series((d) => d.uptime_ms)} />
      </div>
      {empty ? (
        <Panel>
          <div className="empty">
            <h2 className="display-md">Nothing tracked yet today.</h2>
            <p className="text-body">Katsudō starts counting when you do. Bring your history in from ManicTime or WhatPulse under Import.</p>
          </div>
        </Panel>
      ) : (
        <div className="split">
          <div className="stack">
            <Panel title="Timeline · today">
              <DayTimeline data={data} live />
            </Panel>
            <Panel title="Hour by hour" action={<div className="legend text-small"><span className="k">Keys</span><span className="c">Clicks</span></div>}>
              <HourBars hourly={data.hourly} live />
            </Panel>
          </div>
          <div className="stack">
            <Panel title="Applications · today" flush>
              <UsageList
                items={data.apps.slice(0, 8).map((a, i) => ({
                  name: a.name,
                  seconds: a.seconds,
                  meta: a.keys || a.clicks ? `${formatCount(a.keys)} keys · ${formatCount(a.clicks)} clicks` : undefined,
                  tone: (['amber', 'cyan', 'rose', 'lime', 'sky'] as const)[i] ?? 'sky',
                }))}
              />
            </Panel>
            <Panel title="Keyboard · today">
              {keys && Object.keys(keys).length ? (
                <KeyboardHeatmap counts={keys} label="Key presses today" />
              ) : (
                <p className="muted">No key presses yet today.</p>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
