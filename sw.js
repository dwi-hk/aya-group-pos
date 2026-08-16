const CACHE = 'aya-pos-v2.16.3-hierarchical-tabs';

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
  './css/reports-v2.10.1.css',
  './css/master-profit-v2.10.6.css',
  './css/kasir-gaji-v2.11.3.css',
  './css/kasir-profesional-v2.12.0.css',
  './css/kasir-mart-v2.15.1.css',
  './css/sidebar-hierarchy-v2.16.3.css',
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
  './js/payroll-v2.11.3.js',
  './js/pos-ui-v2.10.14.js',
  './js/aya-online-v2.11.0.js',
  './js/aya-online-v2.11.1-payroll.js',
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
  './js/direct-printer-v2.16.1.js',
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

        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }

        return Response.error();
      })
  );
});
