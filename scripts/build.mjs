import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const tracks = JSON.parse(readFileSync('musicList.json', 'utf8'));
if (!Array.isArray(tracks) || !tracks.length) throw new Error('Empty music catalog');
for (const track of tracks) {
  const path = resolve(decodeURI(track));
  if (!path.startsWith(resolve('music') + sep) || !existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Invalid or missing track: ${track}`);
  }
}
// Explicit publication list: never serve the repository, dependencies or native build output.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const path of ['index.html', 'offline.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'assets', 'music', 'musicList.json', 'blue-archive-ost.json', 'waveforms.json', 'lastUpdated.txt']) {
  cpSync(path, `dist/${path}`, { recursive: true });
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
writeFileSync('dist/app-config.json', JSON.stringify({
  schemaVersion: 1, appId: 'com.readiz.music', name: 'Readiz Music', version,
  origin: 'https://music.readiz.com', catalog: './musicList.json',
  titles: './blue-archive-ost.json', waveforms: './waveforms.json',
  mediaBase: './', trackCount: tracks.length, revision, dirty,
}, null, 2) + '\n');
console.log(`Built Readiz Music ${version}: ${tracks.length} tracks, ${revision.slice(0, 12)}${dirty ? ' (working tree)' : ''}`);
