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
  for (const track of tracks) assert.ok(existsSync(`dist/${decodeURI(track)}`), track);
  for (const path of ['.git', 'node_modules', 'android', 'ops', 'scripts', 'package.json', 'README.md']) {
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
