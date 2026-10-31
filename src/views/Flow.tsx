import { useMemo, useState } from 'react';
import { api, type FlowSession, type FlowTask } from '../api';
import { Button, Panel, Segmented, StatTile } from '../ds/katsudo';
import { formatDuration, parseDay, shortDay, useData } from '../lib';
import { RANGE_OPTIONS, rangeDays, type RangeId } from './range';
import './tags.css';
import './flow.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hours = (s: number) => (s >= 360_000 ? `${Math.round(s / 3600).toLocaleString()} h` : formatDuration(s));
const clock = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
const tone = (t: { color: string | null }) => t.color ?? 'idle';

/** Weekday × hour of day, shaded by time in flow. */
function WhenGrid({ grid }: { grid: number[][] }) {
  const top = Math.max(1, ...grid.flat());
  return (
    <div className="fl-grid" role="img" aria-label="Time in flow by weekday and hour of day">
      {grid.map((row, d) => (
        <div key={d} className="fl-grid-row">
          <span className="fl-grid-day data-sm">{WEEKDAYS[d]}</span>
          {row.map((v, h) => (
            <span key={h} className="fl-cell" style={{ ['--v' as string]: v / top }}
              data-tip={v ? `${WEEKDAY_NAMES[d]} ${clock(h)}: ${hours(v)}` : undefined} />
          ))}
        </div>
      ))}
      <div className="fl-grid-row fl-grid-axis">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="data-sm">{h % 3 === 0 ? h : ''}</span>)}
      </div>
    </div>
  );
}

/** The two hours and the weekday with the most flow. */
function bestTimes(grid: number[][]) {
  const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h], 0));
  let best = -1;
  let at = 0;
  for (let h = 0; h < 24; h++) {
    const v = byHour[h] + byHour[(h + 1) % 24];
    if (v > best) [best, at] = [v, h];
  }
  const byDay = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const day = byDay.indexOf(Math.max(...byDay));
  return best > 0 ? { from: at, day } : null;
}

function DayBars({ days }: { days: [string, number][] }) {
  const every = days.length > 62 ? 7 : 1;
  const groups: { label: string; secs: number }[] = [];
  for (let i = 0; i < days.length; i += every) {
    const first = parseDay(days[i][0]);
    groups.push({
      label: every === 7 ? first.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : first.toLocaleDateString(undefined, days.length > 14 ? { day: 'numeric' } : { weekday: 'short' }),
      secs: days.slice(i, i + every).reduce((s, [, v]) => s + v, 0),
    });
  }
  const top = Math.max(1, ...groups.map((g) => g.secs));
  return (
    <div className="tg-bars" role="img" aria-label="Time in flow over the range">
      {groups.map((g, i) => (
        <div key={i} className="tg-bar-col" data-tip={`${g.label}: ${g.secs ? hours(g.secs) : 'none'}`}>
          <div className="tg-stack"><span className="tg-seg tone-lime" style={{ height: `${(g.secs / top) * 100}%` }} /></div>
          {(groups.length <= 31 || i % Math.ceil(groups.length / 16) === 0) && <span className="tg-bar-label data-sm">{g.label}</span>}
        </div>
      ))}
    </div>
  );
}

