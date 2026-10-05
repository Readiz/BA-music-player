async (sourcePage) => {
  const base = new URL(sourcePage.url()).origin;
  const context = await sourcePage.context().browser().newContext();
  const page = await context.newPage();
  try {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const active = selector => page.evaluate(selector => document.activeElement.matches(selector), selector);
    const currentQueueFocused = () => page.evaluate(() => document.activeElement === document.querySelector('#ulist li.simp-active:not([hidden])'));
    const currentQueueVisible = () => page.evaluate(() => {
      const row = document.querySelector('#ulist li.simp-active:not([hidden])').getBoundingClientRect();
      const list = document.querySelector('#ulist').getBoundingClientRect();
      // scrollTop is rounded at the last row when the viewport has a fractional height.
      return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
    });
    const state = () => page.evaluate(() => ({
      focus: document.activeElement.className,
      text: document.activeElement.textContent,
      folder: document.activeElement.value,
      paused: document.querySelector('audio').paused,
      current: document.querySelector('audio').currentTime,
      selected: document.querySelector('#ulist .simp-active')?.textContent,
      seeking: document.documentElement.classList.contains('remote-seeking'),
    }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Force the initial random track outside the first screen of the queue.
    await page.addInitScript(() => { Math.random = () => .999999; localStorage.removeItem('ba-player-albums'); });
    for (const [width,height] of [[1280,720],[1920,1080]]) {
      await page.setViewportSize({width,height});
      await page.goto(base+'/?tv=1');
      await page.waitForFunction(() => window.BAMusicPlayback && document.querySelector('audio').duration > 0 && document.activeElement.matches('.simp-plause'));
      await page.waitForFunction(() => {
        const waveform = document.querySelector('#waveform');
        const host = waveform.firstElementChild;
        return getComputedStyle(waveform).display !== 'none' && getComputedStyle(waveform).visibility === 'visible' &&
          host && host.shadowRoot && host.shadowRoot.querySelector('canvas')?.width > 0;
      });
      check((await state()).paused, 'TV startup autoplayed');
      check(await currentQueueVisible(), 'Initial random track is outside the queue viewport');
      check(await page.locator('.album-toggle').isHidden(), 'TV album toggle remains visible');
      check(await page.locator('.app-header button:visible').count() === 0, 'TV header still has buttons');
      for(let i=0;i<8;i++) await page.keyboard.press('ArrowUp');
      check(await active('.simp-plause'), 'Repeated Up left the top controls');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('audio').currentTime>.1 && !document.querySelector('audio').paused);
      await page.keyboard.press('Enter');
      check((await state()).paused, 'OK did not pause once');
      await page.keyboard.press('ArrowRight');
      check(await active('.simp-next'), 'Controls skipped next');
      await page.keyboard.press('ArrowRight');
      check(await active('.simp-progress'), 'Controls skipped slider');
      const before=(await state()).current;
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      check((await state()).seeking && (await state()).current>=before+4.8 && (await state()).paused, 'Seek changed paused state');
      await page.keyboard.press('Escape');
      check(!(await state()).seeking && await active('.simp-progress') && await page.locator('.tv-exit-dialog').isHidden(), 'Seek Back did not finish editing');
      await page.keyboard.press('ArrowDown');
      check(await currentQueueFocused() && await currentQueueVisible(), 'First queue entry missed the initial random track');
      for(let i=0;i<12;i++) await page.keyboard.press('ArrowUp');
      const remembered=(await state()).text;
      check(await page.evaluate(() => {const r=document.activeElement.getBoundingClientRect(),v=document.querySelector('#ulist').getBoundingClientRect();return r.top>=v.top && r.bottom<=v.bottom;}), 'Focused row left viewport');
      await page.keyboard.press('ArrowRight');
      check((await state()).text===remembered && await active('#ulist li'), 'Queue Right jumped to upper controls');
      await page.keyboard.press('ArrowLeft');
      check((await state()).folder==='Blue Archive', 'Queue Left lost album focus');
      check(await page.evaluate(() => {const input=document.activeElement,card=input.closest('.album-card');return getComputedStyle(card).outlineStyle!=='none' && getComputedStyle(input).outlineStyle==='none' && getComputedStyle(card.querySelector('.album-cover')).outlineStyle==='none';}), 'Album has competing focus outlines');
      await page.keyboard.press('ArrowDown');
      check((await state()).folder==='ETC', 'Album Down skipped its next card');
      await page.keyboard.press('ArrowUp');
      check((await state()).folder==='Blue Archive', 'Album Up skipped previous card');
      await page.keyboard.press('ArrowRight');
      check(await active('.simp-progress'), 'Album Right did not return to the last playback controller');
      await page.keyboard.press('ArrowDown');
      check((await state()).text===remembered, 'Returning through controls lost the browsed queue position');
      await page.locator('#ulist li:not([hidden])').nth(12).focus();
      for(let i=0;i<20;i++) await page.keyboard.press('ArrowUp');
      check(await active('.simp-progress'), 'Repeated queue Up did not stop at last controller');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('audio').paused);
      check((await state()).selected===(await state()).text, 'Queue OK selected another row');
      const focusBeforeBack=(await state()).text;
      await page.keyboard.press('Escape');
      check(await page.locator('.tv-exit-dialog').isVisible() && await active('.exit-cancel') && !(await state()).paused, 'Single Back did not show safe exit confirmation');
      await page.evaluate(() => window.BAMusicPlayback.next());
      check(await active('.exit-cancel'), 'Track change stole exit dialog focus');
      await page.keyboard.press('Escape');
      check(await page.locator('.tv-exit-dialog').isHidden() && await currentQueueFocused(), 'Exit Back did not restore the new track focus');
      check((await state()).text!==focusBeforeBack, 'Next track did not change while exit dialog was open');
      for(let i=0;i<40;i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('MediaTrackNext');
      await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').duration > 0);
      check(await currentQueueFocused() && await currentQueueVisible(), 'Media next did not correct queue focus and scrolling');
      await page.keyboard.press('ArrowLeft');
      const albumBeforeChange=(await state()).folder;
      await page.keyboard.press('MediaTrackPrevious');
      check((await state()).folder===albumBeforeChange && await active('.album-card input'), 'Track change stole album focus');
      await page.keyboard.press('ArrowRight');
      check(await active('.simp-controls button, .simp-progress'), 'Album Right returned to the playlist after a track change');
      await page.keyboard.press('ArrowDown');
      check(await currentQueueFocused() && await currentQueueVisible(), 'Controls Down returned to a stale track');
      const beforeAutoNext=(await state()).selected;
      await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').duration > 0);
      await page.evaluate(() => { const audio=document.querySelector('audio'); audio.currentTime=Math.max(0,audio.duration-.15); });
      await page.waitForFunction(before => document.querySelector('#ulist .simp-active').textContent !== before, beforeAutoNext);
      check(await currentQueueFocused() && await currentQueueVisible(), 'Natural ended transition did not correct queue focus');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowRight');
      await page.locator('.simp-next').focus();
      await page.keyboard.press('Enter');
      check(await active('.simp-next'), 'Next-button track change stole controller focus');
      await page.keyboard.press('ArrowDown');
      check(await currentQueueFocused() && await currentQueueVisible(), 'Next button left a stale queue destination');
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Unidentified',keyCode:19,bubbles:true,cancelable:true})));
      check((await state()).paused, 'Samsung pause failed');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      check(await active('.albums-select-all'), 'Top album did not reach first action');
      await page.keyboard.press('ArrowUp');
      check(await active('.simp-controls button, .simp-progress'), 'Top album actions did not reach controls');
      await page.screenshot({path:'output/playwright/focus-'+width+'.png'});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight), 'TV page overflow');
    }
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    check(await active('.albums-clear'), 'Clear action unreachable');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.simp-empty').hidden && document.activeElement.matches('.album-card input'));
    check((await state()).paused, 'Clear failed to stop playback');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('audio').duration>0);
    check((await state()).paused, 'Album select started playback');
    await page.locator('.simp-plause').click();
    check(await page.evaluate(()=>!document.documentElement.classList.contains('remote-mode')), 'Pointer did not release remote mode');
    await page.goto(base+'/');
    await page.waitForFunction(()=>window.BAMusicPlayback);
    await page.setViewportSize({width:390,height:844});
    check(await page.locator('.album-toggle').isVisible(), 'Mobile lost album toggle');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'Mobile overflow');
    let failCatalog=true;
    await page.route(url=>url.pathname.endsWith('/musicList.json'),route=>failCatalog?route.fulfill({status:503,body:'unavailable'}):route.continue());
    await page.setViewportSize({width:1280,height:720});
    await page.goto(base+'/?tv=1');
    await page.waitForFunction(()=>document.activeElement.matches('.library-retry'));
    failCatalog=false;
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.BAMusicPlayback && document.activeElement.matches('.simp-plause'));
    check((await state()).paused, 'Retry autoplayed');
    check(await currentQueueVisible(), 'Retry left the initial random track outside the queue viewport');
    await page.keyboard.press('ArrowDown');
    check(await currentQueueFocused(), 'Retry queue entry missed the initial random track');
    check(errors.length===0, 'Page errors: '+errors.join('; '));
    return {passed:true,checks:'720p/1080p initial random track visibility and queue focus, album return to controls, media/button/natural-ended queue correction, preserved album/controller/dialog focus, top boundary, real playback, seek, clear/retry and mobile toggle',errors};
  } finally { await context.close(); }
}
