import { useEffect, useMemo, useState } from 'react';
import { api, type AppKeys } from '../api';
import { Button, Panel, Segmented } from '../ds/katsudo';
import { formatCount } from '../lib';
import { byPosition, FINGERS, handsReport, keyIdFromCode, keyLabel, parseHands, type Finger, type HandsConfig, type Preset } from '../hands';
import './hands.css';

// The left hand from the back, thumb towards the middle: [x, y, width, height] per finger.
const SHAPES: Record<'p' | 'r' | 'm' | 'i', [number, number, number, number]> = {
  p: [0, 72, 34, 96], r: [40, 36, 36, 124], m: [82, 20, 38, 138], i: [126, 38, 36, 122],
};
const W = 560;
const OX = 24;

/** Two hands, each finger shaded by how much it did. */
function HandsDiagram({ total }: { total: Record<Finger, number> }) {
  const max = Math.max(1, ...Object.values(total));
  const sum = Object.values(total).reduce((a, b) => a + b, 0) || 1;
  const fill = (f: Finger) => ({ fill: `color-mix(in srgb, var(--amber) ${Math.round(8 + 92 * (total[f] / max))}%, var(--surface-200))` });
  const name = (f: Finger) => FINGERS.find((x) => x.id === f)!.name;
  const hand = (side: 'l' | 'r') => {
    const mirror = (x: number, w: number) => (side === 'l' ? OX + x : W - OX - x - w);
    const palmX = mirror(0, 162);
    const thumbX = mirror(150, 34);
    const thumbAngle = side === 'l' ? 36 : -36;
    const thumbCx = thumbX + 17;
    return (
      <g key={side}>
        <rect className="hd-palm" x={palmX} y={128} width={162} height={86} rx={28} />
        {(['p', 'r', 'm', 'i'] as const).map((k) => {
          const [x, y, w, h] = SHAPES[k];
          const f = `${side}${k}` as Finger;
          const fx = mirror(x, w);
          return (
            <g key={k}>
              <rect className="hd-finger" x={fx} y={y} width={w} height={h} rx={w / 2} style={fill(f)}>
                <title>{`${name(f)}: ${formatCount(Math.round(total[f]))} (${Math.round((total[f] / sum) * 100)}%)`}</title>
              </rect>
              <text className="hd-pct" x={fx + w / 2} y={y + 26}>{Math.round((total[f] / sum) * 100)}%</text>
            </g>
          );
        })}
        <g transform={`rotate(${thumbAngle} ${thumbCx} 206)`}>
          <rect className="hd-finger" x={thumbX} y={118} width={34} height={86} rx={17} style={fill(`${side}t` as Finger)}>
            <title>{`${name(`${side}t` as Finger)}: ${formatCount(Math.round(total[`${side}t` as Finger]))}`}</title>
          </rect>
        </g>
        <text className="hd-pct" x={side === 'l' ? OX + 214 : W - OX - 214} y={160}>{Math.round((total[`${side}t` as Finger] / sum) * 100)}%</text>
      </g>
    );
  };
  return (
    <svg className="hd-diagram" viewBox={`0 0 ${W} 232`} role="img" aria-label="Load on each finger">
      {hand('l')}
      {hand('r')}
    </svg>
  );
}

const PRESETS = [
  { value: 'typing', label: 'Touch typing' },
  { value: 'gaming', label: 'Gaming' },
];
const APP_PRESETS = [
  { value: 'default', label: 'Default' },
  { value: 'typing', label: 'Typing' },
  { value: 'gaming', label: 'Gaming' },
];