function when(s: FlowSession) {
  const start = new Date(s.start * 1000);
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${shortDay(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`)} · ${t(start)}–${t(new Date(s.end * 1000))}`;
}

export function FlowView({ firstDay }: { firstDay: string | null }) {
  const [range, setRange] = useState<RangeId>('month');
  const [version, setVersion] = useState(0);
  const [from, to] = rangeDays(range, firstDay);
  const report = useData(() => api.flowReport(from, to), [from, to, version]);
  const r = report.data;
  const best = useMemo(() => (r ? bestTimes(r.week_hours) : null), [r]);
  const [skip, setSkip] = useState<number[] | null>(null);
  const skipped = skip ?? r?.skipped.map((t) => t.task) ?? [];
  const toggle = async (task: number) => {
    const next = skipped.includes(task) ? skipped.filter((t) => t !== task) : [...skipped, task];
    setSkip(next);
    await api.setSetting('flow_skip', JSON.stringify(next));
    setVersion((v) => v + 1);
  };
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label.toLowerCase();
  const longest = r?.longest[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Flow</h1>
          <p className="text-body">
            Deep-work stretches, found for you: {r?.minutes ?? 25} minutes or more on one task, without going away or switching for more than two minutes at a time.
          </p>
        </div>
        <Segmented label="Range" options={RANGE_OPTIONS.filter((o) => o.value !== 'day')} value={range} onChange={(v) => setRange(v as RangeId)} />
      </div>
      {report.error && <p className="error">{report.error}</p>}
      {!r && !report.error && <p className="text-small faint">Looking through your history…</p>}
      {r && (
        <>
          <div className="tiles">
            <StatTile label={`Time in flow · ${rangeLabel}`} icon="star" tone="lime" value={hours(r.total)} />
            <StatTile label="Sessions" icon="timeline" tone="amber" value={r.count.toLocaleString()}
              unit={r.count ? `avg ${formatDuration(Math.round(r.total / r.count))}` : undefined} />
            <StatTile label="Of your active time" icon="clock" tone="sky" value={r.active ? String(Math.round((r.total / r.active) * 100)) : '0'} unit="%" />
            <StatTile label={longest ? `Longest · ${longest.label}` : 'Longest'} icon="flag" tone="rose" value={longest ? formatDuration(longest.end - longest.start) : '—'} />
          </div>

          {r.untagged && (
            <p className="text-small fl-hint">
              No tags yet, so every app is its own task and hopping between, say, your editor and a terminal ends a session.
              Tag the apps and sites you work in (Tags page) and Flow follows them. Browsers only count once their sites are tagged.
            </p>
          )}

          <div className="split">
            <Panel title="When you're in flow">
              <WhenGrid grid={r.week_hours} />
              {best && (
                <p className="text-body fl-best">
                  Your deepest hours are <strong>{clock(best.from)}–{clock(best.from + 2)}</strong>, and <strong>{WEEKDAY_NAMES[best.day]}</strong> is your best day.
                </p>
              )}
            </Panel>
            <Panel title="By task" flush>
              <TaskList tasks={r.tasks} total={r.total} skipped={false} onToggle={toggle} />
              {r.skipped.length > 0 && (
                <>
                  <div className="kt-label fl-skip-head">Not counted</div>
                  <TaskList tasks={r.skipped} total={r.total} skipped onToggle={toggle} />
                </>
              )}
            </Panel>
          </div>

          <div className="split">
            <Panel title={`Flow by day · ${rangeLabel}`}>
              <DayBars days={r.days} />
            </Panel>
            <Panel title="Longest sessions" flush>
              {r.longest.length ? (
                <ul className="fl-sessions">
                  {r.longest.map((s) => (
                    <li key={s.start}>
                      <span className={`tg-dot tone-${tone(s)}`} />
                      <div className="fl-session-main">
                        <div className="tg-total-name">{s.label}{s.task > 0 && s.app !== s.label ? <span className="faint"> · {s.app}</span> : null}</div>
                        <div className="data-sm faint">{when(s)}{s.breaks ? ` · ${s.breaks} short ${s.breaks === 1 ? 'detour' : 'detours'}` : ''}</div>
                      </div>
                      <span className="data-md">{formatDuration(s.end - s.start)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted fl-empty">No flow sessions in this range yet.</p>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function TaskList({ tasks, total, skipped, onToggle }: { tasks: FlowTask[]; total: number; skipped: boolean; onToggle: (task: number) => void }) {
  if (!tasks.length) return <p className="muted fl-empty">Nothing yet.</p>;
  return (
    <ul className={`fl-tasks${skipped ? ' is-skipped' : ''}`}>
      {tasks.map((t) => (
        <li key={t.task}>
          <span className={`tg-dot tone-${tone(t)}`} />
          <span className="tg-total-name">{t.label}{t.task < 0 && <span className="faint data-sm"> app</span>}</span>
          <span className="data-md">{hours(t.secs)}</span>
          <span className="data-sm faint tg-pct">{skipped ? `${t.sessions}×` : `${total ? Math.round((t.secs / total) * 100) : 0}%`}</span>
          <Button size="sm" variant="ghost" onClick={() => onToggle(t.task)}
            title={skipped ? 'Count this as flow again' : "Leave this out of flow (games, say)"}>
            {skipped ? 'Count it' : "Don't count"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
