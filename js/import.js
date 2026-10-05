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
  const fileForm = modal.querySelector(".music-file-form");
  const fileInput = fileForm.querySelector("[type=file]");
  const fileTitle = fileForm.querySelector("[type=text]");
  const fileSubmit = fileForm.querySelector("[type=submit]");
  const progress = fileForm.querySelector("progress");
  const methods = [...modal.querySelectorAll("[data-method]")];
  let uploading = false;
  const status = modal.querySelector(".music-add-status");
  const jobs = modal.querySelector(".music-add-jobs");
  const logout = modal.querySelector(".music-logout");
  let authenticated = false, timer, priorFocus, refreshing = false, duplicate;
  const labels = { queued: "대기 중", checking: "음악 확인 중", downloading: "다운로드 중", converting: "음악 준비 중", syncing: "동기화 중 · 완료 후 ETC에 추가됩니다", ready: "동기화 완료 · ETC에 추가됨", failed: "추가 실패" };
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
      title.textContent = job.title || "음악";
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
      if (!uploading) message(result.enabled ? "" : "음악 추가 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      if (authenticated) {
        (form.hidden ? fileInput : input).focus();
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
  for (const button of methods) button.addEventListener("click", () => {
    const isFile = button.dataset.method === "file";
    form.hidden = isFile;
    fileForm.hidden = !isFile;
    for (const method of methods) method.setAttribute("aria-pressed", String(method === button));
    if (!uploading) message("");
    (isFile ? fileInput : input).focus();
  });
  fileInput.addEventListener("change", () => {
    var _a;
    fileTitle.value = (((_a = fileInput.files[0]) == null ? void 0 : _a.name) || "").replace(/\.[^.]+$/, "").slice(0, 200);
  });
  function upload(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads?" + new URLSearchParams({ name: file.name, title: fileTitle.value }));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.timeout = 10 * 60 * 1e3;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) progress.value = Math.round(event.loaded / event.total * 100);
        message(progress.value === 100 ? "전송 완료 · 서버에서 파일을 확인하는 중…" : "업로드 중 " + progress.value + "% · 전송이 끝날 때까지 앱이나 페이지를 열어 두세요.");
      };
      xhr.onload = () => {
        let body;
        try {
          body = JSON.parse(xhr.responseText);
        } catch (e) {
          reject(new Error("업로드 응답을 확인하지 못했습니다. 같은 파일로 다시 시도해 주세요."));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else {
          if (xhr.status === 401) {
            authenticated = false;
            guest.hidden = false;
            account.hidden = true;
          }
          reject(new Error(body.error || "파일을 업로드하지 못했습니다. 다시 시도해 주세요."));
        }
      };
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error("파일 전송이 중단되었습니다. 연결을 확인하고 같은 파일로 다시 시도해 주세요."));
      xhr.send(file);
    });
  }
  window.addEventListener("beforeunload", (event) => {
    if (uploading) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  fileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (uploading) return;
    const file = fileInput.files[0];
    if (!file || !file.size || file.size > 100 * 1024 * 1024) {
      message("비어 있지 않은 100MB 이하 파일을 선택해 주세요.");
      return;
    }
    uploading = true;
    progress.hidden = false;
    progress.value = 0;
    fileInput.disabled = fileTitle.disabled = fileSubmit.disabled = logout.disabled = submit.disabled = true;
    message("파일 전송을 시작합니다…");
    try {
      const { job } = await upload(file);
      duplicate = job.status === "ready" ? job : null;
      message(job.status === "ready" ? "이미 ETC에 있는 곡입니다. 바로 들을 수 있습니다." : "파일 전송이 완료되었습니다. 변환·동기화가 끝나면 ETC에 추가됩니다. 이제 창을 닫아도 됩니다.");
      fileForm.reset();
      await refreshJobs();
    } catch (error) {
      message(error.message);
    } finally {
      uploading = false;
      progress.hidden = true;
      fileInput.disabled = fileTitle.disabled = fileSubmit.disabled = logout.disabled = submit.disabled = false;
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
