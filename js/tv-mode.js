/* Also usable as a TV preview in a desktop browser: /?tv=1. */
window.BAMusicTV = /Tizen|SmartTV|Smart-TV|Web0S|WebOS|ReadizMusicTV|AndroidTV/i.test(navigator.userAgent) || new URLSearchParams(location.search).get('tv') === '1';
if (window.BAMusicTV) document.documentElement.classList.add('tv-layout');
// Only upgraded Android TV shells enable wide-viewport overview scaling.
// Run in <head> before layout, without initial-scale=1 so WebView can fit the width.
if (window.BAMusicTV && /(?:^|\s)ReadizTVViewport\/1920(?:\s|$)/.test(navigator.userAgent)) {
  document.querySelector('meta[name="viewport"]').setAttribute('content', 'width=1920, viewport-fit=cover');
}
