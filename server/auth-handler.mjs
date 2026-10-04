// Adapted from new-home Discord auth; music owns separate cookies, state and storage.
import { AuthError,                  } from './auth.mjs';

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
)                    {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
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
      return redirect(result.location, [result.cookie], 302);
    } catch (error) {
      if (error instanceof AuthError)
        return redirect(`/?authError=${error.code}`);
      throw error;
    }
  }
  if (path === '/api/auth/discord/callback') {
    if (auth.limited(`callback:${ip}`, 40))
      return authJson({ error: 'rate-limited' }, 429);
    try {
      const result = await auth.complete(request);
      return redirect(result.location, [auth.clearState(), result.cookie]);
    } catch (error) {
      if (error instanceof AuthError)
        return redirect(`/?authError=${error.code}`, [auth.clearState()]);
      throw error;
    }
  }
  return authJson({ error: 'not-found' }, 404);
}
