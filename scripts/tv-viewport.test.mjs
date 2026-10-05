import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/tv-mode.js', import.meta.url), 'utf8');
test('only an Android TV shell with overview support receives the FHD viewport', () => {
  for (const [ua, search, tv, fhd] of [
    ['ReadizMusicTV/0.3.3 ReadizTVViewport/1920', '', true, true],
    ['ReadizMusicTV/0.3.2', '', true, false],
    ['ReadizMusic/0.3.3', '', false, false],
    ['ReadizMusic/0.3.3', '?tv=1', true, false],
    ['Tizen 5.0', '', true, false],
    ['Chrome', '?tv=1', true, false],
    ['ReadizMusicTV/0.3.3 ReadizTVViewport/19200', '', true, false],
  ]) {
    let viewport = 'width=device-width, initial-scale=1, viewport-fit=cover';
    const classes = [];
    const window = {};
    runInNewContext(source, {
      window, navigator: { userAgent: ua }, location: { search }, URLSearchParams,
      document: {
        documentElement: { classList: { add: value => classes.push(value) } },
        querySelector: selector => {
          assert.equal(selector, 'meta[name="viewport"]');
          return { setAttribute: (key, value) => { assert.equal(key, 'content'); viewport = value; } };
        },
      },
    });
    assert.equal(window.BAMusicTV, tv, ua);
    assert.deepEqual(classes, tv ? ['tv-layout'] : [], ua);
    assert.equal(viewport, fhd ? 'width=1920, viewport-fit=cover' : 'width=device-width, initial-scale=1, viewport-fit=cover', ua);
  }
});
