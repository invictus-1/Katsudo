import { useState } from 'react';
import { api } from '../api';
import { Button, Panel, UsageList } from '../ds/katsudo';
import { formatDuration, longDay, rankRefs, shiftDay, todayIso, useData } from '../lib';
import { DayTimeline } from './DayTimeline';
import { openReceipt } from './Receipt';

export function TimelineView({ initialDay }: { initialDay?: string }) {
  const [day, setDay] = useState(initialDay ?? todayIso());
  const isToday = day === todayIso();
  const { data, error } = useData(() => api.day(day), [day], isToday ? 15000 : 0);

  const docs = new Map<number, number>();
  for (const s of data?.docs_lane ?? []) docs.set(s.ref, (docs.get(s.ref) ?? 0) + (s.to - s.from) * 3600);
  const docTone = rankRefs(data?.docs_lane ?? []);
  const topDocs = [...docs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">{longDay(day)}</h1>
          {data && <p className="text-body">Active {formatDuration(data.totals.active_secs)}</p>}
        </div>
        <div className="page-tools">
          <Button size="sm" icon="export" onClick={() => openReceipt(day)}>Receipt</Button>
          <Button size="sm" icon="chevron" aria-label="Previous day" className="flip" onClick={() => setDay(shiftDay(day, -1))} />
          <Button size="sm" disabled={isToday} onClick={() => setDay(todayIso())}>Today</Button>
          <Button size="sm" icon="chevron" aria-label="Next day" disabled={isToday} onClick={() => setDay(shiftDay(day, 1))} />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <Panel title="Timeline">
            {data.activity.length || data.apps_lane.length ? (
              <DayTimeline data={data} live={isToday} full />
            ) : (
              <p className="muted">Nothing recorded on this day.</p>
            )}
          </Panel>
          <div className="split-even">
            <Panel title="Applications" flush>
              <UsageList
                items={data.apps.slice(0, 15).map((a, i) => ({
                  name: a.name,
                  seconds: a.seconds,
                  meta: a.keys ? `${a.keys.toLocaleString('en-US')} keys · ${a.clicks.toLocaleString('en-US')} clicks` : undefined,
                  tone: (['amber', 'cyan', 'rose', 'lime', 'sky'] as const)[i] ?? 'sky',
                }))}
              />
            </Panel>
            <Panel title="Documents and sites" flush>
              {topDocs.length ? (
                <UsageList
                  items={topDocs.map(([ref, secs]) => ({ name: data.titles[ref] ?? 'Document', seconds: secs, tone: docTone.get(ref) ?? 'sky' }))}
                />
              ) : (
                <div className="empty"><p className="text-body">No window titles recorded on this day.</p></div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
