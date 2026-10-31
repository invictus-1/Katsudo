// 1645 Ronin: the Musashi era as an old notebook. Sumi ink on tea-stained paper: a brushed
// ensō, ink-wash mountains, a sword drawn in a few lines and a column of brush kanji, with a
// red seal. A turbulence filter roughens the strokes like a dry brush. Styles in ronin.css.
import { Hanko, NAME } from '../kanji';

function BrushFilter({ id }: { id: string }) {
  return (
    <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}

export function Enso({ className }: { className?: string }) {
  return (
    <svg className={`rn-enso${className ? ` ${className}` : ''}`} viewBox="0 0 200 200" aria-hidden="true">
      <defs><BrushFilter id="rn-dry" /></defs>
      <g filter="url(#rn-dry)">
        <path className="rn-enso-stroke" d="M 150 52 A 68 68 0 1 0 162 86" pathLength="100" />
        <path className="rn-enso-dry" d="M 146 50 A 72 72 0 1 0 160 94" pathLength="100" />
      </g>
    </svg>
  );
}

export function RoninArt() {
  return (
    <div className="rn">
      <svg className="rn-scene" viewBox="0 0 1000 300" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
        <defs>
          <BrushFilter id="rn-rough" />
          <filter id="rn-wash"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        <g filter="url(#rn-wash)">
          <path className="rn-mtn is-far" d="M380 300 L500 170 L560 210 L650 130 L760 230 L860 180 L1000 260 V300 Z" />
          <path className="rn-mtn is-near" d="M300 300 L430 220 L520 260 L600 205 L700 280 L1000 300 Z" />
        </g>
        <g filter="url(#rn-rough)">
          {/* The sword: blade, tsuba, a wrapped grip. */}
          <path className="rn-blade" d="M548 244 Q 700 196 900 116" />
          <path className="rn-edge" d="M560 246 Q 710 202 898 122" />
          <ellipse className="rn-tsuba" cx="548" cy="246" rx="7" ry="13" transform="rotate(-20 548 246)" />
          <path className="rn-grip" d="M542 249 L470 276" />
          <path className="rn-grip-wrap" d="M536 251 L476 274" />
        </g>
      </svg>
      <Enso className="rn-hero-enso" />
      <div className="rn-column"><span>五</span><span>輪</span></div>
      <Hanko className="rn-seal" />
      <div className="rn-stain is-a" /><div className="rn-stain is-b" />
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
