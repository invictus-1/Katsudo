import { useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { toPng } from 'html-to-image';
import { api, type Wrapped as Year, type WrappedNamed } from '../api';
import { Button, KeyboardHeatmap, Segmented } from '../ds/katsudo';
import { bytes, formatCount, longDay, shortCount, useData } from '../lib';
import { Hanko, NAME } from '../kanji';
import './wrapped.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const KEY_NAMES: Record<string, string> = { space: 'Space', backspace: 'Backspace', enter: 'Enter', lshift: 'Left Shift', rshift: 'Right Shift',
  lctrl: 'Left Ctrl', rctrl: 'Right Ctrl', lalt: 'Left Alt', ralt: 'Right Alt', tab: 'Tab', capslock: 'Caps Lock', escape: 'Esc', meta: 'Windows' };
const keyName = (k: string) => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k);
const h = (secs: number) => Math.round(secs / 3600).toLocaleString();
const pct = (now: number, then: number) => (then > 0 ? Math.round(((now - then) / then) * 100) : null);

function persona(hours: number[]): { title: string; line: string; peak: number } {
  const peak = hours.indexOf(Math.max(...hours));
  if (peak >= 21 || peak < 4) return { title: 'Night owl', line: 'You came alive after dark.', peak };
  if (peak < 10) return { title: 'Early bird', line: 'Most of your typing happened before lunch.', peak };
  if (peak < 17) return { title: 'Daytime grinder', line: 'Your busiest hours were the middle of the day.', peak };
  return { title: 'Evening person', line: 'Your keyboard peaked as the sun went down.', peak };
}
const clockHour = (hr: number) => `${hr % 12 === 0 ? 12 : hr % 12} ${hr < 12 ? 'AM' : 'PM'}`;

function Card({ id, kicker, children, onSave, className }: { id: string; kicker: string; children: ReactNode; onSave: (el: HTMLElement, id: string) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="wr-slot">
      <article ref={ref} className={`wr-card ${className ?? ''}`} data-card={id}>
        <div className="wr-kicker">{kicker}</div>
        {children}
        <div className="wr-brand"><Hanko className="wr-hanko" />Katsudō</div>
      </article>
      <Button size="sm" variant="ghost" className="wr-save" onClick={() => ref.current && onSave(ref.current, id)}>Save image</Button>
    </div>
  );
}

function List({ items, hidden, onHide, unit = 'h' }: { items: WrappedNamed[]; hidden: Set<string>; onHide: (name: string) => void; unit?: string }) {
  const shown = items.filter((i) => !hidden.has(i.name));
  const top = Math.max(1, ...shown.map((i) => i.secs));
  return (
    <ol className="wr-list">
      {shown.map((i, n) => (
        <li key={i.name}>
          <span className="wr-rank">{n + 1}</span>
          <span className="wr-name">{i.name}</span>
          <span className="wr-val">{h(i.secs)} {unit}</span>
          <span className="wr-bar" style={{ width: `${(i.secs / top) * 100}%` }} />
          <button className="wr-hide wr-noexport" onClick={() => onHide(i.name)} aria-label={`Hide ${i.name} from the card`}>Hide</button>
        </li>
      ))}
    </ol>
  );
}

