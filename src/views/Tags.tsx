import { useEffect, useMemo, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { api, type Tag, type TagRule } from '../api';
import { Button, Icon, Input, Panel, Segmented } from '../ds/katsudo';
import { formatDuration, parseDay, useData } from '../lib';
import { RANGE_OPTIONS, rangeDays, type RangeId } from './range';
import './tags.css';

const TONES = ['amber', 'cyan', 'rose', 'lime', 'sky'] as const;
const UNTAGGED = 0;
const hours = (s: number) => (s >= 360_000 ? `${Math.round(s / 3600).toLocaleString()} h` : formatDuration(s));

/** Time per tag: one stacked bar per day (per week past two months). */
function TagBars({ days, tags }: { days: [string, Record<string, number>][]; tags: Tag[] }) {
  const every = days.length > 62 ? 7 : 1;
  const groups: { label: string; by: Record<number, number> }[] = [];
  for (let i = 0; i < days.length; i += every) {
    const by: Record<number, number> = {};
    for (const [, d] of days.slice(i, i + every)) for (const [k, v] of Object.entries(d)) by[Number(k)] = (by[Number(k)] ?? 0) + v;
    const first = parseDay(days[i][0]);
    groups.push({ label: every === 7 ? first.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : first.toLocaleDateString(undefined, days.length > 14 ? { day: 'numeric' } : { weekday: 'short' }), by });
  }
  const top = Math.max(1, ...groups.map((g) => Object.values(g.by).reduce((a, b) => a + b, 0)));
  const order = [...tags.map((t) => t.id), UNTAGGED];
  const tone = (id: number) => tags.find((t) => t.id === id)?.color ?? 'idle';
  return (
    <div className="tg-bars" role="img" aria-label="Time per tag over the range">
      {groups.map((g, i) => (
        <div key={i} className="tg-bar-col" data-tip={`${g.label}: ${order.filter((id) => g.by[id]).map((id) => `${tags.find((t) => t.id === id)?.name ?? 'Untagged'} ${hours(g.by[id])}`).join(' · ') || 'nothing'}`}>
          <div className="tg-stack">
            {order.map((id) => (g.by[id] ? <span key={id} className={`tg-seg tone-${tone(id)}`} style={{ height: `${(g.by[id] / top) * 100}%` }} /> : null))}
          </div>
          {(groups.length <= 31 || i % Math.ceil(groups.length / 16) === 0) && <span className="tg-bar-label data-sm">{g.label}</span>}
        </div>
      ))}
    </div>
  );
}

export function TagsView({ firstDay }: { firstDay: string | null }) {
  const [range, setRange] = useState<RangeId>('week');
  const setup = useData(api.tags, []);
  const [tags, setTags] = useState<Tag[]>([]);
  const [rules, setRules] = useState<TagRule[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (setup.data && !dirty) {
      setTags(setup.data.tags);
      setRules(setup.data.rules);
    }
  }, [setup.data]);
  const [from, to] = rangeDays(range, firstDay);
  const report = useData(() => api.tagReport(from, to), [from, to, version]);
  // While history is being re-tagged, check back until it's done, then load the new totals.
  const wasBuilding = useRef(false);
  useEffect(() => {
    const building = !!setup.data?.building;
    if (wasBuilding.current && !building) setVersion((v) => v + 1);
    wasBuilding.current = building;
    if (!building) return;
    const t = window.setTimeout(() => setup.reload(), 1000);
    return () => window.clearTimeout(t);
  }, [setup.data]);

  const persist = async (nextTags: Tag[], nextRules: TagRule[]) => {
    try {
      const s = await api.saveTags(nextTags, nextRules);
      setTags(s.tags);
      setRules(s.rules);
      setDirty(false);
      setError('');
      setup.reload();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(String(e));
    }
  };
  const editTags = (t: Tag[]) => { setTags(t); setDirty(true); };
  const editRules = (r: TagRule[]) => { setRules(r); setDirty(true); };
  const addTag = (name = 'New tag') => {
    const t = { id: -(Date.now() % 1e9), name, color: TONES[tags.length % TONES.length] };
    editTags([...tags, t]);
    return t;
  };
  /** Rules may point at tags that aren't saved yet: send those as -(position + 1). */
  const resolve = (rs: TagRule[], ts: Tag[]) =>
    rs.map((r) => (r.tag_id < 0 ? { ...r, tag_id: -(ts.findIndex((t) => t.id === r.tag_id) + 1) } : r));
  const saveAll = () => persist(tags.map((t) => (t.id < 0 ? { ...t, id: 0 } : t)), resolve(rules, tags));
  const quickTag = (field: 'app' | 'title', value: string, tagId: number) => {
    const next = [{ field, op: field === 'app' ? 'is' : 'contains', value, tag_id: tagId }, ...rules] as TagRule[];
    persist(tags.map((t) => (t.id < 0 ? { ...t, id: 0 } : t)), resolve(next, tags));
  };

  const totals = report.data?.totals ?? {};
  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  const rows = useMemo(() => [...tags.map((t) => ({ id: t.id, name: t.name, color: t.color })), { id: UNTAGGED, name: 'Untagged', color: 'idle' }]
    .map((t) => ({ ...t, secs: totals[t.id] ?? 0 })).filter((t) => t.secs > 0 || t.id !== UNTAGGED), [tags, totals]);
  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === range)?.label.toLowerCase();

  const exportCsv = async () => {
    if (!report.data) return;
    const name = (id: number) => (id === UNTAGGED ? 'Untagged' : tags.find((t) => t.id === id)?.name ?? `Tag ${id}`);
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ['Date,Tag,Hours'];
    for (const [day, by] of report.data.days) for (const [id, secs] of Object.entries(by)) lines.push(`${day},${q(name(Number(id)))},${(secs / 3600).toFixed(2)}`);
    lines.push('', 'Total,Tag,Hours');
    for (const r of rows) lines.push(`${from} to ${to},${q(r.name)},${(r.secs / 3600).toFixed(2)}`);
    try {
      const path = await save({ defaultPath: `katsudo-tags-${from}-to-${to}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (path) await invoke('save_csv', { path, data: lines.join('\r\n') + '\r\n' });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Tags</h1>
          <p className="text-body">Label your time with rules: by app, or by window title, document or site. They apply to your whole history at once.</p>
        </div>
        <Segmented label="Range" options={RANGE_OPTIONS.filter((o) => o.value !== 'day')} value={range} onChange={(v) => setRange(v as RangeId)} />
      </div>
      {error && <p className="error">{error}</p>}

      <div className="split">
        <Panel title={`Time by tag · ${rangeLabel}`} action={<Button size="sm" variant="ghost" icon="export" onClick={exportCsv} disabled={!report.data}>Export CSV</Button>}>
          {setup.data?.building && <p className="text-small faint tg-note">Re-tagging your history…</p>}
          {report.data && <TagBars days={report.data.days} tags={tags.filter((t) => t.id > 0)} />}
        </Panel>
        <Panel title="Totals" flush>
          <ul className="tg-totals">
            {rows.map((r) => (
              <li key={r.id}>
                <span className={`tg-dot tone-${r.color}`} />
                <span className="tg-total-name">{r.name}</span>
                <span className="data-md">{hours(r.secs)}</span>
                <span className="data-sm faint tg-pct">{all ? Math.round((r.secs / all) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="split">
        <Panel title="Tags and rules"
          action={<Button size="sm" variant={dirty ? 'primary' : 'ghost'} onClick={saveAll} disabled={!dirty}>{dirty ? 'Save and re-tag history' : 'Saved'}</Button>}>
          <div className="tg-tags">
            {tags.map((t, i) => (
              <div key={t.id} className="tg-tag">
                <div className="tg-swatches" role="radiogroup" aria-label={`Colour for ${t.name}`}>
                  {TONES.map((tone) => (
                    <button key={tone} className={`tg-swatch tone-${tone}${t.color === tone ? ' is-on' : ''}`} role="radio" aria-checked={t.color === tone} aria-label={tone}
                      onClick={() => editTags(tags.map((x, j) => (j === i ? { ...x, color: tone } : x)))} />
                  ))}
                </div>
                <Input value={t.name} aria-label="Tag name" onChange={(e) => editTags(tags.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => { editTags(tags.filter((_, j) => j !== i)); editRules(rules.filter((r) => r.tag_id !== t.id)); }}>Delete</Button>
              </div>
            ))}
            <Button size="sm" onClick={() => addTag()}>New tag</Button>
          </div>

          <div className="kt-label tg-sub">Rules · checked top to bottom, titles and sites before apps</div>
          <datalist id="tg-apps">{report.data?.untagged_apps.map(([n]) => <option key={n} value={n} />)}</datalist>
          <datalist id="tg-sites">{report.data?.untagged_sites.map(([n]) => <option key={n} value={n} />)}</datalist>
          <div className="tg-rules">
            {rules.map((r, i) => {
              const set = (patch: Partial<TagRule>) => editRules(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const move = (d: number) => { const n = [...rules]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); editRules(n); };
              return (
                <div key={i} className="tg-rule">
                  <select value={r.field} onChange={(e) => set({ field: e.target.value as TagRule['field'] })} aria-label="What to match">
                    <option value="app">App</option>
                    <option value="title">Title or site</option>
                  </select>
                  <select value={r.op} onChange={(e) => set({ op: e.target.value as TagRule['op'] })} aria-label="How to match">
                    <option value="is">is</option>
                    <option value="contains">contains</option>
                  </select>
                  <Input value={r.value} list={r.field === 'app' ? 'tg-apps' : 'tg-sites'} placeholder={r.field === 'app' ? 'Visual Studio Code' : 'github.com'}
                    aria-label="Value" onChange={(e) => set({ value: e.target.value })} />
                  <Icon name="chevron" />
                  <select value={r.tag_id} onChange={(e) => set({ tag_id: Number(e.target.value) })} aria-label="Tag">
                    {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <div className="tg-rule-actions">
                    <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(-1)}>↑</Button>
                    <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => move(1)}>↓</Button>
                    <Button size="sm" variant="ghost" aria-label="Remove rule" onClick={() => editRules(rules.filter((_, j) => j !== i))}>✕</Button>
                  </div>
                </div>
              );
            })}
            <Button size="sm" disabled={!tags.length} onClick={() => editRules([...rules, { field: 'app', op: 'is', value: '', tag_id: tags[0].id }])}>
              {tags.length ? 'Add rule' : 'Make a tag first'}
            </Button>
          </div>
        </Panel>

        <Panel title={`Biggest untagged · ${rangeLabel}`}>
          <p className="text-small faint tg-note">Pick a tag to add a rule for it straight away.</p>
          {(['app', 'title'] as const).map((field) => {
            const list = field === 'app' ? report.data?.untagged_apps : report.data?.untagged_sites;
            if (!list?.length) return null;
            return (
              <div key={field}>
                <div className="kt-label tg-sub">{field === 'app' ? 'Apps' : 'Sites'}</div>
                <ul className="tg-untagged">
                  {list.slice(0, 8).map(([name, secs]) => (
                    <li key={name}>
                      <span className="tg-total-name">{name}</span>
                      <span className="data-sm faint">{hours(secs)}</span>
                      <select value="" aria-label={`Tag ${name}`} disabled={dirty || !tags.some((t) => t.id > 0)}
                        onChange={(e) => e.target.value && quickTag(field, name, Number(e.target.value))}>
                        <option value="">{dirty ? 'Save first' : 'Tag as…'}</option>
                        {tags.filter((t) => t.id > 0).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Panel>
      </div>
    </div>
  );
}
