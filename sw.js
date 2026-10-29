/* Service worker: makes Shape Check installable and usable without network.
   App files come from the cache first; a new version gets a new cache name. */
var CACHE = 'shapecheck-v0.3.0';
var ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'src/app.js', 'src/silhouette.js', 'src/edge-worker.js', 'src/core.js',
  'src/profile.js', 'src/export3d.js', 'src/viewer3d.js', 'src/measure.js',
  'icons/logo-gpi-white.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  // cache: 'reload' skips the browser HTTP cache, so a new version never precaches old files
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS.map(function (a) { return new Request(a, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  var isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;
  // Fonts are cross-origin: their responses are opaque (status unknown), so they are never cached.
  e.respondWith(caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then(function (hit) {
    if (hit) return hit;
    return fetch(e.request).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    });
  }));
});
