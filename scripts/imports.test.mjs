import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createImports, createDownloader, youtubeVideo, ImportError } from '../server/imports.mjs';
import { createHandler } from '../server/app.mjs';
const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const id = 'jNQXAC9IVRw';
const temp = t => { const root = mkdtempSync(join(tmpdir(), 'music-import-test-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
async function done(store, owner = '1') {
  for (let i = 0; i < 100; i++) {
    const job = store.list(owner)[0];
    if (job && ['ready', 'failed'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Worker did not finish');
}
const fakeDownload = async ({ directory }) => { const path = join(directory, 'audio.mp3'); writeFileSync(path, 'test audio'); return { path, title: '<test> 음악', duration: 12, bytes: 10 }; };
test('YouTube links become one canonical video; arbitrary hosts and playlists are rejected', () => {
  for (const value of [url, `https://youtu.be/${id}?si=x`, `https://music.youtube.com/watch?v=${id}&list=test`, `https://m.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`]) assert.deepEqual(youtubeVideo(value), { id, url });
  for (const value of [null, '', 'file:///tmp/song', 'https://127.0.0.1/watch?v='+id, 'https://youtube.com.evil.test/watch?v='+id, 'https://evil@youtube.com/watch?v='+id, 'https://youtube.com:444/watch?v='+id, 'https://youtube.com/playlist?list=x', 'https://youtu.be/../../etc/passwd', 'https://youtu.be/'+id+'/extra', '--exec=bad']) assert.throws(() => youtubeVideo(value), ImportError);
});
test('only completed audio is published; duplicates coalesce; restart preserves tracks', async t => {
  const root = temp(t);
  let release; let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createImports({ dataRoot: root, downloader: async args => { calls++; await gate; return fakeDownload(args); } });
  const first = store.enqueue(url, '1');
  assert.equal(store.enqueue(url, '1').id, first.id);
  assert.throws(() => store.enqueue(url, '2'), /다른 사용자/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.catalog(), []);
  release();
  const job = await done(store);
  assert.equal(job.status, 'ready'); assert.equal(calls, 1);
  assert.equal(store.catalog()[0].title, '<test> 음악');
  assert.equal(store.enqueue(url, '2').id, first.id);
  assert.deepEqual(store.list('2'), []);
  assert.ok(existsSync(join(root, 'media/ETC/yt-'+id+'.mp3')));
  assert.deepEqual(readdirSync(join(root, 'staging')), []);
  await store.close();
  const reopened = createImports({ dataRoot: root, downloader: fakeDownload });
  assert.equal(reopened.catalog().length, 1);
  await reopened.close();
});
test('failed/partial downloads stay private and can be retried; interruption is recovered', async t => {
  const root = temp(t); let fail = true;
  const store = createImports({ dataRoot: root, downloader: async args => { if (fail) { writeFileSync(join(args.directory, 'audio.mp3.part'), 'partial'); throw new Error('signed secret url'); } return fakeDownload(args); } });
  const first = store.enqueue(url, '1');
  const failed = await done(store); assert.equal(failed.status, 'failed'); assert.doesNotMatch(failed.error, /secret/);
  assert.deepEqual(store.catalog(), []); assert.deepEqual(readdirSync(join(root, 'staging')), []);
  fail = false; assert.equal(store.enqueue(url, '1').id, first.id); assert.equal((await done(store)).status, 'ready');
  await store.close();
  const interrupted = createImports({ dataRoot: join(root, 'other'), downloader: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')))) });
  interrupted.enqueue(url, '1'); await new Promise(resolve => setImmediate(resolve)); await interrupted.close();
  const recovered = createImports({ dataRoot: join(root, 'other'), downloader: fakeDownload });
  assert.equal(recovered.list('1')[0].status, 'failed'); recovered.enqueue(url, '1'); assert.equal((await done(recovered)).status, 'ready'); await recovered.close();
});
test('API keeps catalog public but rejects missing auth, cross-origin and invalid requests before invoking worker', async t => {
  const root = temp(t); writeFileSync(join(root,'musicList.json'), JSON.stringify(['./music/ETC/original.mp3']));
  let calls = 0;
  const imports = createImports({ dataRoot: join(root,'data'), downloader: async args => { calls++; return fakeDownload(args); } });
  t.after(() => imports.close());
  const auth = { origin: 'https://music.example.com', user: request => request.headers.get('cookie') === 'test=valid' ? { id: '1' } : null, limited: () => false };
  const handler = createHandler({ auth, imports, staticRoot: root });
  const request = (path, method = 'GET', headers = {}, body) => new Request(auth.origin+path, { method, headers, ...(body === undefined ? {} : {body}) });
  assert.equal((await handler(request('/musicList.json'))).status, 200);
  assert.equal((await handler(request('/api/library'))).status, 200);
  for (const method of ['GET','POST']) { const r = await handler(request('/api/imports',method)); assert.equal(r.status,401); assert.equal(r.headers.get('cache-control'),'private, no-store'); }
  const good = { cookie:'test=valid',origin:auth.origin,'content-type':'application/json' };
  for (const origin of ['', 'https://evil.example']) assert.equal((await handler(request('/api/imports','POST',{...good,origin},JSON.stringify({url})))).status,403);
  assert.equal((await handler(request('/api/imports','POST',{...good,'content-type':'text/plain'},JSON.stringify({url})))).status,415);
  assert.equal((await handler(request('/api/imports','POST',good,'x'.repeat(4097)))).status,413);
  assert.equal((await handler(request('/api/imports','POST',good,'no json'))).status,400);
  assert.equal((await handler(request('/api/imports','POST',good,JSON.stringify({url:'https://localhost/'})))).status,400);
  assert.equal(calls,0);
  assert.equal((await handler(request('/api/imports','POST',good,JSON.stringify({url})))).status,202);
  await done(imports); assert.equal(calls,1);
  const list = await (await handler(request('/musicList.json'))).json(); assert.equal(list.length,2);
  const catalog = await (await handler(request('/api/library'))).json(); assert.equal(catalog.tracks.length,1); assert.doesNotMatch(JSON.stringify(catalog), /owner|created_at|video_id/);
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
