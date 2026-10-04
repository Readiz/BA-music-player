/* oxlint-disable typescript/no-deprecated -- Samsung Back uses legacy keyCode 10009. */
/* A top-level hosted page preserves its own login origin and cookie policy.
 * No iframe wrapper, external browser launch, credentials, or media key grabs.
 * Tizen APIs are not assumed to remain available after remote navigation.
 */
(function () {
  'use strict';
  const destination = window.READIZ_APP_URL || 'https://music.readiz.com/';
  const startUrl = new URL('/app-start.html?launcher=tizen', destination).href;
  const returning = !!(window.history.state && window.history.state.readizMusicHosted === true);
  let departed = false;
  function exit() {
    try {
      window.tizen.application.getCurrentApplication().exit();
      return true;
    } catch (error) {
      void error;
      return false;
    }
  }
  for (const key of [
    'MediaPlay',
    'MediaPause',
    'MediaPlayPause',
    'MediaStop',
    'MediaRewind',
    'MediaFastForward',
  ]) {
    try {
      window.tizen.tvinputdevice.registerKey(key);
    } catch (error) {
      void error;
      /* Basic arrows/OK/Back remain available. */
    }
  }
  const retry = document.getElementById('retry');
  const status = document.getElementById('status');
  const spinner = document.getElementById('spinner');
  const hint = document.getElementById('hint');
  const main = document.querySelector('main');
  let connectionTimer;
  function showRetry(message) {
    window.clearTimeout(connectionTimer);
    main.setAttribute('aria-busy', 'false');
    spinner.hidden = true;
    status.textContent = message;
    retry.hidden = false;
    hint.hidden = false;
    retry.focus();
  }
  function openSite() {
    window.clearTimeout(connectionTimer);
    main.setAttribute('aria-busy', 'true');
    retry.hidden = true;
    hint.hidden = true;
    spinner.hidden = false;
    status.textContent = 'Readiz Music 불러오는 중…';
    connectionTimer = window.setTimeout(function () {
      showRetry('연결이 지연되고 있습니다. 다시 연결해 주세요.');
    }, 12000);
    try {
      window.history.replaceState({ readizMusicHosted: true }, '');
      window.location.assign(startUrl);
    } catch (error) {
      void error;
      showRetry('사이트를 열지 못했습니다. 다시 연결해 주세요.');
    }
  }
  retry.addEventListener('click', openSite);
  document.addEventListener('keydown', function (event) {
    if (event.keyCode === 10009) {
      try {
        window.tizen.application.getCurrentApplication().exit();
        event.preventDefault();
      } catch (error) {
        void error;
        /* Only the local launcher can use the app exit API. */
      }
    }
  });
  window.addEventListener('pagehide', function () {
    departed = true;
    window.clearTimeout(connectionTimer);
  });
  window.addEventListener('pageshow', function () {
    if (departed && !exit())
      showRetry(
        '앱을 종료하지 못했습니다. 리모컨의 종료 키를 길게 눌러 주세요.',
      );
  });
  if (returning) {
    if (!exit())
      showRetry(
        '앱을 종료하지 못했습니다. 리모컨의 종료 키를 길게 눌러 주세요.',
      );
  } else {
    // Navigation during the initial load can replace the launcher entry even
    // with assign(). Wait until load has completed so native return is retained.
    window.addEventListener('load', function () {
      window.setTimeout(openSite, 0);
    });
  }
})();
