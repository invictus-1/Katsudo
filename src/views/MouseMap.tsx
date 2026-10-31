import { useEffect, useRef } from 'react';
import type { MouseMap } from '../api';

export type MouseMetric = 'clicks' | 'moves';

/** 256 colours from faint to hot, from the era's heat tokens. */
function palette(css: CSSStyleDeclaration): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  ['--heat-1', '--heat-2', '--heat-3', '--heat-4'].forEach((v, i) => grad.addColorStop(i / 3, css.getPropertyValue(v).trim() || '#888'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 1);
  return g.getImageData(0, 0, 256, 1).data;
}

function paint(cv: HTMLCanvasElement, width: number, map: MouseMap, metric: MouseMetric) {
  const css = getComputedStyle(cv);
  const cell = map.cell;
  const pick = (c: number[]) => (metric === 'clicks' ? c[2] : c[3]);
  const cells = map.cells.filter((c) => pick(c) > 0);
  // Bounds in squares: the monitors, plus anywhere the pointer went beyond them.
  const rects = map.screens.map((s) => [s.x / cell, s.y / cell, (s.x + s.w) / cell, (s.y + s.h) / cell]);
  for (const c of cells) rects.push([c[0], c[1], c[0] + 1, c[1] + 1]);
  if (!rects.length || width <= 0) return;
  const minX = Math.floor(Math.min(...rects.map((r) => r[0]))), minY = Math.floor(Math.min(...rects.map((r) => r[1])));
  const maxX = Math.ceil(Math.max(...rects.map((r) => r[2]))), maxY = Math.ceil(Math.max(...rects.map((r) => r[3])));
  const gw = maxX - minX, gh = maxY - minY;
  const scale = width / gw; // CSS pixels per square
  const height = Math.round(gh * scale);
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(width * dpr);
  cv.height = Math.round(height * dpr);
  cv.style.height = `${height}px`;
  const g = cv.getContext('2d')!;
  const k = scale * dpr; // device pixels per square

  // Monitors underneath.
  g.fillStyle = css.getPropertyValue('--surface-300').trim();
  for (const s of map.screens) g.fillRect((s.x / cell - minX) * k, (s.y / cell - minY) * k, (s.w / cell) * k, (s.h / cell) * k);

  if (cells.length) {
    // One pixel per square. Capping at the 99.7th percentile keeps one hot spot (a close
    // button clicked ten thousand times) from washing everything else out.
    const sorted = cells.map(pick).sort((a, b) => a - b);
    const cap = Math.max(1, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.997))]);
    const grid = document.createElement('canvas');
    grid.width = gw;
    grid.height = gh;
    const gg = grid.getContext('2d')!;
    const gi = gg.createImageData(gw, gh);
    for (const c of cells) {
      const t = Math.pow(Math.min(1, pick(c) / cap), 0.7);
      gi.data[((c[1] - minY) * gw + (c[0] - minX)) * 4 + 3] = Math.round(t * 255);
    }
    gg.putImageData(gi, 0, 0);

    // Scale it up smoothly and soften it, then colour each pixel by its intensity.
    const layer = document.createElement('canvas');
    layer.width = cv.width;
    layer.height = cv.height;
    const lg = layer.getContext('2d')!;
    lg.imageSmoothingEnabled = true;
    lg.imageSmoothingQuality = 'high';
    lg.filter = `blur(${Math.max(1, k * 0.9)}px)`;
    lg.drawImage(grid, 0, 0, gw * k, gh * k);
    const img = lg.getImageData(0, 0, layer.width, layer.height);
    const pal = palette(css);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i];
      if (a < 3) {
        d[i] = 0;
        continue;
      }
      const p = Math.min(255, Math.round(a * 1.15)) * 4;
      d[i - 3] = pal[p];
      d[i - 2] = pal[p + 1];
      d[i - 1] = pal[p + 2];
      d[i] = Math.min(255, 12 + a * 1.5);
    }
    lg.putImageData(img, 0, 0);
    g.drawImage(layer, 0, 0);
  }

  // Monitor outlines and labels on top.
  g.strokeStyle = css.getPropertyValue('--line-strong').trim();
  g.lineWidth = Math.max(1, dpr);
  g.fillStyle = css.getPropertyValue('--ink-muted').trim();
  g.font = `${12 * dpr}px ${css.getPropertyValue('--font-mono') || 'monospace'}`;
  map.screens.forEach((s, i) => {
    const x = (s.x / cell - minX) * k, y = (s.y / cell - minY) * k;
    g.strokeRect(x + 0.5, y + 0.5, (s.w / cell) * k - 1, (s.h / cell) * k - 1);
    const label = `${i + 1}${s.primary ? ' · main' : ''}  ${s.w}×${s.h}`;
    const fill = g.fillStyle;
    g.fillStyle = css.getPropertyValue('--surface-000').trim();
    g.fillRect(x + 4 * dpr, y + 4 * dpr, g.measureText(label).width + 12 * dpr, 22 * dpr);
    g.fillStyle = fill;
    g.fillText(`${i + 1}${s.primary ? ' · main' : ''}  ${s.w}×${s.h}`, x + 10 * dpr, y + 20 * dpr);
  });
}

/** Where the pointer clicked or travelled, over the monitors it happened on. */
export function MouseHeatmap({ map, metric }: { map: MouseMap; metric: MouseMetric }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv) return;
    let last = el.clientWidth;
    paint(cv, last, map, metric);
    const resized = new ResizeObserver(() => {
      if (el.clientWidth !== last) paint(cv, (last = el.clientWidth), map, metric);
    });
    resized.observe(el);
    // Eras change the heat colours.
    const themed = new MutationObserver(() => paint(cv, el.clientWidth, map, metric));
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      resized.disconnect();
      themed.disconnect();
    };
  }, [map, metric]);
  return (
    <div ref={wrap} className="mouse-map">
      <canvas ref={canvas} role="img" aria-label={`Pointer ${metric === 'clicks' ? 'clicks' : 'movement'} heatmap across ${map.screens.length} screens`} />
    </div>
  );
}
