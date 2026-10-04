import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const window = {};
runInNewContext(readFileSync(new URL('../js/remote-core.js', import.meta.url), 'utf8'), { window });
const { key, nearest } = window.BAMusicRemoteCore;
const rect = (x,y,w=40,h=40) => ({ left:x,top:y,right:x+w,bottom:y+h });
test('remote key aliases and Samsung numeric keys match browser keys', () => {
  for (const [code, expected] of [[10009,'Back'],[13,'Enter'],[37,'ArrowLeft'],[38,'ArrowUp'],[39,'ArrowRight'],[40,'ArrowDown'],[10252,'MediaPlayPause'],[415,'MediaPlay'],[19,'MediaPause'],[413,'MediaStop'],[412,'MediaRewind'],[417,'MediaFastForward']]) assert.equal(key({key:'Unidentified',keyCode:code}),expected);
  assert.equal(key({key:'Return'}),'Enter');
  assert.equal(key({key:'Escape'}),'Back');
  assert.equal(key({key:'BrowserBack'}),'Back');
});
test('spatial navigation prefers aligned row and column over a nearer diagonal', () => {
  const from=rect(100,100);
  const candidates=[{item:'diagonal',rect:rect(141,130)},{item:'aligned',rect:rect(200,100)}];
  assert.equal(nearest(from,candidates,'ArrowRight'),'aligned');
  assert.equal(nearest(from,[{item:'diagonal',rect:rect(130,141)},{item:'aligned',rect:rect(100,200)}],'ArrowDown'),'aligned');
  assert.equal(nearest(from,candidates,'ArrowLeft'),null);
});
test('app start records launcher depth only for a marked Tizen entry', () => {
  const source=readFileSync(new URL('../js/app-start.js',import.meta.url),'utf8');
  for (const [ua,search,length,expected] of [['Tizen 5.0','?launcher=tizen',3,'2'],['Chrome','?launcher=tizen',3,undefined],['Tizen 5.0','',3,undefined],['Tizen 5.0','?launcher=tizen',1,undefined]]) {
    const writes={}, navigations=[];
    runInNewContext(source,{navigator:{userAgent:ua},location:{search,replace:path=>navigations.push(path)},history:{length},sessionStorage:{setItem:(k,v)=>writes[k]=v},URLSearchParams});
    assert.equal(writes['music:launcher-depth'],expected);
    assert.deepEqual(navigations,['./?tv=1']);
  }
});
