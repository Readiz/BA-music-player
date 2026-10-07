(function() {
  const base = "https://music.readiz.com/";
  window.BAMusicSource = {
    base,
    media: (path) => new URL(path, base).href,
    catalog(path) {
      const url = new URL(path, base);
      url.searchParams.set("v", Date.now().toString());
      return url.href;
    }
  };
})();
