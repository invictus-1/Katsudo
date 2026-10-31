// Copies the built installer to release/Katsudo-Setup-<version>.exe.
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';

const url = (p) => new URL('../' + p, import.meta.url);
const { version } = JSON.parse(readFileSync(url('src-tauri/tauri.conf.json'), 'utf8'));
mkdirSync(url('release/'), { recursive: true });
const out = `release/Katsudo-Setup-${version}.exe`;
copyFileSync(url('installer/src-tauri/target/release/katsudo-setup.exe'), url(out));
console.log(`${out} (${(statSync(url(out)).size / 1e6).toFixed(1)} MB)`);
