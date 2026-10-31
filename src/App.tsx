import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { api } from './api';
import { Button, Icon, NavItem, StatusBar } from './ds/katsudo';
import type { IconName } from './ds/katsudo';
import { bytesText, dateTime, todayIso, useData } from './lib';
import { LiveProvider, useLive } from './live';
import { applyMotion, applyScale, applyTheme, resolveTheme, THEMES, type ThemeId } from './themes/themes';
import { Welcome } from './themes/Welcome';
import { transitionEra } from './themes/transitions';
import { Today } from './views/Today';
import { TimelineView } from './views/Timeline';
import { Applications } from './views/Applications';
import { InputView } from './views/Input';
import { Rhythm } from './views/Rhythm';
import { Network } from './views/Network';
import { Import } from './views/Import';
import { Backups } from './views/Backups';
import { SettingsView } from './views/Settings';
import { Roadmap } from './views/Roadmap';
import { Palette, type Command } from './views/Palette';
import { WrappedView } from './views/Wrapped';
import { CompareView } from './views/Compare';
import { TagsView } from './views/Tags';
import { FlowView } from './views/Flow';
import { openReceipt, ReceiptDialog } from './views/Receipt';
import { Hanko, PAGE_KANJI } from './kanji';

type View = 'today' | 'timeline' | 'apps' | 'input' | 'rhythm' | 'network' | 'wrapped' | 'compare' | 'tags' | 'flow' | 'import' | 'backups' | 'roadmap' | 'settings';

