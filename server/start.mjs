import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from './auth.mjs';
import { createImports } from './imports.mjs';
import { createHandler } from './app.mjs';
import { createGithubSync } from './github-sync.mjs';
const auth = getAuth();
const imports = createImports({ dataRoot: process.env.MUSIC_DATA_ROOT || join(homedir(), '.local/share/readiz-music/data'), synchronize: createGithubSync() });
const staticRoot = process.env.MUSIC_STATIC_ROOT || '/opt/homebrew/var/www/readiz-music/current';
const handler = createHandler({ auth, imports, staticRoot, revision: process.env.MUSIC_REVISION || 'development' });
const server = createServer(async (req, res) => {
  try {
    // Never trust forwarded Host/Origin. Caddy only proxies this music host here.
    const origin = auth?.origin || 'https://music.readiz.com';
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); res.end(); return; }
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
      if (Buffer.byteLength(body) > 4096) { res.writeHead(413, { 'Cache-Control': 'private, no-store' }); res.end(); return; }
    }
    const request = new Request(new URL(req.url, origin), { method: req.method, headers: req.headers, ...(body ? { body } : {}) });
    const response = await handler(request, req.socket.remoteAddress);
    const headers = Object.fromEntries(response.headers);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ error: '서버에서 요청을 처리하지 못했습니다.' }));
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.MUSIC_PORT || 4525), '127.0.0.1', () => console.log('Readiz Music API ready on loopback'));
async function stop() { server.close(); await imports.close(); auth?.close(); server.closeAllConnections(); }
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
