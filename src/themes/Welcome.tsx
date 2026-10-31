import { useEffect, useState } from 'react';
import type { ThemeId } from './themes';
import { SynthFloor } from './Hero';
import { Hanko, NAME } from '../kanji';
import { RamenWelcome, SteamWelcome, UkiyoeWelcome } from './EarlyArt';
import { AnimeWelcome, CyberWelcome, SignalWelcome, StarshipWelcome, VaporWelcome } from './FutureArt';

const DURATION: Record<ThemeId, number> = { ukiyoe: 2300, steampunk: 2000, ramen: 2000, anime: 1900, cyberpunk: 2100, starship: 1900, signal: 2200, vapor: 1500, phosphor: 2200, arcade: 1900, synthwave: 2200, beige: 1900, dark: 1300, light: 1300 };

const BOOT = [
  'KATSUDO BIOS v0.1 · (c) your machine',
  'checking katsudo.db ............ ok',
  'loading keyboard hooks ......... ok',
  'mounting timeline .............. ok',
  'phosphor warm. ready.',
];

/**
 * The era's welcome, once per launch, the first time the window is actually visible
 * (an autostart in the tray waits until you open it). Any key or click skips it.
 */
export function Welcome({ theme, enabled }: { theme: ThemeId; enabled: boolean }) {
  const [phase, setPhase] = useState<'wait' | 'play' | 'out' | 'done'>(enabled ? 'wait' : 'done');

  useEffect(() => {
    if (phase !== 'wait') return;
    const start = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', start);
      setPhase(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'done' : 'play');
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => document.removeEventListener('visibilitychange', start);
  }, [phase]);

  useEffect(() => {
    if (phase === 'play') {
      const skip = () => setPhase('out');
      const t = setTimeout(skip, DURATION[theme]);
      window.addEventListener('keydown', skip);
      window.addEventListener('pointerdown', skip);
      return () => { clearTimeout(t); window.removeEventListener('keydown', skip); window.removeEventListener('pointerdown', skip); };
    }
    if (phase === 'out') {
      const t = setTimeout(() => setPhase('done'), 350);
      return () => clearTimeout(t);
    }
  }, [phase, theme]);

  if (phase === 'wait' || phase === 'done') return null;
  return (
    <div className={`welcome welcome-${theme}${phase === 'out' ? ' is-out' : ''}`} aria-hidden="true">
      {theme === 'phosphor' && (
        <pre className="wl-boot">
          {BOOT.map((line, i) => (
            <span key={i} className="wl-line" style={{ animationDelay: `${i * 0.32}s` }}>{line}</span>
          ))}
          <span className="wl-line wl-ph-kanji" style={{ animationDelay: `${BOOT.length * 0.32}s` }}>{NAME}</span>
          <span className="ph-cursor">█</span>
        </pre>
      )}
      {theme === 'arcade' && (
        <div className="wl-arcade">
          <div className="wl-arcade-kanji">{NAME}</div>
          <div className="wl-arcade-title">KATSUDŌ</div>
          <div className="wl-arcade-blink">PRESS ANY KEY</div>
          <div className="wl-arcade-credit">CREDIT 01</div>
        </div>
      )}
      {theme === 'synthwave' && (
        <div className="wl-sw">
          <div className="sw-sun wl-sw-sun" />
          <SynthFloor />
          <div className="wl-sw-kanji">{NAME}</div>
          <div className="wl-sw-title">Katsudō</div>
        </div>
      )}
      {theme === 'beige' && (
        <div className="wl-bx">
          <div className="bx-window">
            <div className="bx-title"><span>Katsudō Setup</span><b>×</b></div>
            <div className="bx-body">
              <div className="wl-bx-name"><Hanko className="wl-bx-hanko" />Katsudō</div>
              <div>Starting up, please wait…</div>
              <div className="bx-progress wl-bx-progress">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.05}s` }} />)}</div>
            </div>
          </div>
        </div>
      )}
      {theme === 'ukiyoe' && <UkiyoeWelcome />}
      {theme === 'steampunk' && <SteamWelcome />}
      {theme === 'ramen' && <RamenWelcome />}
      {theme === 'anime' && <AnimeWelcome />}
      {theme === 'cyberpunk' && <CyberWelcome />}
      {theme === 'starship' && <StarshipWelcome />}
      {theme === 'signal' && <SignalWelcome />}
      {theme === 'vapor' && <VaporWelcome />}
      {(theme === 'dark' || theme === 'light') && (
        <div className="wl-now">
          <div className="wl-now-lanes">{[0, 1, 2].map((i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</div>
          <Hanko className="wl-now-hanko" />
          <div className="wl-now-title">Katsudō</div>
        </div>
      )}
    </div>
  );
}
