const CACHE = 'aya-pos-v2.15.2-barcode-catalog';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './css/styles.css',
  './css/fixes-v2.5.css',
  './css/fixes-v2.6.css',
  './css/kasir-mart-v2.15.1.css',
  './js/app.js',
  './js/aya-v2.6-fixes.js',
  './js/aya-v2.6.1-category-fix.js',
  './js/script.js',
  './js/firebase-config.js',
  './js/store.js',
  './js/product-cache.js',
  './js/legacy-adapter.js',
  './js/utils.js',
  './js/menu-data.js',
  './js/barcode-catalog-v2.15.2.js',
  './js/dashboard.js',
  './js/pos.js',
  './js/master.js',
  './js/branch.js',
  './js/transaction.js',
  './js/backoffice.js',
  './js/reports.js',
  './js/cash.js',
  './js/kitchen.js',
  './js/users.js',
  './js/settings.js',
  './js/print.js',
  './js/scanner.js',
  './js/bluetooth.js',
  './js/pwa.js',
  './js/audit.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (
    event.request.method !== 'GET'
    || !event.request.url.startsWith(self.location.origin)
  ) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;

        // Hanya permintaan halaman yang boleh kembali ke index.html.
        // File JS yang hilang tidak lagi menerima HTML sebagai pengganti.
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }

        return Response.error();
      })
  );
});
