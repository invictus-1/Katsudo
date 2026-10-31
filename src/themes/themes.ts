export type ThemeId = 'ukiyoe' | 'steampunk' | 'ramen' | 'phosphor' | 'arcade' | 'synthwave' | 'beige' | 'dark' | 'light';
export type ThemeChoice = ThemeId | 'mixtape';

export interface ThemeInfo {
  id: ThemeId;
  era: string;
  name: string;
  blurb: string;
  /** Ground, primary, then two data tones: the card's swatch strip. */
  swatches: string[];
}

/** In era order. Colors come from design/tokens.json; swatches only preview them. */
export const THEMES: ThemeInfo[] = [
  { id: 'ukiyoe', era: '1830', name: 'Ukiyo-e', blurb: 'A woodblock print: indigo waves and a red sun on washi paper.', swatches: ['#f3ebd9', '#c8402e', '#2b5a8c', '#1f2a44'] },
  { id: 'steampunk', era: '1889', name: 'Steampunk', blurb: 'Brass, rivets and mahogany, with a gauge for your keys.', swatches: ['#1d120a', '#d4a24c', '#4fae9b', '#d0703f'] },
  { id: 'ramen', era: '1958', name: 'Ramen shop', blurb: 'A late-night stall: red noren, a paper lantern, steam off the bowl.', swatches: ['#1b1310', '#f2a03d', '#d93b30', '#7fc4b0'] },
  { id: 'phosphor', era: '1977', name: 'Phosphor', blurb: 'Amber terminal glow, scanlines and a boot sequence.', swatches: ['#0d0a04', '#ffb000', '#62e08a', '#ffc870'] },
  { id: 'arcade', era: '1984', name: 'Arcade', blurb: 'Neon on black, pixel type, a high-score table for your fingers.', swatches: ['#04040a', '#ffe14d', '#29f0ff', '#ff3df0'] },
  { id: 'synthwave', era: '1986', name: 'Synthwave', blurb: 'A sunset over an endless grid.', swatches: ['#120f30', '#ff9e5e', '#4fe3f0', '#ff6ec7'] },
  { id: 'beige', era: '1996', name: 'Beige Box', blurb: 'Bevels, navy title bars and a teal desktop.', swatches: ['#d4cfc0', '#1c3d9e', '#00727a', '#a3204a'] },
  { id: 'dark', era: 'Now', name: 'Night shift', blurb: 'Calm, warm and dense. The default.', swatches: ['#15130f', '#ffb347', '#4fd1c5', '#ff8fa3'] },
  { id: 'light', era: 'Now', name: 'Paper', blurb: 'The same, printed on warm paper.', swatches: ['#f3ede0', '#c47400', '#1a9484', '#d8607b'] },
];

/** Mixtape plays a different era each local day. */
export function resolveTheme(choice: string): ThemeId {
  if (choice === 'mixtape') {
    const d = new Date();
    const dayNumber = Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
    return THEMES[dayNumber % THEMES.length].id;
  }
  return (THEMES.find((t) => t.id === choice)?.id ?? 'dark') as ThemeId;
}

export function applyTheme(choice: string) {
  document.documentElement.setAttribute('data-theme', resolveTheme(choice));
}

export function applyScale(percent: number) {
  // Chromium's zoom scales layout and text together, like the browser's own zoom.
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(percent / 100);
}

export function applyMotion(on: boolean) {
  document.documentElement.classList.toggle('no-motion', !on);
}
