/* Offline support.
 *
 * The whole app is a handful of static files, so we cache them all on install
 * and keep that copy as the offline fallback. Nothing here touches journal
 * data — entries live in IndexedDB and never pass through the network.
 *
 * Bump CACHE when you change any file, so phones drop the stale copy.
 */

const CACHE = 'journal-v9';

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

/**
 * Give up on the network after a moment and use what we already have.
 *
 * `cache: 'reload'` matters more than it looks: GitHub Pages serves these
 * files with `Cache-Control: max-age=600`, so a plain fetch is answered from
 * the browser's own HTTP cache and can hand back a ten-minute-old copy. That
 * defeats the whole point of going to the network first — a fix would appear
 * not to have shipped for ten minutes after every deploy. This forces a real
 * request and refreshes the HTTP cache with what comes back.
 */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, ms);
    fetch(request, { signal: controller.signal, cache: 'reload' })
      .then((response) => { clearTimeout(timer); resolve(response); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/*
 * Network first, cache as the safety net.
 *
 * The obvious alternative — serve the cache instantly and refresh in the
 * background — means every fix lands one launch late: you open the app, still
 * see the old version, and only get the new one next time. For an app that is
 * updated in response to your feedback, that is the wrong trade. These files
 * total well under a megabyte, so fetching them fresh costs very little, and
 * anything slower than three seconds (or offline entirely) falls straight back
 * to the cached copy.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetchWithTimeout(request, 3000);
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      // A navigation with nothing cached for that exact URL still gets the app.
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
