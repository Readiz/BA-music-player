// Playwright CLI run-code; validates the real player against the public catalog/media.
async (sourcePage) => {
  const base = new URL(sourcePage.url()).origin;
  const context = await sourcePage.context().browser().newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const ready = () => page.waitForFunction(() => !!window.BAMusicPlayback);
  const rows = () => page.locator('#ulist li:not([hidden])');
  const current = () => page.locator('#audio').evaluate(audio => audio.src);
  const playing = () => page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > .1);
  const focus = selector => page.evaluate(selector => document.activeElement.matches(selector), selector);
  const sourceId = row => row.locator('.simp-source').getAttribute('data-src');
  const report = [];
  try {
    // The static preview has no auth API; no test session or import is created.
    if (base.includes('127.0.0.1')) await page.route('**/api/auth/me', route => route.fulfill({json:{authenticated:false}}));
    await page.setViewportSize({width:1280,height:800});
    await page.goto(base);
    await ready();
    await page.locator('.simp-random').click();
    const allCount = await rows().count();
    const chosen = [await sourceId(rows().nth(1)), await sourceId(rows().nth(5))];
    await rows().nth(1).click();
    await playing();
    await page.locator('#audio').evaluate(audio => { audio.currentTime = 10; });
    const before = await current();
    await page.locator('.tracks-edit').click();
    await page.locator('.tracks-clear').click();
    check(await page.locator('.tracks-apply').isDisabled(), 'Empty selection can apply');
    check(await current() === before && await page.locator('#audio').evaluate(a => !a.paused && a.currentTime >= 10), 'Editing interrupted audio');
    await rows().nth(1).click();
    await rows().nth(5).click();
    check(await page.locator('#ulist [aria-checked=true]').count() === 2, 'Checkbox count is wrong');
    await page.locator('.tracks-apply').click();
    await playing();
    check(await rows().count() === 2 && await current() === before, 'Apply did not retain selected current track');
    check(await page.locator('#audio').evaluate(a => a.currentTime >= 10), 'Apply restarted retained current track');
    await page.locator('.simp-next').click();
    await playing();
    check(await current() === new URL(chosen[1], 'https://music.readiz.com/').href, 'Next escaped selection');
    await page.locator('.simp-prev').click();
    check(await current() === before, 'Previous escaped selection');
    await page.locator('.simp-random').click();
    for (let i = 0; i < 5; i++) {
      await page.locator('.simp-next').click();
      check(chosen.map(id => new URL(id, 'https://music.readiz.com/').href).includes(await current()), 'Shuffle escaped selection');
    }
    await playing();
    const endSource = await current();
    await page.locator('#audio').evaluate(a => { a.currentTime = a.duration - .2; });
    await page.waitForFunction(src => document.querySelector('#audio').src !== src, endSource);
    check(chosen.map(id => new URL(id, 'https://music.readiz.com/').href).includes(await current()), 'Natural next escaped selection');
    await page.locator('.tracks-edit').click();
    check(await rows().count() === allCount, 'Editor cannot reselect excluded tracks');
    await page.locator('.tracks-all').click();
    await page.keyboard.press('Escape');
    check(await rows().count() === 2 && await page.locator('.tv-exit-dialog').isHidden(), 'Back did not cancel draft');
    await page.reload();
    await ready();
    check(await rows().count() === 2 && await page.locator('#audio').evaluate(a => a.paused), 'Reload lost selection or autoplayed');
    await page.getByRole('checkbox',{name:'ETC',exact:true}).check();
    const etcCount = await page.locator('#ulist li[data-folder=ETC]:not([hidden])').count();
    check(await rows().count() === 2 + etcCount, 'Adding album lost prior subset');
    await page.getByRole('checkbox',{name:'Blue Archive',exact:true}).uncheck();
    await page.getByRole('checkbox',{name:'Blue Archive',exact:true}).check();
    check(await rows().count() === 2 + etcCount, 'Album toggle reset subset');
    await page.getByRole('checkbox',{name:'ETC',exact:true}).uncheck();
    await page.locator('.tracks-edit').click();
    await page.locator('.tracks-all').click();
    await page.locator('.tracks-apply').click();
    check(await rows().count() === allCount, 'All tracks restoration failed');
    const single = await sourceId(rows().nth(7));
    await page.locator('.tracks-edit').click();
    await page.locator('.tracks-clear').click();
    await rows().nth(7).click();
    await page.locator('.tracks-apply').click();
    await playing();
    check(await rows().count()===1 && await current()===new URL(single,'https://music.readiz.com/').href, 'Single selected track did not replace current track');
    await page.locator('.simp-next').click();
    check(await current()===new URL(single,'https://music.readiz.com/').href, 'Single-track next escaped selection');
    await page.locator('.tracks-edit').click();
    await page.locator('.tracks-all').click();
    await page.locator('.tracks-apply').click();
    await page.locator('.simp-plause').click();
    report.push('Real media: draft preserves playback/position; apply, next, previous, shuffle, ended, cancel, persistence and album toggles');

    const layouts = [];
    for (const [width,height] of [[1280,800],[768,1024],[390,844],[360,780]]) {
      await page.setViewportSize({width,height});
      await page.locator('.tracks-edit').click();
      if (width < 640 && await page.locator('.simp-albums').isVisible()) await page.locator('.album-toggle').click();
      const layout = await page.evaluate(() => ({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,heights:[...document.querySelectorAll('.track-actions button')].map(el=>el.getBoundingClientRect().height),listHeight:document.querySelector('#ulist').getBoundingClientRect().height}));
      check(!layout.overflow && layout.heights.every(h=>h===28) && layout.listHeight>100, 'Invalid layout '+JSON.stringify(layout));
      await page.locator('.track-actions').scrollIntoViewIfNeeded();
      await page.screenshot({path:`output/playwright/track-selection-${width}.png`});
      await page.locator('.tracks-edit').click();
      layouts.push(layout);
    }
    report.push({layouts});

    for (const [width,height] of [[1280,720],[1920,1080]]) {
      await page.setViewportSize({width,height});
      await page.goto(base+'/?tv=1');
      await ready();
      await page.waitForFunction(()=>document.activeElement.matches('.simp-plause'));
      await page.keyboard.press('ArrowDown');
      check(await focus('.tracks-edit'), 'TV cannot reach song selection');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      check(await focus('.tracks-clear'), 'TV did not skip disabled All');
      await page.keyboard.press('Enter');
      check(await focus('.tracks-all') && await page.locator('.tracks-apply').isDisabled(), 'Empty draft focus recovery failed');
      await page.keyboard.press('ArrowDown');
      check(await focus('#ulist [role=checkbox]'), 'TV cannot enter checkbox rows');
      const focusedId = await sourceId(page.locator('#ulist li:focus'));
      await page.keyboard.press('Enter');
      check(await page.locator('#ulist li:focus').getAttribute('aria-checked') === 'true', 'TV OK did not check exactly once');
      const direction = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#ulist li:not([hidden])')];
        return rows.indexOf(document.activeElement) === rows.length - 1 ? 'ArrowUp' : 'ArrowDown';
      });
      await page.keyboard.press(direction);
      await page.keyboard.press('Space');
      check(await page.locator('#ulist [aria-checked=true]').count() === 2, 'Space checkbox activation failed');
      const focusBefore = await sourceId(page.locator('#ulist li:focus'));
      await page.keyboard.press('MediaTrackNext');
      check(await sourceId(page.locator('#ulist li:focus')) === focusBefore, 'Track change stole checkbox focus');
      await page.keyboard.press('ArrowRight');
      check(await focus('.tracks-apply'), 'TV right shortcut failed');
      await page.keyboard.press('ArrowDown');
      check(await sourceId(page.locator('#ulist li:focus')) === focusBefore, 'Toolbar lost browsed row');
      await page.screenshot({path:`output/playwright/track-selection-tv-${width}.png`});
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await playing();
      check(await rows().count() === 2 && await focus('.simp-plause'), 'TV apply failed');
      check(await rows().locator('.simp-source').evaluateAll(els=>els.map(el=>el.dataset.src)).then(ids=>ids.includes(focusedId)), 'TV applied wrong selection');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      check(await focus('.tracks-edit') && await page.locator('.tv-exit-dialog').isHidden(), 'TV Back exited while editing');
      await page.keyboard.press('Escape');
      check(await page.locator('.tv-exit-dialog').isVisible(), 'TV exit confirmation regressed');
      await page.keyboard.press('Escape');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight), 'TV overflow');
      // Restore whole-album mode for the next independent viewport.
      await page.locator('.tracks-edit').click();
      await page.locator('.tracks-all').click();
      await page.locator('.tracks-apply').click();
    }
    report.push('TV 720p/1080p: direction/OK/Space, right apply shortcut, empty selection, focus during track changes, Back cancellation and exit');
    // Android bridge fixture checks the actual web/native queue contract, not device playback.
    const nativePage = await context.newPage();
    const nativeMediaRequests = [];
    nativePage.on('request', request => { if (new URL(request.url()).pathname.startsWith('/music/')) nativeMediaRequests.push(request.url()); });
    try {
      await nativePage.addInitScript(ids => {
        window.__nativeMessages = [];
        const state = {type:'state',id:ids[0],queue:ids,paused:true,position:23,duration:180,random:false,autoNext:true,repeat:false};
        const port = window.ReadizMusicNative = {
          postMessage(raw) {
            const message = JSON.parse(raw);
            window.__nativeMessages.push(message);
            if (message.type === 'queue') {
              const next = message.tracks[message.index]?.id || '';
              if (!message.preserve || next !== state.id) state.position = 0;
              state.queue = message.tracks.map(track=>track.id); state.id = next; state.paused = !message.play;
            } else if (message.type === 'play') state.paused = false;
            else if (message.type === 'pause') state.paused = true;
            else if (message.type === 'stop') { state.queue = []; state.id = ''; state.paused = true; }
            else if (message.type === 'options') Object.assign(state,{random:message.random,autoNext:message.autoNext,repeat:message.repeat});
            const reply = JSON.stringify(state);
            setTimeout(()=>port.onmessage?.({data:reply}),0);
          }
        };
      }, chosen);
      await nativePage.goto(base);
      await nativePage.waitForFunction(()=>!!window.BAMusicPlayback);
      check(await nativePage.locator('#ulist li:not([hidden])').count()===2, 'Native restore expanded queue');
      check(await nativePage.locator('#audio').evaluate(a=>!a.getAttribute('src') && a.paused), 'Native restore opened browser audio');
      await nativePage.locator('.tracks-edit').click();
      await nativePage.locator('#ulist li:not([hidden])').nth(3).click();
      await nativePage.locator('.tracks-apply').click();
      await nativePage.waitForFunction(()=>window.BAMusicNativeAudio.state.queue.length===3 && !window.BAMusicNativeAudio.paused);
      const nativeQueue = await nativePage.evaluate(()=>window.__nativeMessages.filter(m=>m.type==='queue').pop());
      check(nativeQueue.tracks.length===3 && nativeQueue.preserve && nativeQueue.play, 'Native apply did not use filtered queue/preserve');
      check(await nativePage.locator('#audio').evaluate(a=>!a.getAttribute('src') && a.paused), 'Native apply opened duplicate audio');
      // An explicit listen request must include an imported track in an ETC subset.
      const etc = await nativePage.locator('#ulist li[data-folder=ETC] .simp-source').evaluateAll(els=>els.map(el=>({src:el.dataset.src,title:el.textContent})));
      const imported = etc.find(track=>/\/(?:yt-|upload-)/.test(track.src));
      if (imported) {
        await nativePage.getByRole('checkbox',{name:'ETC',exact:true}).check();
        await nativePage.locator('.tracks-edit').click();
        await nativePage.locator('.tracks-clear').click();
        await nativePage.locator('#ulist li[data-folder="Blue Archive"]').nth(1).click();
        await nativePage.locator('.tracks-apply').click();
        await nativePage.evaluate(track=>window.BAMusicLibrary.listen(track),imported);
        check(await nativePage.locator('#ulist li:not([hidden]) .simp-source').evaluateAll((els,id)=>els.some(el=>el.dataset.src===id),imported.src), 'Listen did not include imported track');
      }
      check(nativeMediaRequests.length===0, 'Native UI fetched duplicate media');
      report.push('Android bridge fixture: active subset restoration, filtered queue apply, position preservation, no duplicate browser audio and explicit imported-track listen');
    } finally { await nativePage.close(); }
    check(!errors.length, errors.join('; '));
    return {passed:true,report,errors};
  } finally { await context.close(); }
}
