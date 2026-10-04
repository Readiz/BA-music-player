(function() {
  if (/Tizen/i.test(navigator.userAgent) && new URLSearchParams(location.search).get("launcher") === "tizen" && history.length > 1) {
    try {
      sessionStorage.setItem("music:launcher-depth", String(history.length - 1));
    } catch (_) {
    }
  }
  location.replace("./?tv=1");
})();
