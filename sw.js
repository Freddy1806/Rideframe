// RIDEFRAME phone app (handy, outdoor, kraft, pure, profil, aktivitaeten, statistik, remote, body): keeps the app shell offline-ready.
// Network first, so every deploy shows up right away; the cache only answers when there is no connection (out on the bike).
// The 3D world (assets/, audio/, videos), the API and coach/workouts.json (host data, js/coachworkouts.js) are never touched here.
const C = 'rf-shell-v9';
const SHELL = ['handy.html', 'training.html', 'css/cards.css', 'css/today.css', 'js/cards.js', 'js/cardlib.js', 'js/cardlayout.js', 'js/today.js', 'js/readiness.js', 'js/insights.js', 'js/planlib.js', 'js/trainplan.js', 'body.html', 'css/body.css', 'js/body.js', 'js/bodylib.js', 'js/bodycard.js', 'js/healthcard.js', 'js/scaleset.js', 'outdoor.html', 'kraft.html', 'pure.html', 'profil.html', 'aktivitaeten.html', 'statistik.html', 'remote.html', 'css/remote.css', 'js/remote.js', 'js/remotelink.js', 'app.webmanifest', 'css/app.css', 'css/pure.css', 'css/kraft.css', 'css/outdoor.css', 'css/handy.css', 'css/profil.css', 'css/feed.css', 'js/native.js',
  'js/handy.js', 'js/live.js', 'js/feed.js', 'js/statpage.js', 'js/nav.js', 'js/profil.js', 'js/fitness.js', 'js/stats.js', 'js/kraftlib.js', 'js/theme.js', 'js/outdoor.js', 'js/kraft.js', 'js/kraftguide.js', 'js/kraftplayer.js', 'js/quick.js', 'js/watchpair.js', 'js/watchcfg.js', 'js/mcplink.js', 'js/watchfields.js', 'js/watchdraw.js', 'js/pure.js', 'js/db.js', 'js/util.js', 'js/account.js', 'js/trainer.js', 'js/stravaup.js', 'js/tcx.js', 'js/track.js',
  'js/workouts.js', 'js/padnav.js', 'js/controller.js', 'js/myworkouts.js', 'js/myworkouts-store.js', 'js/myworkouts-ui.js', 'js/wbuilder.js', 'js/coachworkouts.js', 'js/routefit.js', 'css/myworkouts.css', 'js/physics.js', 'js/gears.js', 'js/zwiftclick.js', 'js/sports.js', 'js/actimport.js', 'js/actfile.js', 'js/addact.js', 'js/navroute.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'fonts/archivo-latin.woff2', 'img/icon-192.png', 'img/icon-180.png', 'img/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('rf-') && x !== C && x !== 'rf-tiles-2').map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const shell = p => /^\/(handy|training|outdoor|kraft|pure|profil|aktivitaeten|statistik|remote)\.html$|^\/app\.webmanifest$|^\/(css|js|fonts|img|vendor\/leaflet)\//.test(p) && !p.startsWith('/js/world/');
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.hostname === 'server.arcgisonline.com') { // map tiles: from cache when seen before, so the map of the home roads works without signal
    e.respondWith(caches.open('rf-tiles-2').then(async c => (await c.match(r)) || fetch(r).then(res => { if (res.ok || res.type === 'opaque') c.put(r, res.clone()).then(() => trim(c)); return res; })));
    return;
  }
  if (u.origin !== location.origin || !shell(u.pathname)) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) caches.open(C).then(c => c.put(r, res.clone())); return res; }).catch(() => caches.match(r, { ignoreSearch: true })));
});
let trimming = false;
async function trim(c) { if (trimming) return; trimming = true; try { const k = await c.keys(); if (k.length > 4000) for (const x of k.slice(0, 800)) await c.delete(x); } catch {} trimming = false; }
