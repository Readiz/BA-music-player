import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGithubSync, waitForPages, validateCatalog } from '../server/github-sync.mjs';

const revision = 'a'.repeat(40), source = 'b'.repeat(40), id = 'jNQXAC9IVRw';
const audio = Buffer.from('verified audio');
const track = { src: `./music/ETC/yt-${id}.mp3`, title: '정리된 곡명', sha256: createHash('sha256').update(audio).digest('hex'), bytes: audio.length };
const manifest = { schemaVersion: 1, tracks: [track] };
const catalog = ['./music/original.mp3', track.src];
const peaks = { [track.src]: { duration: 12, peaks: Array(480).fill(0.5) } };
const temp = t => { const root = mkdtempSync(join(tmpdir(), 'music-sync-test-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };

test('completion waits for actual Pages catalogs and audio, including CDN propagation and checksum checks', async () => {
  const files = { 'imported-tracks.json': manifest, 'musicList.json': catalog, 'waveforms.json': peaks };
  const client = { raw: async path => Buffer.from(JSON.stringify(files[path])) };
  let round = 0;
  const requests = [];
  const result = await waitForPages({ client, revision, videoId: id, pause: async () => { round++; }, fetcher: async url => {
    requests.push(url.href);
    assert.equal(url.origin, 'https://blog.readiz.com');
    assert.ok(url.pathname.startsWith('/BA-music-player/'));
    const file = url.pathname.slice('/BA-music-player/'.length);
    if (file.endsWith('.mp3')) return new Response(round === 1 ? Buffer.from('bad audio') : audio);
    if (round === 0 && file === 'imported-tracks.json') return new Response(JSON.stringify({ schemaVersion: 1, tracks: [] }));
    return new Response(JSON.stringify(files[file]));
  } });
  assert.equal(round, 2);
  assert.equal(result.revision, revision);
  assert.equal(result.track.src, track.src);
  assert.ok(requests.every(url => url.includes('sync=')));
});

test('catalog validation rejects traversal, checksum metadata omissions, duplicates and missing peaks', () => {
  validateCatalog(manifest, catalog, peaks);
  for (const invalid of [{ ...track, src: '../../secret' }, { ...track, sha256: '' }, { ...track, bytes: 200 * 1024 ** 2 }]) assert.throws(() => validateCatalog({ schemaVersion: 1, tracks: [invalid] }, catalog, peaks));
  assert.throws(() => validateCatalog({ schemaVersion: 1, tracks: [track, track] }, catalog, peaks));
  assert.throws(() => validateCatalog(manifest, catalog, {}));
});

test('curated Touhou tracks coexist with ETC imports without accepting arbitrary folders', () => {
  const touhou = { ...track, src: `./music/동방 어레인지/yt-${id}.mp3`, folder: '동방 어레인지', artist: 'IOSYS' };
  const original = { ...track, src: `./music/th original/yt-${id}.mp3`, folder: 'th original', artist: 'ZUN / 上海アリス幻樂団' };
  validateCatalog({ schemaVersion: 1, tracks: [track, touhou, original] }, [...catalog, touhou.src, original.src], { ...peaks, [touhou.src]: peaks[track.src], [original.src]: peaks[track.src] });
  for (const folder of ['../ETC', '동방 어레인지/../../ETC', 'th original/../../ETC', 'th original/extra', 'unknown', '%2e%2e']) {
    const invalid = { ...touhou, src: `./music/${folder}/yt-${id}.mp3` };
    assert.throws(() => validateCatalog({ schemaVersion: 1, tracks: [invalid] }, [invalid.src], { [invalid.src]: peaks[track.src] }));
  }
});

test('GitHub pipeline uploads only public media metadata, checkpoints the Action and installs only after success', async t => {
  const root = temp(t), path = join(root, 'audio.mp3'); writeFileSync(path, audio);
  const requests = [], checkpoints = [], progress = [];
  let polls = 0, installed = false;
  const client = { api: async (method, endpoint, body) => {
    requests.push({ method, endpoint, body });
    if (endpoint === 'git/ref/heads/master') return { object: { sha: revision } };
    if (endpoint.startsWith('git/commits/') && method === 'GET') return { tree: { sha: revision } };
    if (endpoint === 'git/blobs' || endpoint === 'git/trees') return { sha: revision };
    if (endpoint === 'git/commits') return { sha: source };
    if (endpoint.includes('/runs?')) return { workflow_runs: [] };
    if (endpoint.endsWith('/dispatches')) return { workflow_run_id: 42 };
    if (endpoint === 'actions/runs/42/jobs') return { jobs: [{ steps: [{ name: polls === 1 ? 'Prepare audio, title, catalog and waveform' : 'Publish GitHub Pages library', status: 'in_progress' }] }] };
    if (endpoint === 'actions/runs/42') { polls++; return polls < 3 ? { status: 'in_progress' } : { status: 'completed', conclusion: 'success' }; }
    return {};
  } };
  const sync = createGithubSync({ client, pause: async () => { assert.equal(installed, false); }, publish: async args => { installed = true; assert.equal(args.revision, revision); return { revision, track }; } });
  await sync({ video: { id }, result: { path, title: track.title }, saveCheckpoint: state => checkpoints.push(state), onProgress: stage => progress.push(stage) });
  assert.equal(installed, true);
  assert.deepEqual(progress, ['uploading', 'waiting', 'waveform', 'publishing', 'verifying']);
  assert.deepEqual(checkpoints, [{ source }, { source, runId: 42 }]);
  const tree = requests.find(request => request.endpoint === 'git/trees').body.tree;
  assert.equal(tree.length, 2); assert.deepEqual(JSON.parse(tree[1].content), { videoId: id, title: track.title });
  assert.ok(requests.some(request => request.method === 'DELETE'));
});

test('restart resumes an existing Action without publishing again; failed Action never installs', async () => {
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    let installed = false;
    const calls = [];
    const sync = createGithubSync({ client: { api: async (method, endpoint) => {
      calls.push(endpoint);
      if (endpoint === 'actions/runs/42') return { status: 'completed', conclusion };
      if (endpoint === 'git/ref/heads/master') return { object: { sha: revision } };
      return {};
    } }, publish: async () => { installed = true; return { revision }; } });
    const args = { video: { id }, result: {}, checkpoint: { source, runId: 42 }, saveCheckpoint: () => assert.fail('Checkpoint already durable') };
    if (conclusion === 'success') await sync(args); else await assert.rejects(sync(args), /synchronization failed/);
    assert.equal(installed, conclusion === 'success'); assert.equal(calls.includes('git/blobs'), false);
  }
});
