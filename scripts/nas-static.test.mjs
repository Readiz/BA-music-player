import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { publishNasStatic, createStaticResolver, staticObject, validateMountRecord, verifyNasStatic } from '../server/nas-static.mjs';
import { publishLibrary, updateLibrary } from '../server/library.mjs';
import { createHandler } from '../server/app.mjs';
import { createApiServer } from '../server/http.mjs';

const bytes = Buffer.from('verified-public-music-data');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const src = './music/ETC/yt-aaaaaaaaaaa.mp3';
const path = src.slice(2);
const file = { src, path, bytes: bytes.length, sha256 };
const revision = 'a'.repeat(40);
async function fixture(t) {
  const base = await mkdtemp('/private/tmp/nas-static-test-');
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'mac');
  const mount = join(base, 'nas-static');
  const settings = { publishMount: mount, serveMount: mount, serveRoot: join(mount, 'music'), requireMount: false };
  const snapshot = { revision, trackCount: 1, bytes: bytes.length, files: [file] };
  await mkdir(join(root, 'objects', sha256.slice(0, 2)), { recursive: true });
  await mkdir(mount);
  await writeFile(join(root, 'objects', sha256.slice(0, 2), sha256), bytes);
  await mkdir(join(root, 'snapshots', revision), { recursive: true });
  await writeFile(join(root, 'snapshots', revision, 'snapshot.json'), JSON.stringify(snapshot));
  await symlink(join(root, 'snapshots', revision), join(root, 'current'));
  return { base, root, settings, snapshot };
}
const request = (uri, method = 'GET') => new Request('http://localhost/_internal/music-static', { headers: { 'X-Forwarded-Uri': uri, 'X-Forwarded-Method': method } });

test('NAS publication reuses immutable objects and verifies the read-side copy', async t => {
  const f = await fixture(t);
  assert.equal((await publishNasStatic(f)).copied, 1);
  assert.equal((await publishNasStatic(f)).copied, 0);
  assert.equal(await verifyNasStatic(f.settings, f.snapshot), 'verified');
  const bucket = join(f.settings.serveMount, 'music/objects', sha256.slice(0, 2));
  assert.equal((await readdir(bucket)).length, 1);
  assert.deepEqual(await readFile(join(f.settings.serveMount, 'music/objects', staticObject(file))), bytes);
  await writeFile(join(bucket, sha256 + '.mp3'), 'corruption');
  await assert.rejects(publishNasStatic(f), /changed/);
});

test('only current catalog paths resolve; private paths and forged objects do not', async t => {
  const f = await fixture(t);
  await publishNasStatic(f);
  const resolve = createStaticResolver(f);
  assert.equal((await resolve(request('/' + path + '?v=1'))).headers.get('X-Readiz-Music-Object'), staticObject(file));
  for (const uri of ['/music/snapshot.json', '/music/../secret.mp3', '/music/%2e%2e/secret.mp3', '/music/ETC/%2f..%2fsecret.mp3', '/music/%', '/objects/' + sha256, '//music/ETC/yt-aaaaaaaaaaa.mp3']) {
    assert.equal((await resolve(request(uri))).status, 404, uri);
  }
  assert.equal((await resolve(request('/' + path, 'POST'))).status, 405);
  const target = join(f.settings.serveMount, 'music/objects', staticObject(file));
  await rm(target);
  const privateFile = join(f.base, 'private.mp3');
  await writeFile(privateFile, bytes);
  await symlink(privateFile, target);
  assert.equal((await resolve(request('/' + path))).status, 503);
});

test('missing publication, changed receipt and lost NAS fail closed', async t => {
  const f = await fixture(t);
  assert.equal((await createStaticResolver(f)(request('/' + path))).status, 503);
  await publishNasStatic(f);
  const resolve = createStaticResolver(f);
  assert.equal((await resolve(request('/' + path))).status, 200);
  await rename(f.settings.serveMount, f.settings.serveMount + '.offline');
  assert.equal((await resolve(request('/' + path))).status, 503);
  await rename(f.settings.serveMount + '.offline', f.settings.serveMount);
  assert.equal((await resolve(request('/' + path))).status, 200);
  await writeFile(join(f.root, 'static-revisions', revision + '.json'), JSON.stringify({ revision, files: [] }));
  assert.equal((await createStaticResolver(f)(request('/' + path))).status, 503);
});

test('mount validation requires the exact SMB source and read-only serving mode', () => {
  const source = '//readiz@192.168.0.5/readiz_static', mount = '/service/serve';
  const good = `${source} on ${mount} (smbfs, nodev, read-only, nobrowse)\n`;
  validateMountRecord(good, mount, source, true);
  for (const wrong of [good.replace('read-only, ', ''), good.replace('readiz_static', 'readiz_private'), good.replace('smbfs', 'apfs'), good.replace('/service/serve', '/service/serve-extra')]) {
    assert.throws(() => validateMountRecord(wrong, mount, source, true));
  }
});

