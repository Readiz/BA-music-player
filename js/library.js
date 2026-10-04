BAAlbumPanel();
  async function getMusics() {
      const [arr, catalog] = await Promise.all([
          fetch('./musicList.json', { cache: 'no-cache' }).then(res => {
              if (!res.ok) throw new Error('음악 목록을 불러오지 못했습니다.');
              return res.json();
          }),
          // Keep the filename-based playlist usable if metadata is unavailable.
          fetch('./blue-archive-ost.json', { cache: 'no-cache' })
              .then(res => res.ok ? res.json() : { titles: {} })
              .catch(() => ({ titles: {} })),
      ]);
      const list = document.createDocumentFragment();
      for (const [index, item] of arr.entries()) {
          const parts = String(item).split('/');
          const artist = decodeURIComponent(parts[parts.length - 2]);
          let songname = decodeURIComponent(parts[parts.length - 1]).replace(/\.(ogg|mp3|m4a)$/i, '');
          const unnamed = artist === 'Blue Archive' && songname.match(/^theme_(\d+)$/);
          const title = unnamed && catalog.titles?.[Number(unnamed[1])];
          // Fill missing names by OST number without changing audio URLs or known names.
          if (title) songname += `-${title}`;

          const li = document.createElement('li');
          li.dataset.folder = parts.slice(2, -1).map(decodeURIComponent).join('/') || artist;
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
          BAPlayer();
          loadState.hidden = true;
      } catch (error) {
          console.error(error);
          loadState.querySelector('p').textContent = '음악 목록을 불러오지 못했습니다. 다시 시도해 주세요.';
          retry.hidden = false;
      } finally {
          loading = false;
      }
  }
  retry.addEventListener('click', loadLibrary);
  loadLibrary();
