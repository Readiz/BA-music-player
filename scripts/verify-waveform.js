// Playwright CLI run-code. Compares the actual native canvas to bundled
// WaveSurfer pixels using an isolated native bridge fixture (not a real device).
async (page) => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser();
  const results = [];
  for (const [width, ratio] of [[320, 1], [390, 3], [832, 2], [1280, 1], [390, 2.625]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: ratio, serviceWorkers: 'block' });
    const tab = await context.newPage();
    const mediaRequests = [];
    tab.on('request', request => { if (new URL(request.url()).pathname.startsWith('/music/')) mediaRequests.push(request.url()); });
    try {
      await tab.addInitScript(() => {
        window.__webPlayCalls = 0;
        const webPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { window.__webPlayCalls++; return webPlay.call(this); };
        localStorage.setItem('ba-player-albums', JSON.stringify({ all: true }));
        class FixtureAudio extends EventTarget {
          constructor() { super(); this.ready = Promise.resolve(); this.playbackRate = 1; this.commands = []; this.state = { id: '', queue: [], paused: true, position: 0, duration: 120, repeat: false, autoNext: true, random: true }; }
          get paused() { return this.state.paused; }
          get duration() { return this.state.duration; }
          get currentTime() { return this.state.position; }
          set currentTime(value) { this.commands.push(['seek', value]); this.state.position = value; this.dispatchEvent(new Event('timeupdate')); }
          get src() { return this.state.id && new URL(this.state.id, location.href).href; }
          get loop() { return this.state.repeat; }
          set loop(value) { this.state.repeat = value; }
          configure(tracks, index, play) { this.state.queue = tracks.map(track => track.id); this.state.id = this.state.queue[index]; this.state.paused = !play; this.state.position = 0; }
          send(type, data) { this.commands.push([type, data]); if (type === 'select') { this.state.id = this.state.queue[data.index]; this.state.position = 0; this.state.paused = !data.play; } }
          options(value) { Object.assign(this.state, value); }
          play() { this.commands.push(['play']); this.state.paused = false; return Promise.resolve(); }
          pause() { this.state.paused = true; }
          load() {}
          removeAttribute() {}
        }
        window.BAMusicNativeAudio = new FixtureAudio();
      });
      await tab.goto(origin);
      await tab.waitForFunction(() => document.querySelector('#waveform > div')?.shadowRoot?.querySelector('.canvases canvas')?.width > 0);
      const report = await tab.evaluate(async () => {
        const { default: WaveSurfer } = await import('./js/wavesurfer.esm.js');
        const waveforms = await (await fetch('./waveforms.json')).json();
        const entries = Object.entries(waveforms);
        const selections = [entries.find(([, value]) => Math.max(...value.peaks) > 1.4), entries.find(([, value]) => Math.max(...value.peaks) <= 1), entries[0]];
        const native = window.BAMusicNativeAudio;
        let canvas = document.querySelector('#waveform > div').shadowRoot.querySelector('.canvases canvas');
        const checked = [];
        for (const [src, data] of selections) {
          document.querySelector(`[data-src="${src}"]`).closest('li').click();
          native.state.position = 0;
          native.state.duration = data.duration;
          native.dispatchEvent(new Event('timeupdate'));
          await new Promise(requestAnimationFrame);
          canvas = document.querySelector('#waveform > div').shadowRoot.querySelector('.canvases canvas');
          const holder = document.createElement('div');
          holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${canvas.clientWidth}px;height:70px`;
          document.body.append(holder);
          const media = document.createElement('audio');
          const reference = WaveSurfer.create({ container: holder, media, peaks: [[...data.peaks]], duration: data.duration, height: 70, waveColor: '#5f5f5f', progressColor: '#ffffff', cursorWidth: 0 });
          await new Promise(resolve => reference.on('ready', resolve));
          const expected = holder.firstElementChild.shadowRoot.querySelector('.canvases canvas');
          if (canvas.width !== expected.width || canvas.height !== expected.height) throw new Error('Canvas size differs');
          await new Promise(requestAnimationFrame);
          native.dispatchEvent(new Event('timeupdate'));
          const actual = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          const baseline = expected.getContext('2d').getImageData(0, 0, expected.width, expected.height).data;
          let differences = 0;
          for (let i = 0; i < actual.length; i++) if (actual[i] !== baseline[i]) differences++;
          if (differences) throw new Error(`Waveform differs at ${differences} values: ${src}, DPR ${devicePixelRatio}, width ${canvas.width}`);
          native.state.position = data.duration * 0.37;
          native.dispatchEvent(new Event('timeupdate'));
          const progressRoot = document.querySelector('#waveform > div').shadowRoot;
          const progressCanvas = progressRoot.querySelector('.progress canvas');
          const progress = progressCanvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let white = 0, grey = 0;
          for (let i = 0; i < progress.length; i += 4) {
            if (!progress[i + 3]) continue;
            if (progress[i] === 255) white++;
            if (baseline[i] === 95) grey++;
            if (progress[i + 3] !== baseline[i + 3]) throw new Error('Progress changed the waveform outline');
          }
          if (!white || !grey || Math.abs(parseFloat(progressRoot.querySelector('.progress').style.width) - 37) > 0.01) throw new Error('Progress fill missing');
          checked.push({ src, maximum: Math.max(...data.peaks), pixelsEqual: true, progress: true });
          reference.destroy(); holder.remove();
        }
        if (document.querySelector('#audio').getAttribute('src')) throw new Error('Native mode loaded web audio');
        return checked;
      });
      // Resizing a paused track must rebuild the outline; tapping still uses native seeking.
      await tab.setViewportSize({ width: width + 40, height: 900 });
      await tab.waitForFunction(() => { const c = document.querySelector('#waveform > div').shadowRoot.querySelector('.canvases canvas'); return c.width === Math.round(c.clientWidth * devicePixelRatio); });
      await tab.locator('#waveform').click({ position: { x: 50, y: 35 } });
      const commands = await tab.evaluate(() => window.BAMusicNativeAudio.commands);
      if (mediaRequests.length || await tab.evaluate(() => window.__webPlayCalls)) throw new Error('Waveform started a second web audio stream');
      if (!commands.some(([name]) => name === 'seek') || !commands.some(([name]) => name === 'play')) throw new Error('Waveform tap did not seek and play through native bridge');
      if (ratio === 3) await tab.screenshot({ path: 'output/playwright/waveform/native-mobile.png' });
      results.push({ width, ratio, checked: report, resize: true, nativeSeek: true });
    } finally { await context.close(); }
  }
  return results;
}
