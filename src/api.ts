import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface Totals {
  active_secs: number;
  keys: number;
  clicks: number;
  scrolls: number;
  distance_m: number;
  download: number;
  upload: number;
  uptime_ms: number;
}
export interface DaySummary extends Totals { day: string }
export interface LaneSeg { from: number; to: number; ref: number; source: number }
export interface AppTotal { app_id: number; name: string; seconds: number; keys: number; clicks: number }
export interface DayView {
  day: string;
  totals: Totals;
  activity: LaneSeg[];
  apps_lane: LaneSeg[];
  docs_lane: LaneSeg[];
  tags_lane: LaneSeg[];
  /** Time tagged by your rules (ref = tag id). */
  rule_tags: LaneSeg[];
  names: Record<string, string>;
  titles: Record<string, string>;
  apps: AppTotal[];
  hourly: { hour: number; keys: number; clicks: number }[];
  week: DaySummary[];
}
export interface RangeView { days: DaySummary[]; apps: AppTotal[] }
export interface Stat { label: string; value: string }
export interface SourceInfo { id: number; kind: string; label: string; path: string | null; created_at: number; summary: Stat[] | null }
export interface BackupInfo { file: string; created_at: number; size: number; verified: boolean; kind: string; note: string | null }
export interface Status {
  today: string;
  tracking: boolean;
  paused_until: number | null;
  active: boolean;
  app_name: string | null;
  db_bytes: number;
  data_dir: string;
  db_path: string;
  first_day: string | null;
  /** Lifetime amounts with no dates (WhatPulse totals beyond its pulse history). */
  undated: Undated;
  last_backup: BackupInfo | null;
  sources: SourceInfo[];
  version: string;
}
export interface Tag { id: number; name: string; color: 'amber' | 'cyan' | 'rose' | 'lime' | 'sky' | string }
export interface TagRule { field: 'app' | 'title'; op: 'is' | 'contains'; value: string; tag_id: number }
export interface TagReport {
  totals: Record<string, number>;
  days: [string, Record<string, number>][];
  untagged_apps: [string, number][];
  untagged_sites: [string, number][];
}
export interface WrappedNamed { name: string; secs: number }
export interface ComparePeriod {
  from: string;
  to: string;
  totals: Totals;
  active_days: number;
  days: DaySummary[];
  hours: number[];
  apps: WrappedNamed[];
  sites: WrappedNamed[];
}
export interface Wrapped {
  year: number;
  years: number[];
  totals: { active_secs: number; keys: number; clicks: number; scrolls: number; distance_m: number; download: number; upload: number; uptime_ms: number };
  days_tracked: number;
  longest_day: { day: string; value: number } | null;
  most_keys_day: { day: string; value: number } | null;
  /** Length, first day, last day. */
  streak: [number, string | null, string | null];
  top_apps: WrappedNamed[];
  new_apps: number;
  top_new_app: WrappedNamed | null;
  top_sites: WrappedNamed[];
  keys: Record<string, number>;
  hours: number[];
  weekdays: number[];
  months: [number, number][];
  rhythm: { secs: number; games: WrappedNamed[]; sessions: number; peak_kps: number; best_stream: number };
  prev: Wrapped['totals'] | null;
  prev_days: number;
}
export interface SearchHit {
  kind: 'app' | 'title';
  id: number;
  name: string;
  app: string | null;
  secs: number;
  first: string | null;
  last: string | null;
  days: number;
}
export interface SearchDetail {
  secs: number; first: string | null; last: string | null; days: number;
  busiest: [string, number][];
  years: [string, number][];
}
export interface OverlayConfig {
  enabled: boolean;
  /** Key names separated by spaces, e.g. "Z X". */
  keys: string;
  show: string;
  era: string;
  speed: number;
}
export interface OverlayStatus { config: OverlayConfig; url: string; running: boolean; error: string | null }
export interface RhythmSession {
  id: number; app_id: number; app: string; start: number; end: number;
  keys: number; peak_kps: number; best_stream: number; streams: number;
}
export interface RhythmBest {
  app_id: number; app: string; sessions: number; seconds: number; keys: number;
  peak_kps: number; peak_at: number; best_stream: number; stream_at: number; most_keys: number;
}
export interface RhythmOverview {
  sessions: RhythmSession[];
  bests: RhythmBest[];
  apps: { key: string; name: string; game: boolean; known: boolean; keys: number }[];
  /** Keys in a second that count as streaming. */
  stream_kps: number;
}
export interface RhythmLive {
  app_id: number; app: string; started: number; keys: number; peak_kps: number;
  best_stream: number; stream: number;
  /** Keys per second for the last two minutes, oldest first. */
  recent: number[];
}
export interface Screen { x: number; y: number; w: number; h: number; primary: boolean }
/** Pointer heatmap: squares of `cell` pixels, each [x, y, clicks, moves] in square units. */
export interface MouseMap { cell: number; screens: Screen[]; cells: [number, number, number, number][] }
export interface Undated {
  keys: number;
  clicks: number;
  scrolls: number;
  distance_m: number;
  download: number;
  upload: number;
  uptime_ms: number;
}
export interface Settings {
  idle_minutes: number;
  track_titles: boolean;
  track_input: boolean;
  nightly_backup: boolean;
  theme: string;
  ui_scale: number;
  welcome: boolean;
  motion: boolean;
  /** JSON: { starred: string[], mine: { id, title, created }[] } */
  roadmap: string;
}
export interface Live { keys_today: number; clicks_today: number; kps: number; peak_kps: number }
export interface ScanResult {
  kind: string;
  path: string;
  first_day: string | null;
  last_day: string | null;
  days: number;
  stats: Stat[];
  notes: string[];
  overlap_days: number;
  previous_import: number | null;
}
export interface ImportProgress { kind: string; phase: string; done: number; total: number }
export interface ImportOutcome { kind: string; result: Stat[] | null; error: string | null }
export interface ImportStatus { running: ImportProgress | null; last: ImportOutcome | null }
export interface AccountComputer {
  id: number;
  name: string;
  os: string | null;
  archived: boolean;
  pulses: number;
  last_pulse: string | null;
  keys: number;
  clicks: number;
  suggested: 'this-pc' | 'other';
}
export interface AccountScan {
  username: string;
  first_pulse: string | null;
  last_pulse: string | null;
  pulses: number;
  stats: Stat[];
  computers: AccountComputer[];
  previous_import: number | null;
}
export type AccountRole = 'this-pc' | 'other' | 'skip';

