'use strict';

// Only this patient-free shell and its public assets may enter Cache Storage.
const cacheName = 'tafiyar-provider-shell-v3';
const shellPath = '/offline';
const publicFiles = new Set([shellPath, '/assets/offline.js', '/assets/app.css']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    for (const path of publicFiles) {
      const response = await fetch(path, { cache: 'reload', credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('Offline shell could not be installed.');
      await cache.put(path, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('tafiyar-provider-shell-') && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const publicFile = publicFiles.has(url.pathname);
  const providerNavigation = request.mode === 'navigate' && url.pathname === '/provider';
  if (!publicFile && !providerNavigation) return;

  // Keep live permission errors intact. A failed provider navigation can show only the generic shell.
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(publicFile ? url.pathname : shellPath) || Response.error();
  }));
});
