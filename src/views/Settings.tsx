import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useState } from 'react';
import { api, type Status } from '../api';
import type { Appearance } from '../App';
import { Button, Panel, Segmented, Switch } from '../ds/katsudo';
import { bytesText, useData } from '../lib';
import { THEMES, resolveTheme } from '../themes/themes';
import { UpdatesPanel } from './Updates';

const SCALES = [90, 100, 115, 130, 150, 175];

export function SettingsView({ status, appearance, onAppearance }: {
  status: Status | null;
  appearance: Appearance;
  onAppearance: (a: Appearance) => void;
}) {
  const { data } = useData(api.settings, []);
  const autostart = useData(api.autostart, []);
  const admin = useData(api.admin, []);
  const [adminNote, setAdminNote] = useState<string | null>(null);
  if (!data || autostart.data === null || admin.data === null) return <div className="page" />;
  const setAdmin = (v: boolean) => {
    setAdminNote(v ? 'Restarting as administrator…' : 'Restarting…');
    api.setAdmin(v).then(
      (restarting) => { if (!restarting) { setAdminNote(null); admin.reload(); autostart.reload(); } },
      (e) => { setAdminNote(String(e)); admin.reload(); },
    );
  };
  const adminHint = adminNote
    ?? (admin.data.wanted && !admin.data.elevated
      ? 'On, but Windows wasn\'t asked or said no this time, so input in apps run as administrator isn\'t counted. Turn it off and on to try again.'
      : 'Many games, often those with anti-cheat, run as administrator and hide their keys and clicks from apps that don\'t. Katsudō restarts as administrator (Windows asks first) and starts that way at sign-in without asking, so anything that can change files in your user folder could also start as administrator then.');

  const set = (patch: Partial<Appearance>, key: 'theme' | 'ui_scale' | 'motion' | 'welcome', value: string) => {
    onAppearance({ ...appearance, ...patch });
    api.setSetting(key, value);
  };
  const today = resolveTheme('mixtape');

  return (
    <div className="page">
      <div className="page-head"><h1 className="display-lg">Settings</h1></div>

      <Panel title="Era">
        <div className="themes">
          {THEMES.map((t) => (
            <button key={t.id} type="button" className={`theme-card${appearance.theme === t.id ? ' is-on' : ''}`}
              aria-pressed={appearance.theme === t.id} onClick={() => set({ theme: t.id }, 'theme', t.id)}>
              <div className="theme-swatches">{t.swatches.map((c) => <i key={c} style={{ background: c }} />)}</div>
              <div className="row"><span className="text-strong">{t.name}</span><span className="data-sm theme-era">{t.era}</span></div>
              <span className="text-small muted">{t.blurb}</span>
            </button>
          ))}
          <button type="button" className={`theme-card${appearance.theme === 'mixtape' ? ' is-on' : ''}`}
            aria-pressed={appearance.theme === 'mixtape'} onClick={() => set({ theme: 'mixtape' }, 'theme', 'mixtape')}>
            <div className="theme-swatches">{THEMES.map((t) => <i key={t.id} style={{ background: t.swatches[1] }} />)}</div>
            <div className="row"><span className="text-strong">Mixtape</span><span className="data-sm theme-era">Every era</span></div>
            <span className="text-small muted">A different era each day. Today: {THEMES.find((t) => t.id === today)?.name}.</span>
          </button>
          <button type="button" className={`theme-card${appearance.theme === 'shuffle' ? ' is-on' : ''}`}
            aria-pressed={appearance.theme === 'shuffle'} onClick={() => set({ theme: 'shuffle' }, 'theme', 'shuffle')}>
            <div className="theme-swatches">{[...THEMES].reverse().map((t) => <i key={t.id} style={{ background: t.swatches[2] }} />)}</div>
            <div className="row"><span className="text-strong">Shuffle</span><span className="data-sm theme-era">Every era</span></div>
            <span className="text-small muted">A new era, picked at random, every time you open Katsudō.{appearance.theme === 'shuffle' ? ` Now: ${THEMES.find((t) => t.id === resolveTheme('shuffle'))?.name}.` : ''}</span>
          </button>
        </div>
      </Panel>

      <div className="split-even">
        <Panel title="Display">
          <div className="settings-list">
            <div className="setting-row">
              <div>
                <div className="text-body">Interface scale</div>
                <div className="text-small faint">Bigger on 4K screens. Applies at once.</div>
              </div>
              <Segmented label="Interface scale" value={String(appearance.scale)}
                options={SCALES.map((s) => ({ value: String(s), label: `${s}%` }))}
                onChange={(v) => set({ scale: Number(v) }, 'ui_scale', v)} />
            </div>
            <Switch checked={appearance.theme === 'shuffle'} label="Shuffle eras"
              hint="A new era, at random, every time you open Katsudō from the tray or the taskbar. Off keeps the era you're on."
              onChange={(v) => { const keep = resolveTheme(appearance.theme); set({ theme: v ? 'shuffle' : keep }, 'theme', v ? 'shuffle' : keep); }} />
            <Switch defaultChecked={appearance.motion} label="Animations"
              hint="The era's moving art. Paused whenever the window is hidden, so it costs nothing in the tray."
              onChange={(v) => set({ motion: v }, 'motion', String(v))} />
            <Switch defaultChecked={appearance.welcome} label="Welcome on launch"
              hint="The era's short intro when Katsudō opens. Any key or click skips it."
              onChange={(v) => set({ welcome: v }, 'welcome', String(v))} />
          </div>
        </Panel>

        <Panel title="Tracking">
          <div className="settings-list">
            <Switch defaultChecked={autostart.data} label="Start with Windows"
              hint="Opens in the tray when you sign in, so no day goes untracked. Closing the window keeps it running."
              onChange={(v) => api.setAutostart(v).catch(() => autostart.reload())} />
            <Switch defaultChecked={data.track_input} label="Count keys and clicks"
              hint="Counts presses per key and per app. Never records what you type or in what order."
              onChange={(v) => api.setSetting('track_input', String(v))} />
            <Switch checked={admin.data.wanted} label="Run as administrator" hint={adminHint} onChange={setAdmin} />
            <Switch defaultChecked={data.presence_aware} label="Calls and videos count as present"
              hint="While the microphone or camera is in use, or a video keeps the screen on, you aren't marked away for not typing. Break nudges wait for calls to end."
              onChange={(v) => api.setSetting('presence_aware', String(v))} />
            <Switch defaultChecked={data.track_titles} label="Record window titles"
              hint="Off: only app names are stored, and the Documents lane stays empty."
              onChange={(v) => api.setSetting('track_titles', String(v))} />
            <div className="setting-row">
              <div>
                <div className="text-body">Count as away after</div>
                <div className="text-small faint">No keyboard or mouse input for this long.</div>
              </div>
              <Segmented label="Away after" defaultValue={String(data.idle_minutes)}
                options={['2', '5', '10', '15'].map((m) => ({ value: m, label: `${m} min` }))}
                onChange={(v) => api.setSetting('idle_minutes', v)} />
            </div>
            <div className="setting-row">
              <div>
                <div className="text-body">Flow needs at least</div>
                <div className="text-small faint">The shortest stretch on one task that counts as a flow session.</div>
              </div>
              <Segmented label="Flow needs at least" defaultValue={String(data.flow_minutes)}
                options={['15', '25', '45', '60'].map((m) => ({ value: m, label: `${m} min` }))}
                onChange={(v) => api.setSetting('flow_minutes', v)} />
            </div>
            <Switch defaultChecked={data.break_nudges} label="Break nudges"
              hint="After a long stretch without a break, a small note above the tray suggests one. Never during a flow session, a game or anything fullscreen; sooner after hard typing. Going away for a few minutes resets it."
              onChange={(v) => api.setSetting('break_nudges', String(v))} />
            <div className="setting-row">
              <div>
                <div className="text-body">Nudge after</div>
                <div className="text-small faint">Unbroken time at the computer. <button className="link-button" onClick={() => api.nudgePreview()}>Show me one</button></div>
              </div>
              <Segmented label="Nudge after" defaultValue={String(data.break_minutes)}
                options={['45', '60', '90', '120'].map((m) => ({ value: m, label: Number(m) < 60 ? `${m} min` : `${Number(m) / 60} h`.replace('1.5 h', '1½ h') }))}
                onChange={(v) => api.setSetting('break_minutes', v)} />
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Data">
        <div className="settings-list">
          <div className="setting-row">
            <div>
              <div className="text-body">Database{status ? ` · ${bytesText(status.db_bytes)}` : ''}</div>
              <div className="path">{status?.db_path}</div>
            </div>
            {status && <Button icon="database" onClick={() => revealItemInDir(status.db_path)}>Show in Explorer</Button>}
          </div>
          <p className="text-small faint">One SQLite file on this machine, readable by any SQLite tool. Nothing is sent anywhere.</p>
        </div>
      </Panel>
      <UpdatesPanel version={status?.version ?? ''} weekly={data.update_weekly} />
    </div>
  );
}
