import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImports, createFileConverter, MAX_BYTES } from '../server/imports.mjs';
import { createHandler } from '../server/app.mjs';
import { createApiServer } from '../server/http.mjs';
import { validateCatalog, waitForPages } from '../server/github-sync.mjs';
const revision = 'a'.repeat(40), origin = 'https://music.example.com';
const bytes = Buffer.from('test original audio');
const id = 'upload-' + createHash('sha256').update(bytes).digest('hex');
const src = `./music/ETC/${id}.mp3`;
const temp = t => { const root = mkdtempSync(join(tmpdir(), 'music-upload-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const request = (body = bytes, name = '한 곡.mp3', headers = {}) => new Request(origin + '/api/uploads?' + new URLSearchParams({ name }), { method: 'POST', headers: { origin, 'content-type': 'application/octet-stream', cookie: 'test=valid', ...headers }, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) });
const convert = async ({ source, title, directory }) => { assert.deepEqual(readFileSync(source), bytes); const path = join(directory, 'audio.mp3'); writeFileSync(path, 'mp3'); return { path, title, duration: 2, bytes: 3 }; };
async function until(store, status) { for (let i = 0; i < 200; i++) { const job = store.list('1')[0]; if (job?.status === status) return job; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Missing ' + status + ': ' + JSON.stringify(store.list('1'))); }

test('upload stays private until Pages verification, deduplicates original bytes, cleans files and survives restart', async t => {
  const root = temp(t); let release;
  const gate = new Promise(resolve => { release = resolve; });
  let conversions = 0;
  const store = createImports({ dataRoot: root, converter: async args => { conversions++; return convert(args); }, synchronize: async ({ video }) => { assert.equal(video.id, id); await gate; return { revision }; } });
  const queued = await store.upload(request(), '1');
  assert.equal(queued.title, '한 곡'); assert.equal(queued.track, undefined);
  await until(store, 'syncing'); assert.equal(store.list('1')[0].track, undefined);
  assert.equal((await store.upload(request(), '1')).id, queued.id);
  release(); const ready = await until(store, 'ready'); assert.equal(ready.track.src, src);
  assert.equal((await store.upload(request(bytes, 'renamed.mp3'), '2')).id, queued.id);
  assert.equal(conversions, 1);
  for (const dir of ['incoming', 'uploads', 'staging', 'media/ETC']) assert.deepEqual(readdirSync(join(root, dir)), []);
  await store.close();
  const reopened = createImports({ dataRoot: root, synchronize: async () => assert.fail('Already published') });
  assert.equal(reopened.list('1')[0].track.src, src); await reopened.close();
});

test('failed publication keeps converted media and upload retry reuses it', async t => {
  const root = temp(t); let fails = true, conversions = 0;
  const store = createImports({ dataRoot: root, converter: async args => { conversions++; return convert(args); }, synchronize: async () => { if (fails) throw new Error('private diagnostic'); return { revision }; } });
  await store.upload(request(), '1'); const failed = await until(store, 'failed');
  assert.equal(failed.track, undefined); assert.doesNotMatch(failed.error, /private/);
  assert.ok(existsSync(join(root, 'media/ETC', id + '.mp3')));
  fails = false; await store.upload(request(), '1'); await until(store, 'ready');
  assert.equal(conversions, 1); assert.deepEqual(readdirSync(join(root, 'uploads')), []); await store.close();
});

test('invalid names, empty/oversized/interrupted streams leave no file or job', async t => {
  const root = temp(t), store = createImports({ dataRoot: root, converter: convert, synchronize: async () => ({ revision }) });
  for (const name of ['../secret.mp3', 'x.m3u', 'x.txt', 'x\u0000.mp3']) await assert.rejects(store.upload(request(bytes, name), '1'));
  await assert.rejects(store.upload(request(Buffer.alloc(0)), '1'));
  await assert.rejects(store.upload(request(bytes, 'x.mp3', { 'content-length': String(MAX_BYTES + 1) }), '1'), error => error.status === 413);
  let n = 0;
  await assert.rejects(store.upload(request(new ReadableStream({ pull(controller) { if (n++ < 101) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close(); } })), '1'), error => error.status === 413);
  await assert.rejects(store.upload(request(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.error(new Error('Disconnected')); } })), '1'));
  assert.deepEqual(store.list('1'), []); assert.deepEqual(readdirSync(join(root, 'incoming')), []); await store.close();
});

test('HTTP upload authenticates before reading, rejects cross-origin and preserves binary bytes', async t => {
  const root = temp(t), store = createImports({ dataRoot: root, converter: convert, synchronize: async () => ({ revision }) });
  const auth = { origin, user: r => r.headers.get('cookie') === 'test=valid' ? { id: '1' } : null, limited: () => false };
  const handler = createHandler({ auth, imports: store });
  for (const [headers, expected] of [[{ cookie: '' }, 401], [{ origin: 'https://evil.test' }, 403], [{ 'content-type': 'text/plain' }, 415]]) assert.equal((await handler(request(bytes, 'x.mp3', headers))).status, expected);
  const server = createApiServer({ handler, origin }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/uploads?name=song.mp3`, { method: 'POST', headers: { origin, cookie: 'test=valid', 'content-type': 'application/octet-stream' }, body: bytes });
    assert.equal(response.status, 202); await until(store, 'ready');
    let sent = 0;
    const large = await fetch(`http://127.0.0.1:${server.address().port}/api/uploads?name=large.mp3`, {
      method: 'POST', duplex: 'half', headers: { origin, cookie: 'test=valid', 'content-type': 'application/octet-stream' },
      body: new ReadableStream({ pull(controller) { if (sent++ < 101) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close(); } }),
    });
    assert.equal(large.status, 413); assert.match((await large.json()).error, /100MB/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
});

test('uploaded identities pass the same Pages catalog, waveform and audio verification', async () => {
  const track = { src, title: 'Uploaded song', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  const files = { 'imported-tracks.json': { schemaVersion: 1, tracks: [track] }, 'musicList.json': [src], 'waveforms.json': { [src]: { duration: 2, peaks: Array(480).fill(0.4) } } };
  validateCatalog(files['imported-tracks.json'], files['musicList.json'], files['waveforms.json']);
  const result = await waitForPages({ revision, videoId: id, client: { raw: async file => Buffer.from(JSON.stringify(files[file])) }, fetcher: async url => new Response(url.pathname.endsWith('.mp3') ? bytes : JSON.stringify(files[url.pathname.split('/').pop()])), pause: () => assert.fail('No propagation delay') });
  assert.equal(result.track.src, src);
});

test('real file conversion accepts WAV and rejects disguised text, playlists, and excess duration', async t => {
  const ffmpeg = process.platform === 'darwin' ? '/opt/homebrew/bin' : '/usr/bin';
  if (!existsSync(join(ffmpeg, 'ffmpeg'))) { t.skip('ffmpeg unavailable'); return; }
  const directory = temp(t), source = join(directory, 'source');
  execFileSync(join(ffmpeg, 'ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-f', 'wav', source]);
  const converter = createFileConverter({ ffmpeg });
  const result = await converter({ source, title: '검증 곡', directory, stage: () => {} });
  assert.ok(result.bytes > 0); assert.ok(result.duration > 0); assert.equal(result.title, '검증 곡');
  for (const text of ['not music', '#EXTM3U\nhttp://127.0.0.1/private\n', 'ffconcat version 1.0\nfile /etc/passwd']) {
    writeFileSync(source, text); await assert.rejects(converter({ source, title: 'x', directory, stage: () => {} }));
  }
  const tooLong = createFileConverter({ execute: async () => JSON.stringify({ format: { duration: 1801 }, streams: [{ codec_type: 'audio' }] }) });
  await assert.rejects(tooLong({ source, title: 'x', directory, stage: () => {} }), /30분/);
});

test('Action preparation publishes an uploaded MP3, safe title and 480 peaks together', async t => {
  const ffmpeg = process.platform === 'darwin' ? '/opt/homebrew/bin' : '/usr/bin';
  if (!existsSync(join(ffmpeg, 'ffmpeg'))) { t.skip('ffmpeg unavailable'); return; }
  const root = temp(t);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(root, 'music-inbox'));
  execFileSync(join(ffmpeg, 'ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.5', join(root, 'music-inbox', id + '.mp3')]);
  writeFileSync(join(root, 'music-inbox', id + '.json'), JSON.stringify({ videoId: id, title: ' 업로드\n곡 ' }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-q']); git(['add', 'music-inbox']); git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture']);
  const source = git(['rev-parse', 'HEAD']);
  for (const [name, data] of [['imported-tracks.json', { schemaVersion: 1, tracks: [] }], ['musicList.json', []], ['waveforms.json', {}]]) writeFileSync(join(root, name), JSON.stringify(data));
  const script = new URL('./prepare-import.mjs', import.meta.url);
  execFileSync(process.execPath, [script.pathname], { cwd: root, env: { ...process.env, MUSIC_FFMPEG: ffmpeg, IMPORT_VIDEO_ID: id, IMPORT_SOURCE_SHA: source } });
  const manifest = JSON.parse(readFileSync(join(root, 'imported-tracks.json')));
  validateCatalog(manifest, JSON.parse(readFileSync(join(root, 'musicList.json'))), JSON.parse(readFileSync(join(root, 'waveforms.json'))));
  assert.equal(manifest.tracks[0].sourceType, 'upload'); assert.equal(manifest.tracks[0].sourceUrl, undefined);
  assert.equal(manifest.tracks[0].title, '업로드곡');
  assert.equal(manifest.tracks[0].sha256, createHash('sha256').update(readFileSync(join(root, src))).digest('hex'));
});
