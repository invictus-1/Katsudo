import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, Icon, Input, Panel } from '../ds/katsudo';
import { ROADMAP, STAGES, type RoadmapItem, type Stage } from '../roadmap';

interface Mine { id: string; title: string; created: number }
interface Saved { starred: string[]; mine: Mine[] }

const EMPTY: Saved = { starred: [], mine: [] };

export function Roadmap() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    api.settings().then(
      (s) => { try { setSaved({ ...EMPTY, ...JSON.parse(s.roadmap || '{}') }); } catch { setSaved(EMPTY); } },
      () => setSaved(EMPTY),
    );
  }, []);
  if (!saved) return <div className="page" />;

  const save = (next: Saved) => {
    setSaved(next);
    api.setSetting('roadmap', JSON.stringify(next));
  };
  const toggleStar = (id: string) =>
    save({ ...saved, starred: saved.starred.includes(id) ? saved.starred.filter((s) => s !== id) : [...saved.starred, id] });
  const addIdea = () => {
    const title = draft.trim();
    if (!title) return;
    save({ ...saved, mine: [{ id: `mine-${Date.now()}`, title, created: Date.now() }, ...saved.mine] });
    setDraft('');
  };
  const removeIdea = (id: string) => save({ ...saved, mine: saved.mine.filter((m) => m.id !== id), starred: saved.starred.filter((s) => s !== id) });

  const mineAsItems: RoadmapItem[] = saved.mine.map((m) => ({ id: m.id, title: m.title, blurb: 'Your idea.', stage: 'idea', area: 'Polish' }));
  const byStage = (stage: Stage) => {
    const items = [...(stage === 'idea' ? mineAsItems : []), ...ROADMAP.filter((i) => i.stage === stage)];
    // Starred first, then the order written.
    return items.sort((a, b) => Number(saved.starred.includes(b.id)) - Number(saved.starred.includes(a.id)));
  };
  const starredCount = saved.starred.length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Roadmap</h1>
          <p className="text-body">
            Where Katsudō is going. Star what you want next{starredCount ? ` (${starredCount} starred)` : ''}; add your own ideas. Saved on this machine only.
          </p>
        </div>
      </div>
      <div className="roadmap">
        {STAGES.map((stage) => (
          <Panel key={stage.id} title={`${stage.title} · ${byStage(stage.id).length}`}>
            <p className="text-small faint roadmap-note">{stage.note}</p>
            {stage.id === 'idea' && (
              <form className="roadmap-add" onSubmit={(e) => { e.preventDefault(); addIdea(); }}>
                <Input icon="flag" placeholder="Add your own idea" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <Button size="sm" variant="primary" type="submit" disabled={!draft.trim()}>Add</Button>
              </form>
            )}
            <ul className="roadmap-list">
              {byStage(stage.id).map((item) => {
                const starred = saved.starred.includes(item.id);
                const mine = item.id.startsWith('mine-');
                return (
                  <li key={item.id} className={`roadmap-item${starred ? ' is-starred' : ''}`}>
                    <div className="roadmap-item-head">
                      <span className="text-strong">{item.title}</span>
                      {item.stage !== 'done' && (
                        <button type="button" className="roadmap-star" aria-pressed={starred}
                          aria-label={starred ? `Unstar ${item.title}` : `Star ${item.title}`} onClick={() => toggleStar(item.id)}>
                          <Icon name="star" size={16} />
                        </button>
                      )}
                    </div>
                    <p className="text-small muted">{item.blurb}</p>
                    <div className="row">
                      <Badge tone={mine ? 'amber' : 'neutral'}>{mine ? 'Yours' : item.area}</Badge>
                      {item.version && <Badge tone={item.stage === 'done' ? 'success' : 'sky'}>{item.version}</Badge>}
                      {mine && <Button size="sm" variant="ghost" onClick={() => removeIdea(item.id)}>Remove</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
