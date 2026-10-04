import { transformSync } from 'esbuild';
import { readAndroidRelease } from './android-release.mjs';
import { MUSIC_PAGES, validateCatalog } from '../server/github-sync.mjs';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const tracks = JSON.parse(readFileSync('musicList.json', 'utf8'));
const imported = JSON.parse(readFileSync('imported-tracks.json', 'utf8'));
validateCatalog(imported, tracks, JSON.parse(readFileSync('waveforms.json', 'utf8')));
for (const track of imported.tracks) {
  const audio = readFileSync(track.src);
  if (audio.length !== track.bytes || createHash('sha256').update(audio).digest('hex') !== track.sha256) throw new Error('Imported audio checksum mismatch');
}
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
const pages = process.env.MUSIC_BUILD_TARGET === 'pages';
for (const path of ['index.html', 'app-start.html', 'offline.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'assets', 'music', 'musicList.json', 'imported-tracks.json', 'blue-archive-ost.json', 'waveforms.json', 'lastUpdated.txt']) {
  if (path === 'music' && !pages) continue;
  cpSync(path, `dist/${path}`, { recursive: true });
}
// Tizen 5.0 uses Chromium 63. Keep native audio usable without modern syntax.
for (const file of readdirSync('dist/js')) {
  if (!file.endsWith('.js')) continue;
  const path = `dist/js/${file}`;
  const result = transformSync(readFileSync(path, 'utf8'), { target: 'chrome63', charset: 'utf8', legalComments: 'inline' });
  writeFileSync(path, result.code);
}
execFileSync('python3', ['scripts/build-wgt.py'], { stdio: 'inherit' });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
let android;
if (existsSync('output/android/readiz-music.apk')) {
  const release = readAndroidRelease('output/android/readiz-music.apk');
  cpSync('output/android/readiz-music.apk', 'dist/app.apk');
  writeFileSync('dist/android-update.json', JSON.stringify(release, null, 2) + '\n');
  android = { version: release.versionName, versionCode: release.versionCode, package: './app.apk', update: './android-update.json' };
}
writeFileSync('dist/app-config.json', JSON.stringify({
  schemaVersion: 1, appId: 'com.readiz.music', name: 'Readiz Music', version,
  origin: 'https://music.readiz.com', catalog: `${MUSIC_PAGES}musicList.json`,
  titles: `${MUSIC_PAGES}blue-archive-ost.json`, waveforms: `${MUSIC_PAGES}waveforms.json`,
  mediaBase: MUSIC_PAGES, buildTarget: pages ? 'pages' : 'app', android, tv: { preview: './?tv=1', tizenPackage: './app.wgt', tizenChecksum: './app.wgt.sha256', signed: false, appId: 'ReadizMU01.ReadizMusic' }, trackCount: tracks.length, revision, dirty,
}, null, 2) + '\n');
console.log(`Built Readiz Music ${version}: ${tracks.length} tracks, ${revision.slice(0, 12)}${dirty ? ' (working tree)' : ''}`);
