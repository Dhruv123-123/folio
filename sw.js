// Offline support: the app shell is precached; vendor assets (cmaps, OCR data) are cached on first use.
const VERSION = 'folio-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/reader.js', 'js/db.js', 'js/importer.js', 'js/extract.js', 'js/layout.js', 'js/outline.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isShell = req.mode === 'navigate' || /\.(html|css|js|mjs|webmanifest)$/.test(new URL(req.url).pathname) && !req.url.includes('/vendor/');
  if (isShell) {
    // Network first so updates land quickly; fall back to cache offline.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req.mode === 'navigate' ? 'index.html' : req, copy)); }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
