// Adapted from new-home Discord auth; music owns separate cookies, state and storage.
import { AuthError, cookieValue } from './auth.mjs';
import { authLog } from './auth-log.mjs';

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
export const authJson = (body         , status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...privateHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
function redirect(location        , cookies           = [], status = 303) {
  const headers = new Headers({ ...privateHeaders, Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status, headers });
}

function appComplete(location, stateCookie) {
  // Only a server-generated base64url ticket is interpolated, never OAuth query strings or profile data.
  const headers = new Headers({ ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff', 'Set-Cookie': stateCookie });
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Readiz Music 로그인</title><style>body{margin:0;background:#0e1621;color:#f5f7fa;font:18px/1.65 system-ui;min-height:100svh;display:grid;place-items:center}main{max-width:28rem;padding:28px}h1{font-size:26px}a{display:block;margin:28px 0;padding:15px 20px;background:#82dcff;color:#10202b;border-radius:12px;text-align:center;text-decoration:none;font-weight:700}p{color:#ccd6e0}</style><main><h1>로그인이 완료됐습니다</h1><p>2분 안에 뮤직앱으로 돌아가면 음악을 추가할 수 있습니다.</p><a href="${location}">뮤직앱으로 돌아가기</a><p>앱이 열리지 않으면 최신 버전으로 업데이트한 뒤 다시 로그인해 주세요.</p></main></html>`, { headers });
}

export async function handleAuth(
  request         ,
  auth                    ,
  ip = 'local',
  writeLog = console.info,
)                    {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const audit = (event, details = {}) => authLog(event, request, details, writeLog);
  const failure = error => ({ code: error instanceof AuthError ? error.code : 'internal',
    reason: error instanceof AuthError ? error.reason : 'unexpected_error', upstreamStatus: error?.upstreamStatus });
  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = auth?.user(request) ?? null;
    return authJson({ enabled: !!auth, authenticated: !!user, user });
  }
  if (!auth) return authJson({ error: 'auth-not-configured' }, 503);
  if (path === '/api/auth/android/redeem') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...privateHeaders, Allow: 'POST' } });
    if ((request.headers.has('origin') && request.headers.get('origin') !== auth.origin) ||
        request.headers.get('content-type')?.split(';')[0] !== 'application/json')
      return authJson({ error: 'invalid-request' }, 403);
    if (auth.limited(`redeem:${ip}`, 30)) return authJson({ error: 'rate-limited' }, 429);
    try {
      const body = await request.json();
      const session = auth.redeemAndroid(request, body?.ticket, body?.verifier);
      const response = authJson({ authenticated: true });
      response.headers.append('Set-Cookie', session);
      audit('auth_android_success');
      return response;
    } catch (error) {
      audit('auth_android_failure', failure(error));
      return authJson({ error: 'login-failed' }, 400);
    }
  }
  if (path === '/api/auth/logout') {
    if (request.method !== 'POST')
      return new Response(null, {
        status: 405,
        headers: { ...privateHeaders, Allow: 'POST' },
      });
    if (request.headers.get('origin') !== auth.origin)
      return authJson({ error: 'invalid-origin' }, 403);
    auth.revoke(request);
    return redirect('/', [auth.clearSession(), auth.clearState()]);
  }
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { ...privateHeaders, Allow: 'GET' },
    });
  if (path === '/api/auth/discord/start') {
    if (auth.limited(`start:${ip}`, 20))
      return authJson({ error: 'rate-limited' }, 429);
    try {
      const result = auth.begin(url.searchParams.get('returnTo'), url.searchParams.get('app_challenge'));
      audit('auth_start', { state: new URL(result.location).searchParams.get('state') });
      return redirect(result.location, [result.cookie], 302);
    } catch (error) {
      audit('auth_start_failure', failure(error));
      if (error instanceof AuthError)
        return redirect(`/?authError=${error.code}`);
      throw error;
    }
  }
  if (path === '/api/auth/discord/callback') {
    if (auth.limited(`callback:${ip}`, 40))
      return authJson({ error: 'rate-limited' }, 429);
    const context = { state: url.searchParams.get('state'),
      hasStateCookie: Boolean(cookieValue(request, auth.stateCookie)), hasCode: url.searchParams.has('code') };
    try {
      const result = await auth.complete(request);
      audit('auth_success', context);
      if (result.appReturn) return appComplete(result.appReturn, auth.clearState());
      return redirect(result.location, [auth.clearState(), result.cookie]);
    } catch (error) {
      audit('auth_failure', { ...context, ...failure(error) });
      if (error instanceof AuthError)
        return redirect(`/?authError=${error.code}`, [auth.clearState()]);
      throw error;
    }
  }
  return authJson({ error: 'not-found' }, 404);
}
