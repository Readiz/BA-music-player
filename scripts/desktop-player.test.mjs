import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../js/desktop-player.js', import.meta.url), 'utf8');
function fixture({name='readiz-music-desktop-v1',referrer='https://www.readiz.com/',standalone=false,native=false}={}) {
  const sent=[], received=[], timers=[];
  let receive;
  const parent={postMessage:(value,origin)=>sent.push({value:JSON.parse(JSON.stringify(value)),origin})};
  const window={name,parent,addEventListener:(_,fn)=>{receive=fn;}, ...(native ? {ReadizMusicNative:{android:true}} : {})};
  if(standalone)window.parent=window;
  runInNewContext(source,{window,document:{referrer},URL,crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789012'},setInterval:()=>1,clearInterval:()=>{},setTimeout:fn=>{timers.push(fn);return 2;},clearTimeout:()=>{}});
  const port=window.ReadizMusicNative;
  if(port?.desktop)port.onmessage=event=>received.push(JSON.parse(event.data));
  const state={type:'state',active:true,id:'./music/A/one.mp3',queue:['./music/A/one.mp3','./music/A/two.mp3'],position:30,paused:false};
  const reply=(data={},origin='https://www.readiz.com',sender=parent)=>receive?.({origin,source:sender,data:{type:'readiz:music',session:'12345678-1234-1234-1234-123456789012',ack:0,state,...data}});
  return {port,sent,received,reply,state,timers};
}
test('standalone, Android, unnamed and untrusted embeds keep their own playback owner',()=>{
  for(const options of [{standalone:true},{name:''},{referrer:'https://evil.example/'}])assert.equal(fixture(options).port,undefined);
  assert.equal(fixture({native:true}).port.android,true);
});
test('trusted parent state wins and stale replies cannot overwrite pending controls',()=>{
  const f=fixture();
  f.port.postMessage(JSON.stringify({type:'sync'}));
  assert.equal(f.sent[0].value.connect,true);
  f.reply({},'https://evil.example');f.reply({},undefined,{});
  assert.equal(f.received.length,0);
  f.reply();assert.equal(f.received[0].position,30);
  f.port.postMessage(JSON.stringify({type:'select',index:1,play:true}));
  assert.deepEqual(f.sent.at(-1).value.command,{type:'select',id:'./music/A/two.mp3',play:true});
  f.reply({state:{...f.state,position:0}});assert.equal(f.received.length,1);
  f.reply({ack:1,state:{...f.state,id:'./music/A/two.mp3'}});assert.equal(f.received.length,2);
  assert.equal(f.sent.every(message=>message.origin==='https://www.readiz.com'),true);
});
test('initial queue is marked once and sends catalog IDs, not arbitrary metadata or media URLs',()=>{
  const f=fixture();f.reply({state:{...f.state,active:false,queue:[],id:''}});
  const command={type:'queue',tracks:[{id:'./music/A/one.mp3',src:'https://evil.example/secret',title:'private'}],index:0,play:false,preserve:false};
  f.port.postMessage(JSON.stringify(command));
  assert.deepEqual(f.sent.at(-1).value.command,{type:'queue',ids:['./music/A/one.mp3'],index:0,play:false,preserve:false,initial:true});
  f.port.postMessage(JSON.stringify(command));assert.equal(f.sent.at(-1).value.command.initial,false);
});
test('failed connection never silently creates a second local player or accepts a late hello',()=>{
  const f=fixture();f.timers[0]();
  assert.equal(f.received[0].type,'failure');
  f.reply();assert.equal(f.received.length,1);
  f.port.postMessage(JSON.stringify({type:'play'}));assert.equal(f.sent.length,0);
});
