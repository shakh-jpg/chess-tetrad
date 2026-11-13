/* Service worker of "Шахматная тетрадь" (generated at build time by scripts/pwa-plugin.mjs).
 * Precaches the whole app (shell, Stockfish, pdf.js, fonts, icons) so it works offline.
 * Lookups use ignoreVary: hosts send Vary (Origin, Accept-Encoding) that would make
 * precached entries miss for module/CORS-mode requests (seen with pdf.js chunks offline).
 * Strategy: cache-first for precached files; navigations get the cached index.html;
 * other same-origin GET requests are cached at runtime. Nothing cross-origin is cached. */
var VERSION = '__VERSION__';
var PRECACHE = 'tetrad-precache-' + VERSION;
var RUNTIME = 'tetrad-runtime';
var ASSETS = __ASSETS__;

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(PRECACHE).then(function (c) {
    return c.addAll(ASSETS.map(function (a) { return new Request(a, { cache: 'reload' }); }));
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('tetrad-precache-') === 0 && k !== PRECACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html', { cacheName: PRECACHE, ignoreVary: true }).then(function (r) {
      return r || fetch(req);
    }));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(RUNTIME).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  }));
});
