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
      const result = auth.begin(url.searchParams.get('returnTo'));
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
