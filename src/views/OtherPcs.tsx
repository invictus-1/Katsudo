import { useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { api } from '../api';
import { Button, Panel } from '../ds/katsudo';
import { dateTime, shortDay, useData } from '../lib';

/** Your other PCs: export this one, keep a sync folder, and see what came from where. */
export function OtherPcs({ onImported }: { onImported: () => void }) {
  const pcs = useData(api.pcs, []);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const p = pcs.data;
  const act = async (what: string, run: () => Promise<string | void>) => {
    setBusy(what);
    setMessage('');
    try {
      const m = await run();
      if (m) setMessage(m);
      pcs.reload();
      onImported();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy('');
    }
  };
  if (!p) return null;
  const range = (f: string | null, l: string | null) => (f && l ? `${shortDay(f)} – ${shortDay(l)}` : 'no days yet');

  const exportThis = () => act('export', async () => {
    const path = await save({ defaultPath: `katsudo-${p.this.name}.db`, filters: [{ name: 'Katsudō database', extensions: ['db'] }] });
    if (!path) return;
    await api.exportPc(path);
    return `Saved. On your other PC, choose this file under "Another PC" above.`;
  });
  const chooseFolder = () => act('folder', async () => {
    const dir = await open({ directory: true, multiple: false, title: 'Choose a folder all your PCs can reach' });
    if (typeof dir !== 'string') return;
    await api.setSetting('sync_dir', dir);
    const got = await api.syncNow();
    return got.length ? `Synced. Brought in ${got.join(', ')}.` : 'Synced. This PC\'s file is in the folder; no other PC\'s file there yet.';
  });
  const syncNow = () => act('sync', async () => {
    const got = await api.syncNow();
    return got.length ? `Brought in ${got.join(', ')}.` : 'Up to date.';
  });
  const stop = () => act('stop', async () => { await api.setSetting('sync_dir', ''); return 'Stopped syncing. Nothing was deleted.'; });
  const remove = (device: string, name: string) => act(device, async () => {
    if (!window.confirm(`Remove ${name}'s history from this PC? A backup is made first; ${name} itself is untouched.`)) return;
    await api.removePc(device);
    return `Removed ${name}.`;
  });

  return (
    <Panel title="Your PCs">
      <div className="pcs">
        <div className="pcs-row">
          <div>
            <div className="text-strong">This PC · {p.this.name}</div>
            <div className="text-small faint">{range(p.this.first_day, p.this.last_day)}</div>
          </div>
          <Button size="sm" onClick={exportThis} disabled={!!busy}>Export this PC…</Button>
        </div>

        <div className="pcs-row">
          <div>
            <div className="text-strong">Sync folder</div>
            <div className="text-small faint">
              {p.sync_dir
                ? <>{p.sync_dir}{p.last_sync ? ` · last synced ${dateTime(p.last_sync)}` : ''}</>
                : 'Point every PC at one folder (OneDrive, Dropbox, a NAS, a USB stick) and each keeps the others up to date, every six hours. Katsudō sends nothing anywhere; your sync tool carries the files.'}
            </div>
          </div>
          <div className="row">
            {p.sync_dir && <Button size="sm" variant="primary" onClick={syncNow} disabled={!!busy}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</Button>}
            <Button size="sm" onClick={chooseFolder} disabled={!!busy}>{p.sync_dir ? 'Change folder…' : 'Choose folder…'}</Button>
            {p.sync_dir && <Button size="sm" variant="ghost" onClick={stop} disabled={!!busy}>Stop</Button>}
          </div>
        </div>

        {p.others.map((o) => (
          <div key={o.device} className="pcs-row">
            <div>
              <div className="text-strong">{o.name}</div>
              <div className="text-small faint">{range(o.first_day, o.last_day)}{o.imported_at ? ` · brought in ${dateTime(o.imported_at)}` : ''}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => remove(o.device, o.name)} disabled={!!busy}>Remove</Button>
          </div>
        ))}
        {message && <p className="text-small pcs-message" role="status">{message}</p>}
      </div>
    </Panel>
  );
}
