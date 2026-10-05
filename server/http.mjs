import { createServer } from 'node:http';
import { Readable, Transform } from 'node:stream';

export function createApiServer({ handler, origin }) {
  const server = createServer(async (req, res) => {
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); res.end(); return; }
      // Headers reach authentication before any upload bytes are consumed.
      const url = new URL(req.url, origin);
      let body;
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (url.pathname.replace(/\/$/, '') === '/api/uploads') body = Readable.toWeb(req);
        else {
          let bytes = 0;
          const bounded = new Transform({ transform(chunk, encoding, done) {
            bytes += chunk.length;
            done(bytes > 4096 ? new Error('Request too large') : null, bytes > 4096 ? undefined : chunk);
          } });
          req.on('error', error => bounded.destroy(error));
          body = Readable.toWeb(req.pipe(bounded));
        }
      }
      const request = new Request(url, { method: req.method, headers: req.headers, ...(body ? { body, duplex: 'half' } : {}) });
      const response = await handler(request, req.socket.remoteAddress);
      const headers = Object.fromEntries(response.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      // Reject early without draining an unauthenticated or oversized upload.
      if (!req.readableEnded) { headers.connection = 'close'; res.once('finish', () => req.destroy()); }
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', Connection: 'close' });
      res.end(JSON.stringify({ error: '요청을 처리하지 못했습니다. 파일 전송 상태를 확인하고 다시 시도해 주세요.' }));
    }
  });
  server.requestTimeout = 10 * 60_000;
  server.headersTimeout = 10_000;
  return server;
}
