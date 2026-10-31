import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api, type ImportOutcome, type ImportProgress, type ScanResult, type SourceInfo, type Stat } from '../api';
import { Button, ImportSource, Panel } from '../ds/katsudo';
import { dateTime, formatCount, shortDay, useData } from '../lib';
import { WhatPulseAccount } from './WhatPulseAccount';
import { OtherPcs } from './OtherPcs';

type Phase = 'idle' | 'scanning' | 'ready' | 'importing' | 'done' | 'error';
interface CardState {
  phase: Phase;
  path?: string;
  scan?: ScanResult;
  progress?: ImportProgress;
  result?: Stat[];
  error?: string;
}

const SOURCES = [
  { kind: 'manictime', file: 'ManicTimeReports.db', filter: { name: 'ManicTime database', extensions: ['db'] } },
  { kind: 'whatpulse', file: 'whatpulse.db', filter: { name: 'WhatPulse database', extensions: ['db'] } },
  { kind: 'katsudo', file: 'a Katsudō export', filter: { name: 'Katsudō database', extensions: ['db'] } },
];

export function Import({ onImported, sources }: { onImported: () => void; sources: SourceInfo[] }) {
  const detected = useData(api.detect, []);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [finished, setFinished] = useState<ImportOutcome | null>(null);
  useEffect(() => {
    // An import keeps running while you're on other pages; pick it up again on the way back.
    api.importStatus().then((s) => { if (s.running) setProgress((p) => p ?? s.running); });
    const progressed = api.onImportProgress(setProgress);
    const ended = api.onImportFinished((o) => { setProgress(null); setFinished(o); });
    return () => { progressed.then((f) => f()); ended.then((f) => f()); };
  }, []);
  const imported = sources.filter((s) => s.kind !== 'native' && s.kind !== 'katsudo');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Import your history</h1>
          <p className="text-body">
            Read from ManicTime, WhatPulse or Katsudō on your other PCs. The source files are never changed, and Katsudō is backed up before anything is written.
          </p>
        </div>
      </div>
      <div className="cols">
        {SOURCES.map((s) => (
          <SourceCard key={s.kind} {...s}
            detected={detected.data?.find(([k]) => k === s.kind)?.[1]}
            progress={progress?.kind === s.kind ? progress : null}
            finished={finished?.kind === s.kind ? finished : null}
            onImported={onImported} />
        ))}
      </div>
      <OtherPcs onImported={onImported} />
      <WhatPulseAccount progress={progress?.kind === 'whatpulse-account' ? progress : null}
        finished={finished?.kind === 'whatpulse-account' ? finished : null} onImported={onImported} />
      {imported.length > 0 && (
        <Panel title="Imported" flush>
          <table className="table">
            <thead>
              <tr><th className="kt-label">Source</th><th className="kt-label">Imported</th><th className="kt-label">What landed</th></tr>
            </thead>
            <tbody>
              {imported.map((s) => (
                <tr key={s.id}>
                  <td><div className="text-strong">{s.label}</div><div className="path">{s.path}</div></td>
                  <td className="data-md">{dateTime(s.created_at)}</td>
                  <td className="data-md">{(s.summary ?? []).map((x) => `${x.value} ${x.label.toLowerCase()}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <p className="text-small faint">
        Different PCs add up. On the same PC, where Katsudō and an import both have data for an hour, Katsudō's own recording is used. Importing the same tool again replaces its earlier import.
      </p>
    </div>
  );
}

function SourceCard(props: {
  kind: string;
  file: string;
  filter: { name: string; extensions: string[] };
  detected?: string;
  progress: ImportProgress | null;
  finished: ImportOutcome | null;
  onImported: () => void;
}) {
  const { kind, detected, progress, finished } = props;
  const [st, setSt] = useState<CardState>({ phase: 'idle' });
  useEffect(() => {
    if (progress) setSt((p) => (p.phase === 'importing' ? p : { ...p, phase: 'importing' }));
  }, [progress !== null]);
  useEffect(() => {
    if (!finished) return;
    setSt((p) => (p.phase !== 'importing' ? p
      : finished.error ? { ...p, phase: 'error', error: finished.error } : { phase: 'done', path: p.path, result: finished.result ?? [] }));
  }, [finished]);

  const scan = async (path: string) => {
    setSt({ phase: 'scanning', path });
    try {
      setSt({ phase: 'ready', path, scan: await api.scan(kind, path) });
    } catch (e) {
      setSt({ phase: 'error', path, error: String(e) });
    }
  };
  const choose = async () => {
    const picked = await open({ multiple: false, directory: false, filters: [props.filter], title: `Choose ${props.file}` });
    if (typeof picked === 'string') scan(picked);
  };
  const run = async () => {
    if (!st.path) return;
    setSt({ ...st, phase: 'importing' });
    try {
      const result = await api.runImport(kind, st.path);
      setSt({ phase: 'done', path: st.path, result });
      props.onImported();
    } catch (e) {
      setSt({ ...st, phase: 'error', error: String(e) });
    }
  };

  const s = st.scan;
  const range = s?.first_day && s.last_day ? `${shortDay(s.first_day)} – ${shortDay(s.last_day)}` : '';
  let detail: string | undefined;
  let stats: Stat[] | undefined;
  let action: { label: string; run: () => void } | undefined;
  let value = 0;
  switch (st.phase) {
    case 'idle':
      detail = detected ? 'Found on this computer. Use it, or choose a backup copy.' : `Choose ${props.file} from the data folder or a backup.`;
      action = detected ? { label: 'Use this database', run: () => scan(detected) } : { label: 'Choose file…', run: choose };
      break;
    case 'scanning':
      detail = 'Reading the database. If the tool is running, a private copy is made first.';
      break;
    case 'ready':
      detail = `Found ${formatCount(s!.days)} days, ${range}.` +
        (s!.overlap_days
          ? ` ${formatCount(s!.overlap_days)} of them ${s!.overlap_days === 1 ? 'overlaps' : 'overlap'} data Katsudō already has; Katsudō's own data is kept for those hours.`
          : '') +
        (s!.previous_import ? ` This replaces the import from ${dateTime(s!.previous_import)}.` : '');
      stats = s!.stats;
      action = { label: `Import ${formatCount(s!.days)} days`, run };
      break;
    case 'importing':
      value = progress && progress.total ? progress.done / progress.total : 0;
      detail = progress ? progress.phase + (progress.total > 10 ? ` · ${formatCount(progress.done)} of ${formatCount(progress.total)}` : '') : 'Starting';
      break;
    case 'done':
      detail = 'Imported. It shows up in every view now.';
      stats = st.result;
      action = { label: 'Choose another file…', run: choose };
      break;
    case 'error':
      detail = st.error;
      action = { label: 'Choose another file…', run: choose };
      break;
  }

  return (
    <div className="stack">
      <ImportSource
        source={kind}
        file={st.path ?? detected}
        status={st.phase}
        progress={value}
        detail={detail}
        stats={stats}
        actionLabel={action?.label}
        onAction={action?.run}
      />
      <div className="row">
        {st.phase === 'importing' && <Button size="sm" variant="ghost" onClick={() => api.cancelImport()}>Cancel import</Button>}
        {(st.phase === 'idle' && detected) || st.phase === 'ready' ? (
          <Button size="sm" variant="ghost" onClick={choose}>Choose a different file…</Button>
        ) : null}
      </div>
      {st.phase === 'ready' && s!.notes.length > 0 && (
        <ul className="notes">{s!.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
    </div>
  );
}
