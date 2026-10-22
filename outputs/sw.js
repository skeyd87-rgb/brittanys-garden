const CACHE_NAME = 'brittanys-garden-v14';
const CORE_ASSETS = [
  './', './index.html', './brittanys-garden-cozy-companion.html',
  './garden-reliability.js', './manifest.webmanifest', './vendor/zxing-browser.min.js'
];
const PHOTO_ASSETS = ['./assets/tomato.png', './assets/basil.png', './assets/pepper.png', './assets/lettuce.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    // Optional photo failures must not prevent offline care from installing.
    await Promise.allSettled(PHOTO_ASSETS.map(asset => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('brittanys-garden-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (event.request.mode === 'navigate' || event.request.destination === 'document') {
      try {
        const response = await fetch(event.request);
        if (!response.ok) throw new Error('Page unavailable');
        await cache.put(event.request, response.clone());
        return response;
      } catch {
        // Shortcuts include a version query; never loop through the redirect.
        return await cache.match(event.request, { ignoreSearch: true })
          || await cache.match('./brittanys-garden-cozy-companion.html')
          || new Response('Open your garden once online to prepare offline care.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
