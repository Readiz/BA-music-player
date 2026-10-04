(function() {
  const port = window.ReadizMusicNative;
  if (!port || typeof port.postMessage !== "function") return;
  class NativeAudio extends EventTarget {
    constructor() {
      super();
      this.state = { id: "", queue: [], paused: true, position: 0, duration: 0, repeat: false, autoNext: true, random: true };
      this.playbackRate = 1;
      this.ready = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      this.ready.catch(() => {
      });
      port.onmessage = (event) => {
        let state;
        try {
          state = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        if (state.type === "failure") {
          this.state.error = true;
          this.rejectReady(new Error("Android 재생 서비스에 연결하지 못했습니다. 앱을 다시 열어 주세요."));
          this.dispatchEvent(new Event("error"));
          return;
        }
        if (state.type !== "state") return;
        const previous = this.state;
        this.state = { ...previous, ...state };
        this.resolveReady();
        if (previous.id !== state.id) this.dispatchEvent(new Event("trackchange"));
        if (state.queue) this.dispatchEvent(new Event("queuechange"));
        this.dispatchEvent(new Event("optionschange"));
        this.dispatchEvent(new Event("timeupdate"));
        this.dispatchEvent(new Event(state.error ? "error" : state.buffering ? "waiting" : state.paused ? "pause" : "playing"));
      };
      this.send("sync");
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.send("sync");
      });
    }
    send(type, data = {}) {
      port.postMessage(JSON.stringify({ ...data, type }));
    }
    get paused() {
      return this.state.paused;
    }
    get ended() {
      return this.state.ended;
    }
    get error() {
      return this.state.error;
    }
    get src() {
      return this.state.id ? new URL(this.state.id, location.href).href : "";
    }
    get duration() {
      return this.state.duration || NaN;
    }
    get currentTime() {
      return this.state.position;
    }
    set currentTime(seconds) {
      this.send("seek", { position: Math.round(seconds * 1e3) });
    }
    get loop() {
      return this.state.repeat;
    }
    set loop(repeat) {
      this.options({ repeat });
    }
    options(values) {
      Object.assign(this.state, values);
      this.send("options", this.state);
    }
    play() {
      this.send("play");
      return Promise.resolve();
    }
    pause() {
      this.send("pause");
    }
    load() {
    }
    removeAttribute(name) {
      if (name === "src") this.send("stop");
    }
    configure(tracks, index, play, preserve = false) {
      this.send("queue", { tracks, index, play, preserve });
    }
  }
  window.BAMusicNativeAudio = new NativeAudio();
})();
