// Era transitions: switching era plays a short piece of the era you're switching to, using the
// View Transitions API (the old look is a still, the new one is live underneath the effect).
//   Phosphor   CRT power-off, then the tube warms up again
//   Arcade     pixel dissolve
//   Synthwave  VHS tracking roll, with the PLAY ▶ display
//   Beige Box  a Windows 95 window zooming open
//   Night shift / Paper  a reveal spreading from where you clicked
// Skipped when animations are off, the system asks for reduced motion, or nothing changes.
import { resolveTheme, type ThemeId } from './themes';
import './transitions.css';

type ViewTransition = { finished: Promise<void>; ready: Promise<void> };
type Doc = Document & { startViewTransition?: (update: () => void) => ViewTransition };

let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
window.addEventListener('pointerdown', (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });

const DISSOLVE_FRAMES = 10;
let dissolveReady = false;

/** Masks that fill in a few more random 24-pixel blocks each frame, as @keyframes. */
function prepareDissolve() {
  if (dissolveReady) return;
  dissolveReady = true;
  const cols = 80, rows = 45, block = 24;
  const order = Array.from({ length: cols * rows }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const canvas = document.createElement('canvas');
  canvas.width = cols * block;
  canvas.height = rows * block;
  const g = canvas.getContext('2d')!;
  const frames: string[] = [];
  for (let f = 1; f <= DISSOLVE_FRAMES; f++) {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#000';
    for (const i of order.slice(0, Math.round((order.length * f) / DISSOLVE_FRAMES))) g.fillRect((i % cols) * block, Math.floor(i / cols) * block, block, block);
    frames.push(canvas.toDataURL('image/png'));
  }
  const steps = frames.map((url, i) => `${(i / (DISSOLVE_FRAMES - 1)) * 100}% { -webkit-mask-image: url(${url}); mask-image: url(${url}); }`);
  const style = document.createElement('style');
  style.textContent = `@keyframes era-dissolve { ${steps.join(' ')} }`;
  document.head.appendChild(style);
}

/** A piece of the new era drawn over the live view while it switches (the VHS display). */
function overlay(to: ThemeId): HTMLElement | null {
  if (to !== 'synthwave') return null;
  const el = document.createElement('div');
  el.className = 'era-fx era-fx-vhs';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span class="era-fx-osd">PLAY ▶</span><span class="era-fx-band"></span>';
  return el;
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Switch era with its transition. `update` must apply the new era to the DOM synchronously
 * (set data-theme and render), since the browser captures the new look as soon as it returns.
 */
export function transitionEra(fromChoice: string, toChoice: string, motion: boolean, update: () => void) {
  const from = resolveTheme(fromChoice);
  const to = resolveTheme(toChoice);
  const doc = document as Doc;
  if (from === to || !motion || reduced() || !doc.startViewTransition || document.hidden) {
    update();
    return;
  }
  if (to === 'arcade') prepareDissolve();
  const root = document.documentElement;
  const zoom = Number((root.style as CSSStyleDeclaration & { zoom: string }).zoom) || 1;
  root.style.setProperty('--vt-x', `${pointer.x / zoom}px`);
  root.style.setProperty('--vt-y', `${pointer.y / zoom}px`);
  root.dataset.vt = to;
  const fx = overlay(to);
  const t = doc.startViewTransition(() => {
    update();
    if (fx) document.body.appendChild(fx);
  });
  t.finished.finally(() => {
    delete root.dataset.vt;
    fx?.remove();
  });
}
