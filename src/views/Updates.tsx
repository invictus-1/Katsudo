import { useState } from 'react';
import { api, type Update } from '../api';
import { Button, Panel, Switch } from '../ds/katsudo';
import { bytesText } from '../lib';

/** Updates: a check only when you ask (or weekly, if you turn that on), and signed installers. */
export function UpdatesPanel({ version, weekly }: { version: string; weekly: boolean }) {
  const [state, setState] = useState<'idle' | 'checking' | 'installing' | 'started'>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState('');
  const check = async () => {
    setState('checking');
    setError('');
    try {
      setUpdate(await api.checkUpdate());
    } catch (e) {
      setError(String(e));
    } finally {
      setState('idle');
    }
  };
  const install = async () => {
    setState('installing');
    setError('');
    try {
      await api.installUpdate();
      setState('started');
    } catch (e) {
      setError(String(e));
      setState('idle');
    }
  };
  return (
    <Panel title="Updates">
      <div className="settings-list">
        <div className="setting-row">
          <div>
            <div className="text-body">Katsudō {version}</div>
            <div className="text-small faint" role="status">
              {state === 'checking' ? 'Asking GitHub…'
                : state === 'installing' ? 'Downloading and checking the signature…'
                : state === 'started' ? 'The installer is open. It closes Katsudō, upgrades it and keeps all your data.'
                : update ? (update.newer ? `Katsudō ${update.latest} is out${update.size ? ` (${bytesText(update.size)})` : ''}.` : `You have the newest version.`)
                : 'Katsudō never checks unless you ask.'}
            </div>
          </div>
          <div className="row">
            {update?.newer && state !== 'started' && (
              <Button variant="primary" onClick={install} disabled={state !== 'idle'}>Download and install</Button>
            )}
            {update?.newer && <Button variant="ghost" onClick={() => api.openLink(update.url)}>What's new</Button>}
            {!update?.newer && <Button onClick={check} disabled={state !== 'idle'}>Check for updates</Button>}
          </div>
        </div>
        <Switch defaultChecked={weekly} label="Check once a week"
          hint="Asks GitHub which version is newest, once a week, and shows it in the status bar. Only the question is sent: nothing about you or your data."
          onChange={(v) => api.setSetting('update_weekly', String(v))} />
        <p className="text-small faint">
          Installers are signed: Katsudō checks each download against its own key and refuses anything that doesn't match.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Panel>
  );
}
