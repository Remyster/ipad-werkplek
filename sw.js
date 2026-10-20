"use strict";
const CACHE = "remy-ipad-werkplek-shell-v30";
const PREFIX = "remy-ipad-werkplek-shell-";
const ASSETS = ["./", "./index.html", "./style.css", "./model.js", "./store.js", "./config.js", "./app.js", "./pdf.js", "./drive.js", "./connections.js", "./ai.js", "./werkhub.js", "./sync.js", "./dictate.js", "./agenda.js", "./slim.js", "./nu.js", "./lock.js", "./manifest.json", "./icon.svg",
  "./vendor/package/legacy/build/pdf.mjs", "./vendor/package/legacy/build/pdf.worker.mjs"];
const allowed = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    let failure = "";
    try {
      const cache = await caches.open(CACHE);
      for (const path of ASSETS) {
        const url = new URL(path, self.registration.scope);
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`${path} gaf HTTP ${response.status}`);
        await cache.put(url.href, response);
      }
    } catch (error) {
      failure = error.message || String(error);
      await caches.delete(CACHE);
    }
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage(failure
      ? { type: "offline-error", message: failure }
      : { type: "offline-ready" });
  })());
});
self.addEventListener("fetch", event => {
  const vendor = event.request.url.startsWith(new URL("./vendor/package/", self.registration.scope).href);
  if (event.request.method !== "GET" || (!allowed.has(event.request.url) && !vendor)) return;
  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;
    } catch (error) {
      cache = null;
    }
    const response = await fetch(event.request);
    if (vendor && response.ok && cache) {
      try { await cache.put(event.request, response.clone()); }
      catch (error) { console.warn("Werkplek offline-cache:", error.message); }
    }
    return response;
  })());
});
