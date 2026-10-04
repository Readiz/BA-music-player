/* UI adapted from the original CodeHim simple audio player.
 * One native audio element owns playback for the lifetime of the page.
 * WaveSurfer is optional presentation; no playback action awaits it.
 */
function BAAlbumPanel() {
  const root = document.querySelector('#simp');
  const panel = root.querySelector('.simp-albums');
  const toggle = root.querySelector('.album-toggle');
  function setOpen(open) {
    if (!open && panel.contains(document.activeElement)) toggle.focus();
    panel.hidden = !open;
    root.classList.toggle('albums-collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    const label = open ? '앨범 접기' : '앨범 펼치기';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('keydown', event => {
    if (!event.defaultPrevented && event.key === 'Escape') { event.preventDefault(); setOpen(false); }
  });
}

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
  const albumGrid = root.querySelector('.album-grid');
  const selectAll = root.querySelector('.albums-select-all');
  const clearAll = root.querySelector('.albums-clear');
  const folderCounts = new Map();
  for (const track of tracks) {
    folderCounts.set(track.folder, (folderCounts.get(track.folder) || 0) + 1);
  }
  const albumInputs = new Map();
  const albumArtwork = new Map([
    ['Blue Archive', 'blue-archive'],
    ['ETC', 'etc'],
    ['Girls Band Cry', 'girls-band-cry'],
    ['Kessoku Band', 'kessoku-band'],
  ].map(([folder, slug]) => [folder, {
    src: new URL(`./assets/albums/${slug}.jpg`, location.href).href,
    sizes: '512x512', type: 'image/jpeg',
  }]));
  for (const [folder, count] of folderCounts) {
    const card = document.createElement('label');
    card.className = 'album-card';
    const cover = document.createElement('span');
    cover.className = 'album-cover';
    cover.setAttribute('aria-hidden', 'true');
    const words = folder.split(/[\s/]+/);
    cover.textContent = (words.length === 1 ? folder : words.map(word => word[0]).join('')).slice(0, 3).toUpperCase();
    if (albumArtwork.has(folder)) {
      const image = document.createElement('img');
      image.alt = '';
      image.width = image.height = 512;
      image.decoding = 'async';
      image.draggable = false;
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = albumArtwork.get(folder).src;
      cover.append(image);
    }
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
        <button type="button" class="simp-random simp-active fa fa-random" aria-label="무작위 재생" aria-pressed="true" title="무작위 재생"></button>
      </div>
    </div>
    <p class="simp-status" role="status" hidden></p>`;
  main.insertBefore(player, main.querySelector('.simp-queue-heading'));
  const native = window.BAMusicNativeAudio;
  const audio = native || player.querySelector('audio');
  const playButton = player.querySelector('.simp-plause');
  const progress = player.querySelector('.simp-progress');
  const tracker = player.querySelector('.simp-tracker');
  const status = player.querySelector('.simp-status');
  const session = native ? null : navigator.mediaSession;
  let index = -1;
  let autoNext = true;
  let random = true;
  let playAttempt = 0;
  let WaveSurfer;
  let waveforms;
  let waveformRequest;
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
    if (native && waveform) waveform.setTime(audio.currentTime);
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
    function handlePlayError(error) {
      if (attempt !== playAttempt || error.name === 'AbortError') return;
      syncPlayback();
      showStatus(error.name === 'NotAllowedError'
        ? '재생 버튼을 다시 누르거나 Space 키를 눌러 음악을 시작해 주세요.'
        : '음악을 재생하지 못했습니다. 다시 재생하거나 다음 곡을 선택해 주세요.');
    }
    try { audio.play()?.catch(handlePlayError); } catch (error) { handlePlayError(error); }
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
    if (!data || waveformSource === tracks[index].src) return;
    waveformSource = tracks[index].src;
    // Android uses the same renderer with precomputed peaks and an empty media
    // element. Media3 remains the only playback owner; no second stream loads.
    const media = native ? player.querySelector('audio') : audio;
    const url = native ? '' : audio.src;
    const peaks = [[...data.peaks]];
    if (!waveform) {
      waveform = WaveSurfer.create({
        container, media, url, peaks, duration: data.duration,
        waveColor: '#5f5f5f', progressColor: '#ffffff', height: 70,
      });
      waveform.on('interaction', time => {
        if (native) seek(time);
        play();
      });
      waveform.on('ready', () => { if (native) waveform.setTime(audio.currentTime); });
      // A display error must not stop the native audio stream.
      waveform.on('error', () => {});
    } else {
      waveform.load(url, peaks, data.duration).catch(() => {});
    }
  }

  function syncNativeQueue(autoplay = !audio.paused, preserve = true) {
    if (!native) return;
    native.configure(queue.map(i => ({
      ...tracks[i], id: tracks[i].src, src: new URL(tracks[i].src, location.href).href,
      title: tracks[i].title.replace(/^theme_\d+-/, ''),
      artwork: albumArtwork.get(tracks[i].folder)?.src || '',
    })), Math.max(0, queue.indexOf(index)), autoplay, preserve);
  }

  function selectTrack(nextIndex, autoplay = true, fromNative = false) {
    if (!queue.includes(nextIndex)) return;
    ++playAttempt;
    index = nextIndex;
    const track = tracks[index];
    rows.forEach((row, i) => row.classList.toggle('simp-active', i === index));
    scrollToCurrent();
    player.querySelector('.simp-title').textContent = track.title;
    player.querySelector('.simp-artist').textContent = track.artist;
    showStatus();
    if (native) {
      if (!fromNative) {
        if (native.state.queue.length && native.state.queue.join('|') === queue.map(i => tracks[i].src).join('|')) {
          native.send('select', { index: queue.indexOf(index), play: autoplay });
        } else syncNativeQueue(autoplay, false);
      }
    } else {
      audio.src = new URL(track.src, location.href).href;
      audio.load();
    }
    if (session) {
      if (typeof MediaMetadata !== 'undefined') {
        session.metadata = new MediaMetadata({
          title: track.title.replace(/^theme_\d+-/, ''), artist: track.artist, album: track.folder,
          artwork: albumArtwork.has(track.folder) ? [albumArtwork.get(track.folder)] : [],
        });
      }
      try { session.setPositionState?.(); } catch { /* Optional. */ }
    }
    syncPlayback();
    renderWaveform();
    root.dispatchEvent(new CustomEvent('simp-track-change'));
    if (autoplay && !native) play();
  }

  function scrollToCurrent() {
    if (index < 0 || window.BAMusicTV) return;
    // The remote controller aligns queue focus and scrolling on track changes.
    const focused = document.activeElement;
    if (document.documentElement.classList.contains('remote-mode') && focused && focused.closest('#ulist') && focused !== rows[index]) return;
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
    orderQueue();
    for (const [folder, input] of albumInputs) {
      input.checked = selectedAlbums.has(folder);
      input.closest('.album-card').classList.toggle('is-selected', input.checked);
    }
    const summary = `${selectedAlbums.size}개 앨범 · ${queue.length}곡`;
    root.querySelector('.album-selection-summary').textContent = summary;
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
    else if (queue.includes(index)) { scrollToCurrent(); syncNativeQueue(wasPlaying); }
    else selectTrack(startingTrack(), wasPlaying);
  }

  function startingTrack() {
    return queue[0];
  }

  function orderQueue() {
    queue.sort((a, b) => a - b);
    if (!random) return;
    // Fix one shuffled order on entry or album changes; navigation never reshuffles.
    for (let i = 0; i < queue.length - 1; i++) {
      const next = i + Math.floor(Math.random() * (queue.length - i));
      [queue[i], queue[next]] = [queue[next], queue[i]];
    }
  }

  function readSavedAlbums() {
    const all = [...folderCounts.keys()];
    const defaults = folderCounts.has('Blue Archive') ? ['Blue Archive'] : all;
    try {
      const raw = localStorage.getItem(albumStorageKey);
      if (raw !== null) {
        const saved = JSON.parse(raw);
        if (saved?.all === true) return all;
        if (Array.isArray(saved?.folders)) {
          const available = saved.folders.filter(folder => folderCounts.has(folder));
          // Preserve explicit choices; removed albums fall back to the default.
          return available.length || !saved.folders.length ? available : defaults;
        }
      } else {
        const legacy = localStorage.getItem('ba-player-folder');
        if (folderCounts.has(legacy)) return [legacy];
      }
    } catch { /* Invalid or unavailable storage falls back to the default. */ }
    return defaults;
  }

  function previousTrack() {
    if (native) { native.send('previous'); return; }
    if (!queue.length) return;
    const position = queue.indexOf(index);
    selectTrack(queue[(position - 1 + queue.length) % queue.length]);
  }

  function nextTrack() {
    if (native) { native.send('next'); return; }
    if (!queue.length) return;
    const position = queue.indexOf(index);
    selectTrack(queue[(position + 1) % queue.length]);
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

  // A deliberate playback gesture starts audio; album clicks and unrelated keys do not.
  // Keep this synchronous so the browser can use the key's user activation.
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [role="button"], [contenteditable]')) return;
    event.preventDefault();
    audio.paused ? play() : pause();
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
    if (native) native.options({ autoNext });
  });
  player.querySelector('.simp-random').addEventListener('click', () => {
    random = !random;
    orderQueue();
    toggleOption('.simp-random', random);
    if (native) { native.options({ random }); syncNativeQueue(); }
  });
  function bindRow(row, i) {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', () => selectTrack(i));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectTrack(i);
      }
    });
  }
  rows.forEach(bindRow);

  for (const event of ['play', 'pause', 'playing', 'ended']) audio.addEventListener(event, syncPlayback);
  for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked', 'ratechange']) audio.addEventListener(event, syncPosition);
  for (const event of ['loadstart', 'waiting']) audio.addEventListener(event, () => tracker.classList.add('simp-loading'));
  for (const event of ['canplay', 'playing', 'pause', 'error']) audio.addEventListener(event, () => tracker.classList.remove('simp-loading'));
  audio.addEventListener('playing', () => showStatus());
  audio.addEventListener('ended', () => {
    if (!native && autoNext && !audio.loop) nextTrack();
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
  if (native) {
    native.addEventListener('trackchange', () => {
      const next = tracks.findIndex(track => track.src === native.state.id);
      if (next >= 0) selectTrack(next, false, true);
    });
    native.addEventListener('optionschange', () => {
      autoNext = native.state.autoNext;
      random = native.state.random;
      toggleOption('.simp-repeat', native.loop);
      toggleOption('.simp-plext', autoNext);
      toggleOption('.simp-random', random);
    });
  }
  const restored = native?.state.queue.length && tracks.some(track => track.src === native.state.id);
  filterAlbums(restored ? [...new Set(tracks.filter(track => native.state.queue.includes(track.src)).map(track => track.folder))] : readSavedAlbums());
  if (restored) {
    queue = native.state.queue.map(id => tracks.findIndex(track => track.src === id)).filter(i => i >= 0);
    random = native.state.random;
    autoNext = native.state.autoNext;
    toggleOption('.simp-repeat', native.loop);
    toggleOption('.simp-plext', autoNext);
    toggleOption('.simp-random', random);
    selectTrack(tracks.findIndex(track => track.src === native.state.id), false, true);
  } else if (queue.length) {
    selectTrack(startingTrack(), false);
    showStatus(window.BAMusicTV ? '재생 버튼이나 곡에서 확인 키를 눌러 시작하세요.' : '재생 버튼이나 곡을 눌러 시작하세요. Space 키로도 재생할 수 있습니다.');
  }
  else clearTrack();
  window.BAMusicPlayback = {
    play, pause, toggle: () => audio.paused ? play() : pause(),
    stop: () => { pause(); seek(0); }, next: nextTrack, previous: previousTrack,
    seekBy: seconds => seek(audio.currentTime + seconds),
  };
  window.BAMusicLibrary = {
    add(track) {
      if (!track || !/^\.\/music\/ETC\/yt-[\w-]{11}\.mp3$/.test(track.src)) return;
      // The player may have opened before this import finished.
      if (!waveforms?.[track.src]) {
        Promise.resolve(waveformRequest).catch(() => {}).then(() => {
          if (!waveforms?.[track.src]) return refreshWaveforms();
        }).catch(() => {});
      }
      const existing = tracks.findIndex(item => item.src === track.src);
      if (existing >= 0) return existing;
      const row = document.createElement('li');
      row.dataset.folder = 'ETC';
      const source = document.createElement('span'); source.className = 'simp-source'; source.dataset.src = track.src; source.textContent = track.title;
      const description = document.createElement('span'); description.className = 'simp-desc'; description.textContent = 'ETC';
      row.append(source, description); root.querySelector('#ulist').append(row);
      const i = tracks.length; tracks.push({ ...track, folder: 'ETC', artist: 'ETC' }); rows.push(row); bindRow(row, i);
      folderCounts.set('ETC', (folderCounts.get('ETC') || 0) + 1);
      const count = albumInputs.get('ETC')?.closest('.album-card').querySelector('.album-count');
      if (count) count.textContent = `${folderCounts.get('ETC')}곡`;
      filterAlbums([...selectedAlbums]);
      if (queue.includes(index)) syncNativeQueue();
      return i;
    },
    listen(track) {
      const i = this.add(track);
      if (i === undefined) return;
      changeAlbums([...new Set([...selectedAlbums, 'ETC'])]);
      selectTrack(i);
    },
  };
  // The waveform is optional; engines without ResizeObserver retain native audio and seeking.
  if (typeof ResizeObserver !== 'function') return;
  function refreshWaveforms() {
    if (!waveformRequest) {
      waveformRequest = fetch('./waveforms.json', { cache: 'no-cache' }).then(response => {
        if (!response.ok) throw new Error('Waveform data unavailable');
        return response.json();
      }).then(data => {
        waveforms = data;
        renderWaveform();
      }).finally(() => { waveformRequest = undefined; });
    }
    return waveformRequest;
  }
  Promise.all([
    import('./wavesurfer.esm.js'),
    refreshWaveforms(),
  ]).then(([module]) => {
    WaveSurfer = module.default;
    renderWaveform();
  }).catch(() => { /* Playback remains available without the visualizer. */ });
}

window.BAPlayer = BAPlayer;
window.BAAlbumPanel = BAAlbumPanel;
