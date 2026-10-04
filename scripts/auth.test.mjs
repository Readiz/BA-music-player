import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAuth,
  safeReturnTo,
                  
} from '../server/auth.mjs';
import { handleAuth } from '../server/auth-handler.mjs';

const config             = {
  origin: 'https://blog.example.com',
  clientId: '123',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://relay.example.com/api/auth/discord/callback',
  allowedUserIds: ['123456'],
  sessionSecret: 'test-session-secret-at-least-32-characters',
  storePath: ':memory:',
};
function fixture(overrides                      = {}) {
  let clock = 1_800_000_000_000;
  let id = '123456';
  let fail = false;
  const calls           = [];
  const auth = createAuth(
    { ...config, ...overrides },
    {
      now: () => clock,
      fetch: (async (url                        , init              ) => {
        calls.push(String(url));
        if (fail) return new Response('upstream failed', { status: 502 });
        if (String(url).endsWith('/token')) {
          assert.equal(
            new URLSearchParams(init?.body                   ).get(
              'redirect_uri',
            ),
            config.redirectUri,
          );
          return Response.json({ access_token: 'test-access-token' });
        }
        assert.equal(
          new Headers(init?.headers).get('authorization'),
          'Bearer test-access-token',
        );
        return Response.json({
          id,
          username: 'test-owner',
          global_name: '테스트 사용자',
        });
      })                ,
    },
  );
  const request = (
    path        ,
    cookie = '',
    method = 'GET',
    origin         ,
  ) =>
    new Request(`${config.origin}${path}`, {
      method,
      headers: { cookie, ...(origin ? { origin } : {}) },
    });
  function begin(returnTo = '/#add-music') {
    const start = auth.begin(returnTo);
    const state = new URL(start.location).searchParams.get('state') ;
    return {
      start,
      state,
      request: request(
        `/api/auth/discord/callback?code=test-code&state=${state}`,
        start.cookie.split(';')[0],
      ),
    };
  }
  return {
    auth,
    calls,
    request,
    begin,
    advance: (ms        ) => {
      clock += ms;
    },
    setUser: (value        ) => {
      id = value;
    },
    fail: () => {
      fail = true;
    },
  };
}

test('owner login, minimal scope, secure cookies, session rotation and logout', async (t) => {
  const f = fixture();
  t.after(() => f.auth.close());
  const begin = f.begin('/notes/?tag=test');
  const params = new URL(begin.start.location).searchParams;
  assert.equal(params.get('scope'), 'identify');
  assert.match(params.get('state') , /^music_/);
  assert.match(
    begin.start.cookie,
    /__Host-readiz_music_oauth=.*HttpOnly; SameSite=Lax; Max-Age=600; Secure/,
  );
  const login = await handleAuth(begin.request, f.auth);
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/notes/?tag=test');
  const cookie = login.headers
    .getSetCookie()
    .find((item) => item.startsWith('__Host-readiz_music_session=')) 
    .split(';')[0];
  const me = await handleAuth(f.request('/api/auth/me/', cookie), f.auth);
  assert.deepEqual((await me.json()).user, {
    id: '123456',
    username: 'test-owner',
    displayName: '테스트 사용자',
  });
  assert.equal(me.headers.get('cache-control'), 'private, no-store');
  const second = f.begin();
  const rotated = await f.auth.complete(
    new Request(second.request, {
      headers: { cookie: `${second.start.cookie.split(';')[0]}; ${cookie}` },
    }),
  );
  assert.equal(f.auth.user(f.request('/#add-music', cookie)), null);
  const active = rotated.cookie.split(';')[0];
  assert.equal(
    (await handleAuth(f.request('/api/auth/logout/', active), f.auth)).status,
    405,
  );
  for (const origin of [
    undefined,
    'https://evil.example',
    'https://sub.blog.example.com',
  ]) {
    assert.equal(
      (
        await handleAuth(
          f.request('/api/auth/logout/', active, 'POST', origin),
          f.auth,
        )
      ).status,
      403,
    );
    assert.ok(f.auth.user(f.request('/#add-music', active)));
  }
  const logout = await handleAuth(
    f.request('/api/auth/logout/', active, 'POST', config.origin),
    f.auth,
  );
  assert.equal(logout.status, 303);
  assert.equal(f.auth.user(f.request('/#add-music', active)), null);
  assert.ok(
    logout.headers
      .getSetCookie()
      .every((cookie) => cookie.includes('Max-Age=0')),
  );
});

test('state is bound to the initiating browser and consumed exactly once, including concurrent callbacks', async (t) => {
  const f = fixture();
  t.after(() => f.auth.close());
  const begin = f.begin();
  for (const cookie of [
    '',
    `${f.auth.stateCookie}=music_${'a'.repeat(43)}`,
    `${f.auth.stateCookie}=${'é'.repeat(48)}`,
  ]) {
    const result = await handleAuth(
      new Request(begin.request, { headers: { cookie } }),
      f.auth,
    );
    assert.equal(result.headers.get('location'), '/?authError=state');
  }
  assert.equal(f.calls.length, 0);
  const results = await Promise.all([
    handleAuth(begin.request, f.auth),
    handleAuth(begin.request, f.auth),
  ]);
  assert.deepEqual(results.map((r) => r.headers.get('location')).sort(), [
    '/#add-music',
    '/?authError=state',
  ]);
  assert.equal(f.calls.length, 2);
});

