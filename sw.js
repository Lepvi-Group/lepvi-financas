/* Funciona sem internet: guarda os arquivos do app e usa a rede só para atualizar. */
const V = 'lepvi-financas-v58';
const ARQ = ['./', 'index.html', 'styles.css', 'app.js', 'lib.js', 'qrcode.js', 'manifest.json', 'icone.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(ARQ))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return; // dados privados nunca ficam no cache
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((k) => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
