(function () {
  const root = document.documentElement;
  const core = window.BAMusicRemoteCore;
  const panel = document.querySelector('.simp-albums');
  const toggle = document.querySelector('.album-toggle');
  const dialog = document.querySelector('.tv-exit-dialog');
  const hint = document.querySelector('.remote-hint');
  const memory = {};
  let remote = false;
  let editing = false;
  let priorFocus;
  let lastFocus;
  let pending = false;
  let initialPending = !!window.BAMusicTV;
  const selector = 'button, input, #ulist li[tabindex]';
  function usable(element) {
    return !!(element && element.isConnected && !element.disabled && !element.closest('[hidden]') && element.getClientRects().length);
  }
  function all(scope) { return Array.from(scope.querySelectorAll(selector)).filter(usable); }
  function group(element) {
    if (!element || !element.closest) return 'header';
    if (element.closest('.tv-exit-dialog')) return 'dialog';
    if (element.closest('.simp-albums')) return 'album';
    if (element.closest('#ulist')) return 'queue';
    if (element.closest('.simp-main')) return 'controls';
    return 'header';
  }
  function rect(element) { return (element.closest('.album-card') || element).getBoundingClientRect(); }
  function reveal(element) {
    // Explicit scrolling also works on older Tizen engines without scrollIntoView options.
    const scroller = element.closest('#ulist, .simp-albums');
    if (!scroller) return;
    const box = rect(element), viewport = scroller.getBoundingClientRect();
    if (box.top < viewport.top + 8) scroller.scrollTop -= viewport.top + 8 - box.top;
    else if (box.bottom > viewport.bottom - 8) scroller.scrollTop += box.bottom - viewport.bottom + 8;
  }
  function remember(element) {
    if (!usable(element) || !element.matches(selector)) return;
    const zone = group(element);
    memory[zone] = element;
    if (lastFocus) {
      lastFocus.classList.remove('remote-focus');
      const card = lastFocus.closest('.album-card');
      if (card) card.classList.remove('remote-focus');
    }
    lastFocus = element;
    if (remote) {
      (element.closest('.album-card') || element).classList.add('remote-focus');
      reveal(element);
    }
  }
  function focus(element) {
    if (!usable(element)) return false;
    try { element.focus({ preventScroll: true }); } catch (_) { element.focus(); }
    remember(element);
    return true;
  }
  function initial() {
    return document.querySelector('.simp-plause:not(:disabled)') || document.querySelector('.library-retry:not([hidden])') ||
      (window.BAMusicTV ? panel.querySelector('.album-card input') || all(panel)[0] : toggle);
  }
  function controls() {
    const player = document.querySelector('.simp-player');
    return player ? all(player) : all(document.querySelector('.simp-main')).filter(item => group(item) === 'controls');
  }
  function focusControls() {
    const target = usable(memory.controls) ? memory.controls : initial();
    return group(target) === 'controls' && focus(target);
  }
  function syncTrackFocus() {
    // Keep startup on the controls; later track changes refresh the queue destination.
    if (initialPending) return;
    const row = document.querySelector('#ulist li.simp-active:not([hidden])');
    if (!usable(row)) return;
    memory.queue = row;
    if (!remote) return;
    const current = document.activeElement;
    if (!dialog.hidden && group(priorFocus) === 'queue') priorFocus = row;
    if (group(current) === 'queue' || (current === document.body && lastFocus && group(lastFocus) === 'queue')) focus(row);
    else reveal(row);
  }
  document.querySelector('#simp').addEventListener('simp-track-change', syncTrackFocus);
  function enterRemote() { remote = true; root.classList.add('remote-mode'); remember(document.activeElement); }
  function setEditing(value) {
    editing = value;
    root.classList.toggle('remote-seeking', value);
    hint.textContent = value ? '탐색 중 · ◀ ▶ 5초 이동 · 확인 / 뒤로 완료' : '방향키 이동 · 확인 선택 · 뒤로 종료';
  }
  function openAlbums() {
    if (panel.hidden) {
      if (window.BAMusicTV) panel.hidden = false;
      else toggle.click();
    }
    const target = usable(memory.album) ? memory.album : panel.querySelector('.album-card input') || all(panel)[0];
    if (focus(target)) return true;
    focus(toggle);
    return false;
  }
  function closeDialog() {
    dialog.hidden = true;
    focus(usable(priorFocus) ? priorFocus : initial());
  }
  function showExit() {
    if (!window.BAMusicTV) return;
    priorFocus = document.activeElement;
    dialog.querySelector('.exit-message').textContent = '재생을 멈추고 앱을 닫습니다.';
    dialog.hidden = false;
    enterRemote();
    focus(dialog.querySelector('.exit-cancel'));
  }
  function back() {
    initialPending = false;
    enterRemote();
    if (!dialog.hidden) { closeDialog(); return; }
    if (editing) { setEditing(false); return; }
    if (window.BAMusicTV) { showExit(); return; }
    const zone = group(document.activeElement);
    if (zone === 'queue' || zone === 'controls') { openAlbums(); return; }
    if (!panel.hidden) { toggle.click(); focus(toggle); }
  }
  function exit() {
    if (window.BAMusicPlayback) window.BAMusicPlayback.pause();
    try { window.tizen.application.getCurrentApplication().exit(); return; } catch (_) { /* Hosted pages may not expose Tizen. */ }
    if (/ReadizMusicTV/i.test(navigator.userAgent)) { location.href = 'readiz-music://exit'; return; }
    let depth;
    try { depth = Number(sessionStorage.getItem('music:launcher-depth')); } catch (_) { /* Storage may be restricted. */ }
    if (/Tizen/i.test(navigator.userAgent) && Number.isInteger(depth) && depth > 0 && depth < history.length) {
      sessionStorage.removeItem('music:launcher-depth');
      history.go(depth - history.length);
      return;
    }
    dialog.querySelector('.exit-message').textContent = '음악을 멈췄습니다. TV의 홈 또는 종료 키로 앱을 닫아 주세요.';
    focus(dialog.querySelector('.exit-cancel'));
  }
  function nearest(from, candidates, direction) {
    return core.nearest(rect(from), candidates.filter(item => item !== from).map(item => ({ item, rect: rect(item) })), direction);
  }
  function move(direction) {
    const from = document.activeElement;
    const zone = group(from);
    if (zone === 'dialog') { focus(nearest(from, all(dialog), direction)); return; }
    if (zone === 'queue') {
      const rows = all(document.querySelector('#ulist'));
      const index = rows.indexOf(from);
      if (direction === 'ArrowLeft') { openAlbums(); return; }
      if (direction === 'ArrowRight') {
        if (!window.BAMusicTV) focusControls();
        return;
      }
      if (direction === 'ArrowUp' && index === 0) { focusControls(); return; }
      focus(rows[index + (direction === 'ArrowDown' ? 1 : -1)]);
      return;
    }
    if (zone === 'album') {
      if (window.BAMusicTV) {
        const cards = all(panel.querySelector('.album-grid'));
        const actions = all(panel.querySelector('.album-actions'));
        const inCard = !!from.closest('.album-card');
        const row = inCard ? cards : actions;
        const index = row.indexOf(from);
        if (direction === 'ArrowRight') {
          if (!inCard && focus(row[index + 1])) return;
          focusControls();
        } else if (direction === 'ArrowLeft') {
          if (!inCard) focus(row[index - 1]);
        } else if (direction === 'ArrowDown') {
          focus(inCard ? cards[index + 1] : cards[0]);
        } else if (inCard && index > 0) {
          focus(cards[index - 1]);
        } else if (inCard && actions.length) {
          focus(actions[0]);
        } else {
          focusControls();
        }
        return;
      }
      const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
      const origin = rect(from);
      const candidates = all(panel).filter(item => !horizontal || rect(item).bottom > origin.top && rect(item).top < origin.bottom);
      const target = nearest(from, candidates, direction);
      if (target) { focus(target); return; }
      if (direction === 'ArrowRight') { focusControls(); return; }
      if (direction === 'ArrowUp') focus(toggle);
      return;
    }
    if (zone === 'controls') {
      if (direction === 'ArrowDown') {
        focus(usable(memory.queue) ? memory.queue :
          (!window.BAMusicTV && document.querySelector('#ulist li.simp-active:not([hidden])')) || document.querySelector('#ulist li:not([hidden])')); return;
      }
      // These controls form one visual row. Repeated Up stops at its top boundary.
      if (direction === 'ArrowUp') { if (!window.BAMusicTV) focus(toggle); return; }
      const buttons = controls();
      const index = buttons.indexOf(from);
      const target = window.BAMusicTV
        ? buttons[index + (direction === 'ArrowRight' ? 1 : -1)]
        : nearest(from, buttons, direction);
      if (target) focus(target);
      else if (direction === 'ArrowLeft') openAlbums();
      return;
    }
    if (direction === 'ArrowDown') {
      if (from !== toggle || !openAlbums()) focus(initial());
      return;
    }
    focus(nearest(from, [toggle].filter(usable), direction));
  }
  document.addEventListener('focusin', event => remember(event.target));
  function pointer() {
    initialPending = false;
    remote = false;
    root.classList.remove('remote-mode');
    setEditing(false);
    if (lastFocus) {
      lastFocus.classList.remove('remote-focus');
      const card = lastFocus.closest('.album-card');
      if (card) card.classList.remove('remote-focus');
    }
  }
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('touchstart', pointer, { passive: true });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.defaultPrevented) return;
    const key = core.key(event);
    if (key === 'Enter' && !window.BAMusicTV && document.activeElement.closest('a')) return;
    if (key === 'Tab') {
      initialPending = false;
      enterRemote();
      if (!dialog.hidden) {
        event.preventDefault();
        const buttons = all(dialog);
        focus(buttons[(buttons.indexOf(document.activeElement) + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]);
      }
      return;
    }
    if (!/^(Arrow|Enter$|Back$|Media)/.test(key || '')) return;
    if (event.target.closest && event.target.closest('textarea, [contenteditable], input:not([type=checkbox]):not([type=range])')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    initialPending = false;
    enterRemote();
    if ((key === 'Enter' || key === 'Back' || /^Media/.test(key)) && event.repeat) return;
    if (key === 'Back') { back(); return; }
    if (/^Media/.test(key)) {
      if (!dialog.hidden) return;
      const player = window.BAMusicPlayback;
      if (!player) return;
      const actions = { MediaPlay: 'play', MediaPause: 'pause', MediaPlayPause: 'toggle', MediaStop: 'stop', MediaTrackNext: 'next', MediaTrackPrevious: 'previous' };
      if (actions[key]) player[actions[key]]();
      else if (key === 'MediaRewind' || key === 'MediaFastForward') player.seekBy(key === 'MediaRewind' ? -10 : 10);
      return;
    }
    if (!usable(document.activeElement) || !document.activeElement.matches(selector)) { focus(initial()); return; }
    if (key === 'Enter') {
      if (document.activeElement.matches('.simp-progress')) setEditing(!editing);
      else document.activeElement.click();
      return;
    }
    if (editing && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      if (window.BAMusicPlayback) window.BAMusicPlayback.seekBy(key === 'ArrowLeft' ? -5 : 5);
      return;
    }
    if (editing) setEditing(false);
    move(key);
  }, true);
  // Album changes can remove the focused track or disable an action button.
  new MutationObserver(() => {
    if (pending || !remote) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (initialPending && (window.BAMusicPlayback || usable(document.querySelector('.library-retry')))) {
        initialPending = false;
        focus(initial());
        return;
      }
      if (editing && (!usable(document.activeElement) || !document.activeElement.matches('.simp-progress'))) setEditing(false);
      if (!usable(document.activeElement) || document.activeElement === document.body) {
        if (!dialog.hidden) focus(dialog.querySelector('.exit-cancel'));
        else if (lastFocus && group(lastFocus) === 'album') openAlbums();
        else focus(initial());
      }
    });
  }).observe(document.querySelector('#simp'), { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
  dialog.querySelector('.exit-cancel').addEventListener('click', closeDialog);
  dialog.querySelector('.exit-confirm').addEventListener('click', exit);
  for (const key of ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaRewind', 'MediaFastForward', 'MediaTrackNext', 'MediaTrackPrevious']) {
    try { window.tizen.tvinputdevice.registerKey(key); } catch (_) { /* Basic directions, OK and Back need no registration. */ }
  }
  window.BAMusicRemote = { back };
  if (window.BAMusicTV) {
    document.querySelector('.app-brand').tabIndex = -1;
    toggle.hidden = true;
    panel.hidden = false;
    document.querySelector('#simp').classList.remove('albums-collapsed');
    enterRemote();
    focus(initial());
  }
})();
