// 2077 Cyberpunk: a night city in layers. Far mega-structures, towers with lit windows and
// blinking antennas, a ネオ東京 billboard, an elevated highway with light trails and a red bike
// streak, flying cars at different heights, searchlights, and rain as separate drops (moving
// one-pixel stripes shimmer). Styles in cyber.css.
import type { CSSProperties } from 'react';
import { NAME } from '../kanji';

/** Repeatable randomness, so the skyline is the same every time. */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const FAR = Array.from({ length: 16 }, (_, i) => ({ w: 3 + ((i * 37) % 5), h: 34 + ((i * 53) % 42) }));
const TOWERS = [
  { w: 8, h: 64, tone: 'warm' }, { w: 5, h: 46, tone: 'cyan' }, { w: 11, h: 94, tone: 'warm', spire: true }, { w: 6, h: 58, tone: 'pink' },
  { w: 10, h: 76, tone: 'cyan', board: true }, { w: 7, h: 62, tone: 'warm' }, { w: 9, h: 86, tone: 'pink', spire: true }, { w: 5, h: 44, tone: 'cyan' },
];
const LIT: Record<string, string[]> = { warm: ['#f5e64b', '#ffd27a', '#ffb066'], cyan: ['#6ff8ff', '#9ab8ff', '#b8fbff'], pink: ['#ff5f90', '#f5e64b', '#d99bff'] };

function Windows({ seed, tone }: { seed: number; tone: string }) {
  const r = rng(seed * 7919 + 13);
  const cols = 6;
  const rows = 22;
  const cells: { x: number; y: number; c: string }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (r() < 0.36) cells.push({ x, y, c: LIT[tone][Math.floor(r() * 3)] });
    }
  }
  return (
    <svg className="cy-win" viewBox={`0 0 ${cols * 5} ${rows * 6}`} preserveAspectRatio="none" aria-hidden="true">
      {cells.map((c, i) => <rect key={i} x={c.x * 5 + 1} y={c.y * 6 + 1.5} width="3" height="3" fill={c.c} opacity={0.5 + (i % 3) * 0.2} />)}
    </svg>
  );
}

const CARS = [
  { y: 16, d: 13, delay: 0, left: false, s: 1 },
  { y: 28, d: 19, delay: -7, left: true, s: 0.75 },
  { y: 40, d: 10, delay: -3, left: false, s: 1.25 },
  { y: 22, d: 26, delay: -15, left: true, s: 0.55 },
  { y: 50, d: 15, delay: -9, left: true, s: 1 },
  { y: 34, d: 22, delay: -18, left: false, s: 0.65 },
];
const DROPS = Array.from({ length: 70 }, (_, i) => ({ x: (i * 37.7) % 100, d: 0.45 + ((i * 13) % 7) * 0.06, delay: -((i * 0.071) % 1) }));

export function CyberArt() {
  return (
    <div className="cy">
      <div className="cy-sky" />
      <div className="cy-beams"><i /><i /></div>
      <div className="cy-far">{FAR.map((t, i) => <i key={i} style={{ width: `${t.w}%`, height: `${t.h}%` }} />)}</div>
      <div className="cy-towers">
        {TOWERS.map((t, i) => (
          <div key={i} className={`cy-tower is-${t.tone}`} style={{ width: `${t.w}%`, height: `${t.h}%` }}>
            {t.spire && <span className="cy-spire"><b style={{ animationDelay: `${-i * 0.7}s` }} /></span>}
            <Windows seed={i + 1} tone={t.tone} />
            {t.board && <div className="cy-board"><span>ネ</span><span>オ</span><span>東</span><span>京</span></div>}
          </div>
        ))}
      </div>
      <div className="cy-sign"><span>{NAME[0]}</span><span>{NAME[1]}</span></div>
      <div className="cy-sign-h">KATSUDO</div>
      <div className="cy-sign-s">酒</div>
      <div className="cy-traffic">
        {CARS.map((c, i) => (
          <div key={i} className={`cy-lane${c.left ? ' is-left' : ''}`} style={{ top: `${c.y}%`, animationDuration: `${c.d}s`, animationDelay: `${c.delay}s` }}>
            <i className="cy-car" style={{ '--s': c.s } as CSSProperties} />
          </div>
        ))}
      </div>
      <div className="cy-road">
        <div className="cy-trails is-red" />
        <div className="cy-trails is-white" />
        <div className="cy-bike"><i /></div>
      </div>
      <div className="cy-rain">{DROPS.map((d, i) => <i key={i} style={{ left: `${d.x}%`, animationDuration: `${d.d}s`, animationDelay: `${d.delay}s` }} />)}</div>
    </div>
  );
}
