// Playwright CLI: run-code "$(cat scripts/verify-albums.js)"
// Use an isolated browser profile and a local player with byte-range support.
async (page) => {
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
  const paths = await (await page.request.get(new URL('./musicList.json', page.url()).href)).json();
  const groups = new Map();
  for (const path of paths) {
    const folder = path.split('/').slice(2, -1).map(decodeURIComponent).join('/');
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(path);
  }
  const report = [];
  for (const seed of [0, 0.5, 0.999999]) {
    const fresh = await page.context().newPage();
    try {
      await fresh.addInitScript(seed => {
        localStorage.removeItem('ba-player-folder');
        localStorage.removeItem('ba-player-albums');
        Math.random = () => seed;
      }, seed);
      await fresh.goto(page.url());
      await fresh.waitForFunction(() => document.querySelector('#audio'));
      const ba = groups.get('Blue Archive');
      const expected = new URL(ba[Math.floor(seed * ba.length)], page.url()).href;
      if (!(await fresh.locator('#audio').evaluate((a, expected) => a.src === expected && a.paused, expected))) throw new Error('First track did not use a random BA track or autoplayed');
      if (await fresh.getByRole('button', {name:'무작위 재생',exact:true}).getAttribute('aria-pressed') !== 'true') throw new Error('Shuffle did not start enabled');
      await fresh.getByRole('button', {name:'다음 곡',exact:true}).click();
      if (await fresh.locator('#audio').evaluate((a, expected) => a.src === expected, expected)) throw new Error('Startup shuffle immediately repeated its first track');
      await fresh.getByRole('button', {name:'이전 곡',exact:true}).click();
      if (!(await fresh.locator('#audio').evaluate((a, expected) => a.src === expected, expected))) throw new Error('Startup shuffle did not return to its prepared first track');
    } finally { await fresh.close(); }
  }
  report.push('Fresh visits select only BA, enable shuffle and prepare a random first track without autoplay (three random values verified)');
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(() => { localStorage.removeItem('ba-player-folder'); localStorage.removeItem('ba-player-albums'); });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#audio'));
  const album = name => page.getByRole('checkbox', {name,exact:true});
  const visible = page.locator('#ulist li:not([hidden])');
  const source = () => page.locator('#audio').evaluate(audio => audio.src);
  const waitPlaying = () => page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 0.2);
  const expectSource = async path => {
    if (await source() !== new URL(path, page.url()).href) throw new Error('Wrong track: ' + path);
  };
  if (await page.getByRole('checkbox').count() !== groups.size || await visible.count() !== groups.get('Blue Archive').length || await page.locator('.album-card input:checked').count() !== 1 || !(await album('Blue Archive').isChecked())) throw new Error('Default BA selection is wrong');
  await page.waitForFunction(count => [...document.querySelectorAll('.album-cover img')].length === count && [...document.querySelectorAll('.album-cover img')].every(img => img.complete && img.naturalWidth === 512), groups.size);
  if (!(await page.evaluate(() => navigator.mediaSession.metadata.artwork[0]?.src.endsWith('/assets/albums/blue-archive.jpg')))) throw new Error('Media Session artwork is missing');
  report.push('All album covers load; Media Session receives the current cover');
  // Ordered boundary tests explicitly disable the default shuffle.
  await page.getByRole('button',{name:'무작위 재생',exact:true}).click();
  await page.evaluate(() => { window.__originalAudio = document.querySelector('#audio'); });
  await page.getByRole('button',{name:'전체 해제',exact:true}).click();
  if (await visible.count() || !(await page.getByRole('button',{name:'재생',exact:true}).isDisabled())) throw new Error('Empty queue still has tracks or allows playback');
  await page.evaluate(() => { window.__mediaActions.play(); window.__mediaActions.nexttrack(); window.__mediaActions.previoustrack(); });
  if (!(await page.locator('#audio').evaluate(a=>a.paused && !a.hasAttribute('src')))) throw new Error('Empty selection did not stop the audio');
  await album('Girls Band Cry').check();
  await album('Kessoku Band').check();
  const combined = [...groups.get('Girls Band Cry'), ...groups.get('Kessoku Band')];
  if (await visible.count() !== combined.length) throw new Error('Multiple albums were not combined');
  if (!(await visible.evaluateAll(rows=>rows.every(row=>['Girls Band Cry','Kessoku Band'].includes(row.dataset.folder))))) throw new Error('Unselected album is visible');
  await expectSource(combined[0]);
  if (!(await page.locator('#audio').evaluate(a=>a.paused))) throw new Error('Selecting albums unexpectedly autoplayed');
  report.push('All, none and multiple albums produce the correct combined queue; empty playback controls are safe');

  await page.getByRole('button',{name:'재생',exact:true}).click();
  await waitPlaying();
  await page.getByRole('button',{name:'일시정지',exact:true}).click();
  await page.locator('#audio').evaluate(a=>{ a.currentTime=15; });
  await album('Blue Archive').check();
  await album('Blue Archive').uncheck();
  await expectSource(combined[0]);
  if (!(await page.locator('#audio').evaluate(a=>a.paused && Math.abs(a.currentTime-15)<0.1))) throw new Error('Adding/removing another album reset playback');
  await visible.nth(groups.get('Girls Band Cry').length-1).click();
  await waitPlaying();
  await page.locator('#audio').evaluate(a=>{ a.currentTime=a.duration-0.3; });
  await page.waitForFunction(path=>document.querySelector('#audio').src===new URL(path,location.href).href && document.querySelector('#audio').currentTime>0.2, groups.get('Kessoku Band')[0]);
  await page.evaluate(()=>window.__mediaActions.previoustrack());
  await waitPlaying();
  await expectSource(groups.get('Girls Band Cry').at(-1));
  await page.evaluate(()=>window.__mediaActions.nexttrack());
  await waitPlaying();
  await expectSource(groups.get('Kessoku Band')[0]);
  await visible.last().click();
  await waitPlaying();
  await page.getByRole('button',{name:'다음 곡',exact:true}).click();
  await waitPlaying();
  await expectSource(combined[0]);
  report.push('Current position survives album additions; real ended and media controls cross selected album boundaries and wrap');

  const shuffleStart = await source();
  await page.getByRole('button',{name:'무작위 재생',exact:true}).click();
  if (await source() !== shuffleStart) throw new Error('Enabling shuffle changed the current track');
  const shuffled = [shuffleStart];
  for (let i=1;i<combined.length;i++) {
    await page.getByRole('button',{name:'다음 곡',exact:true}).click();
    await waitPlaying();
    const after=await source();
    if (shuffled.includes(after) || !combined.some(path=>new URL(path,page.url()).href===after)) throw new Error('Shuffle repeated before a full cycle or left the selected albums');
    shuffled.push(after);
  }
  await page.getByRole('button',{name:'다음 곡',exact:true}).click();
  await waitPlaying();
  if (await source() !== shuffled[0]) throw new Error('Shuffle did not wrap in its fixed order');
  for (let i=shuffled.length-1;i>=0;i--) {
    await page.getByRole('button',{name:'이전 곡',exact:true}).click();
    await waitPlaying();
    if (await source() !== shuffled[i]) throw new Error('Previous did not reverse the shuffled order');
  }
  await page.evaluate(()=>window.__mediaActions.nexttrack());
  await waitPlaying();
  if (await source() !== shuffled[1]) throw new Error('Media next did not reuse the shuffled order');
  await page.evaluate(()=>window.__mediaActions.previoustrack());
  await waitPlaying();
  if (await source() !== shuffled[0]) throw new Error('Media previous did not reverse the shuffled order');
  await visible.nth(3).click();
  await waitPlaying();
  const selectedPosition = shuffled.indexOf(await source());
  const following = shuffled[(selectedPosition + 1) % shuffled.length];
  await page.locator('#audio').evaluate(a=>{ a.currentTime=a.duration-0.3; });
  await page.waitForFunction(expected=>document.querySelector('#audio').src===expected && document.querySelector('#audio').currentTime>0.2, following);
  await page.getByRole('button',{name:'이전 곡',exact:true}).click();
  await waitPlaying();
  if (await source() !== shuffled[selectedPosition]) throw new Error('Direct selection or auto-next reshuffled the queue');
  await page.getByRole('button',{name:'무작위 재생',exact:true}).click();
  if (await source() !== shuffled[selectedPosition]) throw new Error('Disabling shuffle changed the current track');
  await page.getByRole('button',{name:'다음 곡',exact:true}).click();
  await waitPlaying();
  await expectSource(combined[4]);
  report.push('Shuffle visits every selected track once, wraps in a fixed order, and reverses exactly through buttons, Media Session and auto-next; direct selection preserves the order and disabling restores catalog order');
  await visible.first().click();
  await waitPlaying();
  await album('Girls Band Cry').uncheck();
  await waitPlaying();
  await expectSource(groups.get('Kessoku Band')[0]);
  if (!(await page.evaluate(()=>window.__originalAudio===document.querySelector('#audio') && document.querySelectorAll('audio').length===1))) throw new Error('Audio element was recreated');
  await page.getByRole('button',{name:'전체 해제',exact:true}).click();
  if (!(await page.locator('#audio').evaluate(a=>a.paused && !a.hasAttribute('src')))) throw new Error('Clearing playing albums left audio running');
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#audio'));
  if (await visible.count() || await page.locator('.album-card input:checked').count()) throw new Error('Empty choice was not restored');
  await album('Girls Band Cry').check();
  await album('Kessoku Band').check();
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#audio'));
  if (await visible.count()!==combined.length || !(await album('Girls Band Cry').isChecked()) || !(await album('Kessoku Band').isChecked()) || !(await page.locator('#audio').evaluate(a=>a.paused))) throw new Error('Album combination restore failed or autoplayed');
  report.push('Shuffle is scoped; removing the playing album moves within the selection; clearing stops playback; empty and multiple selections persist');

  await page.evaluate(()=>{localStorage.removeItem('ba-player-albums');localStorage.setItem('ba-player-folder','ETC');});
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#audio'));
  if (await visible.count()!==groups.get('ETC').length || !(await album('ETC').isChecked())) throw new Error('Legacy folder setting did not migrate');
  for (const name of ['theme_999-ED', 'Younha - Memories of kindness', 'Younha - Thanks to']) {
    await page.getByText(name,{exact:true}).click();
    await waitPlaying();
    if (!(await source()).includes('/music/ETC/') || !(await page.evaluate(() => navigator.mediaSession.metadata.artwork[0]?.src.endsWith('/assets/albums/etc.jpg')))) throw new Error('Moved track path or artwork is wrong: '+name);
    await page.getByRole('button',{name:'일시정지',exact:true}).click();
  }
  report.push('999-ED and the two Younha tracks play from ETC with ETC artwork');
  for (const saved of ['{bad', JSON.stringify({folders:['removed album']})]) {
    await page.evaluate(saved=>localStorage.setItem('ba-player-albums',saved),saved);
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#audio'));
    if (await visible.count()!==groups.get('Blue Archive').length) throw new Error('Invalid selection did not fall back to BA');
  }
  await page.getByRole('button',{name:'전체 해제',exact:true}).click();
  await page.getByRole('button',{name:'전체 선택',exact:true}).click();
  if (await visible.count()!==paths.length || !(await page.evaluate(()=>JSON.parse(localStorage.getItem('ba-player-albums')).all))) throw new Error('Select all did not save all mode');
  report.push('Legacy selections, malformed storage, removed albums and the select-all action behave correctly');

  const layouts=[];
  for (const [width,height] of [[1280,900],[700,600],[390,589],[263,520]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>scrollTo(0,0));
    const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,footer:document.querySelector('.simp-footer').getBoundingClientRect().bottom,list:document.querySelector('.simp-playlist').getBoundingClientRect().height,sidebarRight:document.querySelector('.simp-albums').getBoundingClientRect().right,albumBottom:document.querySelector('.simp-albums').getBoundingClientRect().bottom,mainTop:document.querySelector('.simp-main').getBoundingClientRect().top,mainLeft:document.querySelector('.simp-main').getBoundingClientRect().left,mainWidth:document.querySelector('.simp-main').getBoundingClientRect().width}));
    if (layout.overflow || layout.list<70 || (width>640 && (layout.sidebarRight>layout.mainLeft+1 || layout.footer>height+1)) || (width<=640 && layout.albumBottom>layout.mainTop+1)) throw new Error(JSON.stringify(layout));
    const before=await source();
    await page.getByRole('button',{name:'앨범 접기',exact:true}).click();
    if (await page.locator('.simp-albums').isVisible() || await source()!==before) throw new Error('Panel did not collapse or changed audio');
    if (width>640 && await page.locator('.simp-main').evaluate(el=>el.getBoundingClientRect().width)<=layout.mainWidth) throw new Error('Collapsing did not expand the player');
    await page.getByRole('button',{name:'앨범 펼치기',exact:true}).click();
    await album('Blue Archive').focus();
    await page.keyboard.press('Escape');
    if (await page.locator('.simp-albums').isVisible() || !(await page.getByRole('button',{name:'앨범 펼치기',exact:true}).evaluate(el=>el===document.activeElement))) throw new Error('Escape did not close the panel and restore focus');
    await page.getByRole('button',{name:'앨범 펼치기',exact:true}).click();
    layouts.push(layout);
  }
  report.push({collapsibleDesktopAndStackedMobile:layouts});

  const fallback=await page.context().newPage();
  try {
    await fallback.setViewportSize({width:1280,height:900});
    await fallback.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage blocked','SecurityError');}}));
    await fallback.route('**/assets/albums/*.jpg', route => route.abort());
    await fallback.goto(page.url());
    await fallback.waitForFunction(()=>document.querySelector('#audio'));
    if (await fallback.locator('#ulist li:not([hidden])').count()!==groups.get('Blue Archive').length) throw new Error('Blocked storage did not default to BA');
    await fallback.waitForFunction(() => !document.querySelector('.album-cover img'));
    await fallback.getByRole('button',{name:'전체 해제',exact:true}).click();
    await fallback.getByRole('checkbox',{name:'Kessoku Band',exact:true}).check();
    await fallback.getByRole('button',{name:'재생',exact:true}).click();
    await fallback.waitForFunction(()=>document.querySelector('#audio').currentTime>0.2);
    await fallback.getByRole('button',{name:'일시정지',exact:true}).click();
  } finally { await fallback.close(); }
  if (errors.length) throw new Error(errors.join('\n'));
  report.push('BA defaults, album selection and native playback work when storage and artwork are blocked; no page errors');
  return report;
}
