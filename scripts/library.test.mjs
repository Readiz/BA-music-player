import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { audioPath, assertNasMounted, publishLibrary, readMetadata, restoreLibrary, updateLibrary, verifyLibrary } from '../server/library.mjs';
import { createLocalSync, verifyPublishedTrack } from '../server/local-sync.mjs';

const src = './music/ETC/yt-jNQXAC9IVRw.mp3';
const bytes = Buffer.from('verified source audio');
const hash = value => createHash('sha256').update(value).digest('hex');
const peaks = { duration: 12, peaks: Array(480).fill(0.5) };
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'music-library-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const options = { root: join(base, 'mac'), nasRoot: join(base, 'nas'), nasMount: base, requireMount: false, sourceRoot: join(base, 'source') };
  const track = { src, title: '검증된 곡', sha256: hash(bytes), bytes: bytes.length };
  const metadata = { 'musicList.json': [src], 'imported-tracks.json': { schemaVersion: 1, tracks: [track] }, 'waveforms.json': { [src]: peaks }, 'blue-archive-ost.json': { titles: {} } };
  await mkdir(join(options.sourceRoot, 'music/ETC'), { recursive: true });
  await writeFile(join(options.sourceRoot, audioPath(src)), bytes);
  for (const [name, data] of Object.entries(metadata)) await writeFile(join(options.sourceRoot, name), JSON.stringify(data));
  return { options, track, metadata, base };
}

test('publication verifies both copies and points catalogs at the same immutable audio', async t => {
  const { options } = await fixture(t);
  const stages = [];
  const result = await publishLibrary({ ...options, onProgress: stage => stages.push(stage) });
  assert.deepEqual(stages, ['testing', 'backing-up', 'publishing']);
  assert.equal(result.trackCount, 1);
  assert.match(result.revision, /^[a-f0-9]{40}$/);
  assert.equal((await readFile(join(options.root, 'current', audioPath(src)))).toString(), bytes.toString());
  assert.equal((await verifyLibrary(options)).nas, 'verified');
  const snapshot = JSON.parse(await readFile(join(options.root, 'current/snapshot.json')));
  const object = join(options.root, 'objects', snapshot.files[0].sha256.slice(0, 2), snapshot.files[0].sha256);
  assert.equal((await stat(object)).ino, (await stat(join(options.root, 'current', audioPath(src)))).ino);
  const published = JSON.parse(await readFile(join(options.root, 'current/library-info.json')));
  assert.equal(published.backup, 'nas');
  assert.doesNotMatch(JSON.stringify(published), new RegExp(options.nasRoot));
});

test('NAS outage never creates a local backup stand-in or replaces the good library', async t => {
  const { options } = await fixture(t);
  await publishLibrary(options);
  const before = await realpath(join(options.root, 'current'));
  const unmounted = { ...options, requireMount: true };
  await assert.rejects(assertNasMounted(unmounted), /not mounted/);
  await assert.rejects(publishLibrary(unmounted), /not mounted/);
  assert.equal(await realpath(join(options.root, 'current')), before);
});

test('source and NAS corruption prevent publication and retain the prior catalog', async t => {
  const { options } = await fixture(t);
  await publishLibrary(options);
  const before = await realpath(join(options.root, 'current'));
  await writeFile(join(options.sourceRoot, audioPath(src)), 'broken');
  await assert.rejects(publishLibrary(options), /does not match/);
  assert.equal(await realpath(join(options.root, 'current')), before);
  await writeFile(join(options.sourceRoot, audioPath(src)), bytes);
  const object = join(options.nasRoot, 'objects', hash(bytes).slice(0, 2), hash(bytes));
  await writeFile(object, 'corrupt stored backup');
  await assert.rejects(publishLibrary(options), /checksum mismatch/);
  assert.equal(await realpath(join(options.root, 'current')), before);
});

test('NAS metadata corruption is caught even when a snapshot already exists', async t => {
  const { options } = await fixture(t);
  const result = await publishLibrary(options);
  const path = join(options.nasRoot, 'snapshots', result.revision, 'blue-archive-ost.json');
  await writeFile(path, JSON.stringify({ titles: { 1: 'changed' } }));
  await assert.rejects(publishLibrary(options), /catalog verification failed/);
});

