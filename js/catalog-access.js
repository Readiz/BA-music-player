(function() {
  let authenticated = null, checking = false, changing = false;
  const button = document.querySelector(".music-account");
  const base = "https://music.readiz.com/";
  const access = window.BAMusicAccess = {
    storageKey: (key) => authenticated ? key : key + "-public",
    async catalog() {
      const response = await fetch(new URL("api/catalog", base), { credentials: "include", cache: "no-store" });
      if (!response.ok) throw Error("음악 목록을 불러오지 못했습니다.");
      const data = await response.json();
      if (!Array.isArray(data.list) || typeof data.authenticated !== "boolean") throw Error("Invalid music catalog");
      authenticated = data.authenticated;
      button.textContent = authenticated ? "로그아웃" : "로그인";
      button.title = authenticated ? "Discord 로그아웃" : "Discord로 로그인하여 모든 앨범 보기";
      button.hidden = false;
      return data;
    },
    async refresh() {
      var _a, _b, _c;
      if (checking || changing || authenticated === null || document.hidden) return;
      checking = true;
      try {
        const response = await fetch(new URL("api/auth/me", base), { credentials: "include", cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (data.authenticated === authenticated) return;
        changing = true;
        if ((_a = window.BAMusicNativeAudio) == null ? void 0 : _a.desktop) window.BAMusicNativeAudio.send("refresh");
        else {
          (_b = window.BAMusicPlayback) == null ? void 0 : _b.pause();
          (_c = window.BAMusicNativeAudio) == null ? void 0 : _c.removeAttribute("src");
        }
        location.reload();
      } finally {
        checking = false;
      }
    }
  };
  const check = () => access.refresh().catch(() => {
  });
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  setInterval(check, 3e4);
  button.addEventListener("click", async () => {
    var _a;
    if (!authenticated) {
      const url = "/api/auth/discord/start?returnTo=" + encodeURIComponent(location.pathname + location.search);
      if ((_a = window.BAMusicNativeAudio) == null ? void 0 : _a.desktop) window.open(url, "_blank", "noopener");
      else location.assign(url);
      return;
    }
    button.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw Error("logout");
      await access.refresh();
    } catch (e) {
      button.title = "로그아웃하지 못했습니다. 다시 시도해 주세요.";
    } finally {
      button.disabled = false;
    }
  });
})();
