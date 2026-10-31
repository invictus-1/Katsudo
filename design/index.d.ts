import type * as React from 'react';

/** Data tones. Each maps to one metric: amber = Time, cyan = Keys, rose = Clicks, lime = Network, sky = Uptime / third-party. */
export type DataTone = 'amber' | 'cyan' | 'rose' | 'lime' | 'sky';
export type IconName = 'clock' | 'keyboard' | 'mouse' | 'network' | 'timeline' | 'calendar' | 'apps' | 'tag' | 'import' | 'export' | 'backup' | 'database' | 'lock' | 'search' | 'settings' | 'check' | 'alert' | 'pause' | 'play' | 'chevron' | 'star' | 'flag' | 'rhythm' | 'dot';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** quiet (default keycap), primary (amber, once per view), ghost (toolbar), danger (destructive). */
  variant?: 'quiet' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Leading icon. With no children the button becomes square; pass aria-label. */
  icon?: IconName;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface KbdProps { children: React.ReactNode }
export declare function Kbd(props: KbdProps): React.ReactElement;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName;
  /** A shortcut hint shown at the right edge, e.g. "Ctrl K". */
  kbd?: string;
}
export declare function Input(props: InputProps): React.ReactElement;

export type SegmentedOption = string | { value: string; label: React.ReactNode };
export interface SegmentedProps {
  options: SegmentedOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md';
  /** Accessible name of the group. */
  label?: string;
}
export declare function Segmented(props: SegmentedProps): React.ReactElement;

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  /** One line under the label saying what turning it on does. */
  hint?: React.ReactNode;
  disabled?: boolean;
}
export declare function Switch(props: SwitchProps): React.ReactElement;

export interface BadgeProps {
  tone?: 'neutral' | DataTone | 'success' | 'danger';
  /** A square status dot before the text. */
  dot?: boolean;
  children: React.ReactNode;
}
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface IconProps { name: IconName; size?: number; /** Set for a meaningful icon; omit for decoration. */ title?: string; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

export interface PanelProps {
  title?: React.ReactNode;
  /** Controls in the header's right edge: a Segmented, a ghost Button. */
  action?: React.ReactNode;
  /** Remove body padding for lists and tables that run edge to edge. */
  flush?: boolean;
  children?: React.ReactNode;
}
export declare function Panel(props: PanelProps): React.ReactElement;

export interface MeterProps {
  /** 0 to 1. */
  value: number;
  label?: string;
  /** Text at the right of the head; defaults to the percentage. false hides it. */
  valueText?: string | false;
  segments?: number;
  tone?: DataTone;
}
export declare function Meter(props: MeterProps): React.ReactElement;

export interface SparklineProps { data: number[]; tone?: DataTone; width?: number; height?: number; fill?: boolean }
export declare function Sparkline(props: SparklineProps): React.ReactElement;

export interface StatTileProps {
  label: string;
  /** Pre-formatted: "12,408", "4h 12m". */
  value: React.ReactNode;
  unit?: string;
  /** "+12%" or "-3%": shown neutral with a ▲/▼ glyph, never green or red. */
  delta?: string;
  deltaLabel?: string;
  tone?: DataTone;
  icon?: IconName;
  /** Recent values for the sparkline, oldest first. */
  data?: number[];
}
export declare function StatTile(props: StatTileProps): React.ReactElement;

export interface TimelineSegment { from: number; to: number; tone?: DataTone | 'idle'; title?: string }
export interface TimelineLane { label: string; segments: TimelineSegment[] }
export interface TimelineProps {
  /** Hours as decimals: 9.5 = 09:30. Defaults 0 and 24. */
  start?: number;
  end?: number;
  tickEvery?: number;
  lanes: TimelineLane[];
  /** Current time marker in hours. */
  now?: number;
}
export declare function Timeline(props: TimelineProps): React.ReactElement;

export interface CalendarHeatmapProps {
  /** One value per day, oldest first. */
  values: number[];
  /** Weekday of the first value, 0 = Monday. */
  startWeekday?: number;
  max?: number;
  format?: (value: number) => string;
  legend?: boolean;
}
export declare function CalendarHeatmap(props: CalendarHeatmapProps): React.ReactElement;

export interface KeyboardHeatmapProps {
  /** Presses per key id: letters and digits lowercase ("e", "7"), plus space, enter, backspace, tab, capslock, lshift, rshift, lctrl, rctrl, lalt, ralt, meta, fn, menu. */
  counts: Record<string, number>;
  /** compact: the 60% main block (default). tkl: adds the F-row, navigation keys and arrows
   *  (escape, f1–f12, printscreen, scrolllock, pause, insert, home, pageup, delete, end, pagedown, up, down, left, right).
   *  full: adds the numpad (numlock, num0–num9, num/, num*, num-, num+, num., numenter). */
  layout?: 'compact' | 'tkl' | 'full';
  label?: string;
}
export declare function KeyboardHeatmap(props: KeyboardHeatmapProps): React.ReactElement;

export interface UsageItem { name: string; seconds?: number; /** Overrides the formatted duration, e.g. "8,214 keys". */ value?: string; meta?: string; tone?: DataTone | 'idle' }
export interface UsageListProps { items: UsageItem[] }
export declare function UsageList(props: UsageListProps): React.ReactElement;

export interface ImportSourceProps {
  source: 'manictime' | 'whatpulse' | 'csv' | string;
  name?: string;
  /** The picked path; defaults to a hint of what to pick. */
  file?: string;
  status?: 'idle' | 'scanning' | 'ready' | 'importing' | 'done' | 'error';
  /** 0 to 1 while importing. */
  progress?: number;
  /** The meter label while importing; the message otherwise (the error, when failed). */
  detail?: string;
  stats?: { label: string; value: string }[];
  actionLabel?: string;
  onAction?: () => void;
}
export declare function ImportSource(props: ImportSourceProps): React.ReactElement;

export interface NavItemProps { label: string; icon?: IconName; active?: boolean; count?: React.ReactNode; kbd?: string; href?: string; onClick?: () => void }
export declare function NavItem(props: NavItemProps): React.ReactElement;

export interface StatusBarProps {
  tracking?: boolean;
  items?: { label: React.ReactNode; icon?: IconName }[];
  right?: React.ReactNode;
}
export declare function StatusBar(props: StatusBarProps): React.ReactElement;

/** "4h 05m", "38m", "45s". */
export declare function formatDuration(seconds: number): string;
/** 9.5 → "09:30". */
export declare function formatClock(hours: number): string;
/** 12408 → "12,408". */
export declare function formatCount(n: number): string;

declare global {
  interface Window {
    Katsudo: {
      Button: typeof Button; Kbd: typeof Kbd; Input: typeof Input; Segmented: typeof Segmented; Switch: typeof Switch;
      Badge: typeof Badge; Icon: typeof Icon; Panel: typeof Panel; Meter: typeof Meter;
      StatTile: typeof StatTile; Sparkline: typeof Sparkline; Timeline: typeof Timeline; CalendarHeatmap: typeof CalendarHeatmap;
      KeyboardHeatmap: typeof KeyboardHeatmap; UsageList: typeof UsageList; ImportSource: typeof ImportSource;
      NavItem: typeof NavItem; StatusBar: typeof StatusBar;
      formatDuration: typeof formatDuration; formatClock: typeof formatClock; formatCount: typeof formatCount;
    };
  }
}
