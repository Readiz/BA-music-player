import { transformSync } from 'esbuild';
import { readAndroidRelease } from './android-release.mjs';
import { MUSIC_LIBRARY } from '../server/catalog.mjs';
import { readMetadata } from '../server/library.mjs';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
// Audio integrity belongs to Mac/NAS publication; code builds validate metadata only.
const metadata = await readMetadata(root);
const tracks = metadata['musicList.json'];
// Explicit publication list: never serve the repository, dependencies or native build output.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
const pages = process.env.MUSIC_BUILD_TARGET === 'pages';
for (const path of ['index.html', 'app-start.html', 'offline.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'assets', 'musicList.json', 'imported-tracks.json', 'blue-archive-ost.json', 'waveforms.json', 'lastUpdated.txt']) {
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
  origin: 'https://music.readiz.com', catalog: `${MUSIC_LIBRARY}musicList.json`,
  titles: `${MUSIC_LIBRARY}blue-archive-ost.json`, waveforms: `${MUSIC_LIBRARY}waveforms.json`,
  mediaBase: MUSIC_LIBRARY, buildTarget: pages ? 'pages' : 'app', android, tv: { preview: './?tv=1', tizenPackage: './app.wgt', tizenChecksum: './app.wgt.sha256', signed: false, appId: 'ReadizMU01.ReadizMusic' }, trackCount: tracks.length, revision, dirty,
}, null, 2) + '\n');
console.log(`Built Readiz Music ${version}: ${tracks.length} tracks, ${revision.slice(0, 12)}${dirty ? ' (working tree)' : ''}`);
