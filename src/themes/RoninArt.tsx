// 1645 Ronin: the Musashi era as an old notebook, laid out as a calligraphy piece. A sumi brush
// sweep in grey wash, a large brushed 活 with ink splatter, and a 五輪 column signed with a red
// seal. The day's name can be cut: sweep the pointer through it and it splits along the line of
// the cut, then settles back (it cuts itself once when Today opens). Styles in ronin.css.
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Hanko, NAME } from '../kanji';

/**
 * The ensō as a filled shape: a circle drawn by a brush that starts heavy and thins out,
 * wobbling slightly, so it reads as one stroke (an outline stroke looks drawn by a pen).
 */
function ensoShape() {
  const N = 90;
  const start = (-58 * Math.PI) / 180;
  const sweep = (322 * Math.PI) / 180;
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = start - sweep * t;
    const w = 19 * (1 - 0.78 * t ** 1.4) + 1.2 * Math.sin(t * 23);
    const r = 70 + 2.2 * Math.sin(t * 7 + 1);
    outer.push(`${(100 + (r + w / 2) * Math.cos(a)).toFixed(1)} ${(100 + (r + w / 2) * Math.sin(a)).toFixed(1)}`);
    inner.push(`${(100 + (r - w / 2) * Math.cos(a)).toFixed(1)} ${(100 + (r - w / 2) * Math.sin(a)).toFixed(1)}`);
  }
  return `M${outer.join(' L')} L${inner.reverse().join(' L')} Z`;
}
const ENSO = ensoShape();

export function Enso({ className }: { className?: string }) {
  return (
    <svg className={`rn-enso${className ? ` ${className}` : ''}`} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <filter id="rn-ink" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <path className="rn-enso-ink" d={ENSO} filter="url(#rn-ink)" />
    </svg>
  );
}

/** A brush sweep along a curve: thin in, swelling, thinning out, with dry streaks at the tail. */
function sweepShape() {
  const P = [[30, 210], [380, 40], [960, 150]];
  const pt = (t: number) => {
    const u = 1 - t;
    return [u * u * P[0][0] + 2 * u * t * P[1][0] + t * t * P[2][0], u * u * P[0][1] + 2 * u * t * P[1][1] + t * t * P[2][1]];
  };
  const N = 80;
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, y] = pt(t);
    const [x2, y2] = pt(Math.min(1, t + 0.01));
    const len = Math.hypot(x2 - x, y2 - y) || 1;
    const [nx, ny] = [-(y2 - y) / len, (x2 - x) / len];
    const w = 4 + 46 * Math.sin(Math.PI * Math.min(1, t * 1.25)) ** 0.7 * (1 - t * 0.55) + 2 * Math.sin(t * 31);
    top.push(`${(x + nx * w / 2).toFixed(1)} ${(y + ny * w / 2).toFixed(1)}`);
    bot.push(`${(x - nx * w / 2).toFixed(1)} ${(y - ny * w / 2).toFixed(1)}`);
  }
  const streaks = [-14, -5, 6, 15].map((o, k) => {
    const [a, b] = [pt(0.78 + k * 0.01), pt(0.99)];
    return `M${a[0].toFixed(1)} ${(a[1] + o).toFixed(1)} Q ${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2 + o * 0.6 - 4).toFixed(1)} ${(b[0] + 20).toFixed(1)} ${(b[1] + o * 0.4).toFixed(1)}`;
  });
  return { body: `M${top.join(' L')} L${bot.reverse().join(' L')} Z`, streaks };
}
const SWEEP = sweepShape();
const SPLATTER = [[612, 62, 5], [640, 48, 2.4], [596, 40, 1.6], [660, 74, 1.8], [298, 228, 3.6], [270, 240, 1.5], [318, 250, 2], [850, 196, 2.6], [878, 210, 1.4]];

