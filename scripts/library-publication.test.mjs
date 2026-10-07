import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { audioPath, publishLibrary, readMetadata, updateLibrary, verifyLibrary } from '../server/library.mjs';
import { prepareLibraryPublication } from './library-publication.mjs';

const first = './music/ETC/yt-jNQXAC9IVRw.mp3';
const extra = './music/ETC/yt-aaaaaaaaaaa.mp3';
const peaks = { duration: 12, peaks: Array(480).fill(0.5) };
const hash = data => createHash('sha256').update(data).digest('hex');
const track = (src, data, title = '검증한 곡') => ({ src, title, bytes: data.length, sha256: hash(data) });
const metadata = tracks => ({
  'musicList.json': tracks.map(item => item.src),
  'imported-tracks.json': { schemaVersion: 1, tracks },
  'waveforms.json': Object.fromEntries(tracks.map(item => [item.src, peaks])),
  'blue-archive-ost.json': { titles: {} },
});

async function writeMetadata(root, data) {
  await mkdir(root, { recursive: true });
  for (const [name, value] of Object.entries(data)) await writeFile(join(root, name), JSON.stringify(value));
}
async function writeAudio(root, src, data) {
  const path = join(root, audioPath(src));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'music-source-only-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  const seed = join(base, 'seed');
  const options = { root: join(base, 'mac'), nasRoot: join(base, 'nas'), nasMount: base, requireMount: false };
  const original = Buffer.from('original verified audio');
  const added = Buffer.from('online addition');
  const originalTrack = track(first, original);
  await writeMetadata(seed, metadata([originalTrack, track(extra, added, '온라인 추가곡')]));
  await writeAudio(seed, first, original);
  await writeAudio(seed, extra, added);
  const published = await publishLibrary({ ...options, sourceRoot: seed });
  await writeMetadata(repo, metadata([originalTrack]));
  return { base, repo, options, published, original };
}

test('a source-only checkout republishes Mac audio and preserves online additions under the lock', async t => {
  const { repo, options, published } = await fixture(t);
  assert.equal(existsSync(join(repo, 'music')), false);
  const result = await updateLibrary(options, liveMetadata => prepareLibraryPublication({ repo, liveRoot: join(options.root, 'current'), liveMetadata }));
  assert.equal(result.revision, published.revision);
  assert.deepEqual((await readMetadata(join(options.root, 'current')))['musicList.json'], [first, extra]);
  assert.equal((await verifyLibrary(options)).nas, 'verified');
});

test('locally prepared replacements take precedence over Mac copies and retain unrelated online additions', async t => {
  const { repo, options, published } = await fixture(t);
  const replacement = Buffer.from('new curated source audio');
  await writeMetadata(repo, metadata([track(first, replacement, '바꾼 곡명')]));
  await writeAudio(repo, first, replacement);
  const result = await updateLibrary(options, liveMetadata => prepareLibraryPublication({ repo, liveRoot: join(options.root, 'current'), liveMetadata }));
  assert.notEqual(result.revision, published.revision);
  assert.deepEqual(await readFile(join(options.root, 'current', audioPath(first))), replacement);
  assert.deepEqual((await readMetadata(join(options.root, 'current')))['musicList.json'], [first, extra]);
  assert.equal((await verifyLibrary(options)).mac, 'verified');
});

test('missing staged audio and an empty Mac require a NAS restore instead of publishing an incomplete catalog', async t => {
  const { repo } = await fixture(t);
  await assert.rejects(prepareLibraryPublication({ repo }), /library:restore/);
});

async function waveformFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'music-waveform-source-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  await mkdir(join(repo, 'scripts'), { recursive: true });
  await copyFile(new URL('./build-waveforms.py', import.meta.url), join(repo, 'scripts/build-waveforms.py'));
  await writeFile(join(repo, 'musicList.json'), JSON.stringify([first]));
  await writeFile(join(repo, 'waveforms.json'), JSON.stringify({ preserved: true }));
  const library = join(base, 'library');
  return { repo, library, env: { ...process.env, MUSIC_LIBRARY_ROOT: library } };
}

test('waveform maintenance with no audio leaves the previous metadata intact', async t => {
  const { repo, env } = await waveformFixture(t);
  const result = spawnSync('python3', ['scripts/build-waveforms.py'], { cwd: repo, env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /library:restore/);
  assert.deepEqual(JSON.parse(await readFile(join(repo, 'waveforms.json'))), { preserved: true });
});

const mediaToolsAvailable = ['ffmpeg', 'ffprobe'].every(command => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0);
test('waveform maintenance reads the Mac library and preserves the exact catalog URLs', { skip: mediaToolsAvailable ? false : 'ffmpeg/ffprobe unavailable' }, async t => {
  const { repo, library, env } = await waveformFixture(t);
  const path = join(library, 'current', audioPath(first));
  await mkdir(dirname(path), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-y', path]);
  execFileSync('python3', ['scripts/build-waveforms.py'], { cwd: repo, env });
  const waves = JSON.parse(await readFile(join(repo, 'waveforms.json')));
  assert.deepEqual(Object.keys(waves), [first]);
  assert.equal(waves[first].peaks.length, 480);
  assert.ok(waves[first].duration >= 1);
  assert.equal(existsSync(join(repo, 'music')), false);
});
