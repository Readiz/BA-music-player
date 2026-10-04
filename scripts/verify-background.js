// Playwright CLI: run-code "$(cat scripts/verify-background.js)"
// Run against a headed local preview with byte-range support (npm run dev).
// Playwright forces page visibility, so this verifies an unfocused browser tab,
// not a physical phone's screen lock, app suspension, or battery policy.
async (page) => {
  const url = page.url();
  const catalogResponse = await page.request.get(new URL('./musicList.json', url).href);
  const expectedTracks = (await catalogResponse.json()).length;
  const report = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__mediaActions = {};
    if (navigator.mediaSession) {
      const register = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (action, handler) => {
        window.__mediaActions[action] = handler;
        return register(action, handler);
      };
    }
  });
  await page.route('**/wavesurfer.esm.js', route => route.abort());
  await page.evaluate(() => localStorage.removeItem('ba-player-folder'));
  await page.reload();
  await page.waitForFunction(count => document.querySelectorAll('#ulist li').length === count, expectedTracks);
  if (!(await page.locator('#audio').evaluate(audio => audio.paused))) throw new Error('Unexpected autoplay');
  await page.getByText('Click here to use').click();
  await page.getByText("theme_103-Poppin' Memories", {exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.5);
  await page.evaluate(() => { window.__originalAudio = document.querySelector('#audio'); });
  if (await page.evaluate(() => navigator.mediaSession.metadata.title) !== "Poppin' Memories") throw new Error('Wrong lock-screen title');
  report.push('Native playback and title work while waveform module is blocked');

  await page.evaluate(() => window.__mediaActions.pause());
  await page.waitForFunction(() => document.querySelector('#audio').paused && navigator.mediaSession.playbackState === 'paused');
  await page.evaluate(() => {
    window.__mediaActions.seekto({seekTime:20});
    window.__mediaActions.seekforward({seekOffset:5});
    if (Math.abs(document.querySelector('#audio').currentTime - 25) > 0.1) throw new Error('Forward seek changed the track or position incorrectly');
    window.__mediaActions.seekbackward({seekOffset:7});
    if (Math.abs(document.querySelector('#audio').currentTime - 18) > 0.1) throw new Error('Backward seek failed');
    window.__mediaActions.play();
  });
  await page.waitForFunction(() => document.querySelector('#audio').currentTime > 18.5 && navigator.mediaSession.playbackState === 'playing');
  report.push('Media Session play, pause, seekto, forward/backward seek and state agree');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', {enabled:false});
  const other = await page.context().newPage();
  try {
    await other.goto('about:blank');
    await other.bringToFront();
    const background = await page.evaluate(() => ({hidden:document.hidden, focused:document.hasFocus()}));
    if (background.focused) throw new Error('Player did not lose focus');
    report.push(`Background test state: hidden=${background.hidden}, focused=${background.focused}`);
    const start = await page.locator('#audio').evaluate(audio => audio.currentTime);
    await page.waitForTimeout(12000);
    const elapsed = await page.locator('#audio').evaluate((audio, start) => audio.currentTime - start, start);
    if (elapsed < 10) throw new Error('Playback stopped in the unfocused tab');
    report.push(`Unfocused native playback advanced ${elapsed.toFixed(1)} seconds`);
    await page.evaluate(() => { const audio = document.querySelector('#audio'); audio.currentTime = audio.duration - 0.7; });
    await page.waitForFunction(() => document.querySelector('.simp-title').textContent === 'theme_104-Cotton Candy Island' && document.querySelector('#audio').currentTime > 0.5, null, {polling:100, timeout:15000});
    if (!(await page.evaluate(() => !document.hasFocus() && window.__originalAudio === document.querySelector('#audio')))) throw new Error('Audio element changed or tab regained focus');
    report.push('A real ended event advanced to the next song while unfocused, reusing the audio element');

    await page.evaluate(() => {
      document.querySelector('.simp-repeat').click();
      const audio = document.querySelector('#audio');
      audio.currentTime = audio.duration - 0.7;
    });
    await page.waitForFunction(() => document.querySelector('#audio').currentTime < 5 && !document.querySelector('#audio').paused, null, {polling:100, timeout:10000});
    if (!(await page.locator('#audio').evaluate(audio => audio.loop && audio.src.endsWith('theme_104.ogg')))) throw new Error('Native repeat changed tracks');
    report.push('Native single-song repeat works while unfocused');

    await page.evaluate(() => {
      document.querySelector('.simp-repeat').click();
      document.querySelector('.simp-plext').click();
      const audio = document.querySelector('#audio');
      audio.currentTime = audio.duration - 0.7;
    });
    await page.waitForFunction(() => document.querySelector('#audio').ended, null, {polling:100, timeout:10000});
    await page.bringToFront();
    if (!(await page.locator('#audio').evaluate(audio => audio.paused && audio.src.endsWith('theme_104.ogg')))) throw new Error('Returning to tab resumed stopped playback');
    report.push('Auto-next off stops at the end; returning to the tab does not restart it');
  } finally {
    await other.close();
    await page.bringToFront();
  }

  await page.evaluate(() => window.__mediaActions.previoustrack());
  await page.waitForFunction(() => document.querySelector('#audio').src.endsWith('theme_103.ogg') && document.querySelector('#audio').currentTime > 0.2);
  await page.evaluate(() => window.__mediaActions.nexttrack());
  await page.waitForFunction(() => document.querySelector('#audio').src.endsWith('theme_104.ogg') && document.querySelector('#audio').currentTime > 0.2);
  await page.getByRole('button', {name:'일시정지', exact:true}).click();
  await page.evaluate(() => {
    const audio = document.querySelector('#audio');
    window.__realPlay = audio.play;
    audio.play = () => Promise.reject(new DOMException('Test rejection', 'NotAllowedError'));
  });
  await page.getByRole('button', {name:'재생', exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.simp-status').textContent.includes('재생 버튼'));
  if (!(await page.locator('#audio').evaluate(audio => audio.paused))) throw new Error('Rejected play presented as playing');
  await page.evaluate(() => { document.querySelector('#audio').play = window.__realPlay; });
  report.push('Media next/previous work; rejected play leaves a paused, retryable UI');

  const fallback = await page.context().newPage();
  try {
    await fallback.addInitScript(() => Object.defineProperty(navigator, 'mediaSession', {value:undefined, configurable:true}));
    await fallback.goto(url);
    await fallback.waitForFunction(count => document.querySelectorAll('#ulist li').length === count, expectedTracks);
    await fallback.getByText('Click here to use').click();
    await fallback.getByRole('button', {name:'재생', exact:true}).click();
    await fallback.waitForFunction(() => document.querySelector('#audio').currentTime > 0.3);
    await fallback.getByRole('button', {name:'일시정지', exact:true}).click();
    report.push('Playback works without Media Session');
  } finally { await fallback.close(); }

  await page.unroute('**/wavesurfer.esm.js');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#waveform div')?.shadowRoot?.querySelector('canvas'));
  await page.getByText('Click here to use').click();
  await page.getByText('theme_179-夢路の花', {exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.5);
  await page.getByRole('button', {name:'일시정지', exact:true}).click();
  if (await page.locator('#audio').evaluate(audio => audio.src.startsWith('blob:'))) throw new Error('Visualizer replaced the native URL');
  if (errors.length) throw new Error(errors.join('\n'));
  report.push('Real waveform renders without replacing the native audio URL; no uncaught page errors');
  return report;
}
