// Playwright CLI run-code against the isolated upload fixture.
async page => {
  page.setDefaultTimeout(15000);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.unrouteAll({ behavior: 'wait' });
  let authenticated = false, delayed, delayNext = false, checks = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://music.readiz.com/**', async route => {
    const url = new URL(route.request().url());
    const response = await page.request.get('http://127.0.0.1:4543/__pages/' + url.pathname.slice(1) + url.search);
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': 'http://127.0.0.1:4543', 'access-control-allow-credentials': 'true' } });
  });
  await page.route('**/api/catalog', async route => {
    const result = await (await page.request.get('http://127.0.0.1:4543/__pages/api/catalog')).json();
    await route.fulfill({ json: { ...result, authenticated }, headers: { 'access-control-allow-origin': 'http://127.0.0.1:4543', 'access-control-allow-credentials': 'true' } });
  });
  await page.route('**/api/auth/me', async route => {
    checks++;
    const value = authenticated;
    if (delayNext) { delayNext = false; await new Promise(resolve => { delayed = resolve; }); }
    await route.fulfill({ json: { authenticated: value, enabled: true } });
  });
  await page.route('**/api/imports', route => route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { jobs: [] } : { error: '로그인이 필요합니다.' } }));
  await page.route('**/api/auth/logout', route => { authenticated = false; return route.fulfill({ json: { ok: true } }); });
  await page.goto('http://127.0.0.1:4543/');
  await page.locator('.album-card').first().waitFor();
  // Isolate import's stale-response behavior from the catalog's deliberate reload.
  // The fresh-document login below restores the real catalog access controller.
  await page.evaluate(() => { window.BAMusicAccess.refresh = async () => {}; });
  assert(!await page.locator('.music-add-dialog').isVisible(), 'Opening the player opened the add dialog');
  await page.getByRole('button', { name: '음악 추가', exact: true }).click();
  await page.getByRole('link', { name: '디스코드로 로그인' }).waitFor();
  const addLogin = new URL(await page.getByRole('link', { name: '디스코드로 로그인' }).getAttribute('href'), page.url());
  assert(addLogin.searchParams.get('returnTo') === '/#add-music', 'Add login did not preserve its explicit destination');
  await page.evaluate(() => { window.loginReturnDocument = true; });
  authenticated = true;
  const before = checks;
  await page.evaluate(() => { location.hash = 'add-music'; });
  await page.locator('.music-add-account').waitFor({ state: 'visible' });
  assert(checks > before, 'Same-document handoff did not recheck authentication');
  assert(await page.evaluate(() => window.loginReturnDocument && !location.hash), 'Handoff reloaded the player or left a stale hash');
  await page.locator('[data-method=file]').click();
  await page.locator('.music-file-form [type=file]').setInputFiles('output/playwright/music-upload/sample.wav');
  await page.locator('.music-file-form [type=text]').fill('복귀 후에도 유지할 제목');
  authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.music-add-guest').waitFor({ state: 'visible' });
  // An old foreground request must not overwrite the newer successful handoff.
  delayNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  for (let count = 0; !delayed && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 10));
  assert(delayed, 'Delayed foreground request did not start');
  authenticated = true;
  await page.evaluate(() => { location.hash = 'add-music'; });
  await page.locator('.music-add-account').waitFor({ state: 'visible' });
  const oldResponse = page.waitForResponse('**/api/auth/me');
  delayed();
  await oldResponse;
  await page.waitForTimeout(100);
  assert(await page.locator('.music-add-account').isVisible(), 'Stale guest response undid handoff');
  assert(await page.locator('.music-file-form [type=text]').inputValue() === '복귀 후에도 유지할 제목', 'Return discarded the edited title');
  assert(await page.locator('.music-file-form [type=file]').evaluate(input => input.files.length === 1), 'Return discarded the selected file');
  await page.getByRole('button', { name: '음악 추가 닫기' }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert(!await page.locator('.music-add-dialog').isVisible(), 'Foreground opened a closed modal');
  // The new Android app loads the ordinary player after installing the cookie.
  // A normal login must not reopen the add dialog on load or foreground return.
  await Promise.all([
    page.waitForNavigation(),
    page.evaluate(() => { history.replaceState(history.state, '', '/'); location.reload(); }),
  ]);
  await page.locator('.music-add-account').waitFor({ state: 'attached' });
  await page.waitForFunction(() => !document.querySelector('.music-add-account').hidden);
  await page.locator('.music-account').filter({ hasText: '로그아웃' }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert(!await page.locator('.music-add-dialog').isVisible(), 'Ordinary login opened the add dialog');
  await Promise.all([
    page.waitForNavigation(),
    page.evaluate(() => { history.replaceState(history.state, '', '/#add-music'); location.reload(); }),
  ]);
  await page.locator('.music-add-account').waitFor({ state: 'visible' });
  await page.locator('.music-account').filter({ hasText: '로그아웃' }).waitFor();
  assert(await page.evaluate(() => !location.hash), 'Explicit import return left a stale hash');
  await page.getByRole('button', { name: '음악 추가 닫기' }).click();
  const controls = [];
  for (const width of [1280, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '음악 추가', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.music-add-status').textContent === '');
    await page.locator('[data-method=file]').click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Overflow at ' + width);
    const height = await page.locator('.music-file-form [type=submit]').evaluate(el => el.getBoundingClientRect().height);
    assert(height > 0, 'Upload control is hidden at ' + width);
    controls.push({ width, uploadButtonHeight: height });
    if (width === 390) await page.screenshot({ path: 'output/playwright/music-upload/login-return-mobile.png' });
    await page.getByRole('button', { name: '음악 추가 닫기' }).click();
  }
  await page.getByRole('button', { name: '음악 추가', exact: true }).click();
  await page.locator('.music-add-dialog').getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.locator('.music-account').filter({ hasText: '로그인' }).waitFor();
  assert(!errors.length, errors.join('; '));
  await page.unrouteAll({ behavior: 'wait' });
  return { normalLoginKeepsDialogClosed: true, explicitAddDestination: true, sameDocumentReturn: true, foregroundRefresh: true, staleResponseIgnored: true, fileAndTitlePreserved: true, logout: true, widths: [1280, 768, 390, 360], controls, errors };
}
