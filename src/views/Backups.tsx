import { useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { api, type BackupInfo } from '../api';
import { Badge, Button, Panel, Switch } from '../ds/katsudo';
import { bytesText, dateTime, useData } from '../lib';

export function Backups({ dataDir }: { dataDir: string }) {
  const list = useData(api.backups, [], 30000);
  const settings = useData(api.settings, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const items = list.data ?? [];
  const last = items.find((b) => b.kind === 'nightly' || b.kind === 'manual') ?? items[0];

  const backupNow = async () => {
    setBusy('backup');
    setMessage(null);
    try {
      const b = await api.backupNow();
      setMessage(b.verified ? `Backed up and verified: ${b.file}` : `Backed up, but verification failed: ${b.note}`);
    } catch (e) {
      setMessage(String(e));
    }
    setBusy(null);
    list.reload();
  };

  const restore = async (b: BackupInfo) => {
    const ok = await ask(
      `Restore the snapshot from ${dateTime(b.created_at)}? The current database is backed up first, so this can be undone.`,
      { title: 'Restore backup', kind: 'warning', okLabel: `Restore ${dateTime(b.created_at)}`, cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    setBusy(b.file);
    try {
      await api.restore(b.file);
      setMessage(`Restored ${dateTime(b.created_at)}. The previous state was saved as a pre-restore backup.`);
    } catch (e) {
      setMessage(String(e));
    }
    setBusy(null);
    list.reload();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Backups</h1>
          <p className="counter-lg">{last ? `Last backup ${dateTime(last.created_at)} · ${last.verified ? 'verified' : 'not verified'}` : 'No backup yet'}</p>
        </div>
        <div className="page-tools">
          <Button icon="backup" onClick={backupNow} disabled={busy !== null}>{busy === 'backup' ? 'Backing up…' : 'Back up now'}</Button>
          <Button variant="ghost" icon="database" onClick={() => revealItemInDir(dataDir + '\\backups')}>Show folder</Button>
        </div>
      </div>
      {message && <p className="text-body muted">{message}</p>}
      <Panel title="Schedule">
        {settings.data && (
          <Switch
            defaultChecked={settings.data.nightly_backup}
            label="Daily backup"
            hint="A verified snapshot every 24 hours. Keeps 14 daily and 8 weekly snapshots; imports and restores add a safety snapshot first."
            onChange={(v) => api.setSetting('nightly_backup', String(v))}
          />
        )}
      </Panel>
      <Panel title="Snapshots" flush>
        {items.length ? (
          <table className="table">
            <thead>
              <tr><th className="kt-label">Taken</th><th className="kt-label">Kind</th><th className="kt-label">Size</th><th className="kt-label">Check</th><th /></tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.file}>
                  <td className="data-md">{dateTime(b.created_at)}</td>
                  <td><Badge>{b.kind}</Badge></td>
                  <td className="data-md">{bytesText(b.size)}</td>
                  <td>{b.verified ? <Badge tone="success" dot>Verified</Badge> : <Badge tone="danger" dot>Failed</Badge>}</td>
                  <td className="actions">
                    <Button size="sm" disabled={busy !== null} onClick={() => restore(b)}>{busy === b.file ? 'Restoring…' : 'Restore…'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty"><p className="text-body">No snapshots yet. The first daily backup runs a minute after Katsudō starts.</p></div>
        )}
      </Panel>
    </div>
  );
}
