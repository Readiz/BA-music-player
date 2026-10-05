import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/native-player.js', import.meta.url), 'utf8');
function player() {
  let now = 0, serial = 0;
  const frames = new Map(), commands = [], positions = [];
  const document = new EventTarget();
  document.hidden = false;
  const port = { postMessage: value => commands.push(JSON.parse(value)) };
  const window = { ReadizMusicNative: port };
  runInNewContext(source, {
    window, document, Event, EventTarget, URL,
    location: { href: 'https://music.readiz.com/' },
    performance: { now: () => now },
    requestAnimationFrame: callback => { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const audio = window.BAMusicNativeAudio;
  audio.addEventListener('timeupdate', () => positions.push(audio.currentTime));
  const state = { type: 'state', id: './music/a.mp3', queue: ['./music/a.mp3'], position: 30, duration: 180,
    paused: false, buffering: false, ended: false, error: false };
  return {
    audio, frames, commands, positions,
    sample(values = {}) { Object.assign(state, values); port.onmessage({ data: JSON.stringify(state) }); },
    failure() { port.onmessage({ data: '{"type":"failure"}' }); },
    advance(ms) {
      now += ms;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(now));
    },
    visible(visible) { document.hidden = !visible; document.dispatchEvent(new Event('visibilitychange')); },
  };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test('native cursor advances each frame between 500 ms Media3 samples', () => {
  const p = player(); p.sample();
  for (let i = 1; i <= 30; i++) { p.advance(1000 / 60); near(p.audio.currentTime, 30 + i / 60); }
  assert.equal(new Set(p.positions).size, 31);
  p.sample({ position: 30.5 });
  p.advance(100); near(p.audio.currentTime, 30.6);
  assert.equal(p.frames.size, 1, 'at most one animation loop');
  assert.equal(p.commands.length, 1, 'display frames never issue playback commands');
});

test('small bridge delivery jitter does not rewind the cursor', () => {
  const p = player(); p.sample(); p.advance(520);
  p.sample({ position: 30.5 }); near(p.audio.currentTime, 30.52);
  p.advance(100); near(p.audio.currentTime, 30.616);
  p.advance(400); near(p.audio.currentTime, 31);
});

test('seek is immediate and older replies cannot undo the latest seek', () => {
  const p = player(); p.sample(); p.advance(100);
  p.audio.currentTime = 90; near(p.audio.currentTime, 90);
  assert.equal(p.frames.size, 0);
  assert.deepEqual(p.commands.at(-1), { position: 90000, type: 'seek' });
  p.advance(100); p.sample({ position: 30.2 }); near(p.audio.currentTime, 90);
  p.audio.currentTime = 45;
  p.sample({ position: 90 }); near(p.audio.currentTime, 45);
  p.sample({ position: 45 }); p.advance(100); near(p.audio.currentTime, 45.1);
});

test('paused seeking, rejected seeks and end boundaries use Media3 state', () => {
  const p = player(); p.sample({ paused: true });
  p.audio.currentTime = 90; p.sample({ position: 30 }); near(p.audio.currentTime, 90);
  p.advance(1500); p.sample({ position: 30 }); near(p.audio.currentTime, 30);
  p.audio.currentTime = 999; near(p.audio.currentTime, 180);
  p.sample({ position: 180, ended: true }); near(p.audio.currentTime, 180);
  assert.equal(p.frames.size, 0);
  p.audio.currentTime = -1; near(p.audio.currentTime, 0);
  p.sample({ position: 180, ended: true }); near(p.audio.currentTime, 0);
  p.sample({ position: 0, ended: false }); near(p.audio.currentTime, 0);
});

test('pause, buffering, end and failure stop animation at the reported position', () => {
  for (const change of [{ paused: true }, { buffering: true }, { ended: true }, { error: true }]) {
    const p = player(); p.sample(); p.advance(100);
    p.sample({ position: 30.1, ...change }); p.advance(900);
    near(p.audio.currentTime, 30.1); assert.equal(p.frames.size, 0);
  }
  const p = player(); p.sample(); p.advance(100); p.failure(); p.advance(900);
  near(p.audio.currentTime, 30.1); assert.equal(p.frames.size, 0);
});

test('lost updates stop extrapolation; reconnect uses fresh native position', () => {
  const p = player(); p.sample(); p.advance(2000);
  near(p.audio.currentTime, 31); assert.equal(p.frames.size, 0);
  p.advance(60000); near(p.audio.currentTime, 31);
  p.sample({ position: 92 }); p.advance(100); near(p.audio.currentTime, 92.1);
  p.sample({ position: 179.9 }); p.advance(500); near(p.audio.currentTime, 180);
});

test('backgrounding cancels frames and returning waits for fresh Media3 state', () => {
  const p = player(); p.sample(); p.advance(100); p.visible(false);
  assert.equal(p.frames.size, 0);
  p.advance(60000); p.sample({ position: 90 });
  assert.equal(p.frames.size, 0);
  p.visible(true); p.advance(500);
  near(p.audio.currentTime, 90); assert.equal(p.commands.at(-1).type, 'sync');
  p.sample({ position: 90.6 }); p.advance(100); near(p.audio.currentTime, 90.7);
});

test('track changes and repeat restart discard the previous timeline', () => {
  const p = player(); p.sample(); p.audio.currentTime = 90;
  p.sample({ id: './music/b.mp3', position: 0, duration: 100 }); near(p.audio.currentTime, 0);
  p.advance(100); near(p.audio.currentTime, 0.1);
  p.sample({ position: 99.9 }); p.advance(100);
  p.sample({ position: 0 }); near(p.audio.currentTime, 0);
});

test('ordinary browser playback does not install a native clock', () => {
  const window = {}; runInNewContext(source, { window });
  assert.equal(window.BAMusicNativeAudio, undefined);
});
