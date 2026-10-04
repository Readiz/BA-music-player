// Playwright CLI: run-code "$(cat scripts/verify-folders.js)"
// Run in an isolated browser profile against a local player with byte-range support.
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
  await page.evaluate(() => localStorage.removeItem('ba-player-folder'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#audio'));
  await page.getByText('Click here to use', { exact: true }).click();
  const select = page.getByRole('combobox', { name: '폴더', exact: true });
  if (await select.locator('option').count() !== groups.size + 1) throw new Error('Missing folders');
  await page.evaluate(() => { window.__originalAudio = document.querySelector('#audio'); });
  const visible = page.locator('#ulist li:not([hidden])');
  const source = () => page.locator('#audio').evaluate(audio => audio.currentSrc || audio.src);
  const waitPlaying = () => page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 0.2);
  const expectSource = async path => {
    if (await source() !== new URL(path, page.url()).href) throw new Error('Wrong track: ' + path);
  };
  for (const [folder, files] of groups) {
    await select.selectOption(folder);
    if (await visible.count() !== files.length) throw new Error('Wrong folder count: ' + folder);
    if (!(await visible.evaluateAll((rows, folder) => rows.every(row => row.dataset.folder === folder && row.getBoundingClientRect().height > 0), folder))) throw new Error('Folder contains wrong or invisible rows');
    if (!(await page.locator('#audio').evaluate(audio => audio.paused))) throw new Error('Choosing a folder unexpectedly started playback');
    await expectSource(files[0]);
  }
  report.push('Every real folder shows only its own songs with correct counts; paused selection stays paused');

  const folder = 'ETC';
  const files = groups.get(folder);
  await select.selectOption(folder);
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await waitPlaying();
  await page.getByRole('button', { name: '이전 곡', exact: true }).click();
  await waitPlaying();
  await expectSource(files.at(-1));
  await page.getByRole('button', { name: '다음 곡', exact: true }).click();
  await waitPlaying();
  await expectSource(files[0]);
  await page.evaluate(() => window.__mediaActions.previoustrack());
  await waitPlaying();
  await expectSource(files.at(-1));
  await page.evaluate(() => { const a = document.querySelector('#audio'); a.currentTime = a.duration - 0.3; });
  await page.waitForFunction(path => document.querySelector('#audio').src === new URL(path, location.href).href && document.querySelector('#audio').currentTime > 0.2, files[0]);
  await page.evaluate(() => window.__mediaActions.nexttrack());
  await waitPlaying();
  await expectSource(files[1]);
  report.push('Previous, next, real ended events and Media Session wrap within the selected folder');

  await page.getByRole('button', { name: '무작위 재생', exact: true }).click();
  for (let i = 0; i < 8; i++) {
    const before = await source();
    await page.getByRole('button', { name: '다음 곡', exact: true }).click();
    await waitPlaying();
    const after = await source();
    if (before === after || !files.some(path => new URL(path, page.url()).href === after)) throw new Error('Shuffle left the folder or repeated the same track');
  }
  await page.getByRole('button', { name: '무작위 재생', exact: true }).click();
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.locator('#audio').evaluate(audio => { audio.currentTime = 15; });
  const same = await source();
  await select.selectOption('');
  await select.selectOption(folder);
  if (await source() !== same || !(await page.locator('#audio').evaluate(audio => audio.paused && Math.abs(audio.currentTime - 15) < 0.1))) throw new Error('Retained song lost its position or pause state');
  report.push('Shuffle stays in the folder; switching to all and back preserves the retained song and position');

  await page.getByRole('button', { name: '재생', exact: true }).click();
  await select.selectOption('Girls Band Cry');
  await waitPlaying();
  await expectSource(groups.get('Girls Band Cry')[0]);
  if (!(await page.evaluate(() => window.__originalAudio === document.querySelector('#audio') && document.querySelectorAll('audio').length === 1))) throw new Error('Folder switch recreated the audio element');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#audio'));
  if (await select.inputValue() !== 'Girls Band Cry' || await visible.count() !== groups.get('Girls Band Cry').length || !(await page.locator('#audio').evaluate(audio => audio.paused))) throw new Error('Saved folder restore failed or autoplayed');
  report.push('Playing folder switch keeps one audio element; reload restores the folder without autoplay');

  await page.evaluate(() => localStorage.setItem('ba-player-folder', 'removed folder'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#audio'));
  if (await select.inputValue() !== '' || await visible.count() !== paths.length) throw new Error('Stale saved folder did not fall back to all');
  await page.evaluate(() => localStorage.removeItem('ba-player-folder'));

  const fallback = await page.context().newPage();
  try {
    await fallback.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } }));
    await fallback.goto(page.url());
    await fallback.waitForFunction(() => document.querySelector('#audio'));
    await fallback.getByText('Click here to use', { exact: true }).click();
    await fallback.getByRole('combobox', { name: '폴더', exact: true }).selectOption('Kessoku Band');
    await fallback.getByRole('button', { name: '재생', exact: true }).click();
    await fallback.waitForFunction(() => document.querySelector('#audio').currentTime > 0.2);
    await fallback.getByRole('button', { name: '일시정지', exact: true }).click();
    if (await fallback.locator('#ulist li:not([hidden])').count() !== groups.get('Kessoku Band').length) throw new Error('Storage-blocked filtering failed');
  } finally { await fallback.close(); }
  if (errors.length) throw new Error(errors.join('\n'));
  report.push('Missing saved folders and blocked storage do not prevent selection or playback; no page errors');
  return report;
}
