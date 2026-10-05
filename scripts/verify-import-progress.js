// Playwright CLI run-code against the isolated upload fixture, never production.
async page => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const job = { id: 'progress-fixture', title: '진행 확인 <script>', status: 'syncing', syncStage: 'waiting', createdAt: Date.now() - 6 * 60000, updatedAt: Date.now() };
  let authenticated = true, offline = false, polls = 0;
  await page.route('**/api/auth/me', route => route.fulfill({ json: { authenticated, enabled: true } }));
  await page.route('**/api/auth/logout', route => { authenticated = false; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/imports', route => {
    polls++;
    if (offline) return route.abort();
    return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { jobs: [{ ...job }] } : { error: '로그인이 필요합니다.' } });
  });
  await page.goto('http://127.0.0.1:4543/');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.querySelector('.music-import-notice').textContent.includes('공개 작업 대기 중'));
  assert(!await page.locator('.music-add-dialog').isVisible(), 'Recovery opened the modal');
  await page.getByRole('button', { name: '진행 확인', exact: true }).click();
  await page.getByText('예상보다 오래 걸리고 있습니다. 다시 요청할 필요 없이 여기서 결과를 확인할 수 있습니다.', { exact: true }).waitFor();
  assert(await page.locator('.music-add-jobs strong').textContent() === job.title, 'Title was not inert text');
  await page.getByRole('button', { name: '음악 추가 닫기' }).click();
  const before = polls; job.syncStage = 'waveform';
  await page.waitForFunction(() => document.querySelector('.music-import-notice').textContent.includes('파형 생성 중'));
  assert(polls > before, 'Polling stopped when modal closed');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.music-import-notice').textContent.includes('파형 생성 중'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile overflow');
  await page.screenshot({ path: 'output/playwright/music-upload/progress-mobile.png' });
  offline = true;
  await page.waitForFunction(() => document.querySelector('.music-import-notice').textContent.includes('연결을 다시 확인'));
  offline = false; job.status = 'ready'; job.updatedAt = Date.now();
  job.track = { src: './music/ETC/yt-mqjYP2Kjpg4.mp3', title: job.title, folder: 'ETC', artist: 'ETC' };
  await page.waitForFunction(() => document.querySelector('.music-import-notice').textContent.includes('추가 완료'));
  await page.getByRole('button', { name: '완료 확인' }).click();
  await page.getByRole('button', { name: '듣기', exact: true }).waitFor();
  assert(!await page.locator('.music-add-status').textContent(), 'Stale connection error persisted');
  await page.getByRole('button', { name: '음악 추가 닫기' }).click();
  assert(!await page.locator('.music-import-notice').isVisible(), 'Acknowledged completion remains');
  job.status = 'failed'; job.error = '동기화 실패 검증'; delete job.track;
  await page.reload();
  await page.getByRole('button', { name: '오류 확인' }).click();
  await page.getByText(job.error, { exact: true }).waitFor();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.locator('.music-import-notice').waitFor({ state: 'hidden' });
  assert(!errors.length, errors.join('; '));
  await page.unrouteAll({ behavior: 'wait' });
  return { closedModalPolling: true, reloadRecovery: true, delayedJobFeedback: true, connectionRecovery: true, completion: true, failure: true, logoutClearsStatus: true, mobile: true, errors };
}
