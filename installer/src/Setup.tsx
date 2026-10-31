import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { Switch } from '../../src/ds/katsudo';
import { LanesArt, SynthwaveArt } from '../../src/themes/Hero';

type Era = 'phosphor' | 'arcade' | 'synthwave' | 'beige' | 'dark';
type Screen = 'intro' | 'options' | 'working' | 'done' | 'error';

interface Info {
  mode: 'install' | 'uninstall';
  version: string;
  era: Era;
  dir: string;
  existing_version: string | null;
  running: boolean;
  size_mb: number;
}

const ERA_NAME: Record<Era, string> = {
  phosphor: '1977 · Phosphor',
  arcade: '1984 · Arcade',
  synthwave: '1986 · Synthwave',
  beige: '1996 · Beige Box',
  dark: 'Now · Night shift',
};

const TAGLINE = 'Every hour and every keystroke, kept on your own machine.';

/** Eases the shown progress towards the real one, never faster than full in `minMs`. */
function useSmooth(target: number, minMs: number) {
  const [shown, setShown] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      const next = Math.min(target, ref.current + dt / minMs);
      if (next !== ref.current) {
        ref.current = next;
        setShown(next);
      }
      if (next < target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, minMs]);
  return shown;
}

export function Setup() {
  const [info, setInfo] = useState<Info | null>(null);
  const [screen, setScreen] = useState<Screen>('intro');
  const [opts, setOpts] = useState({ dir: '', autostart: true, desktop: false, keepEra: true, launch: true, removeData: false });
  const [target, setTarget] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [dirError, setDirError] = useState('');
  const shown = useSmooth(target, 3400);

  useEffect(() => {
    invoke<Info>('info').then((i) => {
      document.documentElement.setAttribute('data-theme', i.era);
      setInfo(i);
      setOpts((o) => ({ ...o, dir: i.dir }));
      requestAnimationFrame(() => getCurrentWindow().show());
    });
    const un = listen<{ pct: number; log: string }>('setup-step', (e) => {
      setTarget(e.payload.pct);
      setLog((l) => [...l, e.payload.log]);
    });
    return () => { un.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (finished && shown >= 1 && screen === 'working') setScreen('done');
  }, [finished, shown, screen]);

  if (!info) return null;
  const era = info.era;
  const uninstalling = info.mode === 'uninstall';
  const upgrading = !uninstalling && info.existing_version !== null;

  const start = () => {
    setScreen('working');
    setLog([]);
    setTarget(0.02);
    const call = uninstalling
      ? invoke('uninstall', { removeData: opts.removeData })
      : invoke('install', { opts: { dir: opts.dir, autostart: opts.autostart, desktop: opts.desktop, keep_era: opts.keepEra, era } });
    call.then(
      () => { setTarget(1); setFinished(true); },
      (e) => { setError(String(e)); setScreen('error'); },
    );
  };
  const finish = () => (!uninstalling && opts.launch ? invoke('launch_app', { dir: opts.dir }) : invoke('quit'));
  const chooseDir = async () => {
    const picked = await open({ directory: true, title: 'Install Katsudō in' });
    if (typeof picked !== 'string') return;
    // Only real folders on a drive or network share; the picker can return virtual places
    // ("This PC", libraries) that Windows can't create files in.
    if (!/^([A-Za-z]:\\|\\\\[^\\]+\\)/.test(picked)) {
      setDirError(`"${picked}" isn't a folder Katsudō can be installed in. Pick a folder on a drive, like ${info?.dir}.`);
      return;
    }
    setDirError('');
    const base = picked.replace(/\\+$/, '');
    setOpts({ ...opts, dir: /\\Katsudo$/i.test(base) ? base : `${base}\\Katsudo` });
  };

  const verb = uninstalling ? 'Uninstall' : upgrading ? 'Update' : 'Install';

  return (
    <div className={`setup era-${era} screen-${screen}`} style={{ ['--p' as string]: shown }}>
      <header className="titlebar" data-tauri-drag-region>
        <span className="titlebar-name" data-tauri-drag-region>Katsudō {uninstalling ? 'Uninstall' : 'Setup'} · {ERA_NAME[era]}</span>
        <button type="button" aria-label="Minimise" onClick={() => getCurrentWindow().minimize()}>–</button>
        <button type="button" aria-label="Close" disabled={screen === 'working'} onClick={() => invoke('quit')}>×</button>
      </header>

      <main className="stage">
        <Backdrop era={era} progress={screen === 'working' || screen === 'done' ? shown : 0} />

        {screen === 'intro' && (
          <section className="card intro">
            <EraTitle era={era} />
            <p className="tagline">{uninstalling ? 'Remove Katsudō from this computer.' : TAGLINE}</p>
            <p className="meta">
              {uninstalling
                ? `Installed in ${info.dir}`
                : upgrading
                  ? `Update ${info.existing_version} → ${info.version}. Your data stays exactly where it is.`
                  : `Version ${info.version} · ${info.size_mb.toFixed(1)} MB · installs for you only, no admin needed`}
              {info.running && !uninstalling ? ' · Katsudō will save and close first.' : ''}
            </p>
            {uninstalling && (
              <div className="opts">
                <Switch defaultChecked={false} label="Also delete my data"
                  hint="Your database and backups. Off: they stay, ready for a reinstall."
                  onChange={(v) => setOpts({ ...opts, removeData: v })} />
              </div>
            )}
            <div className="actions">
              <EraButton era={era} primary onClick={start}>{verb}</EraButton>
              {!uninstalling && <EraButton era={era} onClick={() => setScreen('options')}>Options</EraButton>}
              {uninstalling && <EraButton era={era} onClick={() => invoke('quit')}>Keep it</EraButton>}
            </div>
          </section>
        )}

        {screen === 'options' && (
          <section className="card options">
            <h2 className="card-title">Options</h2>
            <div className="field">
              <span className="field-label">Install to</span>
              <div className="field-row">
                <code className="path">{opts.dir}</code>
                <EraButton era={era} onClick={chooseDir}>Change…</EraButton>
              </div>
              {dirError && <p className="meta dir-error">{dirError}</p>}
            </div>
            <div className="opts">
              <Switch defaultChecked={opts.autostart} label="Start with Windows" hint="Opens in the tray when you sign in."
                onChange={(v) => setOpts({ ...opts, autostart: v })} />
              <Switch defaultChecked={opts.desktop} label="Desktop shortcut" hint="A Start menu shortcut is always added."
                onChange={(v) => setOpts({ ...opts, desktop: v })} />
              <Switch defaultChecked={opts.keepEra} label={`Keep ${ERA_NAME[era]} as Katsudō's look`}
                hint="Off: Katsudō opens in Night shift. Change it any time in Settings."
                onChange={(v) => setOpts({ ...opts, keepEra: v })} />
            </div>
            <div className="actions">
              <EraButton era={era} primary onClick={start}>{verb}</EraButton>
              <EraButton era={era} onClick={() => setScreen('intro')}>Back</EraButton>
            </div>
          </section>
        )}

        {screen === 'working' && <Progress era={era} pct={shown} log={log} uninstalling={uninstalling} />}

        {screen === 'done' && (
          <section className="card done">
            <EraTitle era={era} done uninstalling={uninstalling} />
            <p className="tagline">
              {uninstalling
                ? opts.removeData ? 'Katsudō and its data are gone.' : 'Katsudō is gone. Your data is still here if you come back.'
                : upgrading ? `Updated to ${info.version}.` : 'Installed. It lives in your tray and in the Start menu.'}
            </p>
            {!uninstalling && (
              <div className="opts">
                <Switch defaultChecked={opts.launch} label="Open Katsudō now" onChange={(v) => setOpts({ ...opts, launch: v })} />
              </div>
            )}
            <div className="actions">
              <EraButton era={era} primary onClick={finish}>{uninstalling ? 'Close' : 'Finish'}</EraButton>
            </div>
          </section>
        )}

        {screen === 'error' && (
          <section className="card error-card">
            <h2 className="card-title">That didn't work</h2>
            <p className="tagline">{error}</p>
            <p className="meta">Nothing you had was changed. Details are in %TEMP%\katsudo-setup.log.</p>
            <div className="actions">
              <EraButton era={era} primary onClick={start}>Try again</EraButton>
              <EraButton era={era} onClick={() => setScreen('options')}>Options</EraButton>
              <EraButton era={era} onClick={() => invoke('quit')}>Close</EraButton>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ---- pieces ---------------------------------------------------------------------------

function EraTitle({ era, done, uninstalling }: { era: Era; done?: boolean; uninstalling?: boolean }) {
  const word = done ? (uninstalling ? 'Goodbye' : era === 'arcade' ? 'Stage clear' : 'Ready') : 'Katsudō';
  return (
    <h1 className={`era-title${done ? ' is-done' : ''}`}>
      {era === 'phosphor' && <span className="prompt">&gt; </span>}
      {word}
      {era === 'phosphor' && <span className="ph-cursor">█</span>}
    </h1>
  );
}

function EraButton({ era, primary, onClick, children }: { era: Era; primary?: boolean; onClick: () => void; children: string }) {
  const label = era === 'arcade' && primary ? `▶ ${children.toUpperCase()}` : era === 'phosphor' ? `[ ${children} ]` : children;
  return <button type="button" className={`era-btn${primary ? ' is-primary' : ''}`} onClick={onClick}>{label}</button>;
}

/** Full-window art behind the cards. `progress` drives the era's progress motif. */
function Backdrop({ era, progress }: { era: Era; progress: number }) {
  return (
    <div className="backdrop" aria-hidden="true">
      {era === 'synthwave' && <div className="sw-wrap"><SynthwaveArt /></div>}
      {era === 'dark' && <div className="lanes-wrap"><LanesArt /></div>}
      {era === 'arcade' && (
        <div className="ar">
          <div className="ar-stars ar-stars-1" />
          <div className="ar-stars ar-stars-2" />
        </div>
      )}
      {era === 'beige' && (
        <div className="bx-desk">
          {['My Computer', 'Keys', 'Clicks', 'Backups'].map((n) => <div key={n} className="bx-icon"><i /><span>{n}</span></div>)}
        </div>
      )}
      {era === 'phosphor' && <div className="ph-glow" style={{ opacity: 0.35 + progress * 0.65 }} />}
    </div>
  );
}

function Progress({ era, pct, log, uninstalling }: { era: Era; pct: number; log: string[]; uninstalling: boolean }) {
  const p = Math.round(pct * 100);
  const doing = uninstalling ? 'Removing' : 'Installing';
  const last = log[log.length - 1] ?? 'starting';
  if (era === 'phosphor') {
    const width = 36;
    const filled = Math.round(pct * width);
    return (
      <section className="card terminal">
        <pre>
          {`> ${uninstalling ? 'uninstall' : 'install'} katsudo\n`}
          {log.map((l) => `  ${l}\n`).join('')}
          {`\n  [${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${String(p).padStart(3)}%`}
          <span className="ph-cursor">█</span>
        </pre>
      </section>
    );
  }
  if (era === 'arcade') {
    return (
      <section className="card arcade-progress">
        <div className="ar-stage">{uninstalling ? 'GAME OVER?' : 'STAGE 1 · LOADING'}</div>
        <div className="ar-bar">{Array.from({ length: 24 }, (_, i) => <i key={i} className={i < Math.round(pct * 24) ? 'on' : ''} />)}</div>
        <div className="ar-score">SCORE {String(Math.round(pct * 999_999)).padStart(6, '0')}</div>
        <div className="ar-log">{last.toUpperCase()}</div>
      </section>
    );
  }
  if (era === 'beige') {
    return (
      <section className="bx-window bx-setup">
        <div className="bx-title"><span>{doing} Katsudō</span><b>×</b></div>
        <div className="bx-body">
          <div className="bx-big">{doing}…</div>
          <div>{last}</div>
          <div className="bx-progress">{Array.from({ length: 30 }, (_, i) => <i key={i} className={i < Math.round(pct * 30) ? 'on' : ''} />)}</div>
          <div className="bx-small">{pct < 1 ? 'Time remaining: a few seconds' : 'Finishing up'}</div>
        </div>
      </section>
    );
  }
  return (
    <section className={`card meter-card meter-${era}`}>
      <div className="meter-pct">{p}<span>%</span></div>
      <div className="meter-bar"><i style={{ transform: `scaleX(${pct})` }} /></div>
      <div className="meter-log">{doing} · {last}</div>
    </section>
  );
}
