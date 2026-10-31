import type { DayView } from '../api';
import { Timeline } from '../ds/katsudo';
import type { TimelineLane } from '../ds/katsudo';
import { rankRefs, toSegments } from '../lib';

/** The day's lanes, in the design system's fixed order. */
export function DayTimeline({ data, live, full }: { data: DayView; live?: boolean; full?: boolean }) {
  const appTone = rankRefs(data.apps_lane);
  const docTone = rankRefs(data.docs_lane);
  const lanes: TimelineLane[] = [
    {
      label: 'Activity',
      segments: toSegments(data.activity, (s) => (s.ref === 1 ? 'amber' : 'idle'), (s) => (s.ref === 1 ? 'Active' : 'Away')),
    },
    {
      label: 'Applications',
      segments: toSegments(data.apps_lane, (s) => appTone.get(s.ref) ?? 'sky', (s) => data.names[s.ref] ?? 'App'),
    },
  ];
  if (data.docs_lane.length) {
    lanes.push({
      label: 'Documents',
      segments: toSegments(data.docs_lane, (s) => docTone.get(s.ref) ?? 'sky', (s) => data.titles[s.ref] ?? 'Document'),
    });
  }
  if (data.tags_lane.length) {
    lanes.push({ label: 'Tags', segments: toSegments(data.tags_lane, () => 'amber', (s) => data.titles[s.ref] ?? 'Tag') });
  }
  const peak = Math.max(1, ...data.hourly.map((h) => h.keys));
  const keyLane = data.hourly
    .filter((h) => h.keys > 0)
    .map((h) => ({ from: h.hour + 0.08, to: h.hour + 0.08 + 0.84 * Math.max(0.08, h.keys / peak), tone: 'cyan' as const, title: `${h.keys.toLocaleString('en-US')} keys` }));
  if (keyLane.length) lanes.push({ label: 'Keys / hour', segments: keyLane });

  const now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;
  let start = 0;
  let end = 24;
  if (!full) {
    const all = lanes.flatMap((l) => l.segments);
    const first = Math.min(...all.map((s) => s.from), live ? nowH : 24);
    const last = Math.max(...all.map((s) => s.to), live ? nowH : 0);
    start = Math.max(0, Math.floor(first) - (first % 1 < 0.25 ? 1 : 0));
    end = Math.min(24, Math.ceil(last) + 1);
    if (end - start < 6) end = Math.min(24, start + 6);
  }
  return (
    <div className="scroll-x">
      <Timeline start={start} end={end} tickEvery={end - start > 12 ? 2 : 1} lanes={lanes} now={live ? nowH : undefined} />
    </div>
  );
}
