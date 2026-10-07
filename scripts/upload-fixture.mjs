// Isolated local-only authentication and publication fixture; never uses production data.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { createAuth } from '../server/auth.mjs';
import { createImports } from '../server/imports.mjs';
import { createHandler } from '../server/app.mjs';
import { createApiServer } from '../server/http.mjs';
import { createWaveform } from '../server/waveforms.mjs';
mkdirSync('output/playwright/music-upload', { recursive: true });
execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-y', 'output/playwright/music-upload/sample.wav']);
const root=mkdtempSync(join(tmpdir(),'music-upload-browser-')), origin='http://127.0.0.1:4543';
const auth=createAuth({origin,clientId:'test',clientSecret:'test',redirectUri:origin+'/api/auth/discord/callback',allowedUserIds:['1'],sessionSecret:'test-fixture-secret-at-least-32-characters',storePath:join(root,'auth.sqlite')},{fetch:async url=>Response.json(String(url).endsWith('/token')?{access_token:'fake'}:{id:'1',username:'fixture'})});
const original=join(root,'original.mp3'), originalSrc='./music/Blue Archive/fixture-original.mp3';
execFileSync('/opt/homebrew/bin/ffmpeg', ['-v','error','-i','output/playwright/music-upload/sample.wav','-c:a','libmp3lame','-b:a','192k','-y',original]);
const catalog=[originalSrc], manifest={schemaVersion:1,tracks:[]}, waves={[originalSrc]:await createWaveform(original)};
const media = new Map([[originalSrc,readFileSync(original)]]);
const imports=createImports({dataRoot:join(root,'data'),synchronize:async({video,result})=>{
  await new Promise(r=>setTimeout(r,1000));
  const src=`./music/ETC/${video.id}.mp3`;media.set(src,readFileSync(result.path));
  const track={src,title:result.title,folder:'ETC',artist:'ETC'};catalog.push(src);manifest.tracks.push(track);waves[src]=await createWaveform(result.path);
  return {revision:'a'.repeat(40),track};
}});
const api=createHandler({auth,imports});
const server=createApiServer({origin,handler:async request=>{
 const url=new URL(request.url);
 if(url.pathname==='/__login'){const b=auth.begin();const state=new URL(b.location).searchParams.get('state');const login=await auth.complete(new Request(origin+'/api/auth/discord/callback?code=fake&state='+state,{headers:{cookie:b.cookie.split(';')[0]}}));return new Response(null,{status:302,headers:{'Set-Cookie':login.cookie,Location:'/#add-music'}});}
 if(url.pathname.startsWith('/api/'))return api(request);
 if(url.pathname.startsWith('/__pages/')){
  const file='./'+decodeURIComponent(url.pathname.slice('/__pages/'.length));
  const json={'./blue-archive-ost.json':{titles:{}},'./musicList.json':catalog,'./imported-tracks.json':manifest,'./waveforms.json':waves};
  if(json[file])return Response.json(json[file]);
  if(file.startsWith('./music/')){const audio=media.get(file);return audio?new Response(audio,{headers:{'Content-Type':'audio/mpeg'}}):new Response('',{status:404});}
 }
 const pathname=url.pathname.startsWith('/__pages/')?url.pathname.slice('/__pages'.length):url.pathname;
 const path=resolve('dist','.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
 if(!path.startsWith(resolve('dist')+'/'))return new Response('',{status:404});
 try {return new Response(readFileSync(path),{headers:{'Content-Type':{'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg'}[extname(path)]||'application/octet-stream','Cache-Control':'no-store'}});}catch{return new Response('',{status:404});}
}});
server.listen(4543,'127.0.0.1',()=>console.log(origin));
async function stop(){server.closeAllConnections();server.close();await imports.close();auth.close();rmSync(root,{recursive:true,force:true});}process.on('SIGINT',stop);process.on('SIGTERM',stop);
