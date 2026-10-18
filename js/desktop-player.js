(function() {
  if (window.parent === window || window.name !== "readiz-music-desktop-v1" || window.ReadizMusicNative) return;
  let origin;
  try {
    origin = new URL(document.referrer).origin;
  } catch (e) {
    return;
  }
  if (!["https://www.readiz.com", "https://newblog.dev.readiz.com"].includes(origin)) return;
  const session = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("");
  const type = "readiz:music";
  let connected = false, failed = false, seq = 0, ack = 0;
  let current = { queue: [] };
  let initialQueue = false;
  const connect = () => window.parent.postMessage({ type, session, connect: true }, origin);
  const retry = setInterval(connect, 1e3);
  const timeout = setTimeout(fail, 15e3);
  function fail() {
    var _a;
    if (connected || failed) return;
    failed = true;
    clearInterval(retry);
    (_a = port.onmessage) == null ? void 0 : _a.call(port, { data: JSON.stringify({ type: "failure" }) });
  }
  const port = window.ReadizMusicNative = {
    desktop: true,
    postMessage(raw) {
      const value = JSON.parse(raw);
      if (!connected) {
        if (!failed) connect();
        return;
      }
      let command = { type: value.type };
      if (value.type === "queue") {
        command = { ...command, ids: value.tracks.map((track) => track.id), index: value.index, play: value.play, preserve: value.preserve, initial: initialQueue };
        initialQueue = false;
      } else if (value.type === "select") command = { ...command, id: current.queue[value.index], play: value.play };
      else if (value.type === "seek") command.position = value.position;
      else if (value.type === "options") {
        for (const key of ["repeat", "autoNext", "random"]) if (typeof value[key] === "boolean") command[key] = value[key];
      }
      window.parent.postMessage({ type, session, seq: ++seq, command }, origin);
    }
  };
  window.addEventListener("message", (event) => {
    var _a;
    if (event.source !== window.parent || event.origin !== origin || failed) return;
    const data = event.data;
    if (!data || data.type !== type || data.session !== session) return;
    if (data.failure) {
      fail();
      return;
    }
    if (!data.state || data.state.type !== "state" || !Number.isSafeInteger(data.ack) || data.ack < seq || data.ack < ack) return;
    if (!connected) initialQueue = !data.state.active;
    connected = true;
    ack = data.ack;
    clearTimeout(timeout);
    clearInterval(retry);
    current = { ...current, ...data.state };
    (_a = port.onmessage) == null ? void 0 : _a.call(port, { data: JSON.stringify(data.state) });
  });
})();
