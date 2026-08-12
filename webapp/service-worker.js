/**
 * PMS33 Service Worker v3
 * Network-first strategy for app shell to ensure fresh updates.
 */

const CACHE_NAME = 'pms33-v3';
const SHELL_URLS = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/app.js',
    './js/api.js',
    './js/dashboard.js',
    './js/alerts.js',
    './js/history.js',
    './js/settings.js',
    './js/songs.js',
    './js/songs_library.js'
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS))
    );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys
                .filter(k => k !== CACHE_NAME)
                .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ─── Fetch strategy: Network-first, fallback to cache ────────────────────────
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // External APIs & fonts -> network only
    if (url.hostname === 'io.adafruit.com' || url.hostname.includes('fonts.g')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // App shell -> Network first, fallback to cache
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (event.request.method === 'GET' && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
