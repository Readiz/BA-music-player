import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
test('publication contains every catalog track and only public runtime files', () => {
  const tracks = JSON.parse(readFileSync('dist/musicList.json', 'utf8'));
  const config = JSON.parse(readFileSync('dist/app-config.json', 'utf8'));
  assert.equal(config.trackCount, tracks.length);
  assert.equal(config.appId, 'com.readiz.music');
  for (const track of tracks) assert.equal(existsSync(`dist/${decodeURI(track)}`), process.env.MUSIC_BUILD_TARGET === 'pages', track);
  assert.equal(config.mediaBase, 'https://blog.readiz.com/BA-music-player/');
  for (const path of ['.git', 'node_modules', 'android', 'ops', 'scripts', 'server', 'package.json', 'README.md']) {
    assert.equal(existsSync(`dist/${path}`), false, `Private/build file published: ${path}`);
  }
});
test('standalone runtime uses local dependencies and install metadata', () => {
  const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, './');
  for (const icon of manifest.icons) assert.ok(existsSync(`dist/${icon.src}`));
  const html = readFileSync('dist/index.html', 'utf8');
  assert.doesNotMatch(html, /<iframe|<script[^>]*>\s*[^<\s]/i);
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"?#]+)/g)) {
    assert.ok(existsSync(`dist/${match[1]}`), match[1]);
  }
  for (const css of readdirSync('dist/css')) {
    assert.doesNotMatch(readFileSync(`dist/css/${css}`, 'utf8'), /@import.*https?:/);
  }
});
test('Tizen archive is reproducible and contains only the independent launcher', () => {
  const first = readFileSync('dist/app.wgt');
  execFileSync('python3', ['scripts/build-wgt.py']);
  assert.deepEqual(readFileSync('dist/app.wgt'), first);
  const report = JSON.parse(execFileSync('python3', ['-c', `import zipfile,json,xml.etree.ElementTree as ET
with zipfile.ZipFile('dist/app.wgt') as z:
 assert z.testzip() is None
 c=ET.fromstring(z.read('config.xml'))
 app=c.find('{http://tizen.org/ns/widgets}application')
 print(json.dumps({'files':sorted(z.namelist()),'app':app.attrib,'url':z.read('app-url.js').decode(),'version':c.attrib['version']}))`], { encoding: 'utf8' }));
  assert.deepEqual(report.files, ['app-url.js','config.xml','icon.png','index.html','launcher.css','launcher.js']);
  assert.equal(report.app.id, 'ReadizMU01.ReadizMusic');
  assert.equal(report.app.required_version, '5.0');
  assert.equal(report.version, '0.1.0');
  assert.match(report.url, /https:\/\/music\.readiz\.com\//);
  assert.ok(existsSync('dist/app-start.html'));
});