function Cards({ y, hidden, onHide, onSave }: { y: Year; hidden: Set<string>; onHide: (n: string) => void; onSave: (el: HTMLElement, id: string) => void }) {
  const t = y.totals;
  const topKey = Object.entries(y.keys).sort((a, b) => b[1] - a[1])[0];
  const topLetter = Object.entries(y.keys).filter(([k]) => /^[a-z]$/.test(k)).sort((a, b) => b[1] - a[1])[0];
  const busiestMonth = y.months.reduce((best, m, i) => (m[0] > y.months[best][0] ? i : best), 0);
  const favDay = y.weekdays.indexOf(Math.max(...y.weekdays));
  const who = persona(y.hours);
  const topHour = Math.max(1, ...y.hours);
  const [down, downU] = bytes(t.download);
  const [up, upU] = bytes(t.upload);
  const km = t.distance_m / 1000;
  const apps = y.top_apps.filter((a) => !hidden.has(a.name));
  const p = y.prev;
  return (
    <div className="wr-grid">
      <Card id="cover" kicker="Year in review" onSave={onSave} className="wr-cover">
        <div className="wr-watermark" aria-hidden="true">{NAME}</div>
        <div className="wr-year">{y.year}</div>
        <div className="wr-lede">Your year, counted on your own PC.</div>
        <div className="wr-cover-facts">
          <span><b>{h(t.active_secs)}</b> hours</span>
          <span><b>{shortCount(t.keys)}</b> keys</span>
          <span><b>{y.days_tracked}</b> days</span>
        </div>
      </Card>

      <Card id="time" kicker="Time" onSave={onSave}>
        <div className="wr-big">{h(t.active_secs)}<small>hours</small></div>
        <p className="wr-line">active at your PC in {y.year}: about {(t.active_secs / 3600 / Math.max(1, y.days_tracked)).toFixed(1)} a day.</p>
        <dl className="wr-facts">
          {y.longest_day && <div><dt>Longest day</dt><dd>{longDay(y.longest_day.day)} · {(y.longest_day.value / 3600).toFixed(1)} h</dd></div>}
          <div><dt>Longest streak</dt><dd>{y.streak[0]} days in a row</dd></div>
          <div><dt>Busiest month</dt><dd>{MONTHS[busiestMonth]}</dd></div>
        </dl>
      </Card>

      {apps.length > 0 && (
        <Card id="apps" kicker="Top apps" onSave={onSave}>
          <div className="wr-headline">#1 was <em>{apps[0].name}</em></div>
          <List items={y.top_apps.slice(0, 6)} hidden={hidden} onHide={onHide} />
          {y.top_new_app && !hidden.has(y.top_new_app.name) && (
            <p className="wr-foot">{y.new_apps} apps were new this year. The biggest newcomer: <b>{y.top_new_app.name}</b>, {h(y.top_new_app.secs)} h.</p>
          )}
        </Card>
      )}

      <Card id="keys" kicker="Keys" onSave={onSave}>
        <div className="wr-big">{shortCount(t.keys)}<small>keys pressed</small></div>
        {topKey && <p className="wr-line">Most pressed: <b>{keyName(topKey[0])}</b> ({shortCount(topKey[1])}){topLetter && topLetter[0] !== topKey[0] ? <>, top letter <b>{topLetter[0].toUpperCase()}</b></> : null}.</p>}
        <p className="wr-line">About <b>{formatCount(Math.round(t.keys / Math.max(1, y.days_tracked)))}</b> a day.</p>
        {Object.keys(y.keys).length > 0 && <div className="wr-kb"><KeyboardHeatmap counts={y.keys} layout="compact" label={`Key presses in ${y.year}`} /></div>}
        {y.most_keys_day && <p className="wr-foot">Biggest typing day: {longDay(y.most_keys_day.day)}, {formatCount(y.most_keys_day.value)} keys.</p>}
      </Card>

      <Card id="mouse" kicker="Mouse" onSave={onSave}>
        <div className="wr-big">{shortCount(t.clicks)}<small>clicks</small></div>
        <dl className="wr-facts">
          <div><dt>A day</dt><dd>{formatCount(Math.round(t.clicks / Math.max(1, y.days_tracked)))} clicks</dd></div>
          {t.scrolls > 0 && <div><dt>Scrolled</dt><dd>{shortCount(t.scrolls)} notches</dd></div>}
          {km >= 0.1 && <div><dt>Pointer travel</dt><dd>{km.toFixed(km >= 100 ? 0 : 1)} km</dd></div>}
          {km >= 4.2 && <div><dt>That's</dt><dd>{(km / 42.195).toFixed(1)} marathons</dd></div>}
        </dl>
      </Card>

      {y.rhythm.secs > 0 && (
        <Card id="rhythm" kicker="Rhythm" onSave={onSave} className="wr-rhythm">
          <div className="wr-big">{(y.rhythm.secs / 3600).toFixed(y.rhythm.secs >= 36000 ? 0 : 1)}<small>hours in rhythm games</small></div>
          <List items={y.rhythm.games.filter((g) => g.secs >= 1800)} hidden={hidden} onHide={onHide} />
          {y.rhythm.sessions > 0 && (
            <dl className="wr-facts">
              <div><dt>Peak</dt><dd>{y.rhythm.peak_kps} keys / s</dd></div>
              <div><dt>Longest stream</dt><dd>{y.rhythm.best_stream} s</dd></div>
              <div><dt>Sessions</dt><dd>{y.rhythm.sessions}</dd></div>
            </dl>
          )}
        </Card>
      )}

      {y.top_sites.filter((s) => !hidden.has(s.name)).length > 0 && (
        <Card id="web" kicker="On the web" onSave={onSave}>
          <div className="wr-headline">Where your tabs lived</div>
          <List items={y.top_sites} hidden={hidden} onHide={onHide} />
        </Card>
      )}

      <Card id="day" kicker="Your day" onSave={onSave}>
        <div className="wr-headline"><em>{who.title}</em></div>
        <p className="wr-line">{who.line} Peak hour: {clockHour(who.peak)}.</p>
        <div className="wr-hours" aria-label="Keys per hour of the day">
          {y.hours.map((v, i) => <span key={i} className={i === who.peak ? 'is-peak' : ''} style={{ height: `${Math.max(2, (v / topHour) * 100)}%` }} />)}
        </div>
        <div className="wr-hours-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
        <p className="wr-foot">Favourite day of the week: <b>{WEEKDAYS[favDay]}</b>.</p>
      </Card>

      {t.download + t.upload > 0 && (
        <Card id="network" kicker="Network" onSave={onSave}>
          <div className="wr-big">{down}<small>{downU} downloaded</small></div>
          <p className="wr-line">and {up} {upU} sent the other way.</p>
          <dl className="wr-facts">
            <div><dt>Machine on</dt><dd>{h(t.uptime_ms / 1000)} hours</dd></div>
          </dl>
        </Card>
      )}

      {p && (
        <Card id="versus" kicker={`${y.year} vs ${y.year - 1}`} onSave={onSave}>
          <div className="wr-headline">Compared with last year</div>
          <p className="wr-line">Per active day, so a short year compares fairly.</p>
          <dl className="wr-versus">
            {([['Keys', t.keys, p.keys], ['Clicks', t.clicks, p.clicks], ['Hours', t.active_secs, p.active_secs], ['Pointer travel', t.distance_m, p.distance_m]] as const)
              .filter(([, now, then]) => now > 0 && then > 0).map(([label, now, then]) => {
              const d = pct(now / Math.max(1, y.days_tracked), then / Math.max(1, y.prev_days));
              return (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={d !== null && d >= 0 ? 'is-up' : 'is-down'}>{d === null ? '–' : `${d >= 0 ? '+' : ''}${d}%`}</dd>
                </div>
              );
            })}
          </dl>
          {y.prev_days < 120 && <p className="wr-foot">{y.year - 1} only has {y.prev_days} days of data.</p>}
        </Card>
      )}
    </div>
  );
}

export function WrappedView() {
  const [year, setYear] = useState<number | null>(null);
  const data = useData(() => api.wrapped(year), [year]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const y = data.data;

  const render = (el: HTMLElement) =>
    toPng(el, { pixelRatio: 1080 / el.offsetWidth, cacheBust: true, filter: (n) => !(n instanceof HTMLElement && n.classList.contains('wr-noexport')) });
  const write = async (path: string, el: HTMLElement) => {
    const url = await render(el);
    await invoke('save_png', { path, data: url.slice(url.indexOf(',') + 1) });
  };
  const saveOne = async (el: HTMLElement, id: string) => {
    if (!y) return;
    try {
      const path = await save({ defaultPath: `katsudo-${y.year}-${id}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (!path) return;
      await write(path, el);
      setNote(`Saved ${path}`);
    } catch (e) {
      setNote(String(e));
    }
  };
  const saveAll = async () => {
    if (!y) return;
    const cards = [...document.querySelectorAll<HTMLElement>('.wr-card')];
    try {
      const dir = await open({ directory: true, title: 'Save every card into…' });
      if (typeof dir !== 'string') return;
      for (const [i, el] of cards.entries()) {
        setNote(`Saving ${i + 1} of ${cards.length}…`);
        await write(`${dir}\\katsudo-${y.year}-${String(i + 1).padStart(2, '0')}-${el.dataset.card}.png`, el);
      }
      setNote(`Saved ${cards.length} images to ${dir}`);
    } catch (e) {
      setNote(String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display-lg">Year in review</h1>
          <p className="text-body">Your year in cards, worked out on this PC. Save any of them as an image to share; hide anything you'd rather not.</p>
        </div>
        <div className="row">
          {y && y.years.length > 1 && (
            <Segmented label="Year" options={y.years.slice(0, 8).map((v) => ({ value: String(v), label: String(v) }))} value={String(y.year)}
              onChange={(v) => setYear(Number(v))} />
          )}
          <Button variant="primary" onClick={saveAll} disabled={!y}>Save all as images</Button>
        </div>
      </div>
      {data.error && <p className="error">{data.error}</p>}
      {(note || hidden.size > 0) && (
        <p className="text-small faint wr-note">
          {note}
          {hidden.size > 0 && <> {note && '· '}{hidden.size} hidden from the cards · <button className="pal-link" onClick={() => setHidden(new Set())}>show them again</button></>}
        </p>
      )}
      {!y && !data.error && <p className="muted">Counting your year… the first time takes a few seconds.</p>}
      {y && <Cards y={y} hidden={hidden} onHide={(n) => setHidden(new Set(hidden).add(n))} onSave={saveOne} />}
    </div>
  );
}
