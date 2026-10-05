// Run with playwright-cli run-code. Simulates the existing APK's asynchronous
// message port (not a replacement NativeAudio) against the page's shipped code.
async (page) => {
  const origin = page.url();
  const reports = [];
  for (const width of [390, 1280]) {
    const context = await page.context().browser().newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const tab = await context.newPage();
    const errors = [], mediaRequests = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('request', request => { if (new URL(request.url()).pathname.endsWith('.mp3')) mediaRequests.push(request.url()); });
    try {
      await tab.addInitScript(() => {
        localStorage.setItem('ba-player-albums', JSON.stringify({ all: true }));
        const state = { type: 'state', id: '', queue: [], position: 0, duration: 120, paused: true, buffering: false, ended: false, error: false, repeat: false, autoNext: true, random: false };
        const commands = [];
        const reply = values => {
          Object.assign(state, values);
          window.ReadizMusicNative.onmessage({ data: JSON.stringify(state) });
        };
        window.__nativeTiming = { reply, commands };
        window.ReadizMusicNative = {
          postMessage(message) {
            const command = JSON.parse(message); commands.push(command);
            if (command.type === 'sync') setTimeout(() => reply({}), 0);
            if (command.type === 'queue') setTimeout(() => reply({
              queue: command.tracks.map(track => track.id), id: command.tracks[command.index]?.id || '', paused: !command.play,
            }), 0);
          },
        };
        window.__webPlayCalls = 0;
        HTMLMediaElement.prototype.play = function () { window.__webPlayCalls++; return Promise.resolve(); };
      });
      await tab.goto(origin);
      await tab.waitForFunction(() => document.querySelector('#waveform > div')?.shadowRoot?.querySelector('.canvases canvas')?.width > 0);
      const report = await tab.evaluate(async () => {
        const fixture = window.__nativeTiming;
        const audio = window.BAMusicNativeAudio;
        const waveforms = await (await fetch(window.BAMusicSource.catalog('waveforms.json'))).json();
        const duration = waveforms[audio.state.id].duration;
        const progress = document.querySelector('#waveform > div').shadowRoot.querySelector('.progress');
        const position = () => parseFloat(progress.style.width) / 100 * duration;
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        fixture.reply({ duration, position: 10, paused: false });
        const start = performance.now();
        const timer = setInterval(() => fixture.reply({ position: 10 + (performance.now() - start) / 1000 }), 500);
        const frames = [];
        await new Promise(resolve => {
          function sample() {
            frames.push(position());
            if (performance.now() - start >= 1200) resolve(); else requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        });
        clearInterval(timer);
        fixture.reply({ position: 12, paused: true });
        const paused = position(); await wait(150);
        const pausedStable = Math.abs(position() - paused) < 0.001;
        fixture.reply({ position: 12, paused: false, buffering: true });
        await wait(150);
        const bufferingStable = Math.abs(position() - 12) < 0.001;
        fixture.reply({ position: 12, paused: true, buffering: false });
        const slider = document.querySelector('.simp-progress');
        slider.value = '50'; slider.dispatchEvent(new Event('input'));
        const immediateSeek = position();
        fixture.reply({ position: 12 });
        const afterStaleReply = position();
        fixture.reply({ position: duration / 2 });
        const result = {
          duration, frames: frames.length, uniquePositions: new Set(frames.map(value => value.toFixed(4))).size,
          maxStep: Math.max(...frames.slice(1).map((value, i) => value - frames[i])),
          minStep: Math.min(...frames.slice(1).map((value, i) => value - frames[i])),
          elapsed: frames.at(-1) - frames[0], pausedStable, bufferingStable,
          immediateSeek, afterStaleReply, expectedSeek: duration / 2,
          webPlayCalls: window.__webPlayCalls,
        };
        return result;
      });
      await tab.locator('#waveform').click({ position: { x: 50, y: 35 } });
      const tap = await tab.evaluate(() => window.__nativeTiming.commands.slice(-2).map(value => value.type));
      if (report.uniquePositions < report.frames * 0.8 || report.maxStep > 0.1 || report.minStep < -0.001
        || report.elapsed < 1 || report.elapsed > 1.4 || !report.pausedStable || !report.bufferingStable
        || Math.abs(report.immediateSeek - report.expectedSeek) > 0.002 || Math.abs(report.afterStaleReply - report.expectedSeek) > 0.002
        || report.webPlayCalls || mediaRequests.length || errors.length || tap.join(',') !== 'seek,play') {
        throw new Error(JSON.stringify({ width, ...report, tap, mediaRequests, errors }));
      }
      reports.push({ width, ...report, tap, mediaRequests, errors });
    } finally { await context.close(); }
  }
  return reports;
}
