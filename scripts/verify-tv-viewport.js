// Playwright CLI run-code; serve dist locally. Audio fixtures may link dist/music to the Mac library's current/music directory.
async (sourcePage) => {
  const base = new URL(sourcePage.url()).origin;
  const reports = [];
  for (const scenario of [
    { name: 'hd-tv', width: 960, height: 540, dpr: 4 / 3, marker: 'ReadizMusicTV/0.3.3 ReadizTVViewport/1920', expected: 1920 },
    { name: 'fhd-tv', width: 1280, height: 720, dpr: 1.5, marker: 'ReadizMusicTV/0.3.3 ReadizTVViewport/1920', expected: 1920 },
    { name: 'uhd-tv', width: 1920, height: 1080, dpr: 2, marker: 'ReadizMusicTV/0.3.3 ReadizTVViewport/1920', expected: 1920 },
    { name: 'old-tv', width: 960, height: 540, dpr: 4 / 3, marker: 'ReadizMusicTV/0.3.2', expected: 960 },
    { name: 'phone', width: 390, height: 844, dpr: 3, marker: 'ReadizMusic/0.3.3', expected: 390 },
  ]) {
    const context = await sourcePage.context().browser().newContext({
      viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: scenario.dpr,
      isMobile: true, userAgent: `Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 ${scenario.marker}`,
    });
    try {
      // Use the local catalog/media fixture, without relying on external TLS or catalog changes.
      await context.route('https://music.readiz.com/**', async route => {
        const response = await route.fetch({ url: route.request().url().replace('https://music.readiz.com', base) });
        await route.fulfill({ response });
      });
      await context.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { authenticated: false } }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/');
      await page.waitForFunction(() => window.BAMusicPlayback && document.querySelectorAll('.album-card').length > 0);
      await page.waitForFunction(() => document.querySelector('#waveform')?.firstElementChild?.shadowRoot?.querySelector('canvas')?.width > 0);
      const state = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight,
        visualWidth: visualViewport.width, visualHeight: visualViewport.height, scale: visualViewport.scale,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
        tv: window.BAMusicTV, viewport: document.querySelector('meta[name="viewport"]').content,
      }));
      if (Math.abs(state.width - scenario.expected) > 1 || Math.abs(state.visualWidth - scenario.expected) > 1)
        throw new Error(`${scenario.name}: viewport not fitted: ${JSON.stringify(state)}`);
      if (state.scrollWidth > state.width || (state.tv && state.scrollHeight > state.height))
        throw new Error(`${scenario.name}: page overflow: ${JSON.stringify(state)}`);
      if (state.tv) {
        await page.waitForFunction(() => document.activeElement.matches('.simp-plause'));
        await page.keyboard.press('ArrowDown');
        await page.waitForFunction(() => document.activeElement.matches('#ulist li'));
        const visible = await page.evaluate(() => {
          const rect = document.activeElement.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= visualViewport.height;
        });
        if (!visible) throw new Error(`${scenario.name}: remote focus outside visible viewport`);
      } else if (!await page.locator('.album-toggle').isVisible()) throw new Error('Phone album toggle hidden');
      if (errors.length) throw new Error(errors.join('; '));
      await page.screenshot({ path: `output/playwright/viewport-${scenario.name}.png` });
      reports.push({ name: scenario.name, ...state, errors });
    } finally {
      await context.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
  }
  return reports;
}