export function HandsPanel({ keys, apps, clicks, scrolls, label, keyMap }: {
  keys: Record<string, number>; apps: AppKeys[]; clicks: number; scrolls: number; label: string;
  /** The keyboard layout in use, so fingers follow physical keys. */
  keyMap?: Record<string, [string, string]>;
}) {
  const [cfg, setCfg] = useState<HandsConfig | null>(null);
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => { api.settings().then((s) => setCfg(parseHands(s.hands))); }, []);
  useEffect(() => {
    if (!listening) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const id = keyIdFromCode(e.code);
      if (id) {
        setPending(id);
        setListening(false);
      }
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [listening]);

  const save = (next: HandsConfig) => {
    setCfg(next);
    api.setSetting('hands', JSON.stringify(next));
  };
  const r = useMemo(() => (cfg
    ? handsReport(byPosition(keys, keyMap), apps.map((a) => ({ ...a, keys: byPosition(a.keys, keyMap) })), cfg, clicks, scrolls)
    : null), [keys, apps, cfg, clicks, scrolls, keyMap]);
  if (!cfg || !r) return null;
  const sum = r.left + r.right || 1;
  const busiest = [...FINGERS].sort((a, b) => r.total[b.id] - r.total[a.id])[0];
  const kbLeft = FINGERS.filter((f) => f.hand === 'left').reduce((s, f) => s + r.keyboard[f.id], 0);
  const kbRight = FINGERS.filter((f) => f.hand === 'right').reduce((s, f) => s + r.keyboard[f.id], 0);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <Panel title={`Hands · ${label}`}
      action={<div className="hd-actions">
        <Segmented size="sm" label="Finger map" options={PRESETS} value={cfg.preset} onChange={(v) => save({ ...cfg, preset: v as Preset })} />
        <Segmented size="sm" label="Mouse hand" options={[{ value: 'right', label: 'Mouse right' }, { value: 'left', label: 'Mouse left' }]} value={cfg.mouse}
          onChange={(v) => save({ ...cfg, mouse: v as 'left' | 'right' })} />
      </div>}>
      <div className="hd-grid">
        <div>
          <HandsDiagram total={r.total} />
          <div className="hd-balance" role="img" aria-label={`Left hand ${pct(r.left / sum)}, right hand ${pct(r.right / sum)}`}>
            <span className="hd-bal-l" style={{ flexBasis: pct(r.left / sum) }}>Left {pct(r.left / sum)}</span>
            <span className="hd-bal-r" style={{ flexBasis: pct(r.right / sum) }}>Right {pct(r.right / sum)}</span>
          </div>
          <p className="text-small faint hd-note">
            Keyboard {pct(kbLeft / ((kbLeft + kbRight) || 1))} left; the mouse ({formatCount(clicks)} clicks, {formatCount(scrolls)} scrolls) is on the {cfg.mouse} hand.
            Fingers are inferred from the finger map, since a keyboard only reports keys.
          </p>
        </div>
        <div className="hd-side">
          <ul className="hd-stats">
            <li><span>Busiest finger</span><b>{busiest.name}</b><span className="faint">{pct(r.total[busiest.id] / sum)}</span></li>
            <li><span>Home row</span><b>{pct(r.rows.home)}</b><span className="faint">of letter keys</span></li>
            <li><span>Top row</span><b>{pct(r.rows.top)}</b></li>
            <li><span>Bottom row</span><b>{pct(r.rows.bottom)}</b></li>
            <li><span>Number row</span><b>{pct(r.rows.number)}</b></li>
          </ul>

          <div className="kt-label hd-head">Per app</div>
          {apps.length ? (
            <ul className="hd-apps">
              {apps.slice(0, 6).map((a) => (
                <li key={a.app_id}>
                  <span className="hd-app-name">{a.name}<span className="faint data-sm"> {formatCount(a.total)}</span></span>
                  <Segmented size="sm" label={`Finger map for ${a.name}`} options={APP_PRESETS} value={cfg.apps[String(a.app_id)] ?? 'default'}
                    onChange={(v) => {
                      const next = { ...cfg.apps };
                      if (v === 'default') delete next[String(a.app_id)]; else next[String(a.app_id)] = v as Preset;
                      save({ ...cfg, apps: next });
                    }} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small faint">Per-app key counts start with this version.</p>
          )}

          <div className="kt-label hd-head">Your own fingering</div>
          {pending ? (
            <div className="hd-assign">
              <span className="text-small">Which finger presses <b>{keyLabel(pending)}</b>?</span>
              <div className="hd-fingers">
                {FINGERS.map((f) => (
                  <Button key={f.id} size="sm" onClick={() => { save({ ...cfg, keys: { ...cfg.keys, [pending]: f.id } }); setPending(null); }}>{f.name.replace('Left ', 'L ').replace('Right ', 'R ')}</Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => setListening(!listening)}>{listening ? 'Press the key…' : 'Reassign a key'}</Button>
          )}
          {Object.keys(cfg.keys).length > 0 && (
            <ul className="hd-custom">
              {Object.entries(cfg.keys).map(([k, f]) => (
                <li key={k}>
                  <span><b>{keyLabel(k)}</b> → {FINGERS.find((x) => x.id === f)?.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => { const next = { ...cfg.keys }; delete next[k]; save({ ...cfg, keys: next }); }}>Reset</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
