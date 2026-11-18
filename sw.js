/*
 * sw.js: the service worker. It makes the app work offline.
 *
 * Network-first: every request tries the network, so a change that has been
 * merged shows up the next time you open the app online. Each good answer is
 * saved in the cache, and the cache is only the fallback when the network is
 * not there. Every path is relative, because the site lives at
 * https://<username>.github.io/<repository>/ and not at the top of a domain.
 */
'use strict';

var CACHE = 'age-capstruct-v1';

var FILES = [
  './',
  'index.html',
  'styles.css',
  'capstruct.js',
  'app.js',
  'manifest.webmanifest',
  'data/assumptions.csv',
  'data/cdss.csv',
  'data/example_firms.csv',
  'data/ebit_scenarios.csv',
  'data/banker_schedule.csv',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

// Save the app's files so the very first offline visit already works. If one
// file cannot be fetched, keep going with the rest.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(FILES.map(function (file) {
        return cache.add(new Request(file, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

// Remove caches left behind by an older version of this file.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE; })
        .map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url = new URL(request.url);
  // Only our own files. Anything else (there should be nothing) goes straight through.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    // 'no-cache' makes the browser check with the server instead of reusing its
    // own saved copy, which GitHub Pages lets it keep for up to 10 minutes.
    fetch(request, { cache: 'no-cache' }).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;
        // Opening the app offline at some other address: show the main page.
        if (request.mode === 'navigate') {
          return caches.match(new URL('index.html', self.registration.scope).href);
        }
        return Response.error();
      });
    })
  );
});
