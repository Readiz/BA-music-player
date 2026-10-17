// Local-only browser fixture: reads the existing NAS serving objects; never writes library data.
// Start this API, then caddy run --config /private/tmp/music-access-fixture.Caddyfile.
import { createHandler } from '../server/app.mjs';
import { createApiServer } from '../server/http.mjs';
import { createStaticResolver } from '../server/nas-static.mjs';
import { librarySettings } from '../server/library.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const settings=librarySettings();
const auth={origin:'https://music.readiz.com',user: request=>request.headers.get('cookie')?.split(';').some(c=>c.trim()==='fixture-session=owner')?{id:'fixture',username:'fixture'}:null};
const api=createHandler({auth,catalogRoot:settings.root+'/current',resolveStatic:createStaticResolver({root:settings.root,settings:settings.static})});
const server=createApiServer({origin:auth.origin,handler:(request,ip)=>{
 if(new URL(request.url).pathname==='/api/auth/logout') return new Response('{}',{headers:{'Set-Cookie':'fixture-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax'}});
 return api(request,ip);
}});
let caddy=readFileSync(root+'/ops/music.Caddyfile','utf8');
caddy=caddy.slice(caddy.indexOf('\t@audio path')).replaceAll('127.0.0.1:4525','127.0.0.1:4526');
writeFileSync('/private/tmp/music-access-fixture.Caddyfile','{\n admin off\n persist_config off\n auto_https off\n}\nhttp://127.0.0.1:4527 {\n bind 127.0.0.1\n root * '+root+'/dist\n'+caddy);
server.listen(4526,'127.0.0.1',()=>console.log('isolated fixture API 4526'));
process.on('SIGTERM',()=>server.close());
