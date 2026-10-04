// Run against an isolated emulator with the DEBUG APK. Uses the WebView page CDP
// endpoint because Playwright's browser-level CDP attach is unsupported by WebView.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const adb = process.env.ANDROID_ADB || '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const device = process.env.MUSIC_TEST_DEVICE || 'emulator-5580';
const android = (...args) => execFileSync(adb, ['-s', device, ...args], { encoding: 'utf8' });
const pid = android('shell', 'pidof', 'com.readiz.music').trim();
android('forward', 'tcp:9228', `localabstract:webview_devtools_remote_${pid}`);
const pages = await (await fetch('http://127.0.0.1:9228/json/list')).json();
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
const events = new Map();
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, value => { clearTimeout(timer); value.error ? reject(new Error(JSON.stringify(value.error))) : resolve(value.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = event => {
  const value = JSON.parse(event.data);
  if (value.id) { pending.get(value.id)?.(value); pending.delete(value.id); }
  else events.get(value.method)?.(value.params);
};
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) return; await delay(250); }
  throw new Error(`Condition timed out: ${expression}; state=${JSON.stringify(await evaluate('window.BAMusicNativeAudio?.state'))}`);
}
const report = [];
try {
  if (process.env.MUSIC_TEST_LOCAL === '1') {
    // Source fixture only: native streams still use the real HTTPS music origin.
    events.set('Fetch.requestPaused', async event => {
      try {
        const url = new URL(event.request.url);
        const path = resolve('dist', '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!path.startsWith(resolve('dist') + '/') || !existsSync(path) || url.pathname.startsWith('/music/')) {
          await send('Fetch.continueRequest', { requestId: event.requestId }); return;
        }
        const type = path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : path.endsWith('.html') ? 'text/html' : 'application/octet-stream';
        await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
          responseHeaders: [{name:'Content-Type',value:type}], body: readFileSync(path).toString('base64') });
      } catch (error) { console.error(error); }
    });
    await send('Fetch.enable', { patterns: [{urlPattern:'https://music.readiz.com/*'}] });
  }
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await until('window.BAMusicNativeAudio && window.BAMusicPlayback && document.querySelector(".simp-title").textContent');
  await until('window.BAMusicNativeAudio.state.queue.length > 0');
  assert.equal(await evaluate('document.querySelector("#audio").getAttribute("src")'), null);
  await evaluate('window.BAMusicPlayback.play()');
  await until('window.BAMusicNativeAudio.currentTime > 1 && !window.BAMusicNativeAudio.paused');
  const start = await evaluate('({...window.BAMusicNativeAudio.state})');
  report.push({play: start.id, queue: start.queue.length});
  assert.match(android('shell', 'dumpsys', 'notification', '--noredact'), /com.readiz.music/);
  const session = android('shell', 'dumpsys', 'media_session');
  assert.match(session, /com.readiz.music/);
  assert.match(session, /state=PLAYING\(3\)/);
  android('shell', 'input', 'keyevent', '3'); // HOME
  await delay(3500);
  const notification = android('shell', 'dumpsys', 'notification', '--noredact');
  assert.match(notification, /com.readiz.music/);
  android('shell', 'cmd', 'media_session', 'dispatch', 'pause');
  await until('window.BAMusicNativeAudio.paused');
  const stopped = await evaluate('window.BAMusicNativeAudio.currentTime');
  await delay(1000);
  assert.ok(Math.abs(await evaluate('window.BAMusicNativeAudio.currentTime') - stopped) < 0.2);
  assert.ok(stopped > start.position + 2);
  report.push('Background position advanced; system media pause held position');
  android('shell', 'cmd', 'media_session', 'dispatch', 'play');
  await until('!window.BAMusicNativeAudio.paused');
  android('shell', 'cmd', 'media_session', 'dispatch', 'next');
  await until(`window.BAMusicNativeAudio.state.id !== ${JSON.stringify(start.id)} && window.BAMusicNativeAudio.currentTime > 0.3`);
  const next = await evaluate('window.BAMusicNativeAudio.state.id');
  report.push({systemNext: next});
  android('shell', 'cmd', 'media_session', 'dispatch', 'previous');
  await until(`window.BAMusicNativeAudio.state.id === ${JSON.stringify(start.id)}`);
  report.push('System previous returned to the same track in the fixed shuffle queue');
  android('shell', 'input', 'keyevent', '223'); // SLEEP
  const beforeLock = await evaluate('window.BAMusicNativeAudio.currentTime');
  await delay(3000);
  assert.ok(await evaluate('window.BAMusicNativeAudio.currentTime') > beforeLock + 1.5);
  android('shell', 'input', 'keyevent', '224'); // WAKEUP
  android('shell', 'wm', 'dismiss-keyguard');
  android('shell', 'am', 'start', '-n', 'com.readiz.music/.MainActivity');
  await delay(500);
  // Reload the control surface while the native service plays; preserve queue and position.
  const beforeReload = await evaluate('({...window.BAMusicNativeAudio.state})');
  await send('Page.reload', {ignoreCache:true});
  await until('window.BAMusicPlayback && window.BAMusicNativeAudio?.state.id');
  assert.equal(await evaluate('window.BAMusicNativeAudio.state.id'), beforeReload.id);
  assert.ok(await evaluate('window.BAMusicNativeAudio.currentTime') >= beforeReload.position - 0.5);
  assert.equal(await evaluate('document.querySelector("#audio").getAttribute("src")'), null);
  report.push('Screen off and control-surface reload retained native playback without web audio');
  // Native auto-next and repeat do not rely on web ended events.
  const id = await evaluate('window.BAMusicNativeAudio.state.id');
  await evaluate('window.BAMusicNativeAudio.currentTime = window.BAMusicNativeAudio.duration - 0.7');
  await until(`window.BAMusicNativeAudio.state.id !== ${JSON.stringify(id)}`);
  await until('window.BAMusicNativeAudio.duration > 0');
  const repeatId = await evaluate('window.BAMusicNativeAudio.state.id');
  await evaluate('document.querySelector(".simp-repeat").click()');
  await until('window.BAMusicNativeAudio.loop');
  await evaluate('window.BAMusicNativeAudio.currentTime = window.BAMusicNativeAudio.duration - 0.7');
  await delay(2500);
  assert.equal(await evaluate('window.BAMusicNativeAudio.state.id'), repeatId);
  assert.ok(await evaluate('window.BAMusicNativeAudio.currentTime') < 5);
  report.push('Native auto-next and repeat advanced at real track boundaries');
  await evaluate('document.querySelector(".simp-repeat").click(); document.querySelector(".simp-plext").click()');
  await delay(500);
  await evaluate('window.BAMusicNativeAudio.currentTime = window.BAMusicNativeAudio.duration - 0.7');
  await until('window.BAMusicNativeAudio.paused');
  assert.equal(await evaluate('window.BAMusicNativeAudio.state.id'), repeatId);
  report.push('Disabling auto-next stopped at the current track boundary');
  await evaluate('window.BAMusicPlayback.play()');
  android('shell', 'cmd', 'statusbar', 'expand-notifications');
  await delay(1000);
  writeFileSync('output/android/notification.png', execFileSync(adb, ['-s', device, 'exec-out', 'screencap', '-p']));
  console.log(JSON.stringify(report, null, 2));
  writeFileSync('output/android/verification.json', JSON.stringify(report, null, 2));
} finally { ws.close(); }
