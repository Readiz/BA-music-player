(function () {
  const base = 'https://blog.readiz.com/BA-music-player/';
  window.BAMusicSource = {
    base,
    media: path => new URL(path, base).href,
    catalog(path) {
      const url = new URL(path, base);
      // Pages uses a ten-minute CDN cache; a completed import must be visible now.
      url.searchParams.set('v', Date.now().toString());
      return url.href;
    },
  };
})();
