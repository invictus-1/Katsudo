// Generates src/ds/* from the design system sources in design/.
// design/ is a copy of the published Katsudō design system; edit there, then rerun `npm run ds`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// Line endings vary with git's autocrlf; the markers below are matched with LF.
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const write = (p, s) => writeFileSync(new URL('../' + p, import.meta.url), s);
mkdirSync(new URL('../src/ds/', import.meta.url), { recursive: true });

// tokens.json -> tokens.css (same layout the design system page compiles)
const t = JSON.parse(read('design/tokens.json'));
const themes = t.color.themes.map((x) => x.id);
const val = (v, th) => (typeof v === 'string' ? v : v[th] ?? v[themes[0]]);
const alias = (v) => v.replace(/^\{(.+)\}$/, 'var(--$1)');
let css = `/* Katsudō — generated from design/tokens.json by scripts/sync-ds.mjs */\n`;
themes.forEach((th, i) => {
  css += `${i === 0 ? ':root, ' : ''}[data-theme="${th}"] {\n`;
  for (const c of t.color.tokens) css += `  --${c.name}: ${alias(val(c.value, th))};\n`;
  for (const s of t.shadow?.tokens ?? []) css += `  --${s.name}: ${val(s.value, th)};\n`;
  css += '}\n';
});
css += ':root {\n';
for (const fam of Object.keys(t)) {
  if (['name', 'version', 'color', 'type', 'shadow'].includes(fam) || !t[fam]?.tokens) continue;
  for (const x of t[fam].tokens) css += `  --${x.name}: ${x.value};\n`;
}
for (const [k, v] of Object.entries(t.type.families)) css += `  --font-${k}: ${v};\n`;
css += '}\n';
for (const g of t.type.groups) {
  for (const s of g.styles) {
    css += `.${s.name} { font-family: var(--font-${s.family ?? g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight}${s.letterSpacing ? `; letter-spacing: ${s.letterSpacing}` : ''}; }\n`;
  }
}
write('src/ds/tokens.css', css);

// bundle.css minus its Google Fonts import: the app bundles its fonts locally.
write('src/ds/katsudo.css', read('design/bundle.css').replace(/^@import[^\n]*\n/, ''));

// bundle.js (a classic script assigning window.Katsudo) -> an ES module.
let js = read('design/bundle.js')
  .replace(/^\/\* @ds-bundle[^\n]*\n/, '')
  .replace('(function () {\n  var R = window.React;', 'const Katsudo = (function () {\n  var R = React;')
  .replace('window.Katsudo = Object.assign(window.Katsudo || {}, {', 'return ({')
  .replace(/\}\);\n\}\)\(\);\s*$/, '});\n})();\n');
if (!js.includes('const Katsudo') || !js.includes('return ({')) throw new Error('design/bundle.js changed shape; update sync-ds.mjs');
const exportBlock = read('design/bundle.js').split('window.Katsudo = Object.assign(window.Katsudo || {}, {')[1].split('});')[0];
const names = [...exportBlock.matchAll(/(\w+):/g)].map((m) => m[1]);
js = `import * as React from 'react';\n${js}export default Katsudo;\nexport const { ${names.join(', ')} } = Katsudo;\n`;
write('src/ds/katsudo.js', js);

// index.d.ts -> katsudo.d.ts (module types, without the window global)
write('src/ds/katsudo.d.ts', read('design/index.d.ts').replace(/\ndeclare global \{[\s\S]*$/, '\n'));
console.log('design system synced:', names.length, 'exports');