const NAV: { id: View; label: string; icon: IconName; kbd?: string }[] = [
  { id: 'today', label: 'Today', icon: 'clock', kbd: '1' },
  { id: 'timeline', label: 'Timeline', icon: 'timeline', kbd: '2' },
  { id: 'apps', label: 'Applications', icon: 'apps', kbd: '3' },
  { id: 'input', label: 'Input', icon: 'keyboard', kbd: '4' },
  { id: 'rhythm', label: 'Rhythm', icon: 'rhythm', kbd: '5' },
  { id: 'network', label: 'Network', icon: 'network' },
  { id: 'wrapped', label: 'Year in review', icon: 'calendar' },
  { id: 'compare', label: 'Compare', icon: 'timeline' },
  { id: 'tags', label: 'Tags', icon: 'tag' },
  { id: 'flow', label: 'Flow', icon: 'star' },
];
const NAV_DATA: { id: View; label: string; icon: IconName }[] = [
  { id: 'import', label: 'Import', icon: 'import' },
  { id: 'backups', label: 'Backups', icon: 'backup' },
  { id: 'roadmap', label: 'Roadmap', icon: 'flag' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export interface Appearance {
  theme: string;
  scale: number;
  motion: boolean;
  welcome: boolean;
}

export function App() {
  const [appearance, setAppearance] = useState<Appearance | null>(null);

  useEffect(() => {
    api.settings().then(
      (s) => setAppearance({ theme: s.theme, scale: s.ui_scale, motion: s.motion, welcome: s.welcome }),
      () => setAppearance({ theme: 'dark', scale: 100, motion: true, welcome: true }),
    );
    // Pause every animation while the window is hidden in the tray.
    const vis = () => document.documentElement.classList.toggle('is-hidden', document.hidden);
    vis();
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);

  useEffect(() => {
    if (!appearance) return;
    applyTheme(appearance.theme);
    // An overlay set to "Match app" follows the era showing here (Mixtape resolved).
    api.setOverlayEra(resolveTheme(appearance.theme)).catch(() => {});
    applyScale(appearance.scale);
    applyMotion(appearance.motion);
  }, [appearance]);

  // A new era plays its transition: the update has to land in the DOM before the browser
  // captures the new look, so render synchronously and set the era straight away.
  const changeAppearance = (next: Appearance) => {
    if (!appearance || next.theme === appearance.theme) return setAppearance(next);
    transitionEra(appearance.theme, next.theme, next.motion, () => {
      applyTheme(next.theme);
      flushSync(() => setAppearance(next));
    });
  };

  if (!appearance) return null;
  return (
    <LiveProvider>
      <Shell appearance={appearance} onAppearance={changeAppearance} />
      <Welcome theme={resolveTheme(appearance.theme)} enabled={appearance.welcome && appearance.motion} />
    </LiveProvider>
  );
}

function Shell({ appearance, onAppearance }: { appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  const [view, setViewState] = useState<View>('today');
  const [timelineDay, setTimelineDay] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const setView = (v: View) => {
    if (v === 'timeline') setTimelineDay(null);
    setViewState(v);
  };
  const openDay = (day: string) => {
    setTimelineDay(day);
    setViewState('timeline');
  };
  const status = useData(api.status, [], 5000);
  const { live } = useLive();
  const s = status.data;
  const theme: ThemeId = resolveTheme(appearance.theme);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.altKey || e.metaKey) return;
      const hit = NAV.find((n) => n.kbd === e.key);
      if (hit) setView(hit.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const togglePause = async () => {
    await api.setPaused(s?.tracking ? 60 : null);
    status.reload();
  };

  const setEra = (theme: string) => {
    onAppearance({ ...appearance, theme });
    api.setSetting('theme', theme);
  };
  const commands: Command[] = [
    ...[...NAV, ...NAV_DATA].map((n) => ({
      id: `go-${n.id}`, label: n.label, icon: n.icon, hint: 'kbd' in n && n.kbd ? `Go to · ${n.kbd}` : 'Go to', run: () => setView(n.id),
    })),
    {
      id: 'pause', icon: s?.tracking === false ? 'play' : 'pause', run: togglePause, keywords: 'tracking stop resume',
      label: s?.tracking === false ? 'Resume tracking' : 'Pause tracking for 1 hour',
    },
    { id: 'backup', icon: 'backup', label: 'Back up now', keywords: 'backup save snapshot', run: () => { api.backupNow().then(status.reload); } },
    { id: 'receipt-today', icon: 'export', label: "Today's receipt", keywords: 'receipt print slip summary day', run: () => openReceipt(todayIso()) },
    { id: 'receipt-yesterday', icon: 'export', label: "Yesterday's receipt", keywords: 'receipt print slip summary day', run: () => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      openReceipt(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    } },
    { id: 'day-yesterday', icon: 'calendar', label: 'Yesterday on the timeline', keywords: 'day', run: () => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      openDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    } },
    ...THEMES.map((t) => ({
      id: `era-${t.id}`, icon: 'star' as const, label: `Era: ${t.name}`, hint: t.era, keywords: `theme look ${t.id} ${t.blurb}`, run: () => setEra(t.id),
    })),
    { id: 'era-mixtape', icon: 'star', label: 'Era: Mixtape', hint: 'a different era each day', keywords: 'theme look random daily', run: () => setEra('mixtape') },
    {
      id: 'motion', icon: 'play', label: appearance.motion ? 'Turn animations off' : 'Turn animations on', keywords: 'motion reduce',
      run: () => { onAppearance({ ...appearance, motion: !appearance.motion }); api.setSetting('motion', String(!appearance.motion)); },
    },
  ];

  const pausedText = s?.paused_until
    ? s.paused_until > 4e12
      ? 'Paused until resumed'
      : `Resumes ${new Date(s.paused_until * 1000).toTimeString().slice(0, 5)}`
    : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Hanko /><span>Katsudō</span></div>
        <button className="nav-search" onClick={() => setPalette(true)}>
          <Icon name="search" />
          <span>Search</span>
          <kbd className="kt-kbd">Ctrl K</kbd>
        </button>
        <nav className="nav">
          {NAV.map((n) => (
            <NavItem key={n.id} icon={n.icon} label={n.label} kbd={n.kbd} active={view === n.id} onClick={() => setView(n.id)} />
          ))}
          <div className="nav-gap" />
          {NAV_DATA.map((n) => (
            <NavItem key={n.id} icon={n.icon} label={n.label} active={view === n.id} onClick={() => setView(n.id)} />
          ))}
        </nav>
        <div className="sidebar-foot">
          <Button size="sm" icon={s?.tracking === false ? 'play' : 'pause'} onClick={togglePause}>
            {s?.tracking === false ? 'Resume tracking' : 'Pause for 1 hour'}
          </Button>
        </div>
      </aside>
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} onDay={openDay} />}
      <main className="main" style={{ ['--page-kanji' as string]: `"${PAGE_KANJI[view] ?? ''}"` }}>
        {view === 'today' && <Today theme={theme} />}
        {view === 'timeline' && <TimelineView key={timelineDay ?? 'today'} initialDay={timelineDay ?? undefined} />}
        {view === 'apps' && <Applications firstDay={s?.first_day ?? null} />}
        {view === 'input' && <InputView firstDay={s?.first_day ?? null} undated={s?.undated ?? null} />}
        {view === 'rhythm' && <Rhythm />}
        {view === 'wrapped' && <WrappedView />}
        {view === 'compare' && <CompareView />}
        {view === 'tags' && <TagsView firstDay={s?.first_day ?? null} />}
        {view === 'flow' && <FlowView firstDay={s?.first_day ?? null} />}
        {view === 'network' && <Network firstDay={s?.first_day ?? null} undated={s?.undated ?? null} />}
        {view === 'import' && <Import onImported={status.reload} sources={s?.sources ?? []} />}
        {view === 'backups' && <Backups dataDir={s?.data_dir ?? ''} />}
        {view === 'roadmap' && <Roadmap />}
        {view === 'settings' &&<SettingsView status={s} appearance={appearance} onAppearance={onAppearance} />}
      </main>
      <ReceiptDialog firstDay={s?.first_day ?? null} />
      <div className="statusbar">
        <StatusBar
          tracking={s?.tracking !== false}
          items={[
            ...(live && live.kps > 0 ? [{ icon: 'keyboard' as const, label: `${live.kps} keys/s` }] : []),
            ...(s?.app_name && s.tracking ? [{ icon: 'apps' as const, label: s.app_name }] : []),
            { icon: 'database', label: `katsudo.db · ${s ? bytesText(s.db_bytes) : '…'}` },
            {
              icon: 'backup',
              label: s?.last_backup
                ? `Backed up ${dateTime(s.last_backup.created_at)} · ${s.last_backup.verified ? 'verified' : 'NOT verified'}`
                : 'No backup yet',
            },
            { icon: 'lock', label: 'Local only' },
          ]}
          right={pausedText ?? (s ? `v${s.version}` : '')}
        />
      </div>
    </div>
  );
}
