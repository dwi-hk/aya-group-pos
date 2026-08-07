const CACHE = 'aya-pos-v2.4.0';
const ASSETS = [
  './','./index.html','./manifest.json','./css/styles.css',
  './js/app.js','./js/script.js','./js/firebase-config.js','./js/store.js','./js/legacy-adapter.js','./js/utils.js',
  './js/menu-data.js','./js/dashboard.js','./js/pos.js','./js/master.js',
  './js/branch.js','./js/transaction.js','./js/backoffice.js','./js/reports.js','./js/cash.js',
  './js/kitchen.js','./js/users.js','./js/settings.js','./js/print.js',
  './js/scanner.js','./js/bluetooth.js','./js/pwa.js','./js/audit.js'
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request).then(r => r || caches.match('./index.html'))));
});
