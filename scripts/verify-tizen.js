async (page) => {
  const base = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({viewport:{width:1280,height:720},userAgent:'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 Chrome/63.0.3239.84 TV Safari/537.36'});
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  let exits = 0;
  await tab.exposeFunction('__launcherExit', () => { exits++; });
  await tab.addInitScript(() => {
    window.ResizeObserver = undefined;
    Element.prototype.replaceChildren = undefined;
    Math.random = () => 0;
    localStorage.removeItem('ba-player-albums');
    if (location.pathname === '/__launcher/') window.tizen = {tvinputdevice:{registerKey(){}},application:{getCurrentApplication:()=>({exit:()=>window.__launcherExit()})}};
  });
  // Fetch exactly the packaged launcher files through the local preview route.
  const archive = await (await page.request.get(base+'/app.wgt')).body();
  // The CLI sandbox has no filesystem API: a test-only preview server exposes the source launcher.
  await tab.goto(base+'/__launcher/');
  await tab.waitForURL(base+'/?tv=1');
  await tab.waitForFunction(() => window.BAMusicPlayback && document.querySelector('audio').duration > 0);
  const depth=await tab.evaluate(()=>({depth:sessionStorage.getItem('music:launcher-depth'),length:history.length,tv:window.BAMusicTV,apis:!!window.tizen}));
  if (!depth.tv || depth.apis || !(Number(depth.depth)>0) || Number(depth.depth)>=depth.length) throw new Error('Hosted launcher history incorrect: '+JSON.stringify(depth));
  await tab.waitForFunction(() => document.activeElement.matches('.simp-plause'));
  await tab.keyboard.press('Enter');
  await tab.waitForFunction(() => document.querySelector('audio').currentTime > .2 && !document.querySelector('audio').paused);
  await tab.keyboard.press('Escape');
  await tab.keyboard.press('ArrowRight');
  await tab.keyboard.press('Enter');
  await tab.waitForURL(base+'/__launcher/');
  await tab.waitForFunction(() => history.state && history.state.readizMusicHosted);
  for(let i=0; i<20 && exits===0; i++) await tab.waitForTimeout(100);
  if (exits !== 1 || errors.length) throw new Error('Return exit failed: '+JSON.stringify({exits,errors}));
  await context.close();
  return {passed:true,archiveBytes:archive.length,depth,exits,errors,boundary:'Tizen user agent and missing APIs simulated in Chrome; not physical TV evidence'};
}
