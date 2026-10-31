// Art for the eras before the computer: 1830 Ukiyo-e, 1889 Steampunk, 1958 Ramen shop.
// Drawn here (SVG and CSS), animated in early.css with transform and opacity only.
import { Hanko, NAME } from '../kanji';

// ---- 1830 Ukiyo-e: layered waves, a distant mountain and a red sun, as a woodblock print ----

export function UkiyoeArt() {
  return (
    <div className="uk">
      <svg className="uk-print" viewBox="0 0 1000 300" preserveAspectRatio="xMaxYMax slice">
        <circle className="uk-sun" cx="760" cy="92" r="44" />
        <g className="uk-mist">
          <rect x="520" y="118" width="260" height="14" rx="7" />
          <rect x="610" y="140" width="320" height="12" rx="6" />
          <rect x="430" y="160" width="190" height="11" rx="5.5" />
        </g>
        <path className="uk-mountain" d="M560 236 L640 168 Q652 158 664 168 L744 236 Z" />
        <path className="uk-snow" d="M624 182 L640 168 Q652 158 664 168 L680 182 L668 178 L660 186 L652 177 L644 187 L636 178 Z" />
        <g className="uk-wave uk-wave-back">
          <path d="M0 236 Q 90 214 180 232 T 360 230 T 540 236 T 720 230 T 900 234 T 1080 230 V300 H0 Z" />
        </g>
        <g transform="translate(250 0)"><g className="uk-wave uk-wave-mid">
          <path d="M-300 262 C -200 250 -100 266 0 258 C 70 242 120 196 205 182 C 262 173 300 196 286 214 C 276 226 254 220 258 207 C 226 214 214 244 262 258 C 380 286 470 244 590 252 C 700 260 820 236 1000 256 V300 H0 Z" />
          <path className="uk-line" d="M40 262 C 110 246 150 210 210 198 M300 266 C 400 278 480 252 580 262 M680 262 C 760 256 860 246 960 262" />
          {[[212, 184], [232, 180], [252, 183], [270, 190], [281, 201]].map(([x, y], i) => <circle key={i} className="uk-foam" cx={x} cy={y} r={4.5 - i * 0.4} />)}
        </g></g>
        <g className="uk-wave uk-wave-front">
          <path d="M0 282 Q 150 262 300 280 T 600 278 T 900 276 T 1200 280 V300 H0 Z" />
        </g>
        <g className="uk-birds">
          <path d="M470 70 q 8 -7 16 0 q 8 -7 16 0" />
          <path d="M520 52 q 6 -5 12 0 q 6 -5 12 0" />
        </g>
      </svg>
    </div>
  );
}

// ---- 1889 Steampunk: meshing gears, a pressure gauge reading your keys a second, a pipe ----

