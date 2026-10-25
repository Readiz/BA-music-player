const CACHE = 'readiz-music-offline-v1';
const OFFLINE = new URL('./offline.html', self.location.href).href;
self.addEventListener('install', event => {
  // Only the offline document is cached; update the handler without reloading
  // an open player. A failed offline preparation keeps the previous worker.
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('readiz-music-offline-') && key !== CACHE)
    .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // Music, range requests and catalogs stay on the network; installation does not copy the library.
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Let the browser keep navigation metadata (including iframe destination)
  // through SSO redirects. Never fetch or substitute an offline OAuth callback.
  if (/^\/(?:_auth|api\/auth)(?:\/|$)/.test(url.pathname) || /^\/login\/?$/.test(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
