// Shared desktop iframe protocol. This file is also served at the enrolled
// service origins; it never exposes page content, cookies, or storage.
(() => {
  if (window.parent === window) return;
  window.addEventListener('message', (event) => {
    if (
      event.source !== window.parent ||
      !['https://www.readiz.com', window.location.origin].includes(event.origin)
    )
      return;
    const data = event.data;
    if (
      !data ||
      data.type !== 'readiz:frame-request' ||
      typeof data.requestId !== 'string' ||
      data.requestId.length > 100
    )
      return;
    if (data.action === 'reload') {
      window.location.reload();
      return;
    }
    if (data.action !== undefined) return;
    window.parent.postMessage(
      {
        type: 'readiz:frame-location',
        requestId: data.requestId,
        url: window.location.href,
      },
      event.origin,
    );
  });
})();
