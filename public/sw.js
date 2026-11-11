// Progressive Web App Service Worker for 無所事事辦公室 — AI Office
const CACHE_NAME = 'aioffice-pwa-v5';

const STATIC_PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.png',
  './apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

// Install: precache essential shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_PRECACHE).catch((err) => {
        console.warn('Precache partial fail (safe to ignore in dev):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: purge old cache stores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for dynamic navigation, Cache-first with network fallback for assets
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension / API requests
  if (request.method !== 'GET' || url.protocol.startsWith('chrome-extension')) {
    return;
  }

  // API calls: Network only
  if (url.pathname.includes('/api/')) {
    return;
  }

  // HTML navigation: Network-first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match('./index.html') || await cache.match('./');
        return cachedResponse;
      })
    );
    return;
  }

  // Manifest & icons: network-first so installability checks and the logo are never stale
  if (
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.includes('/icons/') ||
    url.pathname.endsWith('/favicon.png') ||
    url.pathname.endsWith('/apple-touch-icon.png')
  ) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: Stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request, { cache: 'no-cache' }).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Network failed; return cached response if available
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
