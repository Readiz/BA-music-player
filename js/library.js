BAAlbumPanel();
  async function getMusics() {
      const { list: arr, ost: catalog, imported: added } = await window.BAMusicAccess.catalog();
      const addedTracks = new Map((added.tracks || []).map(track => [track.src, track]));
      const list = document.createDocumentFragment();
      for (const [index, item] of arr.entries()) {
          const parts = String(item).split('/');
          const folderArtist = decodeURIComponent(parts[parts.length - 2]);
          const metadata = addedTracks.get(item);
          const artist = metadata?.artist || folderArtist;
          let songname = decodeURIComponent(parts[parts.length - 1]).replace(/\.(ogg|mp3|m4a)$/i, '');
          songname = metadata?.title || songname;
          const unnamed = folderArtist === 'Blue Archive' && songname.match(/^theme_(\d+)$/);
          const title = unnamed && catalog.titles?.[Number(unnamed[1])];
          // Fill missing names by OST number without changing audio URLs or known names.
          if (title) songname += `-${title}`;

          const li = document.createElement('li');
          li.dataset.folder = parts.slice(2, -1).map(decodeURIComponent).join('/') || folderArtist;
          if (index === 0) li.classList.add('simp-active');
          const source = document.createElement('span');
          source.className = 'simp-source';
          source.dataset.src = item;
          source.textContent = songname;
          const description = document.createElement('span');
          description.className = 'simp-desc';
          description.textContent = artist;
          li.append(source, description);
          list.append(li);
      }
      const listRoot = document.getElementById('ulist');
      listRoot.textContent = '';
      listRoot.appendChild(list);
  }
  const loadState = document.querySelector('.library-load-state');
  const retry = document.querySelector('.library-retry');
  let loading = false;
  async function loadLibrary() {
      if (loading) return;
      loading = true;
      retry.hidden = true;
      loadState.querySelector('p').textContent = '음악 목록을 불러오는 중…';
      try {
          await getMusics();
          if (window.BAMusicNativeAudio) await window.BAMusicNativeAudio.ready;
          BAPlayer();
          window.dispatchEvent(new Event('music-library-ready'));
          loadState.hidden = true;
      } catch (error) {
          console.error(error);
          loadState.querySelector('p').textContent = window.BAMusicNativeAudio?.desktop && window.BAMusicNativeAudio.error
              ? '홈페이지 음악에 연결하지 못했습니다. 다시 불러오기를 눌러 주세요.'
              : '음악 목록을 불러오지 못했습니다. 다시 시도해 주세요.';
          retry.hidden = false;
      } finally {
          loading = false;
      }
  }
  retry.addEventListener('click', () => {
      if (window.BAMusicNativeAudio?.desktop && window.BAMusicNativeAudio.error) location.reload();
      else loadLibrary();
  });
  loadLibrary();
