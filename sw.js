// WEG Field Service worker — app-shell caching for offline-first use in the field.
const CACHE_VERSION = 'weg-fieldservice-v5';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/camera.js',
  './js/reportSections.js',
  './js/testSections.js',
  './js/report.js',
  './js/vendor/docx.min.js',
  './js/vendor/jspdf.min.js',
  './js/vendor/jspdf.autotable.min.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/weg-logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigation (so a reconnected worker gets fresh app code),
// cache-first for static assets, and always let API calls hit the network directly.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return; // never intercept POST/PUT sync calls
  if (url.pathname.includes('/api/')) return; // let sync.js handle API calls & failures itself

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return resp;
      }).catch(() => cached);
    })
  );
});
