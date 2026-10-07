import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateCatalog } from '../server/catalog.mjs';
const id = 'jNQXAC9IVRw';
const audio = Buffer.from('verified audio');
const track = { src: `./music/ETC/yt-${id}.mp3`, title: '정리된 곡명', sha256: createHash('sha256').update(audio).digest('hex'), bytes: audio.length };
const manifest = { schemaVersion: 1, tracks: [track] };
const catalog = ['./music/original.mp3', track.src];
const peaks = { [track.src]: { duration: 12, peaks: Array(480).fill(0.5) } };

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

