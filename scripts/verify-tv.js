async (sourcePage) => {
  const base = new URL(sourcePage.url()).origin;
  const context = await sourcePage.context().browser().newContext();
  const page = await context.newPage();
  try {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const active = selector => page.evaluate(selector => document.activeElement.matches(selector), selector);
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
    // A last-track startup used to scroll the queue away from its controls.
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
      check(await page.locator('.album-toolbar').isHidden(), 'TV album toolbar remains visible');
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
      check(await page.evaluate(() => document.activeElement===document.querySelector('#ulist li:not([hidden])')), 'First queue entry jumped to random playing track');
      for(let i=0;i<12;i++) await page.keyboard.press('ArrowDown');
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
      check((await state()).text===remembered, 'Album Right lost queue memory');
      for(let i=0;i<20;i++) await page.keyboard.press('ArrowUp');
      check(await active('.simp-progress'), 'Repeated queue Up did not stop at last controller');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('audio').paused);
      check((await state()).selected===(await state()).text, 'Queue OK selected another row');
      const focusBeforeBack=(await state()).text;
      await page.keyboard.press('Escape');
      check(await page.locator('.tv-exit-dialog').isVisible() && await active('.exit-cancel') && !(await state()).paused, 'Single Back did not show safe exit confirmation');
      await page.keyboard.press('Escape');
      check(await page.locator('.tv-exit-dialog').isHidden() && (await state()).text===focusBeforeBack, 'Exit Back did not restore exact focus');
      const scroll=await page.locator('#ulist').evaluate(el=>el.scrollTop);
      await page.evaluate(() => window.BAMusicPlayback.next());
      check(await page.locator('#ulist').evaluate((el,scroll)=>el.scrollTop===scroll,scroll), 'Track change moved TV queue scrolling');
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
    check(await page.locator('.album-toolbar').isVisible(), 'Mobile lost album toggle');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'Mobile overflow');
    let failCatalog=true;
    await page.route('**/musicList.json',route=>failCatalog?route.fulfill({status:503,body:'unavailable'}):route.continue());
    await page.setViewportSize({width:1280,height:720});
    await page.goto(base+'/?tv=1');
    await page.waitForFunction(()=>document.activeElement.matches('.library-retry'));
    failCatalog=false;
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.BAMusicPlayback && document.activeElement.matches('.simp-plause'));
    check((await state()).paused, 'Retry autoplayed');
    check(errors.length===0, 'Page errors: '+errors.join('; '));
    return {passed:true,checks:'720p/1080p top boundary, linear controls/albums, one focus outline, single Back popup, scroll ownership, real playback, seek, clear/retry and mobile toggle',errors};
  } finally { await context.close(); }
}
