const install = document.querySelector("[data-install]");
let installPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (window.BAMusicTV) return;
  installPrompt = event;
  install.hidden = false;
});
install.addEventListener("click", async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = void 0;
  install.hidden = true;
  await prompt.prompt();
});
window.addEventListener("appinstalled", () => {
  install.hidden = true;
});
if (!window.BAMusicTV && "serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("앱 오프라인 안내를 준비하지 못했습니다.", error));
  });
}
