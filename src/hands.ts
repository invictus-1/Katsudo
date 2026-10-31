// Hand and finger balance. A keyboard reports keys, never fingers, so presses are given to
// fingers by a finger map: the touch-typing chart, or a gaming one with the left hand on WASD.
// You can set a map per app (games use the gaming map) and move any key to the finger you
// really use. Mouse clicks go to the index finger of the hand on the mouse, scrolls to its
// middle finger. Only counts are used, never the order of keys.

export type Finger = 'lp' | 'lr' | 'lm' | 'li' | 'lt' | 'rt' | 'ri' | 'rm' | 'rr' | 'rp';
export type Preset = 'typing' | 'gaming';
export type Hand = 'left' | 'right';

export const FINGERS: { id: Finger; name: string; hand: Hand }[] = [
  { id: 'lp', name: 'Left pinky', hand: 'left' }, { id: 'lr', name: 'Left ring', hand: 'left' }, { id: 'lm', name: 'Left middle', hand: 'left' },
  { id: 'li', name: 'Left index', hand: 'left' }, { id: 'lt', name: 'Left thumb', hand: 'left' }, { id: 'rt', name: 'Right thumb', hand: 'right' },
  { id: 'ri', name: 'Right index', hand: 'right' }, { id: 'rm', name: 'Right middle', hand: 'right' }, { id: 'rr', name: 'Right ring', hand: 'right' },
  { id: 'rp', name: 'Right pinky', hand: 'right' },
];

export interface HandsConfig {
  preset: Preset;
  mouse: Hand;
  /** App id -> the map its keys use, where it differs from `preset`. */
  apps: Record<string, Preset>;
  /** Key id -> the finger you really press it with. */
  keys: Record<string, Finger>;
}

export const DEFAULT_HANDS: HandsConfig = { preset: 'typing', mouse: 'right', apps: {}, keys: {} };

export function parseHands(json: string | undefined): HandsConfig {
  try {
    const v = JSON.parse(json || '{}');
    return {
      preset: v.preset === 'gaming' ? 'gaming' : 'typing',
      mouse: v.mouse === 'left' ? 'left' : 'right',
      apps: v.apps && typeof v.apps === 'object' ? v.apps : {},
      keys: v.keys && typeof v.keys === 'object' ? v.keys : {},
    };
  } catch {
    return { ...DEFAULT_HANDS };
  }
}

const groups = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).flatMap(([finger, keys]) => keys.split(' ').map((k) => [k, finger as Finger])));

/** The touch-typing chart. Space is shared by both thumbs. */
const TYPING: Record<string, Finger | 'thumbs'> = {
  ...groups({
    lp: '` 1 q a z intl tab capslock lshift lctrl escape f1',
    lr: '2 w s x f2',
    lm: '3 e d c f3',
    li: '4 5 r t f g v b f4 f5',
    lt: 'lalt meta',
    rt: 'ralt menu',
    ri: '6 7 y u h j n m f6 f7 left num0 num1 num4 num7 numlock',
    rm: '8 i k , f8 up down home end insert delete num2 num5 num8 num/',
    rr: '9 o l . f9 f10 right pageup pagedown num3 num6 num9 num*',
    rp: '0 - = p [ ] \\ ; \' / enter backspace rshift rctrl f11 f12 printscreen scrolllock pause num- num+ numenter num.',
  }),
  space: 'thumbs',
};

/** Gaming: the left hand rests on WASD; the right hand leaves the mouse only for the far keys. */
const GAMING: Record<string, Finger | 'thumbs'> = {
  ...TYPING,
  ...groups({
    lp: '` 1 escape tab capslock lshift lctrl z',
    lr: '2 q a x',
    lm: '3 w s c',
    li: '4 5 6 e d r f t g v b y h n',
    lt: 'space lalt meta',
  }),
};

export function fingerFor(key: string, preset: Preset, custom: Record<string, Finger>): Finger | 'thumbs' | null {
  return custom[key] ?? (preset === 'gaming' ? GAMING : TYPING)[key] ?? null;
}

/** Counts by physical position: on other layouts a position types another key. */
export function byPosition(counts: Record<string, number>, map?: Record<string, [string, string]>) {
  if (!map) return counts;
  const out = { ...counts };
  for (const [pos, [id]] of Object.entries(map)) out[pos] = counts[id] ?? 0;
  return out;
}

export type Tally = Record<Finger, number>;
const empty = (): Tally => ({ lp: 0, lr: 0, lm: 0, li: 0, lt: 0, rt: 0, ri: 0, rm: 0, rr: 0, rp: 0 });

