// Service worker: keeps a copy of the app's files on the phone so it opens offline.
// IMPORTANT: change this version string every time you edit any app file,
// otherwise phones keep using the old cached copy.
const CACHE = 'larder-v2';

const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './fonts/doto.woff2',
  './fonts/instrument-sans.woff2',
];

// First visit (or new version): download and store every file
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES))
      .then(() => self.skipWaiting())   // take over without waiting for old tabs to close
  );
});

// Delete caches from older versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Every request: answer from the stored copy first, fall back to the network
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then(hit => hit || fetch(event.request))
  );
});
