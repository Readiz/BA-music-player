/* Pure geometry and key normalization, shared by the controller and tests. */
(function (root) {
  const codes = { 13: 'Enter', 27: 'Back', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 10009: 'Back', 461: 'Back', 415: 'MediaPlay', 19: 'MediaPause', 413: 'MediaStop', 412: 'MediaRewind', 417: 'MediaFastForward', 10252: 'MediaPlayPause', 427: 'MediaTrackNext', 428: 'MediaTrackPrevious' };
  const aliases = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Return: 'Enter', Escape: 'Back', BrowserBack: 'Back', GoBack: 'Back' };
  function key(event) {
    const value = aliases[event.key] || event.key;
    return /^(Arrow(Left|Right|Up|Down)|Enter|Back|Media\w+)$/.test(value || '') ? value : codes[event.keyCode] || value;
  }
  function nearest(from, candidates, direction) {
    const vertical = direction === 'ArrowUp' || direction === 'ArrowDown';
    const sign = direction === 'ArrowUp' || direction === 'ArrowLeft' ? -1 : 1;
    const center = r => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
    const origin = center(from);
    let best = null;
    let bestScore = Infinity;
    candidates.forEach(candidate => {
      const r = candidate.rect;
      const c = center(r);
      const primary = (vertical ? c.y - origin.y : c.x - origin.x) * sign;
      if (primary <= 2) return;
      const secondary = Math.abs(vertical ? c.x - origin.x : c.y - origin.y);
      const aligned = vertical ? r.right > from.left && r.left < from.right : r.bottom > from.top && r.top < from.bottom;
      const score = primary + secondary * 2 + (aligned ? 0 : 10000);
      if (score < bestScore) { bestScore = score; best = candidate.item; }
    });
    return best;
  }
  root.BAMusicRemoteCore = { key, nearest };
})(typeof window === 'undefined' ? globalThis : window);
