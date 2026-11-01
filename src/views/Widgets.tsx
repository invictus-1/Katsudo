import { Panel } from '../ds/katsudo';
import { formatCount } from '../lib';
import { bucketMax, useLive } from '../live';

/** Keys and clicks for each hour of a day, as paired bars. */
export function HourBars({ hourly, live }: { hourly: { hour: number; keys: number; clicks: number }[]; live?: boolean }) {
  const peak = Math.max(1, ...hourly.map((h) => h.keys + h.clicks));
  const now = new Date().getHours();
  return (
    <div>
      <div className="hours">
        {hourly.map((h) => (
          <div key={h.hour} className={`hours-col${live && h.hour === now ? ' is-now' : ''}`}
            data-hint={`${String(h.hour).padStart(2, '0')}:00 · ${formatCount(h.keys)} keys · ${formatCount(h.clicks)} clicks`}>
            <i className="c" style={{ height: `${(h.clicks / peak) * 100}%` }} />
            <i className="k" style={{ height: `${(h.keys / peak) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="hours-axis data-sm">
        {hourly.map((h) => <span key={h.hour}>{h.hour % 3 === 0 ? String(h.hour).padStart(2, '0') : ''}</span>)}
      </div>
    </div>
  );
}

/** The last minute of keys per second, stretched to fill its box (unlike Sparkline, which keeps its aspect). */
function LiveTrace({ values }: { values: number[] }) {
  const n = 120;
  const v = values.length >= n ? values.slice(-n) : [...Array(n - values.length).fill(0), ...values];
  const peak = Math.max(10, ...v);
  const pts = v.map((y, i) => `${i},${100 - (y / peak) * 100}`).join(' ');
  return (
    <svg viewBox={`0 0 ${n - 1} 100`} preserveAspectRatio="none" aria-hidden="true">
      <polygon className="area" points={`0,100 ${pts} ${n - 1},100`} />
      <polyline className="line" points={pts} />
    </svg>
  );
}

/** Keys per second right now, the last minute of it, and today's peak. */
export function LivePanel() {
  const { live, history } = useLive();
  const series = bucketMax(history, 5);
  return (
    <Panel title="Keys per second · live">
      <div className="live">
        <div>
          <div className="live-value">{live?.kps ?? 0}</div>
          <div className="data-sm muted">peak {live?.peak_kps ?? 0} today</div>
        </div>
        <div className="live-spark">
          <LiveTrace values={series} />
        </div>
      </div>
      <p className="text-small faint" style={{ margin: 'var(--space-3) 0 0' }}>
        Counted the moment a key goes down, sampled every 20 ms. Held keys count once.
      </p>
    </Panel>
  );
}
