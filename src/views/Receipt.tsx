import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { api, type DayView, type Tag } from '../api';
import { Button } from '../ds/katsudo';
import { longestStretch, parseDay, todayIso, useData } from '../lib';
import './receipt.css';

const OPEN_EVENT = 'katsudo:receipt';

/** Show a day's receipt from anywhere (Today, the timeline, the palette). */
export function openReceipt(day: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: day }));
}

const WIDTH = 34; // characters across the slip
const n = (v: number) => Math.round(v).toLocaleString('en-US');
/** Time as a price: 3:18 (hours:minutes), or 0:42. */
const hm = (secs: number) => `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`;
const clock = (ts: number) => new Date(ts * 1000).toTimeString().slice(0, 5);
const cut = (s: string, len: number) => (s.length > len ? `${s.slice(0, len - 1)}…` : s);

/** Code 39, so the barcode really scans: each character is 9 elements (bar, space, …), 1 = wide. */
const CODE39: Record<string, string> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001',
  '5': '100110000', '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100', '*': '010010100',
};
function Barcode({ text }: { text: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const ch of `*${text}*`) {
    [...CODE39[ch]].forEach((wide, i) => {
      const w = wide === '1' ? 3 : 1;
      if (i % 2 === 0) bars.push({ x, w });
      x += w;
    });
    x += 1; // the narrow gap between characters
  }
  return (
    <svg className="rc-barcode" viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => <rect key={i} x={b.x} y="0" width={b.w} height="40" />)}
    </svg>
  );
}

/** One line: label on the left, amount on the right, dots between. */
function Line({ left, right, strong, sub }: { left: string; right?: string; strong?: boolean; sub?: boolean }) {
  const room = WIDTH - (right?.length ?? 0) - 1;
  return (
    <div className={`rc-line${strong ? ' is-strong' : ''}${sub ? ' is-sub' : ''}`}>
      <span className="rc-left">{cut(left, room)}</span>
      {right !== undefined && <span className="rc-right">{right}</span>}
    </div>
  );
}

const Rule = ({ double }: { double?: boolean }) => <div className={`rc-rule${double ? ' is-double' : ''}`} aria-hidden="true" />;

