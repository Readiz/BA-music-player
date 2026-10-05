(function() {
  const port = window.ReadizMusicNative;
  if (!port || typeof port.postMessage !== "function") return;
  const MAX_SAMPLE_AGE = 1e3;
  const CORRECTION_TIME = 500;
  class NativeAudio extends EventTarget {
    constructor() {
      super();
      this.state = { id: "", queue: [], paused: true, position: 0, duration: 0, repeat: false, autoNext: true, random: true };
      this.playbackRate = 1;
      this.sampleAt = performance.now();
      this.correction = 0;
      this.frame = 0;
      this.pendingSeek = null;
      this.awaitingSync = false;
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
          this.state.position = this.currentTime;
          this.state.error = true;
          this.pendingSeek = null;
          this.correction = 0;
          this.updateAnimation();
          this.rejectReady(new Error("Android 재생 서비스에 연결하지 못했습니다. 앱을 다시 열어 주세요."));
          this.dispatchEvent(new Event("error"));
          return;
        }
        if (state.type !== "state") return;
        const now = performance.now();
        const displayed = this.currentTime;
        const wasAdvancing = this.advancing;
        const previous = this.state;
        const hadPendingSeek = Boolean(this.pendingSeek);
        this.state = { ...previous, ...state };
        if (this.pendingSeek && (previous.id !== this.state.id || state.error || now - this.pendingSeek.at >= 1500 || Math.abs(state.position - this.pendingSeek.position) < 0.25)) {
          this.pendingSeek = null;
        }
        const continuing = !this.awaitingSync && previous.id === this.state.id && wasAdvancing;
        this.awaitingSync = document.hidden;
        this.sampleAt = now;
        const difference = displayed - this.state.position;
        this.correction = continuing && this.advancing && !hadPendingSeek && Math.abs(difference) <= 0.25 ? difference : 0;
        this.updateAnimation();
        this.resolveReady();
        if (previous.id !== state.id) this.dispatchEvent(new Event("trackchange"));
        if (state.queue) this.dispatchEvent(new Event("queuechange"));
        this.dispatchEvent(new Event("optionschange"));
        this.dispatchEvent(new Event("timeupdate"));
        this.dispatchEvent(new Event(state.error ? "error" : state.buffering ? "waiting" : state.paused ? "pause" : "playing"));
      };
      this.send("sync");
      document.addEventListener("visibilitychange", () => {
        this.awaitingSync = true;
        this.updateAnimation();
        if (!document.hidden) this.send("sync");
      });
    }
    get advancing() {
      return Boolean(this.state.id && this.state.duration > 0 && !this.state.paused && !this.state.buffering && !this.state.ended && !this.state.error && !this.awaitingSync);
    }
    updateAnimation() {
      const animate = this.advancing && !document.hidden && !this.pendingSeek && performance.now() - this.sampleAt < MAX_SAMPLE_AGE;
      if (!animate && this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
      if (animate && !this.frame) {
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.dispatchEvent(new Event("timeupdate"));
          this.updateAnimation();
        });
      }
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
      if (this.pendingSeek) return this.pendingSeek.position;
      const elapsed = this.advancing ? Math.min(MAX_SAMPLE_AGE, Math.max(0, performance.now() - this.sampleAt)) : 0;
      const position = this.state.position + elapsed / 1e3 * this.playbackRate + (this.advancing ? this.correction * (1 - Math.min(1, elapsed / CORRECTION_TIME)) : 0);
      return Math.max(0, Math.min(this.state.duration || Infinity, position));
    }
    set currentTime(seconds) {
      if (!Number.isFinite(seconds)) return;
      const position = Math.max(0, Math.min(this.state.duration || Infinity, seconds));
      this.pendingSeek = { position, at: performance.now() };
      this.correction = 0;
      this.updateAnimation();
      this.send("seek", { position: Math.round(position * 1e3) });
      this.dispatchEvent(new Event("timeupdate"));
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
