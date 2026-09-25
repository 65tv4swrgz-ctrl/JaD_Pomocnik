// Service worker: všechno potřebné pro offline běh se stáhne při instalaci do cache.
// BUILD mění skript tools/stamp.py (hash obsahu) – změna souboru = nová verze pro zařízení.
const BUILD = 'e682516dc6';
const CACHE = 'jad-' + BUILD;

const SQLJS = 'https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/';

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/catalog.js',
  'js/db.js',
  'js/rules.js',
  'js/store.js',
  'js/util.js',
  'js/version.js',
  'js/views/encounter.js',
  'js/views/encounters.js',
  'js/views/generate.js',
  'js/views/home.js',
  'js/views/items.js',
  'js/views/loot.js',
  'js/views/monsters.js',
  'js/views/parties.js',
  'js/views/play.js',
  'js/views/settings.js',
  'js/views/spells.js',
  'data/jad.sqlite',
  'data/version.json',
  'icons/logo.png',
  'icons/apple-touch-icon.png',
  'icons/android-chrome-192x192.png',
  'icons/android-chrome-512x512.png',
  'icons/favicon-32x32.png',
  'icons/favicon-16x16.png',
  SQLJS + 'sql-wasm.js',
  SQLJS + 'sql-wasm.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          // cache: 'reload' obchází HTTP cache, ať se po nasazení opravdu stáhne nová verze.
          fetch(new Request(url, { cache: 'reload', mode: url.startsWith('http') ? 'cors' : 'same-origin' })).then((res) => {
            if (!res.ok) throw new Error('Precache selhal: ' + url + ' (' + res.status + ')');
            return cache.put(url, res);
          })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jad-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigace (otevření aplikace) → vždy app shell z cache.
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(caches.match('index.html', { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }

  // Cache-first; co v cache není, zkusí síť a uloží (jen vlastní origin a jsDelivr).
  event.respondWith(
    caches.match(req, { ignoreSearch: url.origin === self.location.origin }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
