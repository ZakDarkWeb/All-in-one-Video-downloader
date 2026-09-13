// ZDownloader Pro Service Worker
const CACHE_NAME = 'zdownloader-pwa-v2';
const ASSETS = [
  './',
  'manifest.json',
  'icons/icon192.png',
  'icons/icon512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => {
        if (k !== CACHE_NAME) return caches.delete(k);
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only handle navigation requests for app shell; network first for APIs and media
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/'))
    );
    return;
  }
  // Let APIs, files, streams and downloads go directly through network
  event.respondWith(fetch(event.request));
});
