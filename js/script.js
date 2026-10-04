/* UI adapted from the original CodeHim simple audio player.
 * One native audio element owns playback for the lifetime of the page.
 * WaveSurfer is optional presentation; no playback action awaits it.
 */
function BAPlayer() {
  const root = document.querySelector('#simp');
  const rows = [...root.querySelectorAll('.simp-playlist li')];
  if (!rows.length) throw new Error('재생할 음악이 없습니다.');
  const tracks = rows.map(row => ({
    src: row.querySelector('.simp-source').dataset.src,
    title: row.querySelector('.simp-source').textContent,
    artist: row.querySelector('.simp-desc')?.textContent || '',
    folder: row.dataset.folder,
  }));
  const main = root.querySelector('.simp-main');
  const albumPanel = root.querySelector('.simp-albums');
  const albumGrid = root.querySelector('.album-grid');
  const selectAll = root.querySelector('.albums-select-all');
  const clearAll = root.querySelector('.albums-clear');
  const folderCounts = new Map();
  for (const track of tracks) {
    folderCounts.set(track.folder, (folderCounts.get(track.folder) || 0) + 1);
  }
  const albumInputs = new Map();
  for (const [folder, count] of folderCounts) {
    const card = document.createElement('label');
    card.className = 'album-card';
    const cover = document.createElement('span');
    cover.className = 'album-cover';
    cover.setAttribute('aria-hidden', 'true');
    const words = folder.split(/[\s/]+/);
    cover.textContent = (words.length === 1 ? folder : words.map(word => word[0]).join('')).slice(0, 3).toUpperCase();
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = folder;
    input.setAttribute('aria-label', folder);
    input.setAttribute('aria-controls', 'ulist');
    const title = document.createElement('strong');
    title.className = 'album-name';
    title.textContent = folder;
    const total = document.createElement('span');
    total.className = 'album-count';
    total.textContent = `${count}곡`;
    card.append(cover, input, title, total);
    albumGrid.append(card);
    albumInputs.set(folder, input);
  }
  const albumStorageKey = 'ba-player-albums';
  let selectedAlbums = new Set();
  let queue = [];
  const player = document.createElement('div');
  player.className = 'simp-player';
  player.innerHTML = `
    <audio id="audio" preload="auto" playsinline></audio>
    <div class="simp-display"><div class="simp-album w-full flex-wrap">
      <div class="simp-info"><div class="simp-title"></div><div class="simp-artist"></div></div>
    </div></div>
    <div id="waveform" style="height:70px;margin:20px"></div>
    <div class="simp-controls flex-wrap flex-align">
      <div class="simp-plauseward flex flex-align">
        <button type="button" class="simp-prev fa fa-backward" aria-label="이전 곡"></button>
        <button type="button" class="simp-plause fa fa-play" aria-label="재생"></button>
        <button type="button" class="simp-next fa fa-forward" aria-label="다음 곡"></button>
      </div>
      <div class="simp-tracker"><input class="simp-progress" aria-label="재생 위치" type="range" min="0" max="100" step="0.1" value="0" disabled><div class="simp-buffer"></div></div>
      <div class="simp-time flex flex-align"><span class="start-time">0:00</span><span class="simp-slash">&nbsp;/&nbsp;</span><span class="end-time">0:00</span></div>
      <div class="simp-others flex flex-align">
        <button type="button" class="simp-repeat fa fa-repeat" aria-label="한 곡 반복" aria-pressed="false" title="한 곡 반복"></button>
        <button type="button" class="simp-plext simp-active fa fa-play-circle" aria-label="자동으로 다음 곡 재생" aria-pressed="true" title="자동으로 다음 곡 재생"></button>
        <button type="button" class="simp-random fa fa-random" aria-label="무작위 재생" aria-pressed="false" title="무작위 재생"></button>
      </div>
    </div>
    <p class="simp-status" role="status" hidden></p>`;
  main.insertBefore(player, main.querySelector('.simp-queue-heading'));
  const audio = player.querySelector('audio');
  const playButton = player.querySelector('.simp-plause');
  const progress = player.querySelector('.simp-progress');
  const tracker = player.querySelector('.simp-tracker');
  const status = player.querySelector('.simp-status');
  const session = navigator.mediaSession;
  let index = -1;
  let autoNext = true;
  let random = false;
  let playAttempt = 0;
  let WaveSurfer;
  let waveforms;
  let waveform;
  let waveformSource = '';

  function showStatus(message = '') {
    status.textContent = message;
    status.hidden = !message;
  }

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    return (hours ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes)) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function syncPosition() {
    const duration = audio.duration;
    const position = audio.currentTime;
    player.querySelector('.start-time').textContent = formatTime(position);
    player.querySelector('.end-time').textContent = formatTime(duration);
    const seekable = queue.length > 0 && Number.isFinite(duration) && duration > 0;
    progress.disabled = !seekable;
    progress.value = seekable ? position / duration * 100 : 0;
    if (session?.setPositionState && seekable) {
      try {
        session.setPositionState({ duration, position: Math.min(duration, Math.max(0, position)), playbackRate: audio.playbackRate });
      } catch { /* A browser may expose only part of Media Session. */ }
    }
  }

  function syncPlayback() {
    const playing = !audio.paused && !audio.ended;
    playButton.classList.toggle('fa-play', !playing);
    playButton.classList.toggle('fa-pause', playing);
    playButton.setAttribute('aria-label', playing ? '일시정지' : '재생');
    if (session) session.playbackState = queue.length ? (playing ? 'playing' : 'paused') : 'none';
    syncPosition();
  }

  function play() {
    if (!queue.length) return;
    const attempt = ++playAttempt;
    showStatus();
    if (audio.error) audio.load();
    // Call synchronously in the user gesture / media-session / ended handler.
    // Neither a network fetch nor waveform decoding may gate this call.
    const result = audio.play();
    result?.catch(error => {
      if (attempt !== playAttempt || error.name === 'AbortError') return;
      syncPlayback();
      showStatus(error.name === 'NotAllowedError'
        ? '재생 버튼을 눌러 음악을 계속 들어 주세요.'
        : '음악을 재생하지 못했습니다. 다시 재생하거나 다음 곡을 선택해 주세요.');
    });
  }

  function pause() {
    ++playAttempt;
    audio.pause();
    syncPlayback();
  }

  function seek(time) {
    if (!Number.isFinite(time) || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, time));
    syncPosition();
  }

  function renderWaveform() {
    if (index < 0 || !WaveSurfer || !waveforms || document.hidden) return;
    const data = waveforms[tracks[index].src];
    const container = player.querySelector('#waveform');
    container.style.visibility = data ? 'visible' : 'hidden';
    if (!data || waveformSource === audio.src) return;
    waveformSource = audio.src;
    if (!waveform) {
      waveform = WaveSurfer.create({
        container, media: audio, url: audio.src, peaks: [data.peaks], duration: data.duration,
        waveColor: '#5f5f5f', progressColor: '#ffffff', height: 70,
      });
      waveform.on('interaction', play);
      // A display error must not stop the native audio stream.
      waveform.on('error', () => {});
    } else {
      waveform.load(audio.src, [data.peaks], data.duration).catch(() => {});
    }
  }

  function selectTrack(nextIndex, autoplay = true) {
    if (!queue.includes(nextIndex)) return;
    ++playAttempt;
    index = nextIndex;
    const track = tracks[index];
    rows.forEach((row, i) => row.classList.toggle('simp-active', i === index));
    scrollToCurrent();
    player.querySelector('.simp-title').textContent = track.title;
    player.querySelector('.simp-artist').textContent = track.artist;
    showStatus();
    audio.src = new URL(track.src, location.href).href;
    audio.load();
    if (session) {
      if (typeof MediaMetadata !== 'undefined') {
        session.metadata = new MediaMetadata({
          title: track.title.replace(/^theme_\d+-/, ''), artist: track.artist, album: track.folder,
        });
      }
      try { session.setPositionState?.(); } catch { /* Optional. */ }
    }
    syncPlayback();
    renderWaveform();
    if (autoplay) play();
  }

  function scrollToCurrent() {
    if (index < 0) return;
    const list = rows[index].parentElement;
    list.scrollTop += rows[index].getBoundingClientRect().top - list.getBoundingClientRect().top;
  }

  function filterAlbums(values) {
    selectedAlbums = new Set(values.filter(folder => folderCounts.has(folder)));
    queue = [];
    rows.forEach((row, i) => {
      row.hidden = !selectedAlbums.has(tracks[i].folder);
      if (!row.hidden) queue.push(i);
    });
    for (const [folder, input] of albumInputs) {
      input.checked = selectedAlbums.has(folder);
      input.closest('.album-card').classList.toggle('is-selected', input.checked);
    }
    const summary = `${selectedAlbums.size}개 앨범 · ${queue.length}곡`;
    root.querySelector('.album-selection-summary').textContent = summary;
    root.querySelector('.album-mobile-summary').textContent = summary;
    root.querySelector('.queue-count').textContent = `${queue.length}곡`;
    root.querySelector('.simp-empty').hidden = queue.length > 0;
    root.querySelector('#ulist').hidden = !queue.length;
    selectAll.disabled = selectedAlbums.size === folderCounts.size;
    clearAll.disabled = !selectedAlbums.size;
    player.querySelectorAll('button').forEach(button => { button.disabled = !queue.length; });
  }

  function clearTrack() {
    pause();
    index = -1;
    audio.removeAttribute('src');
    audio.load();
    rows.forEach(row => row.classList.remove('simp-active'));
    player.querySelector('.simp-title').textContent = '앨범을 선택해 주세요';
    player.querySelector('.simp-artist').textContent = '';
    waveform?.destroy();
    waveform = undefined;
    waveformSource = '';
    player.querySelector('#waveform').style.visibility = 'hidden';
    if (session) {
      session.metadata = null;
      try { session.setPositionState?.(); } catch { /* Optional. */ }
    }
    showStatus();
    syncPlayback();
  }

  function changeAlbums(values) {
    const wasPlaying = !audio.paused && !audio.ended;
    filterAlbums(values);
    try {
      // Remember "all" as a mode so newly added albums are included next time.
      const saved = selectedAlbums.size === folderCounts.size
        ? { all: true } : { folders: [...selectedAlbums] };
      localStorage.setItem(albumStorageKey, JSON.stringify(saved));
    } catch { /* Storage is optional, including in an iframe. */ }
    if (!queue.length) clearTrack();
    else if (queue.includes(index)) scrollToCurrent();
    else selectTrack(queue[0], wasPlaying);
  }

  function readSavedAlbums() {
    const all = [...folderCounts.keys()];
    try {
      const raw = localStorage.getItem(albumStorageKey);
      if (raw !== null) {
        const saved = JSON.parse(raw);
        if (saved?.all === true) return all;
        if (Array.isArray(saved?.folders)) {
          const available = saved.folders.filter(folder => folderCounts.has(folder));
          // An intentional empty choice stays empty; removed albums fall back to all.
          return available.length || !saved.folders.length ? available : all;
        }
      } else {
        const legacy = localStorage.getItem('ba-player-folder');
        if (folderCounts.has(legacy)) return [legacy];
      }
    } catch { /* Invalid or unavailable storage falls back to all albums. */ }
    return all;
  }

  function previousTrack() {
    if (!queue.length) return;
    const position = queue.indexOf(index);
    selectTrack(queue[(position - 1 + queue.length) % queue.length]);
  }

  function nextTrack() {
    if (!queue.length) return;
    const position = queue.indexOf(index);
    const step = random && queue.length > 1
      ? 1 + Math.floor(Math.random() * (queue.length - 1))
      : 1;
    selectTrack(queue[(position + step) % queue.length]);
  }

  function toggleOption(selector, enabled) {
    const button = player.querySelector(selector);
    button.classList.toggle('simp-active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  }

  playButton.addEventListener('click', () => audio.paused ? play() : pause());
  player.querySelector('.simp-prev').addEventListener('click', previousTrack);
  player.querySelector('.simp-next').addEventListener('click', nextTrack);
  selectAll.addEventListener('click', () => changeAlbums([...folderCounts.keys()]));
  clearAll.addEventListener('click', () => changeAlbums([]));
  albumGrid.addEventListener('change', () => changeAlbums(
    [...albumInputs].filter(([, input]) => input.checked).map(([folder]) => folder),
  ));

  const compact = matchMedia('(max-width: 640px)');
  const albumOpen = root.querySelector('.album-open');
  function setAlbumsOpen(open, moveFocus = true) {
    open = open && compact.matches;
    root.classList.toggle('albums-open', open);
    albumOpen.setAttribute('aria-expanded', String(open));
    main.inert = open;
    if (moveFocus) {
      if (open) albumPanel.querySelector('input').focus();
      else albumOpen.focus();
    }
  }
  albumOpen.addEventListener('click', () => setAlbumsOpen(true));
  for (const selector of ['.album-close', '.album-done', '.album-backdrop']) {
    root.querySelector(selector).addEventListener('click', () => setAlbumsOpen(false));
  }
  compact.addEventListener('change', () => setAlbumsOpen(false, false));
  albumPanel.addEventListener('keydown', event => {
    if (!root.classList.contains('albums-open')) return;
    if (event.key === 'Escape') { event.preventDefault(); setAlbumsOpen(false); }
    if (event.key === 'Tab') {
      const controls = [...albumPanel.querySelectorAll('button:not(:disabled), input')].filter(control => control.offsetParent !== null);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  progress.addEventListener('input', () => seek(Number(progress.value) / 100 * audio.duration));
  player.querySelector('.simp-repeat').addEventListener('click', () => {
    // Native looping does not depend on a JavaScript callback in a hidden tab.
    audio.loop = !audio.loop;
    toggleOption('.simp-repeat', audio.loop);
  });
  player.querySelector('.simp-plext').addEventListener('click', () => {
    autoNext = !autoNext;
    toggleOption('.simp-plext', autoNext);
  });
  player.querySelector('.simp-random').addEventListener('click', () => {
    random = !random;
    toggleOption('.simp-random', random);
  });
  rows.forEach((row, i) => {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', () => selectTrack(i));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectTrack(i);
      }
    });
  });

  for (const event of ['play', 'pause', 'playing', 'ended']) audio.addEventListener(event, syncPlayback);
  for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked', 'ratechange']) audio.addEventListener(event, syncPosition);
  for (const event of ['loadstart', 'waiting']) audio.addEventListener(event, () => tracker.classList.add('simp-loading'));
  for (const event of ['canplay', 'playing', 'pause', 'error']) audio.addEventListener(event, () => tracker.classList.remove('simp-loading'));
  audio.addEventListener('playing', () => showStatus());
  audio.addEventListener('ended', () => {
    if (autoNext && !audio.loop) nextTrack();
  });
  audio.addEventListener('error', () => {
    if (!queue.length) return;
    syncPlayback();
    showStatus('음악을 불러오지 못했습니다. 연결을 확인하고 다시 재생하거나 다음 곡을 선택해 주세요.');
  });

  if (session?.setActionHandler) {
    const actions = {
      play, pause,
      stop: () => { pause(); seek(0); },
      previoustrack: previousTrack,
      nexttrack: nextTrack,
      seekbackward: details => seek(audio.currentTime - (details.seekOffset ?? 10)),
      seekforward: details => seek(audio.currentTime + (details.seekOffset ?? 10)),
      seekto: details => seek(details.seekTime),
    };
    for (const [action, handler] of Object.entries(actions)) {
      try { session.setActionHandler(action, handler); } catch { /* Unsupported actions are independent. */ }
    }
  }

  // Returning to the tab refreshes the display without restarting a paused track.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { syncPlayback(); renderWaveform(); }
  });
  filterAlbums(readSavedAlbums());
  if (queue.length) selectTrack(queue[0], false);
  else clearTrack();
  Promise.all([
    import('./wavesurfer.esm.js'),
    fetch('./waveforms.json', { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error('Waveform data unavailable');
      return response.json();
    }),
  ]).then(([module, data]) => {
    WaveSurfer = module.default;
    waveforms = data;
    renderWaveform();
  }).catch(() => { /* Playback remains available without the visualizer. */ });
}

window.BAPlayer = BAPlayer;
