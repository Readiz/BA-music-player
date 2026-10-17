import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHandler } from '../server/app.mjs';
import { publicTrack } from '../server/catalog-access.mjs';
const blue='./music/Blue Archive/a.ogg', touhou='./music/th original/b.mp3', privateTrack='./music/ETC/private.mp3';
test('only the two exact public album paths bypass authentication',()=>{
  for(const id of [blue,touhou,'./music/Blue%20Archive/a.ogg'])assert.equal(publicTrack(id),true);
  for(const id of [privateTrack,'./music/Touhou/a.mp3','./music/Blue Archive/../ETC/private.mp3','./music/Blue Archive/sub/a.mp3','./music/Blue Archive%2f..%2fETC/a.mp3','https://evil.example/music/Blue Archive/a.ogg'])assert.equal(publicTrack(id),false,id);
});
test('catalog, waveforms, metadata and actual audio honor current authentication without shared caching',async t=>{
  const root=await mkdtemp('/private/tmp/music-access-test-');t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [name,data] of Object.entries({'musicList.json':[blue,touhou,privateTrack],'imported-tracks.json':{schemaVersion:1,tracks:[{src:privateTrack,title:'private title'}]},'waveforms.json':{[blue]:{peaks:[1]},[touhou]:{peaks:[2]},[privateTrack]:{peaks:[3]}},'blue-archive-ost.json':{titles:{1:'public title'}}}))await writeFile(join(root,name),JSON.stringify(data));
  let allowed=true,resolves=0;
  const auth={user:r=>allowed&&r.headers.get('cookie')==='session=valid'?{id:'owner'}:null};
  const handler=createHandler({auth,catalogRoot:root,resolveStatic:async()=>{resolves++;return new Response(null,{status:200});}});
  const request=(path,headers={},method='GET')=>new Request('https://music.readiz.com'+path,{method,headers});
  const credential={cookie:'session=valid',origin:'https://www.readiz.com'};
  let response=await handler(request('/api/catalog'));
  let data=await response.json();assert.deepEqual(data.list,[blue,touhou]);assert.equal(data.authenticated,false);assert.deepEqual(data.imported.tracks,[]);
  response=await handler(request('/api/catalog',credential));data=await response.json();assert.equal(data.authenticated,true);assert.equal(data.list.length,3);
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('access-control-allow-origin'),credential.origin);assert.equal(response.headers.get('access-control-allow-credentials'),'true');assert.match(response.headers.get('vary'),/Cookie/);
  for(const path of ['/musicList.json','/imported-tracks.json','/waveforms.json','/api/library']) {
    const guest=await handler(request(path));assert.equal(guest.status,200);assert.doesNotMatch(await guest.text(),/private/);
    const member=await handler(request(path,credential));assert.match(await member.text(),/private/);
  }
  for(const uri of ['/music/ETC/private.mp3','/music/ETC/private.mp3?x=1','/music/%45TC/private.mp3','/assets/albums/etc.jpg']) {
    const path=uri.startsWith('/assets')?'/_internal/music-access':'/_internal/music-static';
    assert.equal((await handler(request(path,{'x-forwarded-uri':uri}),'127.0.0.1')).status,401);
    assert.equal((await handler(request(path,{...credential,'x-forwarded-uri':uri}),'127.0.0.1')).status,200);
  }
  assert.equal((await handler(request('/_internal/music-static',{'x-forwarded-uri':'/music/Blue%20Archive/a.ogg'}),'127.0.0.1')).status,200);
  assert.equal((await handler(request('/_internal/music-static',credential),'192.0.2.1')).status,404);
  allowed=false;
  assert.equal((await (await handler(request('/api/catalog',credential))).json()).authenticated,false);
  assert.equal((await handler(request('/_internal/music-static',{...credential,'x-forwarded-uri':'/music/ETC/private.mp3'}),'127.0.0.1')).status,401);
  assert.equal((await handler(request('/api/catalog',credential,'HEAD'))).headers.get('cache-control'),'private, no-store');
  assert.equal((await handler(request('/api/catalog',{origin:'https://evil.example'}))).headers.get('access-control-allow-credentials'),null);
});
