/* Offline support.
 *
 * The whole app is a handful of static files, so we cache them all on install
 * and serve from the cache first. Nothing here touches journal data — entries
 * live in IndexedDB and never pass through the network.
 *
 * Bump CACHE when you change any file, so phones pick up the new version.
 */

const CACHE = 'journal-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/db.js',
  './js/nlp.js',
  './js/analysis.js',
  './js/format.js',
  './js/time.js',
  './js/ui.js',
  './js/feed.js',
  './js/vault.js',
  './js/settings.js',
  './js/speech.js',
  './js/pin.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Refresh in the background so the next launch is up to date.
        fetch(request)
          .then((response) => {
            if (response && response.ok) caches.open(CACHE).then((c) => c.put(request, response));
          })
          .catch(() => { /* offline: the cached copy is what we have */ });
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
