import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('every player uses the Mac library with fresh catalog URLs', () => {
  const window = {};
  runInNewContext(readFileSync(new URL('../js/music-source.js', import.meta.url), 'utf8'), { window, URL, Date });
  const source = window.BAMusicSource;
  assert.equal(source.media('./music/ETC/yt-mqjYP2Kjpg4.mp3'), 'https://music.readiz.com/music/ETC/yt-mqjYP2Kjpg4.mp3');
  for (const file of ['musicList.json', 'imported-tracks.json', 'waveforms.json']) {
    const url = new URL(source.catalog(file));
    assert.equal(url.origin, 'https://music.readiz.com');
    assert.equal(url.pathname, '/'+file);
    assert.ok(Number(url.searchParams.get('v')) > 0);
  }
});
