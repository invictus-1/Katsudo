// 1645 Ronin: the Musashi era as an old notebook. A mountain painted in sumi ink (washes, brushed
// ridges, axe-cut texture, mist, pines on the near hill) and a 五輪 column signed with a red
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

/**
 * A brush stroke along a path of points: the width runs from w0 to w1 (with a little wobble), so
 * a ridge line starts heavy where the brush lands and lifts away thin.
 */
function taper(pts: number[][], w0: number, w1: number) {
  const top: string[] = [];
  const bot: string[] = [];
  pts.forEach(([x, y], i) => {
    const [px, py] = pts[Math.max(0, i - 1)];
    const [qx, qy] = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(qx - px, qy - py) || 1;
    const [nx, ny] = [-(qy - py) / len, (qx - px) / len];
    const t = i / (pts.length - 1);
    const w = w0 + (w1 - w0) * t ** 0.8 + 0.8 * Math.sin(i * 1.7);
    top.push(`${(x + (nx * w) / 2).toFixed(1)} ${(y + (ny * w) / 2).toFixed(1)}`);
    bot.push(`${(x - (nx * w) / 2).toFixed(1)} ${(y - (ny * w) / 2).toFixed(1)}`);
  });
  return `M${top.join(' L')} L${bot.reverse().join(' L')} Z`;
}

/** Points along a cubic Bézier, for brushing along a curve. */
function bez(p0: number[], p1: number[], p2: number[], p3: number[], n = 28) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
}

// The peak, its shoulder to the right, and the ridges brushed from the summit down.
const PEAK = 'M250 300 C 360 232 430 176 488 112 C 516 80 540 50 560 40 C 588 62 612 92 640 122 C 662 140 676 150 690 152 C 708 132 728 114 746 110 C 784 146 846 206 930 268 L 990 300 Z';
const RIDGES = [
  taper(bez([560, 40], [536, 56], [500, 96], [470, 136]), 9, 1.5),
  taper(bez([560, 40], [586, 66], [614, 98], [646, 128]), 7, 1.2),
  taper(bez([746, 110], [772, 140], [810, 176], [850, 206]), 6, 1),
  taper(bez([520, 84], [512, 120], [520, 160], [540, 196]), 4, .8),
  taper(bez([600, 84], [606, 118], [596, 150], [584, 186]), 4, .8),
];
// Short axe-cut strokes on the faces, the way old painters gave rock its texture.
const TEXTURE = [
  [[498, 128], [486, 150]], [[528, 116], [518, 142]], [[548, 98], [542, 126]], [[620, 118], [632, 144]], [[652, 138], [664, 160]],
  [[722, 142], [736, 166]], [[760, 150], [776, 172]], [[470, 172], [458, 192]], [[574, 132], [566, 160]],
].map(([a, b]) => taper(bez(a, [a[0] + (b[0] - a[0]) * 0.3, a[1] + 6], [b[0], b[1] - 6], b, 8), 3.4, 0.6));
const HILLS = 'M80 300 C 210 238 300 222 400 238 C 500 256 580 222 690 236 C 800 250 880 232 1000 246 V300 Z';
const HILL_RIDGE = taper(bez([150, 270], [260, 228], [340, 226], [430, 240]), 5, 1);
// Pines on the near hill: a trunk and a few tiers of needles, each a quick dab of the brush.
const PINES = [[352, 232, 1], [384, 238, 0.8], [412, 244, 0.65]];

export function RoninArt() {
  return (
    <div className="rn">
      <svg className="rn-scene" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
          <filter id="rn-bleed" x="-5%" y="-10%" width="110%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="rn-soft"><feGaussianBlur stdDeviation="2.2" /></filter>
          <filter id="rn-mist"><feGaussianBlur stdDeviation="9" /></filter>
          <linearGradient id="rn-wash-peak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b1712" stopOpacity=".62" />
            <stop offset=".45" stopColor="#1b1712" stopOpacity=".26" />
            <stop offset="1" stopColor="#1b1712" stopOpacity=".04" />
          </linearGradient>
          <linearGradient id="rn-wash-hill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3e5566" stopOpacity=".42" />
            <stop offset="1" stopColor="#3e5566" stopOpacity=".08" />
          </linearGradient>
        </defs>
        <g transform="translate(-110 0)">
        <path className="rn-wash" d={PEAK} fill="url(#rn-wash-peak)" filter="url(#rn-soft)" />
        <g filter="url(#rn-bleed)">
          {RIDGES.map((d, i) => <path key={i} className="rn-ridge" d={d} />)}
          {TEXTURE.map((d, i) => <path key={i} className="rn-cun" d={d} />)}
        </g>
        <ellipse className="rn-mist" cx="560" cy="228" rx="460" ry="22" filter="url(#rn-mist)" />
        <path className="rn-wash" d={HILLS} fill="url(#rn-wash-hill)" filter="url(#rn-soft)" />
        <g filter="url(#rn-bleed)">
          <path className="rn-ridge is-hill" d={HILL_RIDGE} />
          {PINES.map(([x, y, s], i) => (
            <g key={i} className="rn-pine" transform={`translate(${x} ${y}) scale(${s})`}>
              <path d="M0 0 L1 -46" className="rn-trunk" />
              {[-40, -30, -20, -10].map((ty, k) => <ellipse key={k} cx={(k % 2 ? 3 : -2)} cy={ty} rx={14 - k} ry="3.2" />)}
            </g>
          ))}
        </g>
        </g>
      </svg>
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
