// Minimal service worker: cache the local app shell, network for everything else
// (the physics engine loads from esm.sh and stays on the network).
const CACHE = 'brutal-v2';
const ASSETS = [
  './', './index.html', './styles.css', './game.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png',
  './favicon.ico', './favicon-32.png', './favicon-16.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;  // let CDN/POSTs hit network
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
