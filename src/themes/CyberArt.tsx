// 2077 Cyberpunk: a night city on the water. Far mega-structures with dim windows, towers with
// their own lit windows and blinking spires, a ネオ東京 billboard and neon signs; the whole
// skyline mirrored in the bay below, rippling. Flying cars, searchlights, a boat crossing, and
// rain as separate drops (moving one-pixel stripes shimmer). Styles in cyber.css.
import type { CSSProperties } from 'react';
import { NAME } from '../kanji';

/** Repeatable randomness, so the skyline is the same every time. */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const FAR = Array.from({ length: 18 }, (_, i) => ({ w: 3 + ((i * 37) % 5), h: 40 + ((i * 53) % 44) }));
/** sign: a rooftop sign on struts, a billboard in the facade, a blade sign on the side, a lantern. */
const TOWERS: { w: number; h: number; tone: string; spire?: boolean; sign?: 'roof' | 'board' | 'blade' | 'lantern' }[] = [
  { w: 7, h: 62, tone: 'warm' }, { w: 5, h: 44, tone: 'cyan', sign: 'lantern' }, { w: 9, h: 70, tone: 'warm', sign: 'roof' }, { w: 6, h: 56, tone: 'pink' },
  { w: 9, h: 74, tone: 'cyan', sign: 'board' }, { w: 6, h: 60, tone: 'warm' }, { w: 8, h: 92, tone: 'pink', spire: true }, { w: 5, h: 46, tone: 'cyan' },
  { w: 7, h: 70, tone: 'warm' }, { w: 5, h: 52, tone: 'pink', spire: true }, { w: 8, h: 80, tone: 'cyan', sign: 'blade' }, { w: 5, h: 42, tone: 'warm' },
];
const LIT: Record<string, string[]> = {
  warm: ['#f5e64b', '#ffd27a', '#ffb066'], cyan: ['#6ff8ff', '#9ab8ff', '#b8fbff'], pink: ['#ff5f90', '#f5e64b', '#d99bff'], dim: ['#5b4d8a', '#7a5cff', '#3a2d66'],
};

function Windows({ seed, tone, density = 0.36 }: { seed: number; tone: string; density?: number }) {
  const r = rng(seed * 7919 + 13);
  const cols = 6;
  const rows = 22;
  const cells: { x: number; y: number; c: string }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (r() < density) cells.push({ x, y, c: LIT[tone][Math.floor(r() * 3)] });
    }
  }
  return (
    <svg className="cy-win" viewBox={`0 0 ${cols * 5} ${rows * 6}`} preserveAspectRatio="none" aria-hidden="true">
      {cells.map((c, i) => <rect key={i} x={c.x * 5 + 1} y={c.y * 6 + 1.5} width="3" height="3" fill={c.c} opacity={0.5 + (i % 3) * 0.2} />)}
    </svg>
  );
}

/** The skyline down to the waterline: drawn twice, once standing and once in the water. */
function City() {
  return (
    <>
      <div className="cy-far">
        {FAR.map((t, i) => (
          <i key={i} style={{ width: `${t.w}%`, height: `${t.h}%` }}><Windows seed={100 + i} tone="dim" density={0.18} /></i>
        ))}
      </div>
      <div className="cy-towers">
        {TOWERS.map((t, i) => (
          <div key={i} className={`cy-tower is-${t.tone}`} style={{ width: `${t.w}%`, height: `${t.h}%` }}>
            {t.spire && <span className="cy-spire"><b style={{ animationDelay: `${-i * 0.7}s` }} /></span>}
            <Windows seed={i + 1} tone={t.tone} />
            {t.sign === 'board' && <div className="cy-board"><span>ネ</span><span>オ</span><span>東</span><span>京</span></div>}
            {t.sign === 'roof' && <div className="cy-roof"><span>KATSUDO</span></div>}
            {t.sign === 'blade' && <div className="cy-blade"><span>{NAME[0]}</span><span>{NAME[1]}</span></div>}
            {t.sign === 'lantern' && <div className="cy-lantern">酒</div>}
          </div>
        ))}
      </div>
    </>
  );
}

const CARS = [
  { y: 10, d: 13, delay: 0, left: false, s: 1 },
  { y: 20, d: 19, delay: -7, left: true, s: 0.75 },
  { y: 30, d: 10, delay: -3, left: false, s: 1.2 },
  { y: 14, d: 26, delay: -15, left: true, s: 0.55 },
  { y: 38, d: 15, delay: -9, left: true, s: 0.9 },
  { y: 25, d: 22, delay: -18, left: false, s: 0.65 },
];
const DROPS = Array.from({ length: 70 }, (_, i) => ({ x: (i * 37.7) % 100, d: 0.45 + ((i * 13) % 7) * 0.06, delay: -((i * 0.071) % 1) }));

export function CyberArt() {
  return (
    <div className="cy">
      <div className="cy-sky" />
      <div className="cy-beams"><i /><i /></div>
      <div className="cy-city"><City /></div>
      <div className="cy-bay">
        <div className="cy-reflection"><div className="cy-city"><City /></div></div>
        <div className="cy-ripples" />
        <div className="cy-boat-lane"><i className="cy-boat" /></div>
      </div>
      <div className="cy-waterline" />
      <div className="cy-traffic">
        {CARS.map((c, i) => (
          <div key={i} className={`cy-lane${c.left ? ' is-left' : ''}`} style={{ top: `${c.y}%`, animationDuration: `${c.d}s`, animationDelay: `${c.delay}s` }}>
            <i className="cy-car" style={{ '--s': c.s } as CSSProperties} />
          </div>
        ))}
      </div>
      <div className="cy-rain">{DROPS.map((d, i) => <i key={i} style={{ left: `${d.x}%`, animationDuration: `${d.d}s`, animationDelay: `${d.delay}s` }} />)}</div>
    </div>
  );
}
