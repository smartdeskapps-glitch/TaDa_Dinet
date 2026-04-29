// ============================================================
// SERVICE WORKER — Dinet Logistics OS
// Estrategia:
//   • Shell propio (index, scanner, manifest, iconos) → Cache First
//   • GAS / APIs externas → Network First con fallback al shell offline
//   • html5-qrcode CDN → Cache First (se cachea en primer uso)
// ============================================================

const CACHE_NAME    = 'dinet-shell-v8';
const OFFLINE_PAGE  = './index.html';

// Assets que se precargan en install — el shell mínimo para abrir offline
const PRECACHE_ASSETS = [
  './index.html',
  './scanner.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // Precachear html5-qrcode para que el scanner funcione offline desde el primer uso
  'https://cdn.jsdelivr.net/npm/html5-qrcode/minified/html5-qrcode.min.js',
];

// ── INSTALL: precargar shell ──────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll falla silenciosamente si algún icono no existe — usar Promise.allSettled
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] No se pudo cachear:', url, err))
        )
      );
    })
  );
});

// ── ACTIVATE: limpiar cachés viejos ──────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: lógica por tipo de recurso ────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Ignorar solicitudes no-GET (POST de GAS, etc.)
  if (event.request.method !== 'GET') return;

  // 2. GAS / googleapis → Network First: intentar red, si falla → offline shell
  const isGAS = url.hostname.endsWith('googleusercontent.com') ||
                url.hostname === 'script.google.com' ||
                url.hostname.endsWith('googleapis.com');
  if (isGAS) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(OFFLINE_PAGE)
      )
    );
    return;
  }

  // 3. CDN de html5-qrcode → Cache First (se cachea en primer uso)
  const isCDN = url.hostname === 'cdn.jsdelivr.net';
  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached); // si no hay red ni caché, devuelve undefined (falla gracefully)
      })
    );
    return;
  }

  // 4. Assets propios (index.html, scanner.html, iconos, etc.) → Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      // No está en caché → buscar en red y cachear para la próxima
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(OFFLINE_PAGE));
    })
  );
});
