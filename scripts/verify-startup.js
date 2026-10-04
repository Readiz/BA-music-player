// Playwright CLI: run-code "$(cat scripts/verify-startup.js)"
// Run in an isolated browser profile. Tests real gestures plus forced policy denials.
async (page) => {
  const url=page.url();
  const report=[];
  const fresh=async () => {
    const tab=await page.context().newPage();
    await tab.setViewportSize({width:1280,height:900});
    await tab.addInitScript(()=>{
      localStorage.removeItem('ba-player-folder');
      localStorage.removeItem('ba-player-albums');
      window.__playCalls=[];
      const nativePlay=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function () {
        window.__playCalls.push({active:navigator.userActivation?.isActive});
        return nativePlay.call(this);
      };
    });
    return tab;
  };
  for (const gesture of ['mouse','keyboard','row-keyboard']) {
    const tab=await fresh();
    try {
      await tab.goto(url);
      await tab.waitForFunction(()=>document.querySelector('#audio'));
      if (await tab.locator('#loading-overlay').count() || await tab.getByText('Click here to use',{exact:true}).count()) throw new Error('Startup overlay remains');
      if (!(await tab.locator('#audio').evaluate(a=>a.paused)) || await tab.evaluate(()=>window.__playCalls.length)) throw new Error('Playback was attempted without a gesture');
      if (gesture==='mouse') await tab.getByRole('button',{name:'재생',exact:true}).click();
      if (gesture==='keyboard') await tab.keyboard.press('Space');
      if (gesture==='row-keyboard') { await tab.locator('#ulist li:not([hidden])').first().focus(); await tab.keyboard.press('Enter'); }
      await tab.waitForFunction(()=>document.querySelector('#audio').currentTime>0.3 && !document.querySelector('#audio').paused);
      const calls=await tab.evaluate(()=>window.__playCalls);
      if (calls.length!==1 || !calls[0].active) throw new Error('First playback did not use the trusted gesture: '+JSON.stringify(calls));
      await tab.getByRole('button',{name:'일시정지',exact:true}).click();
      report.push(`${gesture}: first gesture starts native playback without a startup screen`);
    } finally {await tab.close();}
  }
  const tab=await fresh();
  try {
    await tab.goto(url);
    await tab.waitForFunction(()=>document.querySelector('#audio'));
    await tab.getByRole('button',{name:'앨범 접기',exact:true}).click();
    await tab.getByRole('button',{name:'앨범 펼치기',exact:true}).click();
    const checkbox=tab.getByRole('checkbox',{name:'ETC',exact:true});
    await checkbox.focus();
    await tab.keyboard.press('Space');
    await tab.keyboard.press('Space');
    await tab.evaluate(()=>document.activeElement.blur());
    await tab.keyboard.press('a');
    await tab.keyboard.press('Shift+Space');
    if (await tab.evaluate(()=>window.__playCalls.length)) throw new Error('Album input or unrelated keys started playback');
    for (const synchronous of [false,true]) {
      await tab.evaluate(synchronous=>{
        const a=document.querySelector('#audio');
        window.__nativePlay=a.play;
        a.play=()=>{const error=new DOMException('Test policy denial','NotAllowedError');if(synchronous)throw error;return Promise.reject(error);};
      },synchronous);
      await tab.getByRole('button',{name:'재생',exact:true}).click();
      await tab.waitForFunction(()=>document.querySelector('.simp-status').textContent.includes('재생 버튼을 다시'));
      if (!(await tab.locator('#audio').evaluate(a=>a.paused)) || !(await tab.getByRole('button',{name:'재생',exact:true}).isVisible())) throw new Error('Denied playback is presented as playing');
      await tab.evaluate(()=>{document.querySelector('#audio').play=window.__nativePlay;document.activeElement.blur();});
      await tab.keyboard.press('Space');
      await tab.waitForFunction(()=>document.querySelector('#audio').currentTime>0.3 && !document.querySelector('#audio').paused);
      if (!(await tab.locator('.simp-status').isHidden())) throw new Error('Policy message did not clear after recovery');
      await tab.getByRole('button',{name:'일시정지',exact:true}).click();
    }
    report.push('Album controls and unrelated keys stay silent; promise and synchronous play denials recover with a real key gesture');
  } finally {await tab.close();}
  const retry=await fresh();
  try {
    let requests=0;
    await retry.route('**/musicList.json',route=>++requests===1 ? route.fulfill({status:503,body:'unavailable'}) : route.continue());
    await retry.goto(url);
    await retry.getByRole('button',{name:'다시 불러오기',exact:true}).waitFor();
    if (await retry.locator('#loading-overlay').count() || await retry.locator('#audio').count()) throw new Error('Failed startup created an overlay or audio');
    await retry.getByRole('button',{name:'앨범 접기',exact:true}).click();
    await retry.getByRole('button',{name:'앨범 펼치기',exact:true}).click();
    await retry.getByRole('button',{name:'다시 불러오기',exact:true}).click();
    await retry.waitForFunction(()=>document.querySelector('#audio'));
    if (await retry.locator('#audio').count()!==1 || await retry.evaluate(()=>window.__playCalls.length)) throw new Error('List retry duplicated audio or autoplayed');
    await retry.getByRole('button',{name:'재생',exact:true}).click();
    await retry.waitForFunction(()=>document.querySelector('#audio').currentTime>0.3);
    await retry.getByRole('button',{name:'일시정지',exact:true}).click();
    report.push('A failed playlist has an inline retry; the panel still works, and retry creates one paused player');
  } finally {await retry.close();}
  return report;
}