export const api = {
  day: (day: string) => invoke<DayView>('get_day', { day }),
  range: (from: string, to: string) => invoke<RangeView>('get_range', { from, to }),
  days: (from: string, to: string) => invoke<DaySummary[]>('get_days', { from, to }),
  keys: (from: string, to: string) => invoke<Record<string, number>>('get_keys', { from, to }),
  mouse: (from: string, to: string) => invoke<MouseMap>('get_mouse', { from, to }),
  rhythm: () => invoke<RhythmOverview>('get_rhythm'),
  overlay: () => invoke<OverlayStatus>('get_overlay'),
  searchPrepare: () => invoke<void>('search_prepare'),
  tags: () => invoke<{ tags: Tag[]; rules: TagRule[]; building: boolean }>('get_tags'),
  saveTags: (tags: Tag[], rules: TagRule[]) => invoke<{ tags: Tag[]; rules: TagRule[]; building: boolean }>('save_tags', { tags, rules }),
  tagReport: (from: string, to: string) => invoke<TagReport>('tag_report', { from, to }),
  wrapped: (year: number | null) => invoke<Wrapped>('get_wrapped', { year }),
  compare: (a: { from: string; to: string }, b: { from: string; to: string }) =>
    invoke<{ a: ComparePeriod; b: ComparePeriod }>('get_compare', { aFrom: a.from, aTo: a.to, bFrom: b.from, bTo: b.to }),
  searchHistory: (q: string) => invoke<{ hits: SearchHit[]; ready: boolean }>('search_history', { q }),
  searchDetail: (kind: string, id: number) => invoke<SearchDetail>('search_detail', { kind, id }),
  setOverlay: (config: OverlayConfig) => invoke<OverlayStatus>('set_overlay', { config }),
  setOverlayEra: (era: string) => invoke<void>('set_overlay_era', { era }),
  rhythmSeries: (id: number) => invoke<number[]>('get_rhythm_series', { id }),
  rhythmLive: () => invoke<RhythmLive | null>('get_rhythm_live'),
  setRhythmGame: (key: string, game: boolean) => invoke<void>('set_rhythm_game', { key, game }),
  status: () => invoke<Status>('get_status'),
  live: () => invoke<Live>('get_live'),
  setPaused: (minutes: number | null) => invoke<void>('set_paused', { minutes }),
  settings: () => invoke<Settings>('get_settings'),
  setSetting: (key: keyof Settings, value: string) => invoke<void>('set_setting', { key, value }),
  autostart: () => invoke<boolean>('get_autostart'),
  setAutostart: (enabled: boolean) => invoke<void>('set_autostart', { enabled }),
  detect: () => invoke<[string, string][]>('import_detect'),
  scan: (kind: string, path: string) => invoke<ScanResult>('import_scan', { kind, path }),
  runImport: (kind: string, path: string) => invoke<Stat[]>('import_run', { kind, path }),
  cancelImport: () => invoke<void>('import_cancel'),
  importStatus: () => invoke<ImportStatus>('import_status'),
  wpScan: (user: string, token: string) => invoke<AccountScan>('wp_account_scan', { user, token }),
  wpImport: (user: string, token: string, choices: { computer_id: number; name: string; role: AccountRole }[]) =>
    invoke<Stat[]>('wp_account_import', { user, token, choices }),
  backups: () => invoke<BackupInfo[]>('list_backups'),
  backupNow: () => invoke<BackupInfo>('backup_now'),
  restore: (file: string) => invoke<void>('restore_backup', { file }),
  onImportProgress: (cb: (p: ImportProgress) => void): Promise<UnlistenFn> =>
    listen<ImportProgress>('import-progress', (e) => cb(e.payload)),
  onImportFinished: (cb: (o: ImportOutcome) => void): Promise<UnlistenFn> =>
    listen<ImportOutcome>('import-finished', (e) => cb(e.payload)),
};
