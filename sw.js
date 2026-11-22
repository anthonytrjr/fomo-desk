/* v8: drop stale caches and unregister so iOS standalone cannot keep old JS. */
self.addEventListener("install", function (event) {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      return self.registration.unregister();
    })
  );
});
