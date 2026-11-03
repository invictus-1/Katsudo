import { useEffect, useState } from 'react';
import { api, type AccountRole, type AccountScan, type ImportOutcome, type ImportProgress, type Stat } from '../api';
import { Badge, Button, ImportSource, Input, Segmented } from '../ds/katsudo';
import { dateTime, formatCount, shortCount, shortDay } from '../lib';

type Phase = 'idle' | 'looking' | 'ready' | 'importing' | 'done' | 'error';
const KEY_PAGE = 'https://whatpulse.org/go/settings-api-keys';

/** Your whole WhatPulse account: every computer, every pulse, through your own API key. */
export function WhatPulseAccount({ progress, finished, onImported }: {
  progress: ImportProgress | null;
  finished: ImportOutcome | null;
  onImported: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [user, setUser] = useState('');
  const [token, setToken] = useState('');
  const [scan, setScan] = useState<AccountScan | null>(null);
  const [roles, setRoles] = useState<Record<number, AccountRole>>({});
  const [result, setResult] = useState<Stat[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (progress) setPhase('importing');
  }, [progress !== null]);
  useEffect(() => {
    if (!finished || phase !== 'importing') return;
    if (finished.error) {
      setError(finished.error);
      setPhase('error');
    } else {
      setResult(finished.result ?? []);
      setPhase('done');
    }
  }, [finished]);

  const lookUp = async () => {
    setPhase('looking');
    setError('');
    try {
      const s = await api.wpScan(user, token);
      setScan(s);
      setRoles(Object.fromEntries(s.computers.map((c) => [c.id, c.suggested])));
      setPhase('ready');
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };
  const run = async () => {
    if (!scan) return;
    setPhase('importing');
    try {
      const choices = scan.computers.map((c) => ({ computer_id: c.id, name: c.name, role: roles[c.id] ?? 'other' }));
      setResult(await api.wpImport(user, token, choices));
      setToken(''); // nothing to keep it for
      setPhase('done');
      onImported();
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  const chosen = scan?.computers.filter((c) => roles[c.id] !== 'skip') ?? [];
  const chosenPulses = chosen.reduce((s, c) => s + c.pulses, 0);
  const pct = progress && progress.total ? progress.done / progress.total : 0;
  const status = phase === 'looking' ? 'scanning' : phase;
  const detail =
    phase === 'idle' ? 'Every computer you ever pulsed from, archived ones too, back to your first pulse.'
      : phase === 'looking' ? 'Asking WhatPulse for your account and computers.'
        : phase === 'ready' && scan ? `${scan.username}: ${formatCount(scan.pulses)} pulses${scan.first_pulse ? ` since ${shortDay(scan.first_pulse.slice(0, 10))}` : ''}.${scan.previous_import ? ` Replaces the account import from ${dateTime(scan.previous_import)}.` : ''}`
          : phase === 'importing' ? (progress ? progress.phase + (progress.total > 10 ? ` · ${formatCount(progress.done)} of ${formatCount(progress.total)}` : '') : 'Starting')
            : phase === 'done' ? 'Imported. Your old PCs now show in every view.'
              : error;

  return (
    <div className="stack wp-account">
      <ImportSource
        source="whatpulse"
        name="WhatPulse account"
        file={scan ? `whatpulse.org/${scan.username}` : 'whatpulse.org · all computers'}
        status={status}
        progress={pct}
        detail={detail}
        stats={phase === 'ready' ? scan?.stats : phase === 'done' ? result ?? undefined : undefined}
      />

      {(phase === 'idle' || phase === 'error' || phase === 'looking') && (
        <form className="wp-form" onSubmit={(e) => { e.preventDefault(); lookUp(); }}>
          <Input placeholder="WhatPulse username" value={user} onChange={(e) => setUser(e.target.value)} />
          <Input type="password" icon="lock" placeholder="API key" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          <Button type="submit" variant="primary" disabled={!user.trim() || !token.trim() || phase === 'looking'}>
            {phase === 'looking' ? 'Looking up…' : 'Look up'}
          </Button>
          <p className="text-small faint wp-note">
            Create a free key in your WhatPulse settings (<a href={KEY_PAGE} onClick={(e) => { e.preventDefault(); api.openLink(KEY_PAGE); }}>whatpulse.org/go/settings-api-keys</a>).
            It is sent to WhatPulse only, used for this import, and never saved.
          </p>
        </form>
      )}

      {phase === 'ready' && scan && (
        <>
          <table className="table wp-computers">
            <thead>
              <tr><th className="kt-label">Computer</th><th className="kt-label">Pulses</th><th className="kt-label">Keys</th><th className="kt-label">Last pulse</th><th className="kt-label">Import as</th></tr>
            </thead>
            <tbody>
              {scan.computers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="row"><span className="text-strong">{c.name}</span>{c.archived && <Badge>Archived</Badge>}{c.suggested === 'this-pc' && <Badge tone="cyan">This PC</Badge>}</div>
                    {c.os && <div className="text-small faint">{c.os}</div>}
                  </td>
                  <td className="data-md">{formatCount(c.pulses)}</td>
                  <td className="data-md">{shortCount(c.keys)}</td>
                  <td className="data-md">{c.last_pulse ? shortDay(c.last_pulse.slice(0, 10)) : '–'}</td>
                  <td>
                    <Segmented size="sm" label={`Import ${c.name} as`} value={roles[c.id]}
                      options={[{ value: 'this-pc', label: 'This PC' }, { value: 'other', label: 'Other PC' }, { value: 'skip', label: 'Skip' }]}
                      onChange={(v) => setRoles({ ...roles, [c.id]: v as AccountRole })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="notes">
            <li>Other PCs add to your totals as their own devices. This PC only fills days Katsudō has no input for yet, since your local WhatPulse import and Katsudō's own recording are more detailed.</li>
            <li>WhatPulse keeps each pulse as one batch. Katsudō spreads every batch evenly over the hours since the previous pulse (up to a week), so calendars show roughly when you were active. Totals are exact.</li>
            <li>The account has totals, not per-key or per-app detail, so old PCs show in totals, calendars and charts, not on the keyboard map.</li>
          </ul>
          <div className="row">
            <Button variant="primary" onClick={run} disabled={!chosen.length}>Import {formatCount(chosenPulses)} pulses from {chosen.length} {chosen.length === 1 ? 'computer' : 'computers'}</Button>
            <Button variant="ghost" onClick={() => setPhase('idle')}>Back</Button>
          </div>
        </>
      )}

      {phase === 'importing' && <Button size="sm" variant="ghost" onClick={() => api.cancelImport()}>Cancel import</Button>}
    </div>
  );
}