function addKeys(t: Tally, counts: Record<string, number>, preset: Preset, custom: Record<string, Finger>, sign = 1) {
  for (const [key, n] of Object.entries(counts)) {
    const f = fingerFor(key, preset, custom);
    if (f === 'thumbs') {
      t.lt += (sign * n) / 2;
      t.rt += (sign * n) / 2;
    } else if (f) {
      t[f] += sign * n;
    }
  }
}

const ROWS: Record<string, string[]> = {
  number: '` 1 2 3 4 5 6 7 8 9 0 - ='.split(' '),
  top: 'q w e r t y u i o p [ ] \\'.split(' '),
  home: 'a s d f g h j k l ; \''.split(' '),
  bottom: 'z x c v b n m , . /'.split(' '),
};

export interface HandsReport {
  keyboard: Tally;
  mouse: Tally;
  total: Tally;
  left: number;
  right: number;
  /** Share of letter and symbol presses on each row. */
  rows: Record<'number' | 'top' | 'home' | 'bottom', number>;
  /** Presses the map couldn't place (media keys and the like). */
  unmapped: number;
}

export function handsReport(
  all: Record<string, number>,
  perApp: { app_id: number; keys: Record<string, number> }[],
  cfg: HandsConfig,
  clicks: number,
  scrolls: number,
): HandsReport {
  const keyboard = empty();
  addKeys(keyboard, all, cfg.preset, cfg.keys);
  // Apps on another map: take their presses back out under the default map, add them under theirs.
  for (const a of perApp) {
    const p = cfg.apps[String(a.app_id)];
    if (p && p !== cfg.preset) {
      addKeys(keyboard, a.keys, cfg.preset, cfg.keys, -1);
      addKeys(keyboard, a.keys, p, cfg.keys, 1);
    }
  }
  for (const f of FINGERS) keyboard[f.id] = Math.max(0, keyboard[f.id]);
  const mouse = empty();
  const [index, middle] = cfg.mouse === 'left' ? ['li', 'lm'] as const : ['ri', 'rm'] as const;
  mouse[index] = clicks;
  mouse[middle] = scrolls;
  const total = empty();
  for (const f of FINGERS) total[f.id] = keyboard[f.id] + mouse[f.id];
  const left = FINGERS.filter((f) => f.hand === 'left').reduce((s, f) => s + total[f.id], 0);
  const right = FINGERS.filter((f) => f.hand === 'right').reduce((s, f) => s + total[f.id], 0);
  const rowTotals = Object.fromEntries(Object.entries(ROWS).map(([r, keys]) => [r, keys.reduce((s, k) => s + (all[k] ?? 0), 0)]));
  const rowSum = Object.values(rowTotals).reduce((a, b) => a + b, 0) || 1;
  const rows = Object.fromEntries(Object.entries(rowTotals).map(([r, v]) => [r, v / rowSum])) as HandsReport['rows'];
  const unmapped = Object.entries(all).reduce((s, [k, n]) => s + (fingerFor(k, cfg.preset, cfg.keys) ? 0 : n), 0);
  return { keyboard, mouse, total, left, right, rows, unmapped };
}

/** A pressed key, as Katsudō names it (KeyboardEvent.code -> key id). */
export function keyIdFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: 'space', Enter: 'enter', Backspace: 'backspace', Tab: 'tab', CapsLock: 'capslock', Escape: 'escape',
    ShiftLeft: 'lshift', ShiftRight: 'rshift', ControlLeft: 'lctrl', ControlRight: 'rctrl', AltLeft: 'lalt', AltRight: 'ralt',
    MetaLeft: 'meta', MetaRight: 'meta', ContextMenu: 'menu', Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.',
    Slash: '/', Backquote: '`', BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'", ArrowUp: 'up', ArrowDown: 'down',
    ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', Insert: 'insert',
    Delete: 'delete', NumpadAdd: 'num+', NumpadSubtract: 'num-', NumpadMultiply: 'num*', NumpadDivide: 'num/', NumpadDecimal: 'num.',
    NumpadEnter: 'numenter', NumLock: 'numlock', PrintScreen: 'printscreen', ScrollLock: 'scrolllock', Pause: 'pause',
  };
  return named[code] ?? null;
}

/** How a key id reads on screen. */
export function keyLabel(k: string) {
  const words: Record<string, string> = { lshift: 'Left Shift', rshift: 'Right Shift', lctrl: 'Left Ctrl', rctrl: 'Right Ctrl', lalt: 'Left Alt', ralt: 'Right Alt',
    meta: 'Win', capslock: 'Caps Lock', backspace: 'Backspace', space: 'Space', enter: 'Enter', tab: 'Tab', escape: 'Esc' };
  return words[k] ?? (k.length === 1 ? k.toUpperCase() : k.replace(/^num/, 'Num ').replace(/^f(\d)/, 'F$1'));
}
