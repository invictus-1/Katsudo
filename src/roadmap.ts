// The roadmap shown in the app. Edit here as plans change; stars and your own ideas are
// saved locally (setting "roadmap") and never leave the machine.

export type Stage = 'done' | 'next' | 'planned' | 'idea';
export type Area = 'Tracking' | 'Insight' | 'Rhythm' | 'Look & feel' | 'Data' | 'Performance' | 'Polish';

export interface RoadmapItem {
  id: string;
  title: string;
  blurb: string;
  stage: Stage;
  area: Area;
  version?: string;
}

export const STAGES: { id: Stage; title: string; note: string }[] = [
  { id: 'next', title: 'Next up', note: 'Being built or about to be.' },
  { id: 'planned', title: 'Planned', note: 'Agreed, on the road to 1.0. Star to move something up.' },
  { id: 'idea', title: 'Your ideas', note: 'Add anything here. Star what matters most; stars move things up everywhere.' },
  { id: 'done', title: 'Shipped', note: 'In your hands.' },
];

export const ROADMAP: RoadmapItem[] = [
  // ---- shipped ----
  { id: 'import', stage: 'done', area: 'Data', version: '0.1', title: 'ManicTime and WhatPulse import', blurb: 'Read-only, transactional, replaces itself on re-import. 7 years in under a minute.' },
  { id: 'backups', stage: 'done', area: 'Data', version: '0.1', title: 'Verified daily backups', blurb: 'Integrity-checked snapshots, 14 daily and 8 weekly, safety snapshots before imports and restores.' },
  { id: 'live', stage: 'done', area: 'Rhythm', version: '0.2', title: 'Live, exact key counting', blurb: 'Counted on key-down, 18 ns per press, a keys-per-second meter sampled every 20 ms.' },
  { id: 'eras', stage: 'done', area: 'Look & feel', version: '0.2', title: 'Eras and welcomes', blurb: 'Phosphor, Arcade, Synthwave, Beige Box, Night shift, Paper and Mixtape, each with its own intro.' },
  { id: 'setup', stage: 'done', area: 'Polish', version: '0.3', title: 'Bespoke installer', blurb: 'Its own animated setup in a random era each run, a matching uninstaller, clean upgrades that save before closing.' },
  { id: 'tips', stage: 'done', area: 'Rhythm', version: '0.3', title: 'Instant key read-outs', blurb: 'Hover any key or calendar day and its count pops up at once.' },
  { id: 'install', stage: 'done', area: 'Polish', version: '0.2', title: 'Installer, autostart, tray', blurb: 'Per-user installer with era art, starts with Windows in the tray, one copy at a time.' },

  // ---- next ----
  { id: 'wp-account', stage: 'done', area: 'Data', version: '0.4', title: 'Your whole WhatPulse account', blurb: 'Every computer you ever pulsed from, archived ones too, back to day one, through your WhatPulse API key. Then you can leave WhatPulse.' },
  { id: 'roadmap', stage: 'done', area: 'Polish', version: '0.2', title: 'This roadmap', blurb: 'Planned work and ideas inside the app, with stars and your own notes.' },
  { id: 'layouts', stage: 'done', area: 'Rhythm', version: '0.5', title: 'Full keyboard layouts', blurb: '60%, TKL and full size with the F-row, navigation keys, arrows and numpad. Native tracking tells numpad keys apart from their twins.' },
  { id: 'net-ranges', stage: 'done', area: 'Insight', version: '0.5', title: 'Network by day, week, month, year and all time', blurb: 'The same ranges as Input, with busiest days per range.' },
  { id: 'receipt', stage: 'done', area: 'Look & feel', version: '0.13', title: 'Daily receipt', blurb: 'A thermal-receipt slip for any day, itemised by app with keys per minute, departments from your tags, flow and a real barcode; print it or save it as an image.' },
  { id: 'flow', stage: 'done', area: 'Insight', version: '0.12', title: 'Flow detection', blurb: 'Deep-work stretches found automatically (one task, no long breaks or switching), with your best hours, longest sessions and a Flow lane on the timeline.' },
  { id: 'tags', stage: 'done', area: 'Tracking', version: '0.11', title: 'Tags and rules', blurb: 'Tag time by app, window title, document or site; rules apply to your whole history in seconds, sites beat their browser, and reports export to CSV for invoices.' },
  { id: 'compare', stage: 'done', area: 'Insight', version: '0.10', title: 'Compare periods', blurb: 'This week against last, this month against last month or a year ago, this year so far, or any two ranges: totals or per day, day by day, hour of day, apps and sites.' },
  { id: 'kanji', stage: 'done', area: 'Look & feel', version: '0.9.1', title: '活動', blurb: 'The name in kanji, in each era\'s own hand: a hanko seal by the logo, a kanji line over every page title, in every welcome and on the year-in-review cards. Fonts cut to just these characters.' },
  { id: 'wrapped', stage: 'done', area: 'Insight', version: '0.9', title: 'Year in review', blurb: 'Any year as era-styled cards: hours, top apps, keys, mouse, rhythm games, sites, your peak hours and last year compared. Hide anything, save them as images.' },
  { id: 'palette', stage: 'done', area: 'Insight', version: '0.8', title: 'Command palette', blurb: 'Ctrl K anywhere: jump to a page, switch era, back up, or search every app, window and site in your whole history with time, first and last seen and busiest days.' },
  { id: 'overlay', stage: 'done', area: 'Rhythm', version: '0.7', title: 'Stream overlay', blurb: 'A page for OBS on 127.0.0.1: keys per second, peak and streams, and a key viewer with rising trails, in any era. Only the keys you pick are ever sent to it.' },
  { id: 'rhythm-mode', stage: 'done', area: 'Rhythm', version: '0.6', title: 'Rhythm mode', blurb: 'Every session in a rhythm game kept second by second: true peak keys per second, streams of 10+ a second, personal bests per game. osu!, Quaver, Etterna, StepMania and more recognised; mark any other game.' },
  { id: 'wp-keys', stage: 'done', area: 'Data', version: '0.5.1', title: 'Every WhatPulse key placed', blurb: 'Shift, Ctrl, Alt, Windows, arrows, F-keys and the whole numpad, matched by a key test against Katsudō\'s own counts. Old history re-placed automatically.' },
  { id: 'mouse-map', stage: 'done', area: 'Insight', version: '0.5.1', title: 'Mouse heatmap', blurb: 'Where you click and where the pointer travels, over your monitors as they are arranged, in the era\'s heat colours. WhatPulse\'s last three months of clicks come along.' },
  { id: 'app-keys', stage: 'planned', area: 'Rhythm', title: 'Per-app keyboard heatmaps', blurb: 'The keyboard for one game or editor at a time, from Katsudō\'s own tracking and WhatPulse\'s per-app key history.' },
  { id: 'iso', stage: 'planned', area: 'Rhythm', title: 'ISO and other layouts', blurb: 'ISO Enter and the extra key by Left Shift, plus layouts for keyboards that aren\'t US ANSI.' },

  // ---- planned ----
  { id: 'optimize', stage: 'planned', area: 'Performance', version: 'pre-1.0', title: 'Optimization pass', blurb: 'Once feature complete: unload the UI while in the tray (WebView memory down to the tracker\'s few MB), startup and memory budgets, index and query tuning, database compaction, idle CPU at zero.' },
  { id: 'signing', stage: 'planned', area: 'Polish', version: 'pre-1.0', title: 'Signed installer and updates', blurb: 'Code signing so SmartScreen stays quiet, and a built-in update check that you trigger.' },
  { id: 'a11y', stage: 'planned', area: 'Polish', version: 'pre-1.0', title: 'Keyboard and screen-reader pass', blurb: 'Every view usable without a mouse; charts with readable summaries.' },

  // ---- planned: every idea approved for the road to 1.0 (Oct 2026) ----
  { id: 'transitions', stage: 'planned', area: 'Look & feel', title: 'Era transitions', blurb: 'Switching eras plays a short CRT power-off, VHS tracking roll or pixel dissolve.' },
  { id: 'more-eras', stage: 'planned', area: 'Look & feel', title: 'More eras', blurb: '1992 Vaporwave, 2003 Glass, 2008 Gloss, a print-magazine era. Community eras as simple theme files.' },
  { id: 'breaks', stage: 'planned', area: 'Tracking', title: 'Gentle break nudges', blurb: 'Opt-in: after long unbroken typing or clicking, a quiet tray hint to stretch. Never a nag, off by default.' },
  { id: 'aware', stage: 'planned', area: 'Tracking', title: 'Meeting and media awareness', blurb: 'Microphone or camera in use, or video playing, counts as present rather than away.' },
  { id: 'multi-pc', stage: 'planned', area: 'Data', title: 'Several PCs, one history', blurb: 'Merge databases from your other machines through a shared folder or the LAN. Still no cloud.' },
  { id: 'ask', stage: 'planned', area: 'Insight', title: 'Ask your history', blurb: 'Optional local model through Ollama: "what did I work on Tuesday afternoon?" answered on your machine only.' },
  { id: 'ergonomics', stage: 'planned', area: 'Rhythm', title: 'Hand and finger balance', blurb: 'Which hand and fingers do the work, from your key counts, with the busiest reaches highlighted.' },
];