export function RoninArt() {
  return (
    <div className="rn">
      <svg className="rn-scene" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <filter id="rn-bleed" x="-5%" y="-10%" width="110%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <g filter="url(#rn-bleed)">
          <path className="rn-sweep" d={SWEEP.body} />
          {SWEEP.streaks.map((d, i) => <path key={i} className="rn-streak" d={d} />)}
          {SPLATTER.map(([x, y, r], i) => <circle key={i} className="rn-drop" cx={x} cy={y} r={r} />)}
        </g>
      </svg>
      <div className="rn-big">{NAME[0]}</div>
      <div className="rn-signature">
        <div className="rn-column"><span>五</span><span>輪</span></div>
        <Hanko className="rn-seal" />
      </div>
    </div>
  );
}

// ---- The cut -----------------------------------------------------------------------------

interface Cut { id: number; x: number; y: number; angle: number }

/** Clip one side of the line through (x, y) at `angle` (radians), in px, far past the box. */
function half(c: Cut, side: 1 | -1) {
  const [dx, dy] = [Math.cos(c.angle), Math.sin(c.angle)];
  const [nx, ny] = [-dy * side, dx * side];
  const F = 4000;
  const p = (x: number, y: number) => `${x.toFixed(0)}px ${y.toFixed(0)}px`;
  return `polygon(${p(c.x - dx * F, c.y - dy * F)}, ${p(c.x + dx * F, c.y + dy * F)}, ${p(c.x + dx * F + nx * F, c.y + dy * F + ny * F)}, ${p(c.x - dx * F + nx * F, c.y - dy * F + ny * F)})`;
}

const calm = () => document.documentElement.classList.contains('no-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The day's name, cut by a quick sweep of the pointer through it. */
export function SlashTitle({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const entry = useRef<{ x: number; y: number; t: number } | null>(null);
  const [cut, setCut] = useState<Cut | null>(null);
  const [apart, setApart] = useState(false);

  const slash = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    if (calm()) return;
    setCut({ id: Date.now(), x: (x1 + x2) / 2, y: (y1 + y2) / 2, angle: Math.atan2(y2 - y1, x2 - x1) });
    setApart(true);
  }, []);

  useEffect(() => {
    if (!cut) return;
    const settle = window.setTimeout(() => setApart(false), 650);
    const heal = window.setTimeout(() => setCut(null), 1300);
    return () => { window.clearTimeout(settle); window.clearTimeout(heal); };
  }, [cut]);

  // Once when Today opens, a cut from lower left to upper right.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (el) slash(0, el.offsetHeight * 0.78, el.offsetWidth, el.offsetHeight * 0.3);
    }, 900);
    return () => window.clearTimeout(t);
  }, [slash]);

  const local = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const z = r.width / ref.current!.offsetWidth || 1; // the interface scale (CSS zoom)
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  };
  const onEnter = (e: PointerEvent) => { entry.current = { ...local(e), t: performance.now() }; };
  const onLeave = (e: PointerEvent) => {
    const from = entry.current;
    entry.current = null;
    const el = ref.current;
    if (!from || !el || cut) return;
    const to = local(e);
    // A cut is fast and goes most of the way through.
    if (performance.now() - from.t < 450 && Math.hypot(to.x - from.x, to.y - from.y) > el.offsetWidth * 0.45) slash(from.x, from.y, to.x, to.y);
  };

  const [dx, dy] = cut ? [Math.cos(cut.angle), Math.sin(cut.angle)] : [0, 0];
  const shift = (side: 1 | -1) => (apart ? `translate(${(dx * 16 - dy * 6) * side}px, ${(dy * 16 + dx * 6) * side}px)` : 'none');
  return (
    <h1 className={`hero-title rn-slash${cut ? ' is-cut' : ''}`} ref={ref} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <span className="rn-half" style={cut ? { clipPath: half(cut, 1), transform: shift(1) } : undefined}>{text}</span>
      {cut && <span className="rn-half is-b" aria-hidden="true" style={{ clipPath: half(cut, -1), transform: shift(-1) }}>{text}</span>}
      {cut && (
        <i key={cut.id} className="rn-trail" aria-hidden="true"
          style={{ left: cut.x, top: cut.y, transform: `translate(-50%, -50%) rotate(${cut.angle}rad)` }} />
      )}
    </h1>
  );
}

export function RoninWelcome() {
  return (
    <div className="wl-rn">
      <div className="wl-rn-center">
        <Enso className="wl-rn-enso" />
        <div className="wl-rn-kanji">{NAME}</div>
      </div>
      <Hanko className="wl-rn-seal" />
      <div className="wl-rn-title">Katsudō</div>
    </div>
  );
}