test('new tracks preserve old catalogs and objects, and retries do not duplicate files', async t => {
  const { options, metadata } = await fixture(t);
  const first = await publishLibrary(options);
  const src2 = './music/ETC/yt-aaaaaaaaaaa.mp3';
  const second = Buffer.from('another song');
  const path = join(options.sourceRoot, 'second.mp3');
  await writeFile(path, second);
  const result = await updateLibrary(options, async current => {
    current['musicList.json'].push(src2);
    current['imported-tracks.json'].tracks.push({ src: src2, title: '두 번째 곡', bytes: second.length, sha256: hash(second) });
    current['waveforms.json'][src2] = peaks;
    return { audio: new Map([[src2, path]]) };
  });
  assert.equal(result.trackCount, 2);
  assert.deepEqual((await readMetadata(join(options.root, 'snapshots', first.revision)))['musicList.json'], metadata['musicList.json']);
  const retry = await updateLibrary(options, async () => ({}));
  assert.equal(retry.revision, result.revision);
  assert.equal((await verifyLibrary(options)).trackCount, 2);
  assert.equal((await readdir(join(options.nasRoot, 'snapshots'))).length, 2);
});

test('an empty Mac can restore all audio and catalogs using only the NAS backup', async t => {
  const { options, base } = await fixture(t);
  const published = await publishLibrary(options);
  const restore = { ...options, root: join(base, 'restored'), sourceRoot: undefined };
  const result = await restoreLibrary(restore);
  assert.equal(result.revision, published.revision);
  assert.equal((await verifyLibrary(restore)).trackCount, 1);
  assert.deepEqual(await readFile(join(restore.root, 'current', audioPath(src))), bytes);
});

test('unsafe paths and concurrent writers cannot change a published library', async t => {
  for (const path of ['../music/a.mp3', './music/../secret.mp3', './music/%2e%2e/secret.mp3', './music/ETC/a.mp3?secret', './music/ETC/a\\b.mp3']) assert.throws(() => audioPath(path));
  const { options } = await fixture(t);
  await publishLibrary(options);
  await writeFile(join(options.root, '.publish.lock'), JSON.stringify({ pid: process.pid }));
  await assert.rejects(publishLibrary(options), /already running/);
});

test('completion requires matching public metadata, full audio checksum and seekable ranges', async t => {
  const { track, metadata } = await fixture(t);
  const request = async (url, options) => {
    assert.equal(url.origin, 'https://music.readiz.com');
    const path = decodeURIComponent(url.pathname.slice(1));
    if (path.startsWith('music/')) {
      if (options.headers?.Range) return new Response(bytes, { status: 206, headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` } });
      return new Response(bytes);
    }
    return new Response(JSON.stringify(metadata[path]));
  };
  assert.equal((await verifyPublishedTrack({ track, waveform: peaks, fetcher: request, pause: async () => {} })).title, track.title);
  await assert.rejects(verifyPublishedTrack({ track, waveform: peaks, pause: async () => {}, fetcher: async (url, options) => {
    if (options.headers?.Range) return new Response(bytes);
    return request(url, options);
  } }), /range is unavailable/);
  await assert.rejects(verifyPublishedTrack({ track, waveform: peaks, pause: async () => {}, fetcher: async (url, options) => {
    if (url.pathname.endsWith('.mp3')) return new Response('corrupt audio');
    return request(url, options);
  } }), /checksum mismatch/);
});

const ffmpeg = process.env.MUSIC_FFMPEG || (process.platform === 'darwin' ? '/opt/homebrew/bin' : '/usr/bin');
test('the real local importer prepares tags and waveform, verifies the backup and retains input on NAS failure', { skip: !existsSync(join(ffmpeg, 'ffmpeg')) }, async t => {
  const { options, base } = await fixture(t);
  await publishLibrary(options);
  const input = join(base, 'input.mp3');
  execFileSync(join(ffmpeg, 'ffmpeg'), ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-codec:a', 'libmp3lame', '-b:a', '192k', input]);
  const args = { video: { id: 'bbbbbbbbbbb' }, result: { path: input, title: '검증용 음악' } };
  const stages = [];
  const synchronize = createLocalSync({ settings: options, ffmpeg, verify: async ({ track, waveform }) => {
    assert.equal((await verifyLibrary(options)).trackCount, 2);
    assert.equal(waveform.peaks.length, 480);
    assert.ok(waveform.duration > 0);
    const metadata = await readMetadata(join(options.root, 'current'));
    assert.equal(metadata['imported-tracks.json'].tracks.find(item => item.src === track.src).sha256, track.sha256);
    return track;
  } });
  const result = await synchronize({ ...args, onProgress: stage => stages.push(stage) });
  assert.deepEqual(stages, ['preparing', 'waveform', 'testing', 'backing-up', 'publishing', 'verifying']);
  assert.equal(result.track.title, args.result.title);
  const before = await realpath(join(options.root, 'current'));
  const unavailable = createLocalSync({ settings: { ...options, requireMount: true }, ffmpeg, verify: () => assert.fail('Must not verify an unbacked track') });
  await assert.rejects(unavailable({ ...args, video: { id: 'ccccccccccc' } }), /백업이나 공개/);
  assert.equal(await realpath(join(options.root, 'current')), before);
  assert.equal(existsSync(input), true);
});
