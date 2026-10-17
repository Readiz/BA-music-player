import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const window = {};
runInNewContext(readFileSync(new URL('../js/track-selection.js', import.meta.url), 'utf8'), { window });
const create = window.BAMusicTrackSelection;
const catalog = () => [
  { folder: 'A', src: 'a1' }, { folder: 'A', src: 'a2' },
  { folder: 'B', src: 'b1' }, { folder: 'B', src: 'b2' },
];
const ids = (selection, tracks, albums) => Array.from(selection.indices(albums), i => tracks[i].src);
test('subsets survive album toggles, reload and reordered catalogs using stable IDs', () => {
  const tracks = catalog(), selection = create(tracks);
  selection.replace(['A'], ['a2']);
  assert.deepEqual(ids(selection, tracks, ['A']), ['a2']);
  assert.deepEqual(ids(selection, tracks, ['B']), ['b1', 'b2']);
  selection.replace(['B'], ['b1']);
  const reordered = [...tracks].reverse();
  const restored = create(reordered, JSON.parse(JSON.stringify(selection.serialize())));
  assert.deepEqual(ids(restored, reordered, ['A', 'B']), ['b1', 'a2']);
});
test('all mode includes new tracks while an explicit subset excludes them until listen is requested', () => {
  const tracks = catalog(), selection = create(tracks);
  selection.replace(['A'], ['a1']);
  tracks.push({ folder: 'A', src: 'a3' }, { folder: 'B', src: 'b3' });
  assert.deepEqual(ids(selection, tracks, ['A', 'B']), ['a1', 'b1', 'b2', 'b3']);
  selection.include(4);
  assert.deepEqual(ids(selection, tracks, ['A']), ['a1', 'a3']);
  selection.replace(['A'], ['a1', 'a2', 'a3']);
  tracks.push({ folder: 'A', src: 'a4' });
  assert.deepEqual(ids(selection, tracks, ['A']), ['a1', 'a2', 'a3', 'a4']);
});
test('empty selections and removed tracks do not silently expand to the whole album', () => {
  const tracks = catalog();
  const selection = create(tracks, { version: 1, albums: { A: ['removed', 'b1'], B: [] } });
  assert.deepEqual(ids(selection, tracks, ['A', 'B']), []);
  selection.replace(['A'], ['a2', 'unknown']);
  assert.deepEqual(ids(selection, tracks, ['A', 'B']), ['a2']);
});
test('invalid storage falls back to whole albums and native queue overrides stale choices', () => {
  const tracks = catalog();
  for (const saved of [null, [], { version: 2 }, { version: 1, albums: { A: 'bad' } }]) {
    assert.deepEqual(ids(create(tracks, saved), tracks, ['A']), ['a1', 'a2']);
  }
  const selection = create(tracks, { version: 1, albums: { A: ['a1'], B: ['b1'] } });
  selection.replace(['A'], ['a2']);
  assert.deepEqual(ids(selection, tracks, ['A']), ['a2']);
  assert.deepEqual(ids(selection, tracks, ['B']), ['b1']);
});
