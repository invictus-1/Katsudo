// The break nudge: a small window above the tray, in the era Katsudō is showing. It never takes
// focus, and closes itself if ignored (no repeat until you've had a break).
import { invoke } from '@tauri-apps/api/core';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/vt323/400.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/shippori-mincho/latin-800.css';
import '@fontsource/shippori-mincho/latin-ext-800.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cinzel/latin-ext-700.css';
import '@fontsource/special-elite/latin-400.css';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource/dela-gothic-one/latin-ext-400.css';
import '../fonts/kanji/kanji.css';
import '../ds/tokens.css';
import '../ds/katsudo.css';
import '../themes/themes.css';
import './nudge.css';

interface Nudge { secs: number; kpm: number; heavy: boolean; era: string }
const AUTO_CLOSE_MS = 45_000;

const duration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
};
const respond = (action: string) => invoke('nudge_respond', { action });

async function main() {
  const n = await invoke<Nudge | null>('get_nudge');
  if (!n) return respond('ignored');
  document.documentElement.setAttribute('data-theme', n.era || 'dark');
  const root = document.getElementById('nudge')!;
  root.innerHTML = `
    <span class="nudge-seal" aria-hidden="true"><span>活</span><span>動</span></span>
    <div class="nudge-text">
      <div id="nudge-title" class="nudge-title">You've been at it for ${duration(n.secs)}.</div>
      <div class="nudge-sub">${n.heavy ? `Lots of typing, too: ${n.kpm} keys a minute. Rest your hands for a few minutes?` : 'Stand up, stretch, look at something far away?'}</div>
      <div class="nudge-actions">
        <button class="kt-btn kt-btn-primary kt-btn-sm" data-a="break">Taking one</button>
        <button class="kt-btn kt-btn-sm" data-a="snooze">Snooze 30 min</button>
        <button class="kt-btn kt-btn-ghost kt-btn-sm" data-a="today">Not today</button>
      </div>
    </div>
    <div class="nudge-timer" aria-hidden="true"></div>`;
  root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => respond(b.dataset.a!)));
  window.setTimeout(() => respond('ignored'), AUTO_CLOSE_MS);
  requestAnimationFrame(() => root.classList.add('is-in'));
}

main();
