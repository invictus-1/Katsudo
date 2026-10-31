import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { api, type Status } from '../api';
import type { Appearance } from '../App';
import { Button, Panel, Segmented, Switch } from '../ds/katsudo';
import { bytesText, useData } from '../lib';
import { THEMES, resolveTheme } from '../themes/themes';

const SCALES = [90, 100, 115, 130, 150, 175];

export function SettingsView({ status, appearance, onAppearance }: {
  status: Status | null;
  appearance: Appearance;
  onAppearance: (a: Appearance) => void;
}) {
  const { data } = useData(api.settings, []);
  const autostart = useData(api.autostart, []);
  if (!data || autostart.data === null) return <div className="page" />;

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
    </div>
  );
}
