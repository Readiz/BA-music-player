(function() {
  if (window.BAMusicTV) return;
  const open = document.querySelector(".music-add-open");
  const modal = document.querySelector(".music-add-dialog");
  const close = modal.querySelector(".music-add-close");
  const guest = modal.querySelector(".music-add-guest");
  const account = modal.querySelector(".music-add-account");
  const form = modal.querySelector("form");
  const input = form.querySelector("input");
  const submit = form.querySelector("button");
  const status = modal.querySelector(".music-add-status");
  const jobs = modal.querySelector(".music-add-jobs");
  const logout = modal.querySelector(".music-logout");
  let authenticated = false, timer, priorFocus, refreshing = false, duplicate;
  const labels = { queued: "대기 중", checking: "영상 확인 중", downloading: "다운로드 중", converting: "음악 준비 중", syncing: "동기화 중 · 완료 후 ETC에 추가됩니다", ready: "동기화 완료 · ETC에 추가됨", failed: "추가 실패" };
  open.hidden = false;
  const message = (text) => {
    status.textContent = text;
  };
  async function api(path, options = {}) {
    const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...options });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        authenticated = false;
        guest.hidden = false;
        account.hidden = true;
      }
      throw new Error(body.error || "요청을 처리하지 못했습니다. 다시 시도해 주세요.");
    }
    return body;
  }
  function renderJobs(items) {
    var _a;
    if (duplicate && !items.some((job) => job.id === duplicate.id)) items = [duplicate, ...items];
    jobs.textContent = "";
    for (const job of items) {
      const row = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = job.title || "유튜브 음악";
      const state = document.createElement("span");
      state.textContent = job.error || labels[job.status];
      row.append(title, state);
      if (job.track) {
        (_a = window.BAMusicLibrary) == null ? void 0 : _a.add(job.track);
        const listen = document.createElement("button");
        listen.type = "button";
        listen.textContent = "듣기";
        listen.addEventListener("click", () => {
          var _a2;
          hide();
          (_a2 = window.BAMusicLibrary) == null ? void 0 : _a2.listen(job.track);
        });
        row.append(listen);
      }
      jobs.append(row);
    }
  }
  async function refreshJobs() {
    if (!authenticated || refreshing || modal.hidden) return;
    refreshing = true;
    try {
      const result = await api("/api/imports");
      renderJobs(result.jobs);
      clearTimeout(timer);
      if (result.jobs.some((job) => !["ready", "failed"].includes(job.status))) timer = setTimeout(refreshJobs, 2e3);
    } catch (error) {
      message(error.message);
      if (authenticated) timer = setTimeout(refreshJobs, 5e3);
    } finally {
      refreshing = false;
    }
  }
  async function show() {
    priorFocus = document.activeElement;
    modal.hidden = false;
    close.focus();
    message("로그인 상태를 확인하는 중…");
    try {
      const result = await api("/api/auth/me");
      authenticated = result.authenticated;
      guest.hidden = authenticated;
      account.hidden = !authenticated;
      guest.querySelector("a").hidden = !result.enabled;
      message(result.enabled ? "" : "음악 추가 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      if (authenticated) {
        input.focus();
        await refreshJobs();
      }
    } catch (e) {
      message("음악 추가 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }
  function hide() {
    modal.hidden = true;
    clearTimeout(timer);
    priorFocus == null ? void 0 : priorFocus.focus();
  }
  open.addEventListener("click", show);
  close.addEventListener("click", hide);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) hide();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
    if (event.key === "Tab") {
      const elements = [...modal.querySelectorAll("button,a,input")].filter((el) => !el.disabled && el.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    event.stopPropagation();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message("추가 요청 중…");
    try {
      const { job } = await api("/api/imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: input.value }) });
      message(job.status === "ready" ? "이미 ETC에 있는 곡입니다. 바로 들을 수 있습니다." : "동기화가 끝나면 ETC에 추가됩니다. 몇 분 걸릴 수 있으며, 창을 닫아도 계속 진행됩니다.");
      duplicate = job.status === "ready" ? job : null;
      input.value = "";
      await refreshJobs();
    } catch (error) {
      message(error.message);
    } finally {
      submit.disabled = false;
    }
  });
  logout.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error();
      authenticated = false;
      duplicate = null;
      clearTimeout(timer);
      jobs.textContent = "";
      guest.hidden = false;
      account.hidden = true;
      message("로그아웃했습니다. 음악은 계속 들을 수 있습니다.");
    } catch (e) {
      message("로그아웃하지 못했습니다. 다시 시도해 주세요.");
    }
  });
  window.addEventListener("music-library-ready", refreshJobs);
  const authError = new URL(location.href).searchParams.get("authError");
  if (authError || location.hash === "#add-music") {
    const clean = new URL(location.href);
    clean.searchParams.delete("authError");
    clean.hash = "";
    history.replaceState(null, "", clean.pathname + clean.search);
    show().then(() => {
      if (authError) message(authError === "forbidden" ? "음악 추가 권한이 있는 디스코드 계정으로 로그인해 주세요." : "디스코드 로그인에 실패했습니다. 다시 시도해 주세요.");
    });
  }
})();