/** A gear outline (teeth around a rim), with an axle hole, centred on 0,0. */
function gearPath(teeth: number, outer: number, inner: number, hole: number) {
  const pt = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`;
  const step = (Math.PI * 2) / teeth;
  const rim = Array.from({ length: teeth }, (_, i) => {
    const a = i * step;
    return `${pt(inner, a)} L${pt(outer, a + step * 0.12)} L${pt(outer, a + step * 0.42)} L${pt(inner, a + step * 0.54)}`;
  });
  return `M${rim.join(' L')} Z M${hole} 0 A${hole} ${hole} 0 1 0 ${-hole} 0 A${hole} ${hole} 0 1 0 ${hole} 0 Z`;
}

export function Gear({ teeth, r, x, y, secs, reverse }: { teeth: number; r: number; x: number; y: number; secs: number; reverse?: boolean }) {
  const spokes = Array.from({ length: 5 }, (_, i) => (i * 72 * Math.PI) / 180);
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="sp-gear" style={{ animationDuration: `${secs}s`, animationDirection: reverse ? 'reverse' : 'normal' }}>
        <path className="sp-gear-body" d={gearPath(teeth, r, r * 0.84, r * 0.16)} fillRule="evenodd" />
        <circle className="sp-gear-ring" r={r * 0.62} />
        {spokes.map((a, i) => <line key={i} className="sp-gear-spoke" x1={Math.cos(a) * r * 0.2} y1={Math.sin(a) * r * 0.2} x2={Math.cos(a) * r * 0.6} y2={Math.sin(a) * r * 0.6} />)}
      </g>
    </g>
  );
}

export function SteamArt({ kps, peak }: { kps: number; peak: number }) {
  // The needle sweeps 240°, full scale at today's peak (at least 10 a second).
  const angle = -120 + 240 * Math.min(1, kps / Math.max(10, peak));
  return (
    <div className="sp">
      <svg className="sp-machine" viewBox="0 0 1000 300" preserveAspectRatio="xMaxYMid slice">
        <defs>
          <linearGradient id="sp-brass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f0cf86" />
            <stop offset=".45" stopColor="#c8923e" />
            <stop offset="1" stopColor="#7a5220" />
          </linearGradient>
          <linearGradient id="sp-pipe" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e9c27a" />
            <stop offset=".5" stopColor="#9a6a2c" />
            <stop offset="1" stopColor="#4a3214" />
          </linearGradient>
        </defs>
        <rect className="sp-pipe" x="300" y="232" width="700" height="22" />
        {[340, 520, 700, 880].map((x) => <rect key={x} className="sp-flange" x={x} y="226" width="14" height="34" rx="2" />)}
        <rect className="sp-pipe" x="836" y="150" width="20" height="90" />
        <Gear teeth={18} r={92} x={590} y={118} secs={60} />
        <Gear teeth={11} r={57} x={723} y={168} secs={36.7} reverse />
        <Gear teeth={8} r={40} x={630} y={230} secs={26.7} reverse />
        <g transform="translate(846 104)" className="sp-gauge">
          <circle r="58" className="sp-gauge-rim" />
          <circle r="49" className="sp-gauge-face" />
          {Array.from({ length: 13 }, (_, i) => -120 + i * 20).map((a) => (
            <line key={a} className={a % 60 === 0 ? 'sp-tick is-major' : 'sp-tick'} x1="0" y1="-44" x2="0" y2={a % 60 === 0 ? -36 : -40} transform={`rotate(${a})`} />
          ))}
          <text y="22" className="sp-gauge-label">KEYS/S</text>
          <line className="sp-needle" x1="0" y1="8" x2="0" y2="-40" style={{ transform: `rotate(${angle}deg)` }} />
          <circle r="5" className="sp-gauge-hub" />
        </g>
      </svg>
      <div className="sp-steam">{[0, 1, 2].map((i) => <i key={i} style={{ animationDelay: `${i * 1.3}s` }} />)}</div>
    </div>
  );
}

// ---- 1958 Ramen shop: a noren over the counter, a paper lantern, steam off a bowl --------

export function RamenArt() {
  return (
    <div className="rm">
      <div className="rm-noren">
        <div className="rm-rod" />
        {'ラーメン'.split('').map((ch, i) => (
          <div key={i} className="rm-panel" style={{ animationDelay: `${-i * 0.9}s` }}><span>{ch}</span></div>
        ))}
      </div>
      <div className="rm-lantern-wrap">
        <div className="rm-cord" />
        <div className="rm-lantern"><span>{NAME[0]}</span><span>{NAME[1]}</span></div>
      </div>
      <div className="rm-counter" />
      <div className="rm-bowl">
        <div className="rm-steam">{[0, 1, 2].map((i) => <i key={i} style={{ animationDelay: `${i * 1.1}s` }} />)}</div>
        <div className="rm-bowl-body" />
      </div>
    </div>
  );
}

// ---- Welcomes -------------------------------------------------------------------------------

export function UkiyoeWelcome() {
  return (
    <div className="wl-uk">
      <div className="wl-uk-kanji">{NAME.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${0.15 + i * 0.45}s` }}>{ch}</span>)}</div>
      <Hanko className="wl-uk-seal" />
      <div className="wl-uk-title">Katsudō</div>
      <svg className="wl-uk-wave" viewBox="0 0 1000 80" preserveAspectRatio="none"><path d="M0 50 Q 125 20 250 50 T 500 50 T 750 50 T 1000 50 V80 H0 Z" /></svg>
    </div>
  );
}

export function SteamWelcome() {
  return (
    <div className="wl-sp">
      <svg className="wl-sp-gears" viewBox="-200 -150 400 300">
        <defs>
          <linearGradient id="sp-brass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f0cf86" />
            <stop offset=".45" stopColor="#c8923e" />
            <stop offset="1" stopColor="#7a5220" />
          </linearGradient>
        </defs>
        <Gear teeth={18} r={110} x={-62} y={0} secs={6} />
        <Gear teeth={11} r={68} x={98} y={-40} secs={3.67} reverse />
      </svg>
      <div className="wl-sp-plate">
        <div className="wl-sp-kanji">{NAME}</div>
        <div className="wl-sp-title">Katsudō</div>
        <div className="wl-sp-est">Est. 1889 · Engine room</div>
      </div>
      <div className="wl-sp-puffs">{[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${0.3 + i * 0.25}s` }} />)}</div>
    </div>
  );
}

export function RamenWelcome() {
  return (
    <div className="wl-rm">
      <div className="wl-rm-glow" />
      <div className="wl-rm-sign">
        <div className="wl-rm-kanji">{NAME}</div>
        <div className="wl-rm-title">Katsudō</div>
        <div className="wl-rm-sub">Open late</div>
      </div>
      <div className="wl-rm-noren">
        <div className="wl-rm-half is-left"><span>活</span></div>
        <div className="wl-rm-half is-right"><span>動</span></div>
      </div>
    </div>
  );
}
