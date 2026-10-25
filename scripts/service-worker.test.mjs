import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://music.readiz.com';
const offlineUrl = `${origin}/offline.html`;

function fixture({ fail = false, installFail = false, cleanupFail = false, response = { status: 200 } } = {}) {
  const handlers = new Map();
  const requests = [], matches = [], added = [], removed = [], opened = [], lifecycle = [];
  const offline = { offline: true };
  runInNewContext(source, {
    URL,
    self: {
      location: new URL(`${origin}/sw.js`),
      addEventListener: (type, handler) => handlers.set(type, handler),
      skipWaiting: async () => { lifecycle.push('skipWaiting'); },
      clients: { claim: async () => { lifecycle.push('claim'); } },
    },
    fetch: async request => {
      requests.push(request);
      if (fail) throw new Error('offline');
      return response;
    },
    caches: {
      open: async name => {
        opened.push(name);
        return { add: async url => {
          added.push(url);
          lifecycle.push('cache-add');
          if (installFail) throw new Error('offline cache unavailable');
        } };
      },
      match: async url => { matches.push(url); return offline; },
      keys: async () => ['unrelated-cache', 'readiz-music-offline-v0', 'readiz-music-offline-v1'],
      delete: async name => {
        removed.push(name);
        lifecycle.push('cache-delete');
        if (cleanupFail) throw new Error('old cache unavailable');
        return true;
      },
    },
  });
  function dispatch(path, extra = {}) {
    const request = Object.freeze({ url: new URL(path, origin).href, method: 'GET', mode: 'navigate', ...extra });
    let intercepted = false, result;
    handlers.get('fetch')({ request, respondWith(value) { intercepted = true; result = value; } });
    return { request, intercepted, result };
  }
  return { handlers, dispatch, requests, matches, added, removed, opened, lifecycle, offline, response };
}

test('authentication navigations remain browser-owned and never enter fetch or offline cache', () => {
  const f = fixture({ fail: true });
  for (const path of [
    '/_auth', '/_auth/', '/_auth/start?returnTo=%2F%23add-music',
    '/_auth/callback?code=synthetic-code&state=synthetic-state',
    '/_auth/frame-login.js', '/api/auth', '/api/auth/',
    '/api/auth/discord/start?returnTo=%2F',
    '/api/auth/discord/callback?code=synthetic-code&state=synthetic-state',
    '/api/auth/logout', '/login', '/login/', '/login?returnTo=%2F',
  ]) {
    for (const destination of ['document', 'iframe']) {
      const event = f.dispatch(path, { destination });
      assert.equal(event.intercepted, false, `${path} (${destination})`);
      assert.equal(event.result, undefined);
    }
  }
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.matches, []);
});

test('ordinary navigation keeps its original network request and returns the response unchanged', async () => {
  const response = { status: 403, body: 'network-response' };
  const f = fixture({ response });
  const event = f.dispatch('/?album=public', { destination: 'iframe', credentials: 'include' });
  assert.equal(event.intercepted, true);
  assert.equal(await event.result, response);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0], event.request);
  assert.deepEqual(f.matches, []);
});

test('ordinary offline pages retain the existing fallback and similar non-auth names stay ordinary', async () => {
  const f = fixture({ fail: true });
  for (const path of ['/', '/?album=public', '/_authentic', '/api/authors', '/login-help', '/login/guide']) {
    const event = f.dispatch(path);
    assert.equal(event.intercepted, true, path);
    assert.equal(await event.result, f.offline);
  }
  assert.equal(f.requests.length, 6);
  assert.deepEqual(f.matches, Array(6).fill(offlineUrl));
});

test('audio, Range, catalog, non-GET and foreign navigation keep bypassing the worker', () => {
  const f = fixture();
  for (const [path, extra] of [
    ['/music/public.mp3', { mode: 'no-cors', destination: 'audio', headers: { Range: 'bytes=0-100' } }],
    ['/api/catalog', { mode: 'cors', destination: '' }],
    ['/musicList.json', { mode: 'cors' }],
    ['/waveforms.json', { mode: 'cors' }],
    ['/', { method: 'POST' }],
    ['/', { method: 'HEAD' }],
    ['https://auth.readiz.com/login', {}],
    ['https://www.readiz.com/', {}],
  ]) assert.equal(f.dispatch(path, extra).intercepted, false, path);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.matches, []);
});

test('install prepares the offline document before skipping the wait; activate claims clients only after old Music caches are removed', async () => {
  const f = fixture();
  let task;
  const event = { waitUntil(value) { task = value; } };
  f.handlers.get('install')(event);
  await task;
  assert.deepEqual(f.opened, ['readiz-music-offline-v1']);
  assert.deepEqual(f.added, [offlineUrl]);
  assert.deepEqual(f.lifecycle, ['cache-add', 'skipWaiting']);
  f.handlers.get('activate')(event);
  await task;
  assert.deepEqual(f.removed, ['readiz-music-offline-v0']);
  assert.deepEqual(f.lifecycle, ['cache-add', 'skipWaiting', 'cache-delete', 'claim']);
  assert.deepEqual(f.requests, []);
});

test('failed offline preparation rejects installation without skipping the existing worker or claiming clients', async () => {
  const f = fixture({ installFail: true });
  let task;
  f.handlers.get('install')({ waitUntil(value) { task = value; } });
  await assert.rejects(task, /offline cache unavailable/);
  assert.deepEqual(f.lifecycle, ['cache-add']);
  assert.deepEqual(f.removed, []);
});

test('failed cache cleanup cannot claim clients before activation cleanup completes', async () => {
  const f = fixture({ cleanupFail: true });
  let task;
  f.handlers.get('activate')({ waitUntil(value) { task = value; } });
  await assert.rejects(task, /old cache unavailable/);
  assert.deepEqual(f.lifecycle, ['cache-delete']);
});
