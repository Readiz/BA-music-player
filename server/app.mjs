import { MUSIC_LIBRARY } from './catalog.mjs';
import { handleAuth, authJson } from './auth-handler.mjs';
import { ImportError } from './imports.mjs';

export function createHandler({ auth, imports, staticRoot, resolveStatic, revision = 'development' }) {
  return async (request, ip = 'local') => {
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (path === '/_internal/music-static') {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return authJson({ error: 'not-found' }, 404);
      return resolveStatic ? resolveStatic(request) : authJson({ error: 'static-unavailable' }, 503);
    }
    if (path.startsWith('/api/auth/')) return handleAuth(request, auth, ip);
    if (path === '/api/health' && request.method === 'GET') return authJson({ service: 'readiz-music', revision, auth: !!auth });
    if (['/waveforms.json', '/musicList.json', '/api/library'].includes(path) && request.method === 'GET') {
      const file = path === '/api/library' ? 'imported-tracks.json' : path.slice(1);
      return new Response(null, { status: 307, headers: { Location: new URL(file, MUSIC_LIBRARY).href, 'Cache-Control': 'no-cache' } });
    }
    if (path === '/api/uploads') {
      const user = auth?.user(request);
      if (!user) return authJson({ error: '음악을 추가하려면 디스코드로 로그인해 주세요.' }, 401);
      if (request.method !== 'POST') return authJson({ error: 'method-not-allowed' }, 405);
      if (request.headers.get('origin') !== auth.origin) return authJson({ error: 'invalid-origin' }, 403);
      if (request.headers.get('content-type') !== 'application/octet-stream') return authJson({ error: 'invalid-content-type' }, 415);
      if (auth.limited(`import:${user.id}`, 5)) return authJson({ error: '요청이 많습니다. 1분 후 다시 시도해 주세요.' }, 429);
      try { return authJson({ job: await imports.upload(request, user.id) }, 202); }
      catch (error) { if (error instanceof ImportError) return authJson({ error: error.message }, error.status); throw error; }
    }
    if (path === '/api/imports') {
      const user = auth?.user(request);
      if (!user) return authJson({ error: '음악을 추가하려면 디스코드로 로그인해 주세요.' }, 401);
      if (request.method === 'GET') return authJson({ jobs: imports.list(user.id) });
      if (request.method !== 'POST') return authJson({ error: 'method-not-allowed' }, 405);
      if (request.headers.get('origin') !== auth.origin) return authJson({ error: 'invalid-origin' }, 403);
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return authJson({ error: 'invalid-content-type' }, 415);
      if (auth.limited(`import:${user.id}`, 5)) return authJson({ error: '요청이 많습니다. 1분 후 다시 시도해 주세요.' }, 429);
      let body;
      try {
        const text = await request.text();
        if (Buffer.byteLength(text) > 4096) return authJson({ error: '링크가 너무 깁니다.' }, 413);
        body = JSON.parse(text);
      } catch { return authJson({ error: '올바른 링크를 입력해 주세요.' }, 400); }
      try { return authJson({ job: imports.enqueue(body?.url, user.id) }, 202); }
      catch (error) { if (error instanceof ImportError) return authJson({ error: error.message }, error.status); throw error; }
    }
    return authJson({ error: 'not-found' }, 404);
  };
}
