(() => {
  if (window.parent === window) return;
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !["https://www.readiz.com", window.location.origin].includes(event.origin))
      return;
    const data = event.data;
    if (!data || data.type !== "readiz:frame-request" || typeof data.requestId !== "string" || data.requestId.length > 100)
      return;
    if (data.action === "reload") {
      window.location.reload();
      return;
    }
    if (data.action !== void 0) return;
    window.parent.postMessage(
      {
        type: "readiz:frame-location",
        requestId: data.requestId,
        url: window.location.href
      },
      event.origin
    );
  });
})();
