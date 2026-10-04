async (sourcePage) => {
  const base = new URL(sourcePage.url()).origin;
  const context = await sourcePage.context().browser().newContext();
  const page = await context.newPage();
  try {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const state = () => page.evaluate(() => ({
    focus: document.activeElement.className,
    text: document.activeElement.textContent,
    folder: document.activeElement.value,
    paused: document.querySelector('audio').paused,
    current: document.querySelector('audio').currentTime,
    src: document.querySelector('audio').src,
    selected: document.querySelector('#ulist .simp-active')?.textContent,
    seeking: document.documentElement.classList.contains('remote-seeking'),
  }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Math.random = () => 0; localStorage.removeItem('ba-player-albums'); });
  await page.setViewportSize({width:1280,height:720});
  await page.goto(base + '/?tv=1');
  await page.waitForFunction(() => window.BAMusicPlayback && document.querySelector('audio').duration > 0);
  check((await state()).paused, 'Initial TV load started playback');
  check((await state()).focus.includes('album-toggle'), 'Initial TV focus missing');
  await page.keyboard.press('ArrowDown');
  check((await state()).folder === 'Blue Archive', 'Down did not enter albums');
  await page.keyboard.press('ArrowRight');
  check((await state()).focus.includes('simp-plause'), 'Right did not reach playback');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').currentTime > .1);
  await page.keyboard.press('Enter');
  check((await state()).paused, 'OK toggled more than once or pause failed');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  check((await state()).focus.includes('simp-progress'), 'Slider unreachable');
  const before = (await state()).current;
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  check((await state()).seeking && (await state()).current >= before+4.8 && (await state()).paused, 'Seeking must preserve paused state');
  await page.keyboard.press('Escape');
  check(!(await state()).seeking && (await state()).focus.includes('simp-progress'), 'Back did not leave seeking');
  await page.keyboard.press('ArrowDown');
  const firstRow = (await state()).text;
  for (let i=0;i<12;i++) await page.keyboard.press('ArrowDown');
  const remembered = (await state()).text;
  check(firstRow !== remembered, 'Queue navigation did not advance');
  check(await page.evaluate(() => { const r=document.activeElement.getBoundingClientRect(),v=document.querySelector('#ulist').getBoundingClientRect(); return r.top>=v.top && r.bottom<=v.bottom; }), 'Focused row scrolled out of view');
  await page.keyboard.press('ArrowLeft');
  check((await state()).folder === 'Blue Archive', 'Queue left lost album memory');
  await page.keyboard.press('ArrowRight');
  check((await state()).text === remembered, 'Album right lost queue memory');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  check((await state()).selected === remembered, 'OK selected the wrong track');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  check(await page.locator('.tv-exit-dialog').isVisible(), 'Back did not open exit confirmation');
  check((await state()).focus.includes('exit-cancel') && !(await state()).paused, 'Exit must default to cancel and keep playing');
  await page.keyboard.press('Enter');
  check(await page.locator('.tv-exit-dialog').isHidden(), 'Cancel failed');
  check((await state()).folder === 'Blue Archive', 'Exit cancel did not restore focus');
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Unidentified',keyCode:19,bubbles:true,cancelable:true})));
  check((await state()).paused, 'Samsung media pause failed');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  check((await state()).focus.includes('albums-clear'), 'Clear action unreachable');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.simp-empty').hidden === false && document.activeElement.matches('.album-card input'));
  check((await state()).paused, 'Clearing albums must stop playback');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('audio').duration > 0);
  check((await state()).paused, 'Selecting an album started playback');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.screenshot({path:'output/playwright/tv-720-focus.png'});
  await page.setViewportSize({width:1920,height:1080});
  await page.screenshot({path:'output/playwright/tv-1080-focus.png'});
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'TV page overflow');
  // Physical media keys may be registered natively; verify numeric event routing independently.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Unidentified',keyCode:413,bubbles:true,cancelable:true})));
  check((await state()).paused && (await state()).current < .1, 'Media stop failed');
  await page.locator('.simp-plause').click();
  check(await page.evaluate(() => !document.documentElement.classList.contains('remote-mode')), 'Mouse did not release remote focus');
  await page.locator('.simp-plause').click();
  await page.goto(base + '/');
  await page.waitForFunction(() => window.BAMusicPlayback);
  await page.setViewportSize({width:390,height:844});
  check(await page.locator('.app-exit').isHidden(), 'TV controls leaked to mobile');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
  await page.screenshot({path:'output/playwright/tv-mobile-regression.png'});
  let failCatalog = true;
  await page.route('**/musicList.json', route => failCatalog ? route.fulfill({status:503,body:'unavailable'}) : route.continue());
  await page.setViewportSize({width:1280,height:720});
  await page.goto(base+'/?tv=1');
  await page.waitForFunction(() => !document.querySelector('.library-retry').hidden);
  await page.keyboard.press('ArrowDown');
  check(await page.locator('.library-retry').evaluate(el=>el===document.activeElement), 'Remote retry unreachable when catalog fails');
  failCatalog = false;
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.BAMusicPlayback && document.querySelector('.library-retry').hidden);
  check((await state()).paused, 'Remote retry started playback');
  check(errors.length === 0, 'Page errors: '+errors.join('; '));
  return {passed:true, checks:'720p/1080p focus, real audio, seek, queue scroll/memory, exit cancel, album clear/reselect, Samsung pause/stop, pointer mode, mobile layout', errors};
  } finally { await context.close(); }
}
