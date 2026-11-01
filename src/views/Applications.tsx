import { useState } from 'react';
import { api, type AppTotal } from '../api';
import { Button, Panel, Segmented, UsageList } from '../ds/katsudo';
import { formatCount, formatDuration, useData } from '../lib';
import { RANGE_OPTIONS, rangeDays, type RangeId } from './range';

type Metric = 'seconds' | 'keys' | 'clicks';
const TONES = ['amber', 'cyan', 'rose', 'lime', 'sky'] as const;

export function Applications({ firstDay }: { firstDay: string | null }) {
  const [range, setRange] = useState<RangeId>('week');
  const [from, to] = rangeDays(range, firstDay);
  const { data, error } = useData(() => api.range(from, to), [from, to], range === 'day' ? 15000 : 0);
  const apps = data?.apps ?? [];
  const label = RANGE_OPTIONS.find((r) => r.value === range)?.label.toLowerCase();
  const totalTime = apps.reduce((s, a) => s + a.seconds, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Applications</h1>
          <p className="text-body">{formatCount(apps.length)} apps · {formatDuration(totalTime)} in front</p>
        </div>
        <Segmented label="Range" options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as RangeId)} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tri">
        <Ranked title={`By time · ${label}`} apps={apps} metric="seconds" loaded={!!data} />
        <Ranked title={`By keys · ${label}`} apps={apps} metric="keys" loaded={!!data} />
        <Ranked title={`By clicks · ${label}`} apps={apps} metric="clicks" loaded={!!data} />
      </div>
    </div>
  );
}

const TOP = 25;

function Ranked({ title, apps, metric, loaded }: { title: string; apps: AppTotal[]; metric: Metric; loaded: boolean }) {
  // The top 25, or every app down to the smallest in a scrolling list.
  const [all, setAll] = useState(false);
  const ranked = apps.filter((a) => a[metric] > 0).sort((a, b) => b[metric] - a[metric]);
  const top = all ? ranked : ranked.slice(0, TOP);
  return (
    <Panel title={title} flush>
      {top.length ? (
        <div className={all ? 'apps-all' : undefined}>
        <UsageList
          items={top.map((a, i) => ({
            name: a.name,
            // UsageList sizes bars from `seconds`; feed it this panel's metric.
            seconds: a[metric],
            value: metric === 'seconds' ? undefined : formatCount(a[metric]),
            meta: metric === 'seconds'
              ? (a.keys ? `${formatCount(a.keys)} keys · ${formatCount(a.clicks)} clicks` : undefined)
              : (a.seconds ? `${formatDuration(a.seconds)} in front` : undefined),
            tone: TONES[i] ?? 'sky',
          }))}
        />
        </div>
      ) : (
        <div className="empty"><p className="text-body">{loaded ? 'Nothing recorded in this range.' : ''}</p></div>
      )}
      {ranked.length > TOP && (
        <div className="apps-more">
          <Button size="sm" variant="ghost" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? `Show top ${TOP}` : `Show all ${ranked.length}`}
          </Button>
        </div>
      )}
    </Panel>
  );
}
