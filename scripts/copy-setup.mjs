// Copies the built installer to release/Katsudo-Setup-<version>.exe. With a code-signing
// certificate in the Windows certificate store, set KATSUDO_SIGN_THUMBPRINT to its SHA-1
// thumbprint and the installer is Authenticode-signed here (signtool from the Windows SDK).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';

const url = (p) => new URL('../' + p, import.meta.url);
const { version } = JSON.parse(readFileSync(url('src-tauri/tauri.conf.json'), 'utf8'));
mkdirSync(url('release/'), { recursive: true });
const out = `release/Katsudo-Setup-${version}.exe`;
copyFileSync(url('installer/src-tauri/target/release/katsudo-setup.exe'), url(out));
const thumb = process.env.KATSUDO_SIGN_THUMBPRINT;
if (thumb) {
  execFileSync(process.env.KATSUDO_SIGNTOOL || 'signtool', ['sign', '/sha1', thumb, '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', out],
    { cwd: url('.'), stdio: 'inherit' });
  console.log('signed with certificate ' + thumb);
}
console.log(`${out} (${(statSync(url(out)).size / 1e6).toFixed(1)} MB)`);
