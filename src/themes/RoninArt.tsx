// 1645 Ronin: the Musashi era as an old notebook. Sumi ink on tea-stained paper: a brushed
// ensō that thins as the brush runs dry, ink-wash mountains, a sheathed sword lying below, and
// a column of brush kanji signed with a red seal. Styles in ronin.css.
import { Hanko, NAME } from '../kanji';

/**
 * The ensō as a filled shape: a circle drawn by a brush that starts heavy and thins out,
 * wobbling slightly, so it reads as one stroke (an outline stroke looks drawn by a pen).
 */
function ensoShape() {
  const N = 90;
  const start = (-58 * Math.PI) / 180; // upper right, then counter-clockwise round
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

/** Where the brush ran dry: a few broken hairlines past the end of the stroke. */
const DRY = [0, 1, 2].map((k) => {
  const r = 66 + k * 4;
  const a0 = (-58 - 322 + 6) * (Math.PI / 180);
  const a1 = (-58 - 322 - 14 - k * 6) * (Math.PI / 180);
  return `M${(100 + r * Math.cos(a0)).toFixed(1)} ${(100 + r * Math.sin(a0)).toFixed(1)} A${r} ${r} 0 0 0 ${(100 + r * Math.cos(a1)).toFixed(1)} ${(100 + r * Math.sin(a1)).toFixed(1)}`;
});

export function Enso({ className }: { className?: string }) {
  return (
    <svg className={`rn-enso${className ? ` ${className}` : ''}`} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <filter id="rn-ink" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g filter="url(#rn-ink)">
        <path className="rn-enso-ink" d={ENSO} />
        {DRY.map((d, i) => <path key={i} className="rn-enso-dry" d={d} />)}
      </g>
    </svg>
  );
}

/** A sheathed katana lying flat: grip with its wrap, guard, lacquered scabbard, a loose cord. */
function Sword() {
  return (
    <svg className="rn-sword" viewBox="0 0 640 60" aria-hidden="true">
      <path className="rn-saya" d="M150 34 L612 24 Q 622 24 622 28.5 Q 622 33 612 33 L150 42 Z" />
      <rect className="rn-habaki" x="146" y="32" width="8" height="11" rx="1" transform="rotate(-1.2 150 38)" />
      <ellipse className="rn-tsuba" cx="142" cy="38" rx="4.5" ry="13" />
      <path className="rn-tsuka" d="M138 34 L30 38 Q 22 38.6 22 42 Q 22 45.4 30 45.6 L138 42 Z" />
      <path className="rn-ito" d="M132 36 L36 40 M132 40 L36 43.6" />
      <path className="rn-sageo" d="M188 38 C 200 52 230 56 262 50 C 280 47 292 52 300 56" />
    </svg>
  );
}

export function RoninArt() {
  return (
    <div className="rn">
      <svg className="rn-scene" viewBox="0 0 1000 300" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
        <defs><filter id="rn-wash"><feGaussianBlur stdDeviation="3" /></filter></defs>
        <g filter="url(#rn-wash)">
          <path className="rn-mtn is-far" d="M380 300 L500 170 L560 210 L650 130 L760 230 L860 180 L1000 260 V300 Z" />
          <path className="rn-mtn is-near" d="M300 300 L430 220 L520 260 L600 205 L700 280 L1000 300 Z" />
        </g>
      </svg>
      <Enso className="rn-hero-enso" />
      <Sword />
      <div className="rn-signature">
        <div className="rn-column"><span>五</span><span>輪</span></div>
        <Hanko className="rn-seal" />
      </div>
    </div>
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
