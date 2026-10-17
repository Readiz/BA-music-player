import { createCatalogReader, catalogFiles, catalogHeaders, publicResource } from './catalog-access.mjs';
import { handleAuth, authJson } from './auth-handler.mjs';
import { ImportError } from './imports.mjs';

export function createHandler({ auth, imports, staticRoot, resolveStatic, catalogRoot = staticRoot, revision = 'development' }) {
  const catalog = catalogRoot ? createCatalogReader(catalogRoot) : null;
  return async (request, ip = 'local') => {
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (path === '/_internal/music-static' || path === '/_internal/music-access') {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return authJson({ error: 'not-found' }, 404);
      if (!publicResource(request.headers.get('x-forwarded-uri') || '') && !auth?.user(request)) return authJson({ error: 'login-required' }, 401);
      if (path === '/_internal/music-access') return new Response(null, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
      return resolveStatic ? resolveStatic(request) : authJson({ error: 'static-unavailable' }, 503);
    }
    if (path.startsWith('/api/auth/')) return handleAuth(request, auth, ip);
    if (path === '/api/health' && request.method === 'GET') return authJson({ service: 'readiz-music', revision, auth: !!auth });
    if (path === '/api/catalog' || path === '/api/library' || catalogFiles.has(path.slice(1))) {
      const headers = catalogHeaders(request);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers });
      try {
        const authenticated = Boolean(auth?.user(request));
        const view = await catalog(authenticated);
        const content = path === '/api/catalog' ? { authenticated, list: view.list, imported: view.imported, ost: view.ost }
          : path === '/musicList.json' ? view.list
          : path === '/api/library' || path === '/imported-tracks.json' ? view.imported
          : path === '/waveforms.json' ? view.waves
          : path === '/blue-archive-ost.json' ? view.ost
          : path === '/library-info.json' ? view.info : view.updated;
        headers['Content-Type'] = path === '/lastUpdated.txt' ? 'text/plain; charset=utf-8' : 'application/json';
        return new Response(request.method === 'HEAD' ? null : typeof content === 'string' ? content : JSON.stringify(content), { headers });
      } catch { return new Response(JSON.stringify({ error: 'catalog-unavailable' }), { status: 503, headers }); }
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
