// Optional launcher round-trip fixture, alongside `npm run dev` on 4523.
import http from 'node:http';
import { readFileSync } from 'node:fs';
const port = 4524;
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (path.startsWith('/__launcher/')) {
    const file = path.slice('/__launcher/'.length) || 'index.html';
    if (!['index.html','launcher.js','launcher.css','app-url.js','icon.png'].includes(file)) { res.writeHead(404).end(); return; }
    const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html';
    res.writeHead(200, {'Content-Type':type, 'Cache-Control':'no-store'});
    res.end(file === 'app-url.js' ? `window.READIZ_APP_URL='http://127.0.0.1:${port}/';` : readFileSync(new URL('../tizen/'+file,import.meta.url)));
    return;
  }
  try {
    const response = await fetch('http://127.0.0.1:4523'+req.url,{headers:req.headers.range ? {Range:req.headers.range} : {}});
    res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>!['content-encoding','transfer-encoding'].includes(key))));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (_) { res.writeHead(502).end(); }
});
server.listen(port,'127.0.0.1',()=>console.log('Launcher fixture at http://127.0.0.1:4524/__launcher/'));