test('failed static publication preserves the existing current catalog; new imports publish NAS objects', async t => {
  const f = await fixture(t);
  const root = join(f.base, 'fresh');
  const options = { root, nasRoot: join(f.base, 'backup'), requireMount: false, static: f.settings };
  const metadata = { 'musicList.json': [src], 'imported-tracks.json': { schemaVersion: 1, tracks: [{ src, title: 'Test', bytes: bytes.length, sha256 }] }, 'waveforms.json': { [src]: { duration: 12, peaks: Array(480).fill(.5) } }, 'blue-archive-ost.json': { titles: {} } };
  const source = join(f.root, 'objects', sha256.slice(0, 2), sha256);
  const first = await publishLibrary({ ...options, metadata, audio: new Map([[src, source]]) });
  const info = JSON.parse(await readFile(join(root, 'current/library-info.json')));
  assert.equal(info.serving, 'nas-via-mac');
  const second = './music/ETC/yt-bbbbbbbbbbb.mp3';
  await assert.rejects(updateLibrary({ ...options, static: { ...f.settings, requireMount: true, source: '//missing/share' } }, async current => {
    current['musicList.json'].push(second);
    current['waveforms.json'][second] = current['waveforms.json'][src];
    current['imported-tracks.json'].tracks.push({ ...current['imported-tracks.json'].tracks[0], src: second });
    return { audio: new Map([[second, source]]) };
  }), /not mounted/);
  assert.equal(JSON.parse(await readFile(join(root, 'current/snapshot.json'))).revision, first.revision);
  const secondBytes = Buffer.from('a newly imported public song');
  const secondHash = createHash('sha256').update(secondBytes).digest('hex');
  const prepared = join(f.base, 'prepared.mp3');
  await writeFile(prepared, secondBytes);
  const next = await updateLibrary(options, async current => {
    current['musicList.json'].push(second);
    current['waveforms.json'][second] = current['waveforms.json'][src];
    current['imported-tracks.json'].tracks.push({ src: second, title: 'Second', bytes: secondBytes.length, sha256: secondHash });
    return { audio: new Map([[second, prepared]]) };
  });
  assert.equal(next.trackCount, 2);
  const resolve = createStaticResolver({ root, settings: f.settings });
  assert.equal((await resolve(request('/' + second.slice(2)))).status, 200);
  const secondFile = { path: second.slice(2), sha256: secondHash, bytes: secondBytes.length };
  assert.deepEqual(await readFile(join(f.settings.serveRoot, 'objects', staticObject(secondFile))), secondBytes);
});

test('the internal resolver is unavailable to non-loopback clients', async () => {
  const handler = createHandler({ resolveStatic: () => new Response(null, { status: 200 }) });
  assert.equal((await handler(request('/' + path), '192.168.0.99')).status, 404);
  assert.equal((await handler(request('/' + path), '127.0.0.1')).status, 200);
});

test('real Caddy keeps audio Range, HEAD, CORS and conditional requests while denying writes and outage reads', { skip: !existsSync('/opt/homebrew/bin/caddy') }, async t => {
  const f = await fixture(t);
  await publishNasStatic(f);
  const api = createApiServer({ handler: createHandler({ resolveStatic: createStaticResolver(f) }), origin: 'http://localhost' });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => { api.closeAllConnections(); api.close(); });
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const production = await readFile(new URL('../ops/music.Caddyfile', import.meta.url), 'utf8');
  const audio = production.slice(production.indexOf('\t@audio path'), production.indexOf('\t@library path'))
    .replace('127.0.0.1:4525', `127.0.0.1:${api.address().port}`)
    .replace('/Users/readiz/.local/share/readiz-static/serve/objects', join(f.settings.serveMount, 'music/objects'));
  const config = join(f.base, 'Caddyfile');
  await writeFile(config, `{\n admin off\n auto_https off\n}\nhttp://127.0.0.1:${port} {\n${audio}\n respond 404\n}\n`);
  const caddy = spawn('/opt/homebrew/bin/caddy', ['run', '--config', config], { stdio: 'ignore' });
  t.after(async () => { caddy.kill(); await new Promise(resolve => caddy.once('exit', resolve)); });
  const url = `http://127.0.0.1:${port}/${path}`;
  let response;
  for (let i = 0; i < 60; i++) {
    try { response = await fetch(url); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(response?.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  const etag = response.headers.get('etag');
  assert.ok(etag);
  const range = await fetch(url, { headers: { Range: 'bytes=3-7', Origin: 'https://readiz.com' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 3-7/${bytes.length}`);
  assert.equal(range.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(3, 8));
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), bytes.length);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await fetch(url, { method: 'OPTIONS' })).status, 204);
  assert.equal((await fetch(url, { method: 'POST', body: 'overwrite' })).status, 405);
  assert.equal((await fetch(url.replace('yt-aaaaaaaaaaa', 'unknown'), { headers: { 'X-Readiz-Music-Object': staticObject(file) } })).status, 404);
  await rename(f.settings.serveMount, f.settings.serveMount + '.offline');
  const unavailable = await fetch(url);
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/);
});
