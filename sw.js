// RIDEFRAME phone app (handy.html, outdoor.html, kraft.html, pure.html): keeps the app shell offline-ready.
// Network first, so every deploy shows up right away; the cache only answers when there is no connection (out on the bike).
// The 3D world (assets/, audio/, videos) and the API are never touched here.
const C = 'rf-shell-v1';
const SHELL = ['handy.html', 'outdoor.html', 'kraft.html', 'pure.html', 'app.webmanifest', 'css/app.css', 'css/pure.css', 'css/kraft.css', 'css/outdoor.css', 'css/handy.css', 'js/native.js',
  'js/handy.js', 'js/outdoor.js', 'js/kraft.js', 'js/pure.js', 'js/db.js', 'js/util.js', 'js/account.js', 'js/trainer.js', 'js/stravaup.js', 'js/tcx.js', 'js/track.js',
  'js/workouts.js', 'js/physics.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'fonts/archivo-latin.woff2', 'img/icon-192.png', 'img/icon-180.png', 'img/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('rf-') && x !== C && x !== 'rf-tiles').map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const shell = p => /^\/(handy|outdoor|kraft|pure)\.html$|^\/app\.webmanifest$|^\/(css|js|fonts|img|vendor\/leaflet)\//.test(p) && !p.startsWith('/js/world/');
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.hostname.endsWith('basemaps.cartocdn.com')) { // map tiles: from cache when seen before, so the map of the home roads works without signal
    e.respondWith(caches.open('rf-tiles').then(async c => (await c.match(r)) || fetch(r).then(res => { if (res.ok || res.type === 'opaque') c.put(r, res.clone()).then(() => trim(c)); return res; })));
    return;
  }
  if (u.origin !== location.origin || !shell(u.pathname)) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) caches.open(C).then(c => c.put(r, res.clone())); return res; }).catch(() => caches.match(r, { ignoreSearch: true })));
});
let trimming = false;
async function trim(c) { if (trimming) return; trimming = true; try { const k = await c.keys(); if (k.length > 4000) for (const x of k.slice(0, 800)) await c.delete(x); } catch {} trimming = false; }
