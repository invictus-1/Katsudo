import type { CSSProperties } from 'react';
import type { ThemeId } from './themes';
import { formatCount } from '../lib';
import { RamenArt, SteamArt, UkiyoeArt } from './EarlyArt';
import { AnimeArt, CyberArt, episode, SignalArt, StarshipArt, VaporArt } from './FutureArt';

interface HeroProps {
  theme: ThemeId;
  weekday: string;
  date: string;
  hourly: number[];
  kps: number;
  peak: number;
  keysToday: number;
}

const EYEBROW: Record<ThemeId, string> = {
  ukiyoe: 'The floating world · today',
  steampunk: 'Engine room · the day’s log',
  ramen: 'Open late · today',
  anime: 'Episode',
  cyberpunk: 'Night city · live feed',
  starship: 'Bridge · activity log',
  signal: 'Transmission received · today',
  vapor: 'Today',
  phosphor: '> katsudo --today',
  arcade: '1UP · PLAYER ONE',
  synthwave: 'NOW TRACKING',
  beige: 'C:\\KATSUDO\\TODAY.LOG',
  dark: 'Today',
  light: 'Today',
};

/** The Today header: the day's name over era-specific art, with a live keys-per-second readout. */
export function Hero(p: HeroProps) {
  return (
    <section className={`hero hero-${p.theme}`}>
      <div className="hero-art" aria-hidden="true">
        {p.theme === 'synthwave' && <SynthwaveArt />}
        {p.theme === 'phosphor' && <PhosphorArt hourly={p.hourly} />}
        {p.theme === 'arcade' && <ArcadeArt hourly={p.hourly} />}
        {p.theme === 'beige' && <BeigeArt />}
        {p.theme === 'ukiyoe' && <UkiyoeArt />}
        {p.theme === 'steampunk' && <SteamArt kps={p.kps} peak={p.peak} />}
        {p.theme === 'ramen' && <RamenArt />}
        {p.theme === 'anime' && <AnimeArt />}
        {p.theme === 'cyberpunk' && <CyberArt />}
        {p.theme === 'starship' && <StarshipArt keysToday={p.keysToday} peak={p.peak} />}
        {p.theme === 'signal' && <SignalArt />}
        {p.theme === 'vapor' && <VaporArt hourly={p.hourly} />}
        {(p.theme === 'dark' || p.theme === 'light') && <LanesArt />}
      </div>
      <div className="hero-text">
        <div className="hero-eyebrow">{p.theme === 'anime' ? `Episode ${episode()}` : EYEBROW[p.theme]}</div>
        <h1 className="hero-title">{p.weekday}</h1>
        <p className="hero-sub">{p.date} · so far today</p>
      </div>
      <div className="hero-live" aria-live="off">
        <div className="hero-live-label">{p.theme === 'arcade' ? 'HI-SCORE' : 'Keys / sec'}</div>
        <div className="hero-live-value">{p.kps}</div>
        <div className="hero-live-foot">
          peak {p.peak} · {formatCount(p.keysToday)} today
        </div>
      </div>
    </section>
  );
}

// ---- Now: timeline lanes drifting by, like the cover ------------------------------

const LANES = [
  [56, 88, 40, 120, 32, 72, 104, 48],
  [32, 48, 96, 24, 64, 136, 40, 80],
  [104, 56, 32, 88, 48, 24, 112, 64],
  [24, 64, 48, 32, 96, 56, 40, 128],
  [72, 32, 120, 56, 24, 88, 48, 36],
];
const LANE_TONES = ['amber', 'cut', 'cyan', 'cut', 'rose', 'cut', 'lime', 'cut', 'sky', 'cut'];

