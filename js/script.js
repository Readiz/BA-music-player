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
  }));
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
  root.insertBefore(player, root.querySelector('.simp-playlist'));
  const audio = player.querySelector('audio');
  const playButton = player.querySelector('.simp-plause');
  const progress = player.querySelector('.simp-progress');
  const tracker = player.querySelector('.simp-tracker');
  const status = player.querySelector('.simp-status');
  const session = navigator.mediaSession;
  let index = 0;
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
    const seekable = Number.isFinite(duration) && duration > 0;
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
    if (session) session.playbackState = playing ? 'playing' : 'paused';
    syncPosition();
  }

  function play() {
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
    if (!WaveSurfer || !waveforms || document.hidden) return;
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
    ++playAttempt;
    index = (nextIndex + tracks.length) % tracks.length;
    const track = tracks[index];
    rows.forEach((row, i) => row.classList.toggle('simp-active', i === index));
    const list = rows[index].parentElement;
    list.scrollTop += rows[index].getBoundingClientRect().top - list.getBoundingClientRect().top;
    player.querySelector('.simp-title').textContent = track.title;
    player.querySelector('.simp-artist').textContent = track.artist;
    showStatus();
    audio.src = new URL(track.src, location.href).href;
    audio.load();
    if (session) {
      if (typeof MediaMetadata !== 'undefined') {
        session.metadata = new MediaMetadata({
          title: track.title.replace(/^theme_\d+-/, ''), artist: track.artist, album: 'Readiz’s Player',
        });
      }
      try { session.setPositionState?.(); } catch { /* Optional. */ }
    }
    syncPlayback();
    renderWaveform();
    if (autoplay) play();
  }

  function nextTrack() {
    const next = random && tracks.length > 1
      ? (index + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length
      : index + 1;
    selectTrack(next);
  }

  function toggleOption(selector, enabled) {
    const button = player.querySelector(selector);
    button.classList.toggle('simp-active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  }

  playButton.addEventListener('click', () => audio.paused ? play() : pause());
  player.querySelector('.simp-prev').addEventListener('click', () => selectTrack(index - 1));
  player.querySelector('.simp-next').addEventListener('click', nextTrack);
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
    syncPlayback();
    showStatus('음악을 불러오지 못했습니다. 연결을 확인하고 다시 재생하거나 다음 곡을 선택해 주세요.');
  });

  if (session?.setActionHandler) {
    const actions = {
      play, pause,
      stop: () => { pause(); seek(0); },
      previoustrack: () => selectTrack(index - 1),
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
  selectTrack(0, false);
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
