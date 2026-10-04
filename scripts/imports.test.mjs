import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createImports as openImports, createDownloader, youtubeVideo, ImportError } from '../server/imports.mjs';
import { createHandler } from '../server/app.mjs';
const revision = 'a'.repeat(40);
const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const id = 'jNQXAC9IVRw';
const src = './music/ETC/yt-'+id+'.mp3';
const temp = t => { const root = mkdtempSync(join(tmpdir(), 'music-import-test-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const createImports = options => openImports({ synchronize: async () => ({ revision }), ...options });
const fakeDownload = async ({ directory }) => { const path = join(directory, 'audio.mp3'); writeFileSync(path, 'test audio'); return { path, title: '<test> 음악', duration: 12, bytes: 10 }; };
async function until(store, status, owner = '1') {
  for (let i = 0; i < 100; i++) {
    const job = store.list(owner)[0];
    if (job?.status === status) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Worker did not reach '+status);
}
test('YouTube links become one canonical video; arbitrary hosts and playlists are rejected', () => {
  for (const value of [url, `https://youtu.be/${id}?si=x`, `https://music.youtube.com/watch?v=${id}&list=test`, `https://m.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`]) assert.deepEqual(youtubeVideo(value), { id, url });
  for (const value of [null, '', 'file:///tmp/song', 'https://127.0.0.1/watch?v='+id, 'https://youtube.com.evil.test/watch?v='+id, 'https://evil@youtube.com/watch?v='+id, 'https://youtube.com:444/watch?v='+id, 'https://youtube.com/playlist?list=x', 'https://youtu.be/../../etc/passwd', 'https://youtu.be/'+id+'/extra', '--exec=bad']) assert.throws(() => youtubeVideo(value), ImportError);
});

test('audio remains pending until GitHub and deployment finish; duplicate/restart is idempotent', async t => {
  const root = temp(t);
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createImports({ dataRoot: root, downloader: async args => { calls++; return fakeDownload(args); }, synchronize: async () => { await gate; return { revision }; } });
  const first = store.enqueue(url, '1');
  assert.equal(store.enqueue(url, '1').id, first.id);
  const pending = await until(store, 'syncing');
  assert.equal(pending.track, undefined);
  assert.throws(() => store.enqueue(url, '2'), /다른 사용자/);
  assert.ok(existsSync(join(root, 'media/ETC/yt-'+id+'.mp3')));
  release();
  const ready = await until(store, 'ready');
  assert.equal(ready.track.src, src);
  assert.equal(calls, 1);
  assert.equal(store.enqueue(url, '2').id, first.id);
  assert.deepEqual(store.list('2'), []);
  assert.equal(existsSync(join(root, 'media/ETC/yt-'+id+'.mp3')), false);
  assert.deepEqual(readdirSync(join(root, 'staging')), []);
  await store.close();
  const reopened = createImports({ dataRoot: root, downloader: () => { throw new Error('Do not redownload'); } });
  assert.equal(reopened.list('1')[0].status, 'ready');
  await reopened.close();
});
test('failed sync retains audio for retry and never returns a playable track', async t => {
  const root = temp(t); let fail = true, downloads = 0;
  const store = createImports({ dataRoot: root, downloader: async args => { downloads++; return fakeDownload(args); }, synchronize: async ({ saveCheckpoint, checkpoint }) => {
    assert.deepEqual(checkpoint, {});
    saveCheckpoint({ source: revision, runId: 42 });
    if (fail) throw new Error('private upstream diagnostic');
    return { revision };
  } });
  const first = store.enqueue(url, '1');
  const failed = await until(store, 'failed');
  assert.equal(failed.track, undefined); assert.match(failed.error, /동기화/); assert.doesNotMatch(failed.error, /private/);
  assert.ok(existsSync(join(root, 'media/ETC/yt-'+id+'.mp3')));
  fail = false;
  assert.equal(store.enqueue(url, '1').id, first.id);
  await until(store, 'ready'); assert.equal(downloads, 1);
  await store.close();
});
test('interrupted sync resumes its GitHub checkpoint automatically without another download', async t => {
  const root = temp(t);
  const first = createImports({ dataRoot: root, downloader: fakeDownload, synchronize: ({ saveCheckpoint, signal }) => {
    saveCheckpoint({ source: revision, runId: 42 });
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
  } });
  first.enqueue(url, '1'); await until(first, 'syncing'); await first.close();
  let recovered = false;
  const second = createImports({ dataRoot: root, downloader: () => { throw new Error('Do not redownload'); }, synchronize: async ({ checkpoint }) => {
    assert.deepEqual(checkpoint, { source: revision, runId: 42 }); recovered = true; return { revision };
  } });
  await until(second, 'ready'); assert.equal(recovered, true); await second.close();
});
test('legacy ready local audio is migrated and hidden until synchronization finishes', async t => {
  const root = temp(t);
  const old = createImports({ dataRoot: root, downloader: fakeDownload, synchronize: async () => { throw new Error('keep cached audio'); } });
  old.enqueue(url, '1'); await until(old, 'failed'); await old.close();
  const db = new DatabaseSync(join(root, 'imports.sqlite'));
  db.exec("UPDATE imports SET status='ready'; ALTER TABLE imports DROP COLUMN sync_state; ALTER TABLE imports DROP COLUMN sync_revision;"); db.close();
  let release; const gate = new Promise(resolve => { release = resolve; });
  const upgraded = createImports({ dataRoot: root, downloader: () => { throw new Error('Do not redownload'); }, synchronize: async () => { await gate; return { revision }; } });
  assert.equal(upgraded.list('1')[0].track, undefined);
  await until(upgraded, 'syncing'); release(); await until(upgraded, 'ready'); await upgraded.close();
});
test('public APIs redirect to Pages and retain import authentication boundaries', async t => {
  const root = temp(t);
  writeFileSync(join(root,'musicList.json'), JSON.stringify(['./music/ETC/original.mp3']));
  writeFileSync(join(root,'waveforms.json'), JSON.stringify({ original: { peaks: [0.1] } }));
  writeFileSync(join(root,'imported-tracks.json'), JSON.stringify({ schemaVersion: 1, tracks: [] }));
  let release; const gate = new Promise(resolve => { release = resolve; });
  const imports = createImports({ dataRoot: join(root,'data'), downloader: fakeDownload, synchronize: async () => { await gate; return { revision }; } });
  const auth = { origin: 'https://music.example.com', user: request => request.headers.get('cookie') === 'test=valid' ? { id: '1' } : null, limited: () => false };
  const handler = createHandler({ auth, imports, staticRoot: root });
  const request = (path, method = 'GET', headers = {}, body) => new Request(auth.origin+path, { method, headers, ...(body === undefined ? {} : {body}) });
  for (const method of ['GET','POST']) { const r = await handler(request('/api/imports',method)); assert.equal(r.status,401); assert.equal(r.headers.get('cache-control'),'private, no-store'); }
  const good = { cookie:'test=valid',origin:auth.origin,'content-type':'application/json' };
  for (const origin of ['', 'https://evil.example']) assert.equal((await handler(request('/api/imports','POST',{...good,origin},JSON.stringify({url})))).status,403);
  assert.equal((await handler(request('/api/imports','POST',{...good,'content-type':'text/plain'},JSON.stringify({url})))).status,415);
  assert.equal((await handler(request('/api/imports','POST',good,'x'.repeat(4097)))).status,413);
  assert.equal((await handler(request('/api/imports','POST',good,'no json'))).status,400);
  assert.equal((await handler(request('/api/imports','POST',good,JSON.stringify({url:'https://localhost/'})))).status,400);
  assert.equal((await handler(request('/api/imports','POST',good,JSON.stringify({url})))).status,202);
  await until(imports, 'syncing');
  for (const [path, target] of [['/musicList.json','musicList.json'],['/waveforms.json','waveforms.json'],['/api/library','imported-tracks.json']]) {
    const response = await handler(request(path));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), 'https://blog.readiz.com/BA-music-player/'+target);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  }
  assert.equal(imports.list('1')[0].track, undefined);
  release(); await until(imports, 'ready');
  await imports.close();
});
test('downloader uses bounded shell-free options, verifies metadata and emits MP3 only', async t => {
  const directory = temp(t); const calls = [], stages = [];
  const download = createDownloader({ execute: async (cmd,args,opts) => {
    if (cmd.endsWith('/ffmpeg')) { writeFileSync(join(directory,'audio.mp3'),'audio'); return ''; }
    calls.push(args); assert.equal(args.at(-1),url); assert.equal(args.at(-2),'--');
    assert.ok(args.includes('--ignore-config')); assert.ok(args.includes('--no-playlist')); assert.ok(args.includes('--no-plugin-dirs'));
    if (args.includes('--dump-single-json')) return JSON.stringify({ id, title:'A song', duration:12 });
    writeFileSync(join(directory,'source.webm'),'audio'); return '';
  } });
  const result = await download({ video:youtubeVideo(url),directory,stage:value=>stages.push(value) });
  assert.equal(result.title,'A song'); assert.deepEqual(stages,['downloading','converting']);
  assert.ok(calls[1].includes('--max-filesize')); assert.ok(calls[1].includes('--match-filters'));
  for (const metadata of [{id,duration:1801},{id,duration:10,is_live:true},{id:'wrong',duration:10},{id,duration:null}]) {
    const invalid = createDownloader({ execute: async () => JSON.stringify(metadata) });
    await assert.rejects(invalid({video:youtubeVideo(url),directory,stage:()=>{}}),ImportError);
  }
});
