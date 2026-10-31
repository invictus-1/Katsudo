import { useEffect, useState } from 'react';
import { api, type RhythmBest, type RhythmLive, type RhythmOverview, type RhythmSession } from '../api';
import { Badge, Panel, StatTile, Switch } from '../ds/katsudo';
import { dateTime, formatCount, shortCount, useData } from '../lib';
import { useLive } from '../live';
import { OverlayPanel } from './OverlayPanel';

const clock = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const hours = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)} h` : `${Math.round(secs / 60)} min`);

/**
 * Keys per second over a session as bars, at most `cols` wide: long sessions keep each
 * column's highest second, so short bursts still show. Stream seconds are lit.
 */
function SessionChart({ series, threshold, cols = 600, live = false }: { series: number[]; threshold: number; cols?: number; live?: boolean }) {
  const every = Math.max(1, Math.ceil(series.length / cols));
  const bars: number[] = [];
  for (let i = 0; i < series.length; i += every) bars.push(Math.max(...series.slice(i, i + every)));
  const n = Math.max(bars.length, live ? 120 : 1);
  const top = Math.max(threshold * 1.5, ...bars);
  const y = (v: number) => 100 - (v / top) * 100;
  return (
    <div className="rh-chart">
      <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" role="img"
        aria-label={`Keys per second over ${clock(series.length)}, highest ${Math.max(0, ...series)}`}>
        <line className="rh-threshold" x1="0" x2={n} y1={y(threshold)} y2={y(threshold)} />
        {bars.map((v, i) => (
          <rect key={i} className={v >= threshold ? 'rh-bar is-stream' : 'rh-bar'} x={i + 0.12} width={0.76} y={y(v)} height={100 - y(v)} />
        ))}
      </svg>
      <div className="rh-axis data-sm">
        <span>{live ? '2 min ago' : '0:00'}</span>
        <span>{threshold}+ keys/s is a stream · top {Math.round(top)}</span>
        <span>{live ? 'now' : clock(series.length)}</span>
      </div>
    </div>
  );
}

function NowPlaying({ live, threshold }: { live: RhythmLive | null; threshold: number }) {
  const { live: meter } = useLive();
  if (!live) {
    return (
      <Panel title="Now playing">
        <p className="muted rh-idle">
          Start a rhythm game and this lights up: keys per second for the whole session, your peak and every stream of {threshold}+ keys a second.
          Recognised games are picked up by themselves; mark any other game below.
        </p>
      </Panel>
    );
  }
  const elapsed = Date.now() / 1000 - live.started;
  return (
    <Panel title={`Now playing · ${live.app}`} action={live.stream >= 3 ? <Badge tone="rose">Streaming · {live.stream} s</Badge> : undefined}>
      <div className="rh-now">
        <div>
          <div className={live.stream >= 3 ? 'live-value rh-hot' : 'live-value'}>{meter?.kps ?? 0}</div>
          <div className="data-sm muted">keys / s · peak {live.peak_kps} this session</div>
        </div>
        <dl className="rh-facts">
          <div><dt className="kt-label">Session</dt><dd className="data-lg">{clock(elapsed)}</dd></div>
          <div><dt className="kt-label">Keys</dt><dd className="data-lg">{formatCount(live.keys)}</dd></div>
          <div><dt className="kt-label">Best stream</dt><dd className="data-lg">{live.best_stream} s</dd></div>
        </dl>
      </div>
      <SessionChart series={live.recent} threshold={threshold} live />
    </Panel>
  );
}

function Bests({ bests }: { bests: RhythmBest[] }) {
  if (!bests.length) return null;
  return (
    <div className="rh-bests">
      {bests.map((b) => (
        <Panel key={b.app_id} title={b.app}
          action={<span className="data-sm muted">{formatCount(b.sessions)} {b.sessions === 1 ? 'session' : 'sessions'} · {hours(b.seconds)}</span>}>
          <div className="tiles rh-tiles">
            <StatTile label="Peak keys / s" icon="keyboard" tone="cyan" value={String(b.peak_kps)} unit={new Date(b.peak_at * 1000).toLocaleDateString()} />
            <StatTile label={`Longest stream`} icon="clock" tone="rose" value={String(b.best_stream)} unit="s" />
            <StatTile label="Most keys, one session" icon="keyboard" tone="amber" value={shortCount(b.most_keys)} />
            <StatTile label="All keys" icon="keyboard" tone="sky" value={shortCount(b.keys)} />
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Sessions({ sessions, threshold }: { sessions: RhythmSession[]; threshold: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const series = useData(() => (open == null ? Promise.resolve(null) : api.rhythmSeries(open).then((v) => ({ id: open, v }))), [open]);
  if (!sessions.length) return null;
  return (
    <Panel title="Sessions" flush>
      <table className="table rh-sessions">
        <thead>
          <tr>
            <th className="kt-label">Played</th><th className="kt-label">Game</th><th className="kt-label">Length</th>
            <th className="kt-label">Keys</th><th className="kt-label">Average</th><th className="kt-label">Peak</th><th className="kt-label">Longest stream</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const secs = s.end - s.start;
            return [
              <tr key={s.id} className={open === s.id ? 'is-open' : undefined} onClick={() => setOpen(open === s.id ? null : s.id)}
                tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === s.id ? null : s.id); } }}
                aria-expanded={open === s.id}>
                <td className="data-md">{dateTime(s.start)}</td>
                <td className="text-strong">{s.app}</td>
                <td className="data-md">{clock(secs)}</td>
                <td className="data-md">{formatCount(s.keys)}</td>
                <td className="data-md">{(s.keys / Math.max(1, secs)).toFixed(1)}/s</td>
                <td className="data-md">{s.peak_kps}/s</td>
                <td className="data-md">{s.best_stream ? `${s.best_stream} s` : '–'}{s.streams > 1 ? ` · ${s.streams} streams` : ''}</td>
              </tr>,
              open === s.id && (
                <tr key={`${s.id}-chart`} className="rh-detail">
                  <td colSpan={7}>{series.data?.id === s.id ? <SessionChart series={series.data.v} threshold={threshold} /> : <div className="rh-chart" />}</td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function Games({ data, onChange }: { data: RhythmOverview; onChange: () => void }) {
  return (
    <Panel title="Rhythm games">
      <p className="text-small faint rh-games-note">
        Sessions are kept while a game marked here is in front. Recognised ones (osu!, Quaver, Etterna, StepMania, beatoraja and more) are on by
        themselves. These are the apps you typed in most this year.
      </p>
      <div className="rh-games">
        {data.apps.map((a) => (
          <Switch key={a.key} checked={a.game} label={a.name}
            hint={`${a.known ? 'Recognised · ' : ''}${shortCount(a.keys)} keys this year`}
            onChange={async (on) => { await api.setRhythmGame(a.key, on); onChange(); }} />
        ))}
      </div>
    </Panel>
  );
}

export function Rhythm() {
  const overview = useData(api.rhythm, [], 15000);
  const [live, setLive] = useState<RhythmLive | null>(null);
  useEffect(() => {
    let on = true;
    const tick = () => api.rhythmLive().then((l) => { if (on) setLive(l); }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 250);
    return () => { on = false; window.clearInterval(id); };
  }, []);
  // A session that just ended shows up in the list straight away.
  const playing = live !== null;
  useEffect(() => { if (!playing) overview.reload(); }, [playing]);

  const data = overview.data;
  const threshold = data?.stream_kps ?? 10;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Rhythm</h1>
          <p className="text-body">Every session in a rhythm game, second by second. Peaks, streams and personal bests per game.</p>
        </div>
      </div>
      {overview.error && <p className="error">{overview.error}</p>}
      <NowPlaying live={live} threshold={threshold} />
      {data && <Bests bests={data.bests} />}
      {data && <Sessions sessions={data.sessions} threshold={threshold} />}
      {data && !data.sessions.length && !live && (
        <p className="text-small faint">No sessions yet. Short visits (under 20 seconds or 50 keys) aren't kept.</p>
      )}
      <OverlayPanel />
      {data && <Games data={data} onChange={overview.reload} />}
    </div>
  );
}
