// Offline app shell. Cache-first for same-origin GETs; the event log lives in
// IndexedDB and is never touched here. Bump VERSION whenever any shell file changes.
const VERSION = 'anamnesis-shell-001-4';
const SHELL = [
    './',
    './css/anamnesis.css',
    './icons/icon-180.png',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg',
    './index.html',
    './js/app.mjs',
    './js/core/analyzer.mjs',
    './js/core/cognition.mjs',
    './js/core/db.mjs',
    './js/core/intel.mjs',
    './js/core/rng.mjs',
    './js/core/schema.mjs',
    './js/core/seed.mjs',
    './js/core/store.mjs',
    './js/core/terminal.mjs',
    './js/ui.mjs',
    './js/views/analyzer.mjs',
    './js/views/characters.mjs',
    './js/views/common.mjs',
    './js/views/entities.mjs',
    './js/views/intelligence.mjs',
    './js/views/plots.mjs',
    './js/views/simulator.mjs',
    './js/views/terminal.mjs',
    './manifest.webmanifest',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
