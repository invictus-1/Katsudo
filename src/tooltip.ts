// Instant tooltips, in the era's own look, for anything with a data-hint attribute. One
// element follows the pointer above the page, so a tip is never clipped by the box it's in
// (the browser's own title tooltips wait a second and ignore the era). Install once.
let tip: HTMLDivElement | null = null;
let current: Element | null = null;

function place(x: number, y: number) {
  if (!tip) return;
  const r = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
  // Above the pointer, or below it when there's no room.
  const top = y - r.height - 14 < 8 ? y + 20 : y - r.height - 14;
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function hide() {
  current = null;
  if (tip) tip.hidden = true;
}

export function installTooltips() {
  if (tip) return;
  tip = document.createElement('div');
  tip.className = 'hint-tip';
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  document.body.appendChild(tip);
  document.addEventListener('pointermove', (e) => {
    const el = (e.target as Element | null)?.closest?.('[data-hint]') ?? null;
    if (!el) return hide();
    if (el !== current) {
      current = el;
      tip!.textContent = el.getAttribute('data-hint');
      tip!.hidden = false;
    }
    place(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('pointerleave', hide);
  window.addEventListener('blur', hide);
  document.addEventListener('scroll', hide, { capture: true, passive: true });
}
