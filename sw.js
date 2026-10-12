"use strict";
const CACHE = "remy-ipad-werkplek-shell-v10";
const PREFIX = "remy-ipad-werkplek-shell-";
const ASSETS = ["./", "./index.html", "./style.css", "./model.js", "./app.js", "./pdf.js", "./connections.js", "./ai.js", "./manifest.json", "./icon.svg",
  "./vendor/package/legacy/build/pdf.mjs", "./vendor/package/legacy/build/pdf.worker.mjs"];
const allowed = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const vendor = event.request.url.startsWith(new URL("./vendor/package/", self.registration.scope).href);
  if (event.request.method !== "GET" || (!allowed.has(event.request.url) && !vendor)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (vendor && response.ok) await cache.put(event.request, response.clone());
    return response;
  }));
});
