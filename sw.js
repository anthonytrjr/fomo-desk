/* Cache the app shell only. Never cache API or /d/ live data. */
const SHELL = "desk-shell-v2";
const ASSETS = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(SHELL).then(function (cache) { return cache.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== SHELL; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  if (/\/d(\/|$)/.test(url.pathname) || /\/api(\/|$)/.test(url.pathname)) {
    return; // network only; do not cache live data
  }
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      return hit || fetch(event.request);
    })
  );
});