export function LanesArt() {
  return (
    <div className="lanes">
      {LANES.map((row, i) => (
        <div key={i} className="lanes-row" style={{ '--dur': `${48 + i * 9}s` } as CSSProperties}>
          {[0, 1].map((copy) => (
            <div key={copy} className="lanes-strip">
              {[...row, ...row].map((w, j) => (
                <span key={j} className={`lanes-seg tone-${LANE_TONES[(i * 3 + j) % LANE_TONES.length]}`} style={{ width: w }} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- 1986: sun, stars and a grid rolling towards you -------------------------------

const STARS = Array.from({ length: 48 }, (_, i) => ({
  x: (i * 37.3) % 100,
  y: (i * 17.9) % 52,
  d: 2 + (i % 5),
  s: i % 3 === 0 ? 2 : 1,
}));

export function SynthwaveArt() {
  return (
    <div className="sw">
      <div className="sw-stars">
        {STARS.map((s, i) => (
          <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDuration: `${s.d}s` }} />
        ))}
      </div>
      <div className="sw-sun" />
      <div className="sw-horizon" />
      <SynthFloor />
    </div>
  );
}

// The floor is drawn flat, not as a tilted texture: tilted 2px lines shrink below a pixel near
// the horizon and shimmer as they scroll. Rays are a static vector drawing; each crossbar
// moves along a perspective curve (themes.css, sw-bar), staggered so they read as one grid.
const RAYS = Array.from({ length: 25 }, (_, i) => 50 + (i - 12) * 4);
const BARS = 10;

export function SynthFloor() {
  return (
    <div className="sw-floor">
      <div className="sw-grid">
        <svg className="sw-rays" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {RAYS.map((x) => (
            <line key={x} x1="50" y1="0" x2={x} y2="100" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {Array.from({ length: BARS }, (_, i) => (
          <i key={i} className="sw-bar" style={{ animationDelay: `${(-i * 14) / BARS}s` }} />
        ))}
      </div>
    </div>
  );
}

// ---- 1977: today's keys per hour as a phosphor bar graph ---------------------------

const BLOCKS = ' ▁▂▃▄▅▆▇█';

function PhosphorArt({ hourly }: { hourly: number[] }) {
  const peak = Math.max(1, ...hourly);
  const bars = hourly.map((v) => BLOCKS[v ? Math.max(1, Math.round((v / peak) * 8)) : 0]).join('');
  const now = new Date().getHours();
  return (
    <div className="ph">
      <div className="ph-graph">
        <div className="ph-inner">
          <div>{bars.slice(0, now + 1)}<span className="ph-cursor">█</span>{' '.repeat(Math.max(0, 23 - now))}</div>
          <div className="ph-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </div>
      </div>
      <div className="ph-roll" />
    </div>
  );
}

// ---- 1984: starfield and an equaliser of today's keys ---------------------------------

function ArcadeArt({ hourly }: { hourly: number[] }) {
  const peak = Math.max(1, ...hourly);
  return (
    <div className="ar">
      <div className="ar-stars ar-stars-1" />
      <div className="ar-stars ar-stars-2" />
      <div className="ar-eq">
        {hourly.map((v, i) => {
          const lit = v ? Math.max(1, Math.round((v / peak) * 10)) : 0;
          return (
            <div key={i} className="ar-col">
              {Array.from({ length: 10 }, (_, j) => (
                <i key={j} className={j < lit ? `on lvl-${j < 5 ? 'lo' : j < 8 ? 'mid' : 'hi'}` : ''} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 1996: a desktop with a window copying your day --------------------------------

function BeigeArt() {
  const d = new Date();
  const dayDone = (d.getHours() * 60 + d.getMinutes()) / 1440;
  const blocks = 24;
  return (
    <div className="bx">
      <div className="bx-icons">
        {['KEYS', 'CLICKS', 'BACKUP'].map((n) => (
          <div key={n} className="bx-icon"><i /><span>{n}</span></div>
        ))}
      </div>
      <div className="bx-window">
        <div className="bx-title"><span>KATSUDO.EXE</span><b>_ □ ×</b></div>
        <div className="bx-body">
          <div>Recording today… {Math.round(dayDone * 100)}% of the day</div>
          <div className="bx-progress">
            {Array.from({ length: blocks }, (_, i) => <i key={i} className={i < Math.round(dayDone * blocks) ? 'on' : ''} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
