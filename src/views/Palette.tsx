import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SearchDetail, type SearchHit } from '../api';
import { Icon, type IconName } from '../ds/katsudo';
import { formatDuration, longDay, shortDay } from '../lib';

/** Something the palette can do: open a page, run an action, or show a piece of history. */
export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  /** Extra words that should find it ("dark" finds Night shift). */
  keywords?: string;
  run: () => void;
}

type Row = { kind: 'command'; cmd: Command } | { kind: 'hit'; hit: SearchHit };

function matches(cmd: Command, q: string): boolean {
  const hay = `${cmd.label} ${cmd.keywords ?? ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const hours = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(secs >= 36000 ? 0 : 1)} h` : formatDuration(secs));

function HitDetail({ hit, onDay }: { hit: SearchHit; onDay: (day: string) => void }) {
  const [detail, setDetail] = useState<SearchDetail | null>(null);
  useEffect(() => {
    let on = true;
    setDetail(null);
    api.searchDetail(hit.kind, hit.id).then((d) => { if (on) setDetail(d); }).catch(() => {});
    return () => { on = false; };
  }, [hit.kind, hit.id]);
  const topYear = Math.max(1, ...(detail?.years ?? []).map((y) => y[1]));
  return (
    <div className="pal-detail">
      <div className="pal-detail-name text-strong">{hit.name}</div>
      {hit.app && <div className="text-small faint">in {hit.app}</div>}
      <dl className="pal-facts">
        <div><dt className="kt-label">Total</dt><dd className="data-lg">{hours(hit.secs)}</dd></div>
        <div><dt className="kt-label">Days</dt><dd className="data-lg">{hit.days.toLocaleString()}</dd></div>
      </dl>
      {hit.first && (
        <p className="text-small pal-span">
          First <button className="pal-link" onClick={() => onDay(hit.first!)}>{shortDay(hit.first)}</button>
          {hit.last && hit.last !== hit.first && <> · last <button className="pal-link" onClick={() => onDay(hit.last!)}>{shortDay(hit.last)}</button></>}
        </p>
      )}
      {detail && detail.years.length > 1 && (
        <div className="pal-years" aria-label="Time per year">
          {detail.years.map(([y, s]) => (
            <div key={y} className="pal-year" title={`${y}: ${hours(s)}`}>
              <span style={{ height: `${Math.max(4, (s / topYear) * 100)}%` }} />
              <em className="data-sm">{y.slice(2)}</em>
            </div>
          ))}
        </div>
      )}
      {detail && detail.busiest.length > 0 && (
        <>
          <div className="kt-label pal-sub">Busiest days</div>
          <ol className="pal-days">
            {detail.busiest.map(([day, s]) => (
              <li key={day}>
                <button className="pal-day" onClick={() => onDay(day)}>
                  <span>{longDay(day)}</span><span className="data-md">{hours(s)}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** Ctrl K: jump to any page, run an action, or search everything you've ever had open. */
export function Palette({ commands, onClose, onDay }: { commands: Command[]; onClose: () => void; onDay: (day: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [ready, setReady] = useState(true);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    api.searchPrepare().catch(() => {});
  }, []);

  // History search, a moment after typing stops.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let on = true;
    const t = window.setTimeout(() => {
      api.searchHistory(term).then((r) => { if (on) { setHits(r.hits); setReady(r.ready); } }).catch(() => {});
    }, 90);
    return () => { on = false; window.clearTimeout(t); };
  }, [q]);

  const rows: Row[] = useMemo(() => {
    const cmds = (q.trim() ? commands.filter((c) => matches(c, q)) : commands).slice(0, q.trim() ? 6 : 12);
    return [...cmds.map((cmd) => ({ kind: 'command' as const, cmd })), ...hits.map((hit) => ({ kind: 'hit' as const, hit }))];
  }, [q, commands, hits]);
  useEffect(() => setSel(0), [q, hits]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-row="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const activate = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    if (r.kind === 'command') r.cmd.run();
    else if (r.hit.last) onDay(r.hit.last);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(rows[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const current = rows[sel];
  const firstHit = rows.findIndex((r) => r.kind === 'hit');
  return (
    <div className="pal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="pal-input">
          <Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoComplete="off"
            placeholder="Go to a page, change era, or search every app, window and site you've used…"
            role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={`pal-row-${sel}`} />
          <kbd className="kt-kbd">Esc</kbd>
        </div>
        <div className="pal-body">
          <div className="pal-list" id="pal-list" role="listbox" ref={list}>
            {rows.map((r, i) => (
              <div key={r.kind === 'command' ? r.cmd.id : `${r.hit.kind}-${r.hit.id}`}>
                {i === firstHit && <div className="pal-group kt-label">History{!ready && ' · counting time…'}</div>}
                {i === 0 && r.kind === 'command' && <div className="pal-group kt-label">{q.trim() ? 'Pages and actions' : 'Jump to'}</div>}
                <div id={`pal-row-${i}`} data-row={i} role="option" aria-selected={i === sel}
                  className={i === sel ? 'pal-row is-sel' : 'pal-row'} onMouseMove={() => setSel(i)} onClick={() => activate(r)}>
                  {r.kind === 'command' ? (
                    <>
                      <Icon name={r.cmd.icon} />
                      <span className="pal-label">{r.cmd.label}</span>
                      {r.cmd.hint && <span className="pal-hint data-sm">{r.cmd.hint}</span>}
                    </>
                  ) : (
                    <>
                      <Icon name={r.hit.kind === 'app' ? 'apps' : 'timeline'} />
                      <span className="pal-label">{r.hit.name}{r.hit.app && <span className="faint"> · {r.hit.app}</span>}</span>
                      <span className="pal-hint data-sm">{r.hit.secs ? hours(r.hit.secs) : ''}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
            {q.trim().length >= 2 && !rows.length && <p className="pal-empty muted">Nothing called “{q.trim()}” anywhere in your history.</p>}
          </div>
          {current?.kind === 'hit' && <HitDetail hit={current.hit} onDay={(d) => { onClose(); onDay(d); }} />}
        </div>
        <div className="pal-foot data-sm faint">
          <span><kbd className="kt-kbd">↑</kbd><kbd className="kt-kbd">↓</kbd> move</span>
          <span><kbd className="kt-kbd">Enter</kbd> open{current?.kind === 'hit' ? ' its last day' : ''}</span>
          <span><kbd className="kt-kbd">Ctrl</kbd><kbd className="kt-kbd">K</kbd> anywhere</span>
        </div>
      </div>
    </div>
  );
}