function ReceiptSlip({ data, firstDay, tags }: { data: DayView; firstDay: string | null; tags: Tag[] }) {
  const day = parseDay(data.day);
  const t = data.totals;
  const present = data.activity.filter((s) => s.ref === 1);
  const midnight = day.getTime() / 1000;
  const opened = present.length ? midnight + Math.min(...present.map((s) => s.from)) * 3600 : null;
  const closed = present.length ? midnight + Math.max(...present.map((s) => s.to)) * 3600 : null;
  // Breaks between the first and last activity, however the source recorded them.
  const away = opened && closed ? Math.max(0, closed - opened - t.active_secs) : 0;
  const number = firstDay ? Math.round((day.getTime() - parseDay(firstDay).getTime()) / 86_400_000) + 1 : null;

  const items = data.apps.filter((a) => a.seconds >= 60);
  const shown = items.slice(0, 12);
  const rest = items.slice(12);
  const restSecs = rest.reduce((a, b) => a + b.seconds, 0);

  const depts = useMemo(() => {
    const by = new Map<number, number>();
    for (const s of data.rule_tags) by.set(s.ref, (by.get(s.ref) ?? 0) + (s.to - s.from) * 3600);
    return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, secs]) => ({ id, name: tags.find((x) => x.id === id)?.name ?? 'Tag', secs }));
  }, [data, tags]);
  const flowSecs = data.flow.week[6] ?? 0;
  const longest = data.flow.sessions.reduce<(typeof data.flow.sessions)[number] | null>((a, s) => (!a || s.end - s.start > a.end - a.start ? s : a), null);
  const busiest = data.hourly.reduce((a, h) => (h.keys > a.keys ? h : a), data.hourly[0]);
  const docs = new Map<number, number>();
  for (const s of data.docs_lane) docs.set(s.ref, (docs.get(s.ref) ?? 0) + (s.to - s.from) * 3600);
  const topDoc = [...docs.entries()].sort((a, b) => b[1] - a[1])[0];
  const km = t.distance_m >= 1000 ? `${(t.distance_m / 1000).toFixed(2)} km` : `${n(t.distance_m)} m`;
  const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
  const stamp = data.day.replace(/-/g, '');

  return (
    <div className="rc-slip">
      <div className="rc-center">
        <div className="rc-kanji">活動</div>
        <div className="rc-shop">KATSUDŌ</div>
        <div>ACTIVITY &amp; SUNDRIES</div>
        <div>STORE: THIS PC · LOCAL ONLY</div>
      </div>
      <Rule double />
      <Line left={day.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
        right={number ? `#${String(number).padStart(4, '0')}` : ''} />
      {opened && closed && <Line left={`OPENED ${clock(opened)}`} right={`CLOSED ${data.day === todayIso() ? 'NOT YET' : clock(closed)}`} />}
      <Rule />
      <Line left="ITEM" right="H:MM" strong />
      {shown.length === 0 && <Line left="NO ITEMS TODAY" />}
      {shown.map((a) => (
        <div key={a.app_id}>
          <Line left={a.name.toUpperCase()} right={hm(a.seconds)} />
          {a.keys + a.clicks > 0 && <Line sub left={`  ${n(a.keys)} KEYS @ ${n(a.keys / Math.max(1, a.seconds / 60))}/MIN`} right={`${n(a.clicks)} CLK`} />}
        </div>
      ))}
      {rest.length > 0 && <Line left={`${rest.length} MORE ITEMS`} right={hm(restSecs)} />}
      <Rule />
      {depts.length > 0 && (
        <>
          <Line left="BY DEPARTMENT" strong />
          {depts.map((d) => <Line key={d.id}left={`  ${d.name.toUpperCase()}`} right={hm(d.secs)} />)}
          <Rule />
        </>
      )}
      <Line left="SUBTOTAL (ACTIVE)" right={hm(t.active_secs)} />
      <Line left="AWAY (NOT CHARGED)" right={hm(away)} />
      {present.length > 0 && <Line left="LONGEST STRETCH" right={hm(longestStretch(data.activity))} />}
      {flowSecs > 0 && <Line left={`IN FLOW (${data.flow.sessions.length}×)`} right={hm(flowSecs)} />}
      {longest && <Line sub left={`  LONGEST: ${longest.label.toUpperCase()}`} right={hm(longest.end - longest.start)} />}
      <Rule />
      <Line left="KEYSTROKES" right={n(t.keys)} />
      <Line left="CLICKS" right={n(t.clicks)} />
      {t.scrolls > 0 && <Line left="SCROLLS" right={n(t.scrolls)} />}
      {t.distance_m > 0 && <Line left="POINTER TRAVEL" right={km} />}
      {t.download > 0 && <Line left="DOWNLOADED" right={gb(t.download)} />}
      {t.upload > 0 && <Line left="UPLOADED" right={gb(t.upload)} />}
      {busiest && busiest.keys > 0 && <Line left="BUSIEST HOUR" right={`${String(busiest.hour).padStart(2, '0')}:00`} />}
      {topDoc && <Line left={`TOP WINDOW: ${(data.titles[topDoc[0]] ?? '').toUpperCase()}`} />}
      <Rule double />
      <Line left="TOTAL" right={`${Math.floor(t.active_secs / 3600)}H ${String(Math.floor((t.active_secs % 3600) / 60)).padStart(2, '0')}M`} strong />
      <Line left="PAID WITH" right="ATTENTION" />
      <Line left="CHANGE" right="0:00" />
      <Rule />
      <div className="rc-center">
        <Barcode text={stamp} />
        <div className="rc-code">{stamp}</div>
        <div className="rc-thanks">THANK YOU FOR YOUR FOCUS</div>
        <div>NOTHING HERE LEFT YOUR PC</div>
        <div>KEEP FOR YOUR RECORDS</div>
      </div>
    </div>
  );
}

/** The receipt in a dialog, with print and save. Mount once; opened by `openReceipt`. */
export function ReceiptDialog({ firstDay }: { firstDay: string | null }) {
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setDay((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  if (!day) return null;
  return <ReceiptBody day={day} firstDay={firstDay} onClose={() => setDay(null)} />;
}

function ReceiptBody({ day, firstDay, onClose }: { day: string; firstDay: string | null; onClose: () => void }) {
  const data = useData(() => api.day(day), [day]);
  const tags = useData(api.tags, []);
  const slip = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('rc-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('rc-open');
    };
  }, [onClose]);

  const saveImage = async () => {
    const el = slip.current;
    if (!el) return;
    try {
      const path = await save({ defaultPath: `katsudo-receipt-${day}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (!path) return;
      const url = await toPng(el, { pixelRatio: 2, cacheBust: true });
      await invoke('save_png', { path, data: url.slice(url.indexOf(',') + 1) });
    } catch (e) {
      setError(String(e));
    }
  };

  // On <body>, outside the app, so printing can leave everything else out.
  return createPortal(
    <div className="rc-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rc-dialog" role="dialog" aria-modal="true" aria-label={`Receipt for ${day}`}>
        <div className="rc-tools">
          <Button size="sm" icon="export" onClick={() => window.print()} disabled={!data.data}>Print</Button>
          <Button size="sm" icon="export" onClick={saveImage} disabled={!data.data}>Save image</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="rc-paper" ref={slip}>
          {data.data ? <ReceiptSlip data={data.data} firstDay={firstDay} tags={tags.data?.tags ?? []} /> : <div className="rc-slip rc-center">PRINTING…</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
