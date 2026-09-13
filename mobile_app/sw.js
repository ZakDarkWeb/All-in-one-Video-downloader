// ZDownloader Pro Service Worker
const CACHE_NAME = 'zdownloader-pwa-v4.2';
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
  // Only handle navigation requests for app shell; network first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./') || caches.match('index.html'))
    );
    return;
  }
  // Let external APIs, scrapers, and downloads pass directly through network
  event.respondWith(fetch(event.request));
});
