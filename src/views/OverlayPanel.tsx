import { useEffect, useState } from 'react';
import { api, type OverlayConfig, type OverlayStatus } from '../api';
import { Button, Input, Panel, Segmented, Switch } from '../ds/katsudo';
import { THEMES } from '../themes/themes';

const PRESETS = [
  { label: 'osu!', keys: 'Z X' },
  { label: 'Mania 4K', keys: 'D F J K' },
  { label: 'Mania 7K', keys: 'S D F Space J K L' },
  { label: 'WASD', keys: 'W A S D' },
];
const ERAS = [
  { value: 'app', label: 'Match app' },
  ...THEMES.map((t) => ({ value: t.id, label: t.name })),
];
const SHOW = [
  { value: 'both', label: 'Keys + keys/s' },
  { value: 'keys', label: 'Keys' },
  { value: 'kps', label: 'Keys/s' },
];
const SPEED = [
  { value: '400', label: 'Slow' },
  { value: '600', label: 'Normal' },
  { value: '900', label: 'Fast' },
];

/** Settings, address and a live preview for the OBS overlay. */
export function OverlayPanel() {
  const [status, setStatus] = useState<OverlayStatus | null>(null);
  const [keys, setKeys] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const load = () => api.overlay().then((s) => { setStatus(s); setKeys((k) => k || s.config.keys); });
    load();
    // The server reports a busy port a moment after it is switched on.
    const id = window.setInterval(load, 3000);
    return () => window.clearInterval(id);
  }, []);
  if (!status) return null;
  const c = status.config;

  const save = async (patch: Partial<OverlayConfig>) => {
    try {
      const next = await api.setOverlay({ ...c, ...patch });
      setStatus(next);
      setKeys(next.config.keys);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(status.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: the address is selectable */ }
  };

  return (
    <Panel title="Stream overlay">
      <div className="ov-grid">
        <div className="stack">
          <Switch checked={c.enabled} onChange={(on) => save({ enabled: on })} label="Overlay for OBS"
            hint="A page on this PC only (127.0.0.1), on while this is on. It is sent the keys listed below and keys per second, nothing else." />
          <div className="ov-field">
            <span className="kt-label">Keys to show</span>
            <div className="row ov-presets">
              {PRESETS.map((p) => (
                <Button key={p.label} size="sm" variant={c.keys === p.keys ? 'primary' : 'ghost'} onClick={() => save({ keys: p.keys })}>{p.label}</Button>
              ))}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); save({ keys }); }}>
              <Input value={keys} onChange={(e) => setKeys(e.target.value)} onBlur={() => keys !== c.keys && save({ keys })}
                placeholder="e.g. Z X, or S D F Space J K L" aria-label="Keys to show, separated by spaces" />
            </form>
            {error && <p className="text-small ov-error">{error}</p>}
          </div>
          <div className="ov-field">
            <span className="kt-label">Show</span>
            <Segmented size="sm" label="Show" options={SHOW} value={c.show} onChange={(v) => save({ show: v })} />
          </div>
          <div className="ov-field">
            <span className="kt-label">Era</span>
            <Segmented size="sm" label="Overlay era" options={ERAS} value={c.era} onChange={(v) => save({ era: v })} />
          </div>
          <div className="ov-field">
            <span className="kt-label">Key trails</span>
            <Segmented size="sm" label="Trail speed" options={SPEED} value={String(c.speed)} onChange={(v) => save({ speed: Number(v) })} />
          </div>
          <div className="ov-field">
            <span className="kt-label">In OBS: Sources → + → Browser, with this URL</span>
            <div className="row">
              <code className="ov-url data-md">{status.url}</code>
              <Button size="sm" variant="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <p className="text-small faint ov-hint">Try 800 × 300 for keys and keys/s side by side. The background is transparent.</p>
          </div>
          {status.error && <p className="text-small ov-error">{status.error}</p>}
        </div>
        <div className="ov-preview" aria-label="Overlay preview">
          {status.running ? (
            <iframe title="Overlay preview" src={status.url} />
          ) : (
            <p className="muted">{c.enabled ? 'Starting…' : 'Switch the overlay on to see it here.'}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