test('expired state and expired session are rejected', async (t) => {
  const f = fixture();
  t.after(() => f.auth.close());
  const expired = f.begin();
  f.advance(10 * 60 * 1000);
  assert.equal(
    (await handleAuth(expired.request, f.auth)).headers.get('location'),
    '/?authError=state',
  );
  assert.equal(f.calls.length, 0);
  const result = await f.auth.complete(f.begin().request);
  const request = f.request('/#add-music', result.cookie.split(';')[0]);
  assert.ok(f.auth.user(request));
  f.advance(14 * 24 * 60 * 60 * 1000);
  assert.equal(f.auth.user(request), null);
});

test('denied accounts, cancelled authorization and upstream failures never create sessions', async (t) => {
  const f = fixture();
  t.after(() => f.auth.close());
  f.setUser('999999');
  let result = await handleAuth(f.begin().request, f.auth);
  assert.equal(result.headers.get('location'), '/?authError=forbidden');
  assert.equal(result.headers.getSetCookie().length, 1);
  const cancel = f.begin();
  result = await handleAuth(
    new Request(`${cancel.request.url}&error=access_denied`, {
      headers: cancel.request.headers,
    }),
    f.auth,
  );
  assert.equal(result.headers.get('location'), '/?authError=cancelled');
  assert.equal(
    (await handleAuth(cancel.request, f.auth)).headers.get('location'),
    '/?authError=state',
  );
  f.fail();
  result = await handleAuth(f.begin().request, f.auth);
  assert.equal(result.headers.get('location'), '/?authError=discord');
  assert.ok(!JSON.stringify([...result.headers]).includes('test-access-token'));
});

test('server restart preserves sessions; removing an allowed user revokes access; tokens are not persisted', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'newblog-auth-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const storePath = join(directory, 'sessions.sqlite');
  const f = fixture({ storePath });
  const login = await f.auth.complete(f.begin().request);
  const request = f.request('/#add-music', login.cookie.split(';')[0]);
  f.auth.close();
  const persisted = fixture({ storePath });
  assert.ok(persisted.auth.user(request));
  persisted.auth.close();
  const removed = fixture({ storePath, allowedUserIds: ['999999'] });
  assert.equal(removed.auth.user(request), null);
  removed.auth.close();
  assert.equal(statSync(storePath).mode & 0o777, 0o600);
  const bytes = readFileSync(storePath);
  assert.ok(
    !bytes.includes(Buffer.from(login.cookie.split(';')[0].split('=')[1])),
  );
  assert.ok(!bytes.includes(Buffer.from('test-access-token')));
});

test('unsafe return targets, missing configuration, methods and rate limits fail closed', async (t) => {
  for (const path of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%5cevil.example',
    '/%2fevil.example',
    '/%0aevil',
    '/%GG',
    '',
  ])
    assert.equal(safeReturnTo(path), '/#add-music');
  assert.equal(
    safeReturnTo('/notes/?q=test#heading'),
    '/notes/?q=test#heading',
  );
  const f = fixture();
  t.after(() => f.auth.close());
  assert.equal(
    (await handleAuth(f.request('/api/auth/discord/start'), null)).status,
    503,
  );
  assert.deepEqual(
    await (await handleAuth(f.request('/api/auth/me'), null)).json(),
    { enabled: false, authenticated: false, user: null },
  );
  assert.equal(
    (await handleAuth(f.request('/api/auth/discord/start', '', 'POST'), f.auth))
      .status,
    405,
  );
  for (let i = 0; i < 20; i++)
    assert.equal(
      (
        await handleAuth(
          f.request('/api/auth/discord/start'),
          f.auth,
          'client-a',
        )
      ).status,
      302,
    );
  assert.equal(
    (await handleAuth(f.request('/api/auth/discord/start'), f.auth, 'client-a'))
      .status,
    429,
  );
  f.advance(60_000);
  assert.equal(
    (await handleAuth(f.request('/api/auth/discord/start'), f.auth, 'client-a'))
      .status,
    302,
  );
  assert.throws(() => createAuth({ ...config, allowedUserIds: [] }));
  assert.throws(() => createAuth({ ...config, sessionSecret: '' }));
  assert.throws(() =>
    createAuth({ ...config, origin: 'http://blog.example.com' }),
  );
});

test('auth diagnostics distinguish missing cookies and Discord HTTP failures without leaking credentials', async (t) => {
  const f = fixture();
  t.after(() => f.auth.close());
  const logs = [];
  const record = line => logs.push(JSON.parse(line));
  const start = await handleAuth(new Request(`${config.origin}/api/auth/discord/start`, {
    headers: { 'user-agent': 'Mozilla Android ReadizMusic/0.3.0' },
  }), f.auth, 'local', record);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const callback = new Request(`${config.origin}/api/auth/discord/callback?code=sensitive-code&state=${state}`, {
    headers: { 'user-agent': 'Mozilla Android Chrome/100' },
  });
  await handleAuth(callback, f.auth, 'local', record);
  assert.equal(logs[0].event, 'auth_start');
  assert.equal(logs[0].client, 'android-app');
  assert.equal(logs[1].event, 'auth_failure');
  assert.equal(logs[1].client, 'android-browser');
  assert.equal(logs[1].reason, 'state_cookie_missing');
  assert.equal(logs[1].hasStateCookie, false);
  assert.equal(logs[1].hasCode, true);
  assert.equal(logs[0].flow, logs[1].flow);
  f.fail();
  await handleAuth(new Request(callback, { headers: { cookie: start.headers.getSetCookie()[0].split(';')[0] } }), f.auth, 'local', record);
  assert.equal(logs[2].reason, 'token_http_error');
  assert.equal(logs[2].upstreamStatus, 502);
  const output = JSON.stringify(logs);
  for (const sensitive of [state, 'sensitive-code', 'test-client-secret', 'test-access-token', 'upstream failed', 'relay.example.com', 'test-owner']) {
    assert.equal(output.includes(sensitive), false, sensitive);
  }
});
