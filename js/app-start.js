(function () {
  // The local WGT launcher remains in history so hosted pages can return to its exit API.
  if (/Tizen/i.test(navigator.userAgent) && new URLSearchParams(location.search).get('launcher') === 'tizen' && history.length > 1) {
    try { sessionStorage.setItem('music:launcher-depth', String(history.length - 1)); } catch (_) { /* Exit can still use the TV home key. */ }
  }
  location.replace('./?tv=1');
})();
