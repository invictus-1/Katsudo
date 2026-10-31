// Art for the newer eras: 1995 Anime, 2350 Starship, ???? Signal and Vapor (now); Cyberpunk is in
// CyberArt.tsx. Styles in future.css and signal.css.
import { useEffect, useState, type CSSProperties } from 'react';
import { formatCount } from '../lib';
import { Hanko, NAME } from '../kanji';

/** Day of the year, 1 to 366: today's episode number. */
export function episode(d = new Date()) {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1;
}

/** Year and the fraction of it gone: 2026.83. */
export function stardate(d = new Date()) {
  const days = new Date(d.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365;
  return `${d.getFullYear()}.${String(Math.floor(((episode(d) - 1) / days) * 100)).padStart(2, '0')}`;
}

// ---- 1995 Anime: a cel-painted sky with speed lines, clouds and falling petals ----------------

const PETALS = Array.from({ length: 14 }, (_, i) => ({ x: (i * 41) % 100, d: 7 + (i % 5) * 1.6, delay: -(i * 1.3), s: 0.7 + (i % 3) * 0.25 }));

function Cloud({ className }: { className: string }) {
  return (
    <svg className={`an-cloud ${className}`} viewBox="0 0 160 70">
      <path d="M20 60 C 4 60 4 40 20 38 C 18 22 40 16 50 26 C 56 8 86 6 94 24 C 104 14 128 18 126 36 C 146 34 152 58 134 60 Z" />
    </svg>
  );
}

export function AnimeArt() {
  return (
    <div className="an">
      <div className="an-lines" />
      <Cloud className="an-cloud-1" />
      <Cloud className="an-cloud-2" />
      <div className="an-city">{[38, 62, 46, 80, 54, 70, 42, 58, 36].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
      <div className="an-petals">
        {PETALS.map((p, i) => <i key={i} style={{ left: `${p.x}%`, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s`, '--s': p.s } as CSSProperties} />)}
      </div>
    </div>
  );
}

// ---- 2350 Starship: a bridge console over a viewport at warp ---------------------------

const WARP = Array.from({ length: 26 }, (_, i) => ({ y: (i * 37) % 100, d: 0.9 + (i % 5) * 0.35, delay: -(i * 0.23), w: 40 + (i % 4) * 30 }));

export function StarshipArt({ keysToday, peak }: { keysToday: number; peak: number }) {
  return (
    <div className="ss">
      <div className="ss-view">{WARP.map((s, i) => <i key={i} style={{ top: `${s.y}%`, width: s.w, animationDuration: `${s.d}s`, animationDelay: `${s.delay}s` }} />)}</div>
      <div className="ss-frame">
        <div className="ss-top"><span className="ss-pill tone-amber">STARDATE {stardate()}</span><span className="ss-pill tone-sky">DECK 04</span><span className="ss-bar" /></div>
        <div className="ss-elbow" />
        <div className="ss-bottom"><span className="ss-pill tone-cyan">KEYS {formatCount(keysToday)}</span><span className="ss-pill tone-rose">PEAK {peak}</span><span className="ss-bar is-lime" /></div>
      </div>
    </div>
  );
}

// ---- Welcomes -------------------------------------------------------------------------------

export function AnimeWelcome() {
  return (
    <div className="wl-an">
      <div className="wl-an-band is-a" />
      <div className="wl-an-band is-b" />
      <div className="wl-an-card">
        <div className="wl-an-kanji">{NAME}</div>
        <div className="wl-an-title">Katsudō!</div>
        <div className="wl-an-ep">Episode {episode()}</div>
      </div>
    </div>
  );
}

export function CyberWelcome() {
  return (
    <div className="wl-cy">
      <div className="wl-cy-sign">{NAME}</div>
      <div className="wl-cy-title">KATSUDO</div>
      <div className="wl-cy-line">// link established · all local</div>
      <div className="wl-cy-scan" />
    </div>
  );
}

export function StarshipWelcome() {
  return (
    <div className="wl-ss">
      <div className="wl-ss-bar is-top"><span>ACTIVITY LOG</span></div>
      <div className="wl-ss-main">
        <div className="wl-ss-kanji">{NAME}</div>
        <div className="wl-ss-title">KATSUDŌ</div>
        <div className="wl-ss-sub">STARDATE {stardate()} · ALL SYSTEMS NOMINAL</div>
      </div>
      <div className="wl-ss-bar is-bottom"><span>DECK 0{(episode() % 9) + 1}</span></div>
    </div>
  );
}

// ---- ???? Signal: an alien transmission, glyphs scrolling past a pulsing beacon ---------------

/** A made-up glyph: two or three strokes in a 10 by 14 box, the same every time for a seed. */
function glyph(seed: number) {
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const parts = [
    'M2 1 V13', 'M8 1 V13', 'M2 7 H8', 'M1 2 Q5 7 9 2', 'M1 12 Q5 7 9 12', 'M2 2 L8 12', 'M8 2 L2 12', 'M5 1 V6', 'M5 8 V13', 'M1 4 H9', 'M1 10 H9',
  ];
  const n = 2 + Math.floor(r(1) * 2);
  return Array.from({ length: n }, (_, i) => parts[Math.floor(r(i + 2) * parts.length)]).join(' ');
}

function GlyphRow({ seed, count }: { seed: number; count: number }) {
  return (
    <svg className="sg-row" viewBox={`0 0 ${count * 14} 14`} preserveAspectRatio="xMinYMid meet">
      {Array.from({ length: count }, (_, i) => <path key={i} d={glyph(seed * 131 + i * 17)} transform={`translate(${i * 14} 0)`} />)}
    </svg>
  );
}

const TERM_LINES = [
  { seed: 4, n: 22 }, { seed: 7, n: 15 }, { seed: 11, n: 26 }, { seed: 2, n: 9 }, { seed: 13, n: 19 },
];

/** An alien console: glyph lines typing in, one line decoded, a cursor, a small radar. */
export function SignalArt({ keysToday, kps }: { keysToday: number; kps: number }) {
  return (
    <div className="sg">
      <div className="sg-grid" />
      <div className="sg-term">
        <div className="sg-term-bar"><i /><i /><i /><GlyphRow seed={21} count={9} /></div>
        <div className="sg-term-body">
          {TERM_LINES.map((l, i) => (
            <div key={i} className="sg-line" style={{ animationDelay: `${i * 0.9}s` }}><span className="sg-prompt">&gt;</span><GlyphRow seed={l.seed} count={l.n} /></div>
          ))}
          <div className="sg-line is-plain" style={{ animationDelay: `${TERM_LINES.length * 0.9}s` }}>
            <span className="sg-prompt">&gt;</span>decoded: {formatCount(keysToday)} keys today · {kps}/s
          </div>
          <div className="sg-line is-cursor"><span className="sg-prompt">&gt;</span><span className="sg-cursor" /></div>
        </div>
        <div className="sg-radar"><i /><b /></div>
      </div>
    </div>
  );
}

// ---- Now Vapor: soft light through frosted glass --------------------------------------------

export function VaporArt({ hourly }: { hourly: number[] }) {
  const peak = Math.max(1, ...hourly);
  return (
    <div className="vp">
      <i className="vp-blob is-a" /><i className="vp-blob is-b" /><i className="vp-blob is-c" />
      <div className="vp-card">
        <div className="vp-card-label">Today, hour by hour</div>
        <div className="vp-bars">{hourly.map((v, i) => <i key={i} style={{ height: `${Math.max(4, (v / peak) * 100)}%` }} />)}</div>
      </div>
    </div>
  );
}

export function SignalWelcome() {
  const [shown, setShown] = useState('');
  useEffect(() => {
    const target = 'KATSUDŌ';
    const noise = '⌁⏃⎍⌇⏁⟟⋔⍜⌖⊑⟒';
    let step = 0;
    const t = window.setInterval(() => {
      step += 1;
      const done = Math.floor(step / 3);
      setShown(target.split('').map((ch, i) => (i < done ? ch : noise[(step + i * 3) % noise.length])).join(''));
      if (done > target.length) window.clearInterval(t);
    }, 55);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="wl-sg">
      <div className="wl-sg-static" />
      <div className="wl-sg-kanji">{NAME}</div>
      <div className="wl-sg-title">{shown}</div>
      <div className="wl-sg-sub">signal locked · origin: this pc</div>
    </div>
  );
}

export function VaporWelcome() {
  return (
    <div className="wl-vp">
      <i className="vp-blob is-a" /><i className="vp-blob is-b" /><i className="vp-blob is-c" />
      <div className="wl-vp-card">
        <Hanko className="wl-vp-hanko" />
        <div className="wl-vp-title">Katsudō</div>
      </div>
    </div>
  );
}
