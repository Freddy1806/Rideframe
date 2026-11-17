// RIDEFRAME Draußen (Freddy 15.11.): record real rides outside like a bike computer app (Cadence): GPS track on a map,
// speed, distance, climbing, plus heart rate and a power meter over Bluetooth. Rides land in the same history
// (routeId 'outdoor', outdoor: true) and go to Strava as a real ride with the GPS track.
// Browser limits: the phone screen must stay on (wake lock keeps it on); Bluetooth needs Chrome (Android) or Bluefy (iPhone).
import { SensorHub, roleText } from './sensors.js';
import { db, uid } from './db.js';
import { fmtTime, fmtNum, esc, bestAvg, twoWeeks, weekStat } from './util.js';
import { SegTracker } from './segtrack.js';
import { applyTheme, icon } from './theme.js';
import { RouteNav, SegAhead, parseRoute, makeRoute, bearing, deltaTxt, xomSec } from './navroute.js';

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search), DEMO = params.has('demo');
/* Laufen (Freddy 16.11.): the same recorder for runs: pace instead of speed, km splits, Strava as a run */
const RUN = params.get('sport') === 'run', MODE = RUN ? 'run' : 'outdoor', DRAFT = RUN ? 'runDraft' : 'outdoorDraft';
const W = RUN ? { act: 'Run', acts: 'Runs', brand: 'Run', time: 'Time', go: 'Resume', none: 'No run recorded yet. Go back, press Start and off you go.', where: 'run', dflt: 'Run' }
  : { act: 'Ride', acts: 'Rides', brand: 'Ride', time: 'Time', go: 'Resume', none: 'No outdoor ride recorded yet. Go back, press Start and off you go.', where: 'outdoors', dflt: 'Ride' };
const pace = mps => mps > .3 ? (s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)(1000 / mps) : '–:––';
if (RUN) { document.title = 'RIDEFRAME Run'; document.documentElement.dataset.mode = 'run'; }
// map tiles without an API key (16.11.: CARTO now answers every tile with an "API KEY REQUIRED" image): Esri grey canvas, dark or light
const TILES = () => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, ATTR = 'Esri, HERE, Garmin, © OpenStreetMap';
const el = document.getElementById('out');
let S = { riderKg: 75, ftp: 250 }, O = { tiles: RUN ? ['time', 'dist', 'avgPace', 'hr', 'gain', 'lastKm', 'lapPace', 'kcal', 'clock'] : ['time', 'dist', 'avgSpeed', 'gain', 'hr', 'power', 'cad', 'alt', 'maxSpeed'], autoPause: true, bigMap: false, n: 9, map: 'small', big: 'main', pg: 0 };
// data pages like Cadence (Freddy 16.11.): 4, 6 or 9 fields per page, up to 3 pages to swipe, big field and map size selectable
const PAGE2 = RUN ? ['pace', 'lapTime', 'lapDist', 'hr', 'wall', 'avgPace', 'gain', 'kcal', 'clock'] : ['power', 'avgPower', 'np', 'cad', 'hr', 'lapTime', 'lapDist', 'wall', 'clock'];
const pages = () => { if (!O.pages) O.pages = [O.tiles]; return O.pages; }, curPage = () => pages()[Math.min(O.pg || 0, pages().length - 1)];
// every page has its own layout (Freddy 16.11.: up to 6 screens, each one configured on its own): field count, map size, big value
const cfg = (i = Math.min(O.pg || 0, pages().length - 1)) => ((O.pcfg ||= [])[i] ||= { n: O.n, map: O.map, big: O.big });
const hub = new SensorHub();
const live = { power: 0, cad: 0, hr: 0, fix: null, acc: null, gpsErr: '' };
let R = fresh(), view = params.has('list') ? 'list' : 'ride', map = null, line = null, dot = null, follow = true, wake = null, watch = null;
function fresh() { return { kms: [], kmsAt: 0, state: 'ready', id: uid(), start: 0, wall: 0, moving: 0, d: 0, v: 0, vMax: 0, gain: 0, eleS: null, eleRef: null, last: null, still: 0, kj: 0, pw: [], samples: [], track: [], lastSec: -1, laps: [], lapAt: { t: 0, d: 0 }, segs: [] }; }
// Strava segments: loaded once there is a fix and Strava is connected, drawn on the map, timed live
const segT = new SegTracker(); let segAt = null, segLayer = null;
// routes to follow (17.11.): kv 'navRoutes' on this phone only; the chosen one per mode in the settings (O.route)
let routes = [], route = null, nav = null, navS = null, routeLayer = null, heading = null;
const ahead = new SegAhead(); let segWarn = null, detCalls = 0; const warned = new Map();
const buzz = p => { try { navigator.vibrate?.(p); } catch {} };
async function loadRoutes() { routes = (await db.kvGet('navRoutes').catch(() => null)) || []; useRoute(routes.find(r => r.id === O.route) || null, false); }
const saveRoutes = () => db.kvSet('navRoutes', routes).catch(() => {});
function useRoute(r, save = true) { route = r; nav = r ? new RouteNav(r, { hint: RUN ? 80 : 200 }) : null; navS = null; O.route = r?.id || null; if (save) saveSettings(); }
function navEvents(ev) {
  if (ev.includes('off')) buzz([200, 120, 200]);
  if (ev.includes('on')) flash('Back on route');
  if (ev.includes('turn')) buzz(150);
  if (ev.includes('complete')) { flash('🏁 Route complete'); buzz([300, 150, 300]); } // the recording goes on
}
/** PR and KOM of a segment the rider is approaching or on: a few detail calls per ride at most, none in the demo */
async function segDetail(s) {
  if (DEMO || s.det || detCalls >= 6) return; s.det = true; detCalls++;
  const { stravaSegment } = await import('./stravaup.js'), d = await stravaSegment(s.id).catch(() => null);
  if (d) { if (d.pr) s.pr = d.pr; s.komS = d.komS ?? null; s.qomS = d.qomS ?? null; }
}
async function loadSegs(pt) {
  if (segAt && Math.abs(segAt[0] - pt[0]) + Math.abs(segAt[1] - pt[1]) < .05) return; segAt = pt;
  const { stravaSegments } = await import('./stravaup.js'), d = .06, list = DEMO ? demoSegs() : await stravaSegments([pt[0] - d, pt[1] - d * 2, pt[0] + d, pt[1] + d * 2], RUN ? 'running' : 'riding');
  if (segT.add(list)) drawSegs();
}
function drawSegs() {
  if (!map) return; segLayer?.remove(); segLayer = L.layerGroup().addTo(map);
  for (const s of segT.segs.values()) L.polyline(s.pts, { color: s.starred ? '#f2b630' : '#9aa0a6', weight: s.starred ? 4 : 3, opacity: .85, dashArray: s.starred ? null : '6 6' }).bindTooltip(s.name).addTo(segLayer);
  line?.bringToFront();
}
function segEvent(e) {
  if (!e) return;
  if (e.type === 'start') { segWarn = null; segDetail(e.seg); }
  else if (e.type === 'lost') flash(`Left segment ${e.seg.name}`);
  else { const pr = e.seg.pr, d = pr ? e.t - pr : null; R.segs.push({ id: 'strava:' + e.seg.id, name: e.seg.name, t: e.t });
    flash(`🏁 ${e.seg.name}: ${fmtTime(e.t)}${pr ? ` · PR ${fmtTime(pr)} (${d <= 0 ? '−' : '+'}${fmtTime(Math.abs(d))})` : ''}`); }
}

// ---------------- settings ----------------
async function loadSettings() {
  const st = await db.kvGet('settings').catch(() => null); if (st) Object.assign(S, st);
  Object.assign(O, S[MODE] || {});
  if (O.bigMap && !S[MODE]?.map) O.map = 'big';
  applyTheme(S, RUN ? 'run' : 'ride');
}
async function saveSettings() { const st = (await db.kvGet('settings').catch(() => null)) || {}; st[MODE] = { ...O }; await db.kvSet('settings', st).catch(() => {}); }

// ---------------- GPS ----------------
const R_E = 6371008.8, rad = x => x * Math.PI / 180;
function hav(a, b) { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]), x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R_E * Math.asin(Math.sqrt(x)); }
function startGPS() {
  if (DEMO && params.has('feed')) { window.__rfFix = onFix; return; } // tests feed their own positions (tools/routes-ui.cjs)
  if (DEMO) return demoGPS();
  if (!navigator.geolocation) { live.gpsErr = 'This device has no GPS.'; return; }
  watch = navigator.geolocation.watchPosition(onFix, e => { live.gpsErr = e.code === 1 ? 'Location not allowed. Please allow it in your phone settings.' : 'No GPS signal.'; paint(); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function onFix(p) {
  const c = p.coords, pt = [c.latitude, c.longitude], t = p.timestamp || Date.now();
  live.gpsErr = ''; live.acc = c.accuracy; live.alt = c.altitude; const prev = live.fix; live.fix = { pt, t, speed: c.speed, alt: c.altitude, acc: c.accuracy };
  if (dot) dot.setLatLng(pt); else if (map) onFixDot();
  if (map && follow) map.setView(pt, Math.max(map.getZoom(), 15), { animate: false });
  if (!prev || segAt) loadSegs(pt).catch(() => {});
  if (R.state !== 'run') { if (!prev && map && !(route && R.state === 'ready')) map.setView(pt, 16); return; }
  if (c.accuracy > 40) return; // too vague for distance
  if (!R.last) { R.last = { pt, t }; R.track.push(pt); line?.addLatLng(pt); if (nav) navS = nav.update(pt, t / 1000); return; }
  const d = hav(R.last.pt, pt), dt = Math.max(.2, (t - R.last.t) / 1000);
  let v = c.speed != null && c.speed >= 0 ? c.speed : d / dt;
  if (d / dt > 33) return; // a jump (>120 km/h): ignore this fix
  if (d < Math.max(2, Math.min(8, c.accuracy * .25)) && v < 1) { R.v = v < .8 ? 0 : v; return; } // standing: GPS wobble is not distance
  const moving = !O.autoPause || v > .8;
  if (d >= 3) heading = bearing(R.last.pt, pt);
  if (moving) { R.d += d; R.track.push(pt); line?.addLatLng(pt); segEvent(segT.update(pt, R.wall));
    if (nav) { navS = nav.update(pt, t / 1000); navEvents(navS.events); } // GPS time: off route after 8 s of fixes
    const w = segT.active ? null : ahead.update(segT.segs.values(), pt, heading, v, nav, x => R.wall - (segT.cool.get(x.id) ?? -1e9) < 120);
    if (w && R.wall - (warned.get(w.seg.id) ?? -1e9) > 300) { warned.set(w.seg.id, R.wall); buzz(250); segDetail(w.seg); }
    segWarn = w ? { ...w, at: performance.now() } : null;
    if (RUN && R.d >= (R.kms.length + 1) * 1000) { const t = R.moving - (R.kmsAt || 0); R.kms.push(Math.round(t)); R.kmsAt = R.moving; flash(`Km ${R.kms.length}: ${fmtTime(t)}`); navigator.vibrate?.(200); } }
  R.v = v; R.vMax = Math.max(R.vMax, v < 30 ? v : 0); R.last = { pt, t };
  if (c.altitude != null) { // smoothed altitude, climbing counted with 3 m hysteresis (raw GPS height jumps)
    R.eleS = R.eleS == null ? c.altitude : R.eleS + (c.altitude - R.eleS) * .2;
    if (R.eleRef == null) R.eleRef = R.eleS; else if (R.eleS - R.eleRef > 3) { R.gain += R.eleS - R.eleRef; R.eleRef = R.eleS; } else if (R.eleRef - R.eleS > 3) R.eleRef = R.eleS;
  }
}
function demoGPS() { // a fake ride around the Lofoten village Reine, so the screen can be tested at the desk
  let a = 0, t = Date.now(); const c = [67.9326, 13.0890], step = RUN ? .0015 : .0035;
  setInterval(() => { a += step * (1 + Math.sin(a * 3) * .3); t += 1000; const r = .006;
    onFix({ timestamp: t, coords: { latitude: c[0] + Math.sin(a) * r, longitude: c[1] + Math.cos(a) * r * 2.4, accuracy: 6, altitude: 20 + Math.sin(a * 4) * 15, speed: RUN ? 3.2 + Math.sin(a * 5) * .3 : 7 + Math.sin(a * 5) * 2 } });
    if (!RUN) { live.power = Math.round(180 + Math.sin(a * 4) * 60); live.cad = 85; } live.hr = (RUN ? 150 : 130) + Math.round(Math.sin(a * 4) * 10);
  }, DEMO && params.has('fast') ? 50 : 1000);
}

// ---------------- ride ----------------
function tick(dt) {
  if (R.state !== 'run') return;
  R.wall += dt;
  const idle = live.fix && Date.now() - live.fix.t > 6000; // no fix for 6 s: count as standing
  if (idle) R.v = 0;
  R.still = R.v < .8 ? R.still + dt : 0;
  const moving = !O.autoPause || R.still < 4;
  if (!moving) return;
  R.moving += dt; R.kj += live.power * dt / 1000;
  const sec = Math.floor(R.wall);
  if (sec > R.lastSec) {
    R.lastSec = sec; const w = Math.round(live.power); R.pw.push(w); const p = live.fix?.pt;
    R.samples.push([sec, Math.round(R.d), w, Math.round(R.v * 36) / 10, Math.round(live.cad) || 0, live.hr || 0, p ? +p[0].toFixed(6) : null, p ? +p[1].toFixed(6) : null, R.eleS != null ? Math.round(R.eleS * 10) / 10 : null]);
  }
}
function start() {
  if (!live.fix && !DEMO && !confirm('No GPS signal yet. Start anyway? Distance counts from the first signal.')) return;
  if (R.state === 'ready') { R.start = Date.now(); follow = true; }
  R.state = 'run'; R.last = null; lockScreen(); render();
}
function pause() { R.state = 'pause'; render(); saveDraft(); }
function lap() { if (R.state !== 'run') return; const t = R.moving - R.lapAt.t, d = R.d - R.lapAt.d; R.laps.push(Math.round(R.wall)); R.lapAt = { t: R.moving, d: R.d }; flash(`Lap ${R.laps.length}:  ${fmtTime(t)} · ${fmtNum(d / 1000, 2)} km`); }
const avgP = () => R.pw.length ? R.pw.reduce((a, b) => a + b, 0) / R.pw.length : 0;
function NP() { const p = R.pw; if (p.length < 30) return avgP(); let s = 0, n = 0, w = 0; for (let i = 0; i < p.length; i++) { w += p[i]; if (i >= 30) w -= p[i - 30]; if (i >= 29) { s += (w / 30) ** 4; n++; } } return Math.pow(s / n, .25); }
const rideName = t => { const h = new Date(t).getHours(); return (h < 11 ? 'Morning' : h < 14 ? 'Lunch' : h < 18 ? 'Afternoon' : 'Evening') + (RUN ? ' run' : ' ride'); };
function record() {
  const pw = R.pw, hasP = pw.some(x => x > 0);
  return { id: R.id, routeId: MODE, outdoor: true, sport: RUN ? 'run' : 'ride', kmSplits: RUN && R.kms.length ? R.kms : undefined, date: Date.now(), complete: true, duration: Math.round(R.moving), elapsed: Math.round(R.wall), distance: Math.round(R.d), gain: Math.round(R.gain), startD: 0,
    workout: R.name || rideName(R.start), avgPower: hasP ? Math.round(avgP()) : 0, maxPower: hasP ? Math.max(...pw) : 0, best5: hasP ? bestAvg(pw, 300) : 0, best20: hasP ? bestAvg(pw, 1200) : 0,
    np: hasP ? Math.round(NP()) : 0, kj: Math.round(R.kj), maxSpeed: Math.round(R.vMax * 36) / 10, stravaSegs: R.segs.length ? R.segs : undefined, lapMarks: R.laps.length ? R.laps : undefined, samples: R.samples };
}
// a crash, a reload or an empty battery must not lose the ride: the state goes to kv every 10 s
let draftAt = 0;
function saveDraft() { const { last, ...r } = R; db.kvSet(DRAFT, { ...r, savedAt: Date.now() }).catch(() => {}); draftAt = performance.now(); }

// ---------------- metrics ----------------
const M = {
  time: { l: W.time, u: '', v: () => fmtTime(R.moving) },
  pace: { l: 'Pace', u: 'min/km', v: () => pace(R.v) },
  avgPace: { l: 'Avg pace', u: 'min/km', v: () => R.d < 50 ? '–' : pace(R.d / R.moving) },
  lapPace: { l: 'Lap pace', u: 'min/km', v: () => R.d - R.lapAt.d < 50 ? '–' : pace((R.d - R.lapAt.d) / (R.moving - R.lapAt.t)) },
  lastKm: { l: 'Last km', u: '', v: () => R.kms.length ? fmtTime(R.kms[R.kms.length - 1]) : '–' },
  wall: { l: 'Elapsed', u: '', v: () => fmtTime(R.wall) },
  dist: { l: 'Distance', u: 'km', v: () => fmtNum(R.d / 1000, 2) },
  speed: { l: 'Speed', u: 'km/h', v: () => fmtNum(R.v * 3.6, 1) },
  avgSpeed: { l: 'Avg speed', u: 'km/h', v: () => R.d < 50 ? '–' : fmtNum(R.d / R.moving * 3.6, 1) },
  maxSpeed: { l: 'Max speed', u: 'km/h', v: () => fmtNum(R.vMax * 3.6, 1) },
  gain: { l: 'Climb', u: 'm', v: () => Math.round(R.gain) },
  alt: { l: 'Altitude', u: 'm', v: () => R.eleS != null ? Math.round(R.eleS) : live.alt != null ? Math.round(live.alt) : '–' },
  hr: { l: 'Heart rate', u: 'bpm', v: () => live.hr || '–' },
  power: { l: 'Power', u: 'W', v: () => hub.has('power') || DEMO ? Math.round(live.power) : '–' },
  avgPower: { l: 'Avg power', u: 'W', v: () => R.pw.some(x => x) ? Math.round(avgP()) : '–' },
  np: { l: 'NP', u: 'W', v: () => R.pw.some(x => x) ? Math.round(NP()) : '–' },
  cad: { l: 'Cadence', u: 'rpm', v: () => hub.has('cad') || DEMO ? Math.round(live.cad) : '–' },
  kcal: { l: 'Calories', u: 'kcal', v: () => RUN ? Math.round(R.d / 1000 * (S.riderKg || 75)) : R.kj ? Math.round(R.kj * 1.1) : Math.round(R.moving / 3600 * 8 * (S.riderKg || 75)) },
  lapTime: { l: 'Lap time', u: '', v: () => fmtTime(R.moving - R.lapAt.t) },
  lapDist: { l: 'Lap distance', u: 'km', v: () => fmtNum((R.d - R.lapAt.d) / 1000, 2) },
  clock: { l: 'Clock', u: '', v: () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
  gps: { l: 'GPS ±', u: 'm', v: () => live.acc != null ? Math.round(live.acc) : '–' },
  routeLeft: { l: 'Route left', u: 'km', v: () => nav ? fmtNum((navS ? navS.left : nav.len) / 1000, 1) : '–' },
  climbLeft: { l: 'Climb left', u: 'm', v: () => nav ? Math.round(navS ? navS.climbLeft : nav.climb) : '–' },
};

// ---------------- screen ----------------
function flash(t) { let f = $('#oflash'); if (!f) { f = document.createElement('div'); f.id = 'oflash'; f.className = 'pflash'; document.body.append(f); } f.textContent = t; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), 3500); }
function sheet(html) { const s = document.createElement('div'); s.className = 'psheet'; s.innerHTML = `<div class="psheetin">${html}</div>`; s.onclick = e => { if (e.target === s) s.remove(); }; document.body.append(s); return s; }
async function lockScreen() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R.state === 'run') { lockScreen(); } else if (R.state === 'run') saveDraft(); });
window.addEventListener('beforeunload', e => { if (R.samples.length && R.state !== 'done') { saveDraft(); e.preventDefault(); e.returnValue = ''; } });

const gpsTxt = () => live.gpsErr ? 'No GPS' : !live.fix ? 'GPS …' : live.acc > 40 ? `GPS ±${Math.round(live.acc)} m` : 'GPS';
function render() {
  if (map) { map.remove(); map = null; line = null; dot = null; routeLayer = null; }
  if (view === 'list') return listView();
  el.innerHTML = `<header class="ptop"><a class="pback" href="handy.html" title="Back to app">‹</a><div class="pbrand"><b>RIDEFRAME </b><span>${W.brand}</span></div>
      <span class="ppill ${live.fix && live.acc <= 40 ? 'on' : ''}" id="oGps"><i></i>${gpsTxt()}</span>
      <button class="ppill ${nSens() ? 'on' : ''}" id="oSens"><i></i>Sensors${nSens() ? ' ' + nSens() : ''}</button>
      <button class="pgear" id="oSet" title="Settings" aria-label="Settings">${icon('gear', 'gico')}</button></header>
    ${live.gpsErr ? `<div class="pnote">${esc(live.gpsErr)}</div>` : ''}
    ${cfg().map === 'off' ? '' : `<div class="omap ${cfg().map === 'big' ? 'big' : ''}" id="oMap"><button class="omapbtn" id="oFollow" title="Centre on me">◎</button><button class="omapbtn r" id="oBig" title="Map bigger/smaller">${cfg().map === 'big' ? '▴' : '▾'}</button>${R.state === 'run' ? '' : `<button class="omapchip" id="oRoute">${route ? `⤳ ${esc(short(route.name))} · ${fmtNum(route.len / 1000, 1)} km` : '⤳ Routes'}</button>`}</div>`}
    <div class="onav" id="oNav" hidden></div>
    <div class="oseg" id="oSeg" hidden></div>
    ${cfg().big === 'off' ? '' : cfg().big === 'main' || !M[cfg().big] ? `<button class="pbig obig" id="oBigF"><div class="label">${RUN ? 'Pace' : 'Speed'}</div><div class="pbigv"><b id="oSpd">${RUN ? '–' : '0.0'}</b><small>${RUN ? 'min/km' : 'km/h'}</small></div></button>`
      : `<button class="pbig obig" id="oBigF"><div class="label">${M[cfg().big].l}</div><div class="pbigv"><b data-k="${cfg().big}">–</b><small>${M[cfg().big].u}</small></div></button>`}
    <section class="ptiles n${cfg().n}" id="oTiles">${tilesOf(curPage()).map((k, i) => `<button class="ptile" data-t="${i}"><span class="label">${M[k]?.l || k}</span><b data-k="${k}">–</b><small>${M[k]?.u || ''}</small></button>`).join('')}</section>
    ${pages().length > 1 ? `<div class="odots">${pages().map((_, i) => `<button data-pg="${i}" class="${i === (O.pg || 0) ? 'on' : ''}" aria-label="Page ${i + 1}"></button>`).join('')}</div>` : ''}
    <footer class="pfoot">${R.state === 'run' ? `<button class="btn ghost" id="oPause">Pause</button><button class="btn ghost" id="oLap">Lap</button><button class="btn ghost" id="oPocket" title="Screen goes black, recording continues">Lock</button>`
      : `${R.state === 'ready' ? `<button class="btn ghost" id="oList">${W.acts}</button>` : ''}<button class="btn" id="oStart">${R.state === 'pause' ? 'Resume' : 'Start'}</button>${R.state === 'pause' ? '<button class="btn ghost" id="oEnd">Finish</button>' : ''}`}</footer>`;
  initMap();
  const on = (id, f) => { const x = $(id); if (x) x.onclick = f; };
  on('#oStart', start); on('#oPause', pause); on('#oLap', lap); on('#oEnd', endSheet); on('#oList', () => { view = 'list'; render(); }); on('#oSet', settingsSheet);
  on('#oSens', sensorSheet); on('#oPocket', pocket); on('#oRoute', routesSheet);
  on('#oFollow', () => { follow = true; if (live.fix && map) map.setView(live.fix.pt, Math.max(map.getZoom(), 15)); });
  on('#oBig', () => { cfg().map = cfg().map === 'big' ? 'small' : 'big'; saveSettings(); render(); });
  on('#oBigF', bigSheet);
  el.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { O.pg = +b.dataset.pg; saveSettings(); render(); });
  swipe($('#oTiles'));
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => tileSheet(+b.dataset.t));
  paint();
}
function initMap() {
  if (!window.L || !document.getElementById('oMap')) return;
  map = L.map('oMap', { zoomControl: false, attributionControl: true }).setView(live.fix?.pt || R.track[R.track.length - 1] || [51.16, 10.45], live.fix || R.track.length ? 16 : 5);
  L.tileLayer(TILES(), { attribution: ATTR, maxZoom: 19, maxNativeZoom: 16 }).addTo(map);
  if (route) { routeLayer = L.polyline(route.pts.map(p => [p[0], p[1]]), { color: '#3d8bff', weight: 7, opacity: .6 }).addTo(map);
    L.circleMarker(route.pts[0], { radius: 5, color: '#fff', weight: 2, fillColor: '#2fb36b', fillOpacity: 1 }).addTo(map);
    if (R.state === 'ready') { map.fitBounds(routeLayer.getBounds(), { padding: [24, 24] }); follow = false; } }
  line = L.polyline(R.track, { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5a1f', weight: 5, opacity: .95 }).addTo(map);
  if (live.fix) onFixDot();
  drawSegs();
  map.on('dragstart', () => { follow = false; });
}
function onFixDot() { dot = L.circleMarker(live.fix.pt, { radius: 7, color: '#fff', weight: 2, fillColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5a1f', fillOpacity: 1 }).addTo(map); }
function paint() {
  if (view !== 'ride' || !$('#oTiles')) return;
  if ($('#oSpd')) { const v = R.state === 'run' || DEMO ? R.v : live.fix?.speed || 0; $('#oSpd').textContent = RUN ? pace(v) : fmtNum(v * 3.6, 1); }
  el.querySelectorAll('[data-k]').forEach(b => { const v = String(M[b.dataset.k]?.v()); if (b.textContent !== v) b.textContent = v; });
  paintSeg(); paintNav();
  const g = $('#oGps'); if (g) { const t = gpsTxt(); if (!g.textContent.endsWith(t)) g.innerHTML = `<i></i>${t}`; g.classList.toggle('on', !!live.fix && live.acc <= 40); }
}
const short = (t, n = 18) => t.length > n ? t.slice(0, n - 1).trim() + '…' : t;
const kmTxt = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${fmtNum(m / 1000, 1)} km`;
const setHtml = (e, cls, h) => { if (e.className !== cls) e.className = cls; if (e.innerHTML !== h) e.innerHTML = h; };
/** the segment banner: the warning with a countdown before the start, live timing against PR and KOM on it */
function paintSeg() {
  const sb = $('#oSeg'); if (!sb) return; const a = segT.active, w = !a && R.state === 'run' ? segWarn : null; sb.hidden = !a && !w; if (sb.hidden) return;
  if (a) { const s = a.seg, el = R.wall - a.t0, pr = s.pr, kom = s.komS ?? xomSec(s.kom), dv = pr ? deltaTxt(el, pr, a.prog) : null;
    return setHtml(sb, 'oseg', `<b>◆ ${esc(s.name)}</b><em class="${dv ? (dv[0] === '−' ? 'up' : 'dn') : ''}">${dv || fmtTime(el)}</em><span>${dv ? fmtTime(el) + ' · ' : ''}${Math.round(a.prog * 100)} %${pr ? ` · PR ${fmtTime(pr)}` : ''}${kom ? ` · KOM ${deltaTxt(el, kom, a.prog)}` : ''}</span>`); }
  const eta = Math.max(0, w.eta - (performance.now() - w.at) / 1000), s = w.seg, len = s.len || s.dist;
  setHtml(sb, 'oseg warn', `<b>◆ Segment in</b><em>${fmtTime(eta)}</em><span>${esc(s.name)}${len ? ' · ' + kmTxt(len) : ''}${s.pr ? ` · PR ${fmtTime(s.pr)}` : ''}</span>`);
}
/** one line for the route while riding: left and climb, a turn coming, off route with the way back, complete */
function paintNav() {
  const nb = $('#oNav'); if (!nb) return; nb.hidden = !nav || R.state === 'ready'; if (nb.hidden) return; const s = navS;
  if (s?.off) return setHtml(nb, 'onav off', `<b>Off route · ${kmTxt(s.offD)}</b><i class="oarr" style="transform:rotate(${Math.round(s.back - (heading ?? 0))}deg)" title="Way back">↑</i>`);
  if (s?.turn) return setHtml(nb, 'onav turn', `<i>${s.turn.dir === 'left' ? '↰' : s.turn.dir === 'right' ? '↱' : '↶'}</i><b>${s.turn.text}</b>`);
  if (s?.done) return setHtml(nb, 'onav done', '<b>Route complete ✓</b>');
  setHtml(nb, 'onav', `<span>Route</span><b>${kmTxt(s ? s.left : nav.len)}</b><span>left ·</span><b>${Math.round(s ? s.climbLeft : nav.climb)} m</b><span>climb</span>`);
}
/** pocket mode (Freddy 15.11.): browsers stop GPS when the screen goes off, so the screen stays on but black (an OLED
 *  screen then hardly uses power) and locked against pocket touches; hold the ring 1.5 s to come back */
function pocket() {
  if ($('#opocket')) return;
  const o = document.createElement('div'); o.id = 'opocket';
  o.innerHTML = `<div class="opin"><b id="opT">–</b><span id="opD"></span><button id="opU" aria-label="Unlock"><i></i></button><small>Hold to unlock</small></div>`;
  document.body.append(o); lockScreen();
  const stats = () => { const t = $('#opT'), d = $('#opD'); if (!t) return clearInterval(iv); t.textContent = M.time.v(); d.textContent = `${M.dist.v()} km`; o.firstChild.style.transform = `translateY(${Math.round(Math.sin(Date.now() / 6e4) * 60)}px)`; };
  const iv = setInterval(stats, 1000); stats();
  let held = 0; const u = $('#opU'), stop = () => { clearTimeout(held); u.classList.remove('hold'); };
  u.addEventListener('pointerdown', e => { e.preventDefault(); u.classList.add('hold'); held = setTimeout(() => { clearInterval(iv); o.remove(); }, 1500); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => u.addEventListener(t, stop));
  o.addEventListener('contextmenu', e => e.preventDefault());
}
const nSens = () => hub.count;
/** all Bluetooth sensors in one place (Freddy 15.11.): one "Gerät verbinden", the app detects what each device sends,
 *  several at once (power meter + strap + cadence), every device is remembered (several bikes) */
function sensorSheet() {
  const ok = SensorHub.supported(), list = hub.list();
  const s = sheet(`<div class="label">Sensors</div>
    ${ok ? '' : `<p class="hint">Bluetooth is not available here. GPS and recording still work.</p>`}
    <button class="btn kbig" id="sPair" ${ok ? '' : 'disabled'}>+ Connect device</button>
    ${list.length ? `<div class="label" style="margin-top:6px">Your devices</div>${list.map(k => `<div class="osens"><div><b>${esc(k.name)}</b><small>${k.on ? '✓ connected · ' : ''}${roleText(k.roles)}</small></div>
      ${k.on ? `<button class="btn ghost ksmall" data-off="${esc(k.id)}">Disconnect</button>` : `<button class="btn ksmall" data-on="${esc(k.id)}" ${ok ? '' : 'disabled'}>Connect</button>`}<button class="kx" data-del="${esc(k.id)}" title="Forget">✕</button></div>`).join('')}`
      : ''}
    <p class="hint">Wake up your heart rate strap, watch, power meter or cadence sensor and connect it; several at once work too. Known devices connect automatically.</p>
    <div class="pfoot"><button class="btn ghost" id="sDone">Done</button></div>`);
  const again = () => { s.remove(); render(); sensorSheet(); };
  const go = async f => { try { await f(); } catch (e) { if (e.name !== 'NotFoundError') flash(e.message || String(e)); } again(); };
  $('#sPair', s).onclick = () => go(() => hub.pair());
  s.querySelectorAll('[data-on]').forEach(b => b.onclick = () => go(async () => { if (!(await hub.auto())) await hub.pair(); }));
  s.querySelectorAll('[data-off]').forEach(b => b.onclick = () => { hub.disconnect(b.dataset.off); again(); });
  s.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await hub.forget(b.dataset.del); again(); });
  $('#sDone', s).onclick = () => { s.remove(); render(); };
}
/** the fields of one page, filled up or cut to the chosen count */
function tilesOf(p) { const fill = [...pages()[0], ...PAGE2, ...Object.keys(M)].filter(k => !p.includes(k)); while (p.length < cfg().n) p.push(fill.shift()); return p.slice(0, cfg().n); }
/** swipe left/right over the fields = next/previous page */
function swipe(x) {
  if (!x || pages().length < 2) return; let sx = null, sy = 0;
  x.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  x.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return; const n = pages().length; O.pg = ((O.pg || 0) + (dx < 0 ? 1 : -1) + n) % n; saveSettings(); render(); });
}
function tileSheet(i) {
  const p = curPage();
  const s = sheet(`<div class="label">Field ${i + 1}${pages().length > 1 ? ` on page ${(O.pg || 0) + 1}` : ''}: choose value</div><div class="ppick">${Object.entries(M).map(([k, m]) => `<button data-k2="${k}" class="${p[i] === k ? 'on' : ''}">${m.l}</button>`).join('')}</div>`);
  s.querySelectorAll('[data-k2]').forEach(b => b.onclick = () => { p[i] = b.dataset.k2; saveSettings(); s.remove(); render(); });
}
function bigSheet() {
  const opts = [['main', RUN ? 'Pace (current)' : 'Speed (current)'], ...Object.entries(M).filter(([k]) => k !== (RUN ? 'pace' : 'speed')).map(([k, m]) => [k, m.l]), ['off', 'No big field']];
  const s = sheet(`<div class="label">Big field: choose value</div><div class="ppick">${opts.map(([k, l]) => `<button data-k2="${k}" class="${(cfg().big || 'main') === k ? 'on' : ''}">${l}</button>`).join('')}</div>`);
  s.querySelectorAll('[data-k2]').forEach(b => b.onclick = () => { cfg().big = b.dataset.k2; saveSettings(); s.remove(); render(); });
}
/** routes (17.11.): import a file or a Strava route, pick, rename, delete. Stored on this phone only. */
function routesSheet() {
  const s = sheet(`<div class="label">Routes</div>
    <label class="btn kbig ofile">Import route (.gpx, .tcx, .fit)<input type="file" id="rFile" accept=".gpx,.tcx,.fit,application/gpx+xml" hidden></label>
    <button class="btn ghost" id="rStrava" hidden>Import from Strava routes</button>
    <p class="hint" id="rMsg" hidden></p>
    ${routes.length ? routes.map(r => `<div class="oroute ${route?.id === r.id ? 'on' : ''}" data-r="${esc(r.id)}">${shape(null, 52, 52, r.pts)}<div class="oinfo"><b>${esc(r.name)}</b>
      <div class="khm"><span>${fmtNum(r.len / 1000, 1)} km</span><span>${fmtNum(r.climb)} m climb</span></div></div><button class="kx" data-ren="${esc(r.id)}" title="Rename" aria-label="Rename">✎</button><button class="kx" data-del="${esc(r.id)}" title="Delete" aria-label="Delete">✕</button></div>`).join('')
      : `<p class="hint">No routes yet. Export one from Komoot, Strava, Garmin Connect or RideWithGPS as a file and import it here, or open a past ${W.act.toLowerCase()} and tap “Use as route”.</p>`}
    <p class="hint">Routes stay on this phone. Turn hints come from the shape of the route, not from a street map.</p>
    <div class="pfoot">${route ? '<button class="btn ghost" id="rNone">No route</button>' : ''}<button class="btn" id="rDone">Done</button></div>`);
  const msg = t => { const m = $('#rMsg', s); m.textContent = t; m.hidden = !t; };
  const again = () => { s.remove(); render(); routesSheet(); };
  const add = async (rt, dup) => { const old = dup && routes.find(dup); if (old) Object.assign(old, { pts: rt.pts, len: rt.len, climb: rt.climb, name: rt.name }); else routes.unshift(rt);
    await saveRoutes(); useRoute(old || rt); return old || rt; };
  $('#rFile', s).onchange = async e => { const f = e.target.files[0]; if (!f) return;
    try { const p = parseRoute(f.name, new Uint8Array(await f.arrayBuffer())); const rt = await add(makeRoute(p.name, p.pts, { src: 'file' })); again(); flash(`Route: ${short(rt.name, 24)}`); }
    catch (err) { msg(err.message || String(err)); } };
  s.querySelectorAll('[data-r]').forEach(b => b.onclick = e => { if (e.target.closest('button')) return; useRoute(routes.find(r => r.id === b.dataset.r)); s.remove(); render(); });
  s.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => { const r = routes.find(x => x.id === b.dataset.ren), n = prompt('Route name', r.name); if (!n?.trim()) return; r.name = n.trim().slice(0, 80); await saveRoutes(); again(); });
  s.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const r = routes.find(x => x.id === b.dataset.del); if (!confirm(`Delete the route “${r.name}”?`)) return;
    routes = routes.filter(x => x !== r); await saveRoutes(); if (route === r) useRoute(null); again(); });
  const none = $('#rNone', s); if (none) none.onclick = () => { useRoute(null); s.remove(); render(); };
  $('#rDone', s).onclick = () => { s.remove(); render(); };
  import('./stravaup.js').then(async su => { const st = await su.stravaStatus(), b = $('#rStrava', s); if (!b || !st.configured || !st.connected) return; b.hidden = false;
    b.onclick = () => stravaRoutesSheet(su, s, add); }).catch(() => {});
}
/** the rider's Strava routes, 50 at a time; a tap fetches the GPX and saves it (once per Strava route) */
async function stravaRoutesSheet(su, parent, add) {
  const s = sheet(`<div class="label">Strava routes</div><div id="srList"><p class="hint">Reading Strava …</p></div><div class="pfoot"><button class="btn ghost" id="srBack">Back</button></div>`);
  $('#srBack', s).onclick = () => s.remove();
  let page = 1, all = [];
  const load = async () => {
    const j = await su.stravaRoutes(page), box = $('#srList', s); if (!box) return;
    if (j.error) { box.innerHTML = `<p class="hint">${esc(j.error)}</p>${j.reconnect ? '<button class="btn" id="srRe">Reconnect Strava</button>' : ''}`; const re = $('#srRe', s); if (re) re.onclick = async () => { if (await su.stravaConnect(true)) { page = 1; all = []; load(); } }; return; }
    all.push(...j.routes);
    box.innerHTML = all.length ? all.map(r => `<button class="osrow" data-sr="${esc(r.id)}"><b>${esc(r.name)}</b><span>${fmtNum(r.distance / 1000, 1)} km · ${fmtNum(r.elevation_gain)} m climb${r.type === 'run' ? ' · run' : ''}${routes.some(x => x.stravaId === r.id) ? ' · saved' : ''}</span></button>`).join('')
      + (j.more ? '<button class="btn ghost" id="srMore">More</button>' : '') : '<p class="hint">No routes on Strava yet.</p>';
    const more = $('#srMore', s); if (more) more.onclick = () => { page++; load(); };
    s.querySelectorAll('[data-sr]').forEach(b => b.onclick = async () => { const r = all.find(x => x.id === b.dataset.sr); b.disabled = true; b.querySelector('span').textContent = 'Loading …';
      try { const p = parseRoute(r.name + '.gpx', await su.stravaRouteGpx(r.id)); const rt = await add(makeRoute(r.name, p.pts, { src: 'strava', stravaId: r.id }), x => x.stravaId === r.id);
        s.remove(); parent.remove(); render(); flash(`Route: ${short(rt.name, 24)}`); }
      catch (e) { b.disabled = false; b.querySelector('span').textContent = e.message || String(e); } });
  };
  load();
}
function settingsSheet() {
  const s = sheet(`<div class="label">Settings</div>
    <h3 class="ksec">Screens</h3><p class="hint">Up to 6 screens to swipe through, each with its own values. Tap a field or the big number to change the value.</p>
    <div class="opg" id="sPg">${pages().map((_, i) => `<button data-v="${i}" class="${i === (O.pg || 0) ? 'on' : ''}">${i + 1}</button>`).join('')}${pages().length < 6 ? '<button data-add="1" title="Add screen">+</button>' : ''}</div>
    <div class="olbl">Screen ${(O.pg || 0) + 1}: fields</div><div class="pseg" id="sN">${[4, 6, 9].map(n => `<button data-v="${n}" class="${cfg().n === n ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="olbl">Screen ${(O.pg || 0) + 1}: map</div><div class="pseg" id="sM">${[['big', 'Large'], ['small', 'Small'], ['off', 'Off']].map(([k, l]) => `<button data-v="${k}" class="${cfg().map === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="olbl">Screen ${(O.pg || 0) + 1}: big number</div><div class="pseg" id="sB" style="grid-template-columns:1fr 1fr">${[['on', 'On'], ['off', 'Off']].map(([k, l]) => `<button data-v="${k}" class="${(cfg().big === 'off') === (k === 'off') ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${pages().length > 1 ? `<button class="btn ghost ksmall" id="sDelPg" style="align-self:flex-start">Delete screen ${(O.pg || 0) + 1}</button>` : ''}
    <h3 class="ksec">Route</h3><button class="btn ghost" id="sRoutes">${route ? esc(short(route.name, 26)) + ' · ' + fmtNum(route.len / 1000, 1) + ' km' : 'Routes'}</button>
    <h3 class="ksec">Recording</h3>
    <label class="prow">Auto-Pause<input id="sAp" type="checkbox" class="toggle" ${O.autoPause ? 'checked' : ''}></label>
    ${window.__rfNative ? '' : `<p class="hint">Phone in your pocket? “Lock” turns the screen dark and recording continues.</p>`}
    <div class="pfoot"><button class="btn" id="sOk">Done</button></div>`);
  const seg = (id, f) => $(id, s).querySelectorAll('[data-v]').forEach(b => b.onclick = () => { f(b.dataset.v); $(id, s).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); saveSettings(); render(); });
  const again = () => { s.remove(); render(); settingsSheet(); };
  seg('#sN', v => { cfg().n = +v; }); seg('#sM', v => { cfg().map = v; }); seg('#sB', v => { cfg().big = v === 'off' ? 'off' : cfg().big === 'off' ? 'main' : cfg().big; });
  $('#sPg', s).querySelectorAll('[data-v]').forEach(b => b.onclick = () => { O.pg = +b.dataset.v; saveSettings(); again(); });
  const add = $('[data-add]', s); if (add) add.onclick = () => { const p = pages(); p.push(p.length % 2 ? [...PAGE2] : [...pages()[0]]); O.pg = p.length - 1; O.pcfg[O.pg] = { n: 6, map: p.length === 2 ? 'off' : 'small', big: 'main' }; saveSettings(); again(); };
  const del = $('#sDelPg', s); if (del) del.onclick = () => { const i = Math.min(O.pg || 0, pages().length - 1); pages().splice(i, 1); (O.pcfg ||= []).splice(i, 1); O.pg = Math.max(0, i - 1); saveSettings(); again(); };
  $('#sRoutes', s).onclick = () => { s.remove(); routesSheet(); };
  $('#sAp', s).onchange = e => { O.autoPause = e.target.checked; saveSettings(); };
  $('#sOk', s).onclick = () => { O.autoPause = $('#sAp', s).checked; saveSettings(); s.remove(); };
}
function endSheet() {
  const rec = record();
  const s = sheet(`<div class="label">Finish ${W.act.toLowerCase()}</div><input class="ksearch" id="eName" value="${esc(rec.workout)}" style="font-size:20px;font-weight:900">
    <div class="psum"><div><span>${W.time}</span><b>${fmtTime(rec.duration)}</b></div><div><span>Distance</span><b>${fmtNum(rec.distance / 1000, 2)} km</b></div>
      <div><span>${RUN ? 'Avg pace' : 'Avg speed'}</span><b>${RUN ? pace(rec.duration ? rec.distance / rec.duration : 0) + ' min/km' : fmtNum(rec.duration ? rec.distance / rec.duration * 3.6 : 0, 1) + ' km/h'}</b></div><div><span>Climb</span><b>${rec.gain} m</b></div>
      ${rec.avgPower ? `<div><span>Avg power</span><b>${rec.avgPower} W</b></div><div><span>NP</span><b>${rec.np} W</b></div>` : ''}</div>
    <div class="pfoot col"><button class="btn" id="eSave">Save</button><button class="btn ghost" id="eStrava">Save + Strava</button><button class="btn ghost" id="eBack">${W.go}</button><button class="btn danger" id="eDrop">Discard</button></div>`);
  const save = async () => { rec.workout = $('#eName', s).value.trim() || rec.workout; R.state = 'done'; await db.put('rides', rec).catch(() => {}); db.kvDel(DRAFT).catch(() => {});
    import('./account.js').then(a => a.pushRide?.(rec)).catch(() => {}); try { wake?.release(); } catch {} };
  $('#eBack', s).onclick = () => s.remove();
  $('#eDrop', s).onclick = () => { if (!confirm(`Really discard this ${W.act.toLowerCase()}?`)) return; R = fresh(); db.kvDel(DRAFT).catch(() => {}); s.remove(); render(); };
  if (S.autoStrava) { $('#eSave', s).textContent = 'Save + Strava'; $('#eStrava', s).hidden = true; }
  $('#eSave', s).onclick = async () => { if (S.autoStrava) return $('#eStrava', s).click(); await save(); s.remove(); R = fresh(); view = 'list'; render(); detail(rec); };
  $('#eStrava', s).onclick = async e => { e.target.disabled = true; await save(); s.remove(); R = fresh(); view = 'list'; render(); detail(rec); toStrava(rec); };
}
async function toStrava(rec, btn) {
  const { stravaStatus, stravaConnect, stravaUpload } = await import('./stravaup.js'), { stravaExport } = await import('./tcx.js');
  const st = await stravaStatus();
  if (!st.configured) return stravaExport(rec, rec.workout);
  try {
    if (!st.connected && !(await stravaConnect())) throw new Error('Not connected to Strava.');
    const url = await stravaUpload(rec, rec.workout, null, t => { if (btn) btn.textContent = t; else flash(t); });
    flash('On Strava ✓'); window.open(url, '_blank');
  } catch (e) { flash(e.message || String(e)); }
  if (btn) btn.textContent = 'Upload to Strava';
}

// ---------------- list + detail ----------------
async function listView() {
  const rides = (await db.ridesFor(MODE).catch(() => [])).sort((a, b) => b.date - a.date);
  const { cur: w, prev: pw } = twoWeeks(rides), sum = (l, f) => l.reduce((a, r) => a + (f(r) || 0), 0), tot = sum(rides, r => r.distance);
  el.innerHTML = `<header class="ptop"><button class="pback" id="oBack">‹</button><div class="pbrand"><b>RIDEFRAME </b><span>${W.brand}</span></div></header>
    <section class="kcard"><div class="hwhead"><span class="label">This week</span><span class="wdl">▲▼ vs last week</span></div><div class="kstats">${weekStat(w.length, pw.length, W.acts)}${weekStat(Math.round(sum(w, r => r.distance) / 1000), Math.round(sum(pw, r => r.distance) / 1000), 'km')}
      ${weekStat(sum(w, r => r.gain), sum(pw, r => r.gain), 'Climb (m)')}${weekStat(sum(w, r => r.duration), sum(pw, r => r.duration), 'Time', fmtTime)}</div>
      <div class="hint" style="margin-top:8px">Total ${rides.length} ${rides.length === 1 ? W.act : W.acts} · ${fmtNum(tot / 1000, 0)} km ${W.where}</div></section>
    ${rides.length ? rides.map(r => `<div class="kcard orow" data-id="${r.id}">${shape(r)}<div class="oinfo"><b>${esc(r.workout || W.dflt)}</b><span>${new Date(r.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
      <div class="khm"><span>${fmtNum(r.distance / 1000, 1)} km</span><span>${fmtTime(r.duration)}</span><span>${r.gain} m climb</span><span>${RUN ? pace(r.duration ? r.distance / r.duration : 0) + ' min/km' : fmtNum(r.duration ? r.distance / r.duration * 3.6 : 0, 1) + ' km/h'}</span></div></div></div>`).join('')
      : `<p class="hint">${W.none}</p>`}`;
  $('#oBack').onclick = () => { view = 'ride'; render(); };
  el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => detail(rides.find(r => r.id === b.dataset.id)));
}
/** the ride's outline as a small SVG (no map tiles needed in the list) */
function shape(r, w = 64, h = 64, p = (r.samples || []).filter(s => s[6] != null).map(s => [s[6], s[7]])) {
  if (p.length < 2) return `<svg class="oshape" viewBox="0 0 ${w} ${h}"></svg>`;
  const la = p.map(x => x[0]), lo = p.map(x => x[1]), k = Math.cos(rad((Math.min(...la) + Math.max(...la)) / 2));
  const x0 = Math.min(...lo), y1 = Math.max(...la), sx = (Math.max(...lo) - x0) * k, sy = y1 - Math.min(...la), sc = (w - 8) / Math.max(sx, sy, 1e-6);
  const ox = (w - sx * sc) / 2, oy = (h - sy * sc) / 2, step = Math.max(1, Math.floor(p.length / 300));
  return `<svg class="oshape" viewBox="0 0 ${w} ${h}"><path d="${p.filter((_, i) => i % step === 0).map((q, i) => `${i ? 'L' : 'M'}${(ox + (q[1] - x0) * k * sc).toFixed(1)},${(oy + (y1 - q[0]) * sc).toFixed(1)}`).join('')}"/></svg>`;
}
function detail(r) {
  if (!r) return;
  const pts = (r.samples || []).filter(s => s[6] != null), hrs = r.samples.map(s => s[5]).filter(Boolean);
  const s = sheet(`<div class="label">${new Date(r.date).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}</div><h2 class="display" style="font-size:28px;margin:6px 0 10px">${esc(r.workout || W.dflt)}</h2>
    <div class="omap det" id="dMap"></div>
    <div class="psum"><div><span>Distance</span><b>${fmtNum(r.distance / 1000, 2)} km</b></div><div><span>${W.time}</span><b>${fmtTime(r.duration)}</b></div>
      ${RUN ? `<div><span>Avg pace</span><b>${pace(r.duration ? r.distance / r.duration : 0)} min/km</b></div><div><span>Fastest km</span><b>${r.kmSplits?.length ? fmtTime(Math.min(...r.kmSplits)) : '–'}</b></div>` : `<div><span>Avg speed</span><b>${fmtNum(r.duration ? r.distance / r.duration * 3.6 : 0, 1)} km/h</b></div><div><span>Max speed</span><b>${fmtNum(r.maxSpeed || 0, 1)} km/h</b></div>`}
      <div><span>Climb</span><b>${r.gain} m</b></div><div><span>Elapsed</span><b>${fmtTime(r.elapsed || r.duration)}</b></div>
      ${hrs.length ? `<div><span>Avg HR</span><b>${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)}</b></div><div><span>Max HR</span><b>${Math.max(...hrs)}</b></div>` : ''}
      ${r.avgPower ? `<div><span>Avg power</span><b>${r.avgPower} W</b></div><div><span>NP</span><b>${r.np} W</b></div>` : ''}</div>
    ${r.kmSplits?.length ? `<div class="label" style="margin-top:10px">Splits</div><div class="kdet">${r.kmSplits.map((t, i) => `<div><span>${i + 1}</span><span>${'▮'.repeat(Math.max(1, Math.round(10 * Math.min(...r.kmSplits) / t)))}</span><span>${fmtTime(t)}</span></div>`).join('')}</div>` : ''}
    ${r.stravaSegs?.length ? `<div class="label" style="margin-top:10px">Strava segments (timed live)</div><div class="kdet">${r.stravaSegs.map(x => `<div><span>◆</span><span>${esc(x.name)}</span><span>${fmtTime(x.t)}</span></div>`).join('')}</div>` : ''}
    <div class="label" style="margin-top:10px">Altitude &amp; speed</div>${profile(r)}
    <div class="pfoot col"><button class="btn" id="dStrava">Upload to Strava</button>${pts.length > 1 ? '<button class="btn ghost" id="dRoute">Use as route</button>' : ''}<button class="btn ghost" id="dGpx">Download GPX</button><button class="btn danger" id="dDel">Delete</button></div>`);
  if (window.L && pts.length > 1) setTimeout(() => {
    const m = L.map($('#dMap', s), { zoomControl: false }); L.tileLayer(TILES(), { attribution: ATTR, maxZoom: 19, maxNativeZoom: 16 }).addTo(m);
    const ln = L.polyline(pts.map(p => [p[6], p[7]]), { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), weight: 4 }).addTo(m);
    L.circleMarker([pts[0][6], pts[0][7]], { radius: 6, color: '#fff', fillColor: '#2fb36b', fillOpacity: 1, weight: 2 }).addTo(m);
    L.circleMarker([pts[pts.length - 1][6], pts[pts.length - 1][7]], { radius: 6, color: '#fff', fillColor: '#ff4f3c', fillOpacity: 1, weight: 2 }).addTo(m);
    m.fitBounds(ln.getBounds(), { padding: [16, 16] });
  }, 30); else $('#dMap', s).remove();
  $('#dStrava', s).onclick = e => toStrava(r, e.target);
  $('#dGpx', s).onclick = () => gpx(r);
  const ur = $('#dRoute', s); if (ur) ur.onclick = async () => { let rt = routes.find(x => x.from === r.id);
    if (!rt) { rt = makeRoute(r.workout || W.dflt, pts.map(p => [p[6], p[7], p[8]]), { from: r.id }); routes.unshift(rt); await saveRoutes(); }
    useRoute(rt); s.remove(); view = 'ride'; render(); flash(`Route: ${short(rt.name, 24)}`); };
  $('#dDel', s).onclick = async () => { if (!confirm(`Delete this ${W.act.toLowerCase()} for good?`)) return;
    try { const a = await import('./account.js'); await a.deleteRideRemote(r.id); } catch (e) { return flash('Server: ' + e.message); }
    await db.del('rides', r.id); s.remove(); render(); };
}
/** altitude (filled) and speed (line) over distance */
function profile(r) {
  const ss = r.samples || []; if (ss.length < 2) return '';
  const W0 = 320, H = 110, D = Math.max(1, ss[ss.length - 1][1]), step = Math.max(1, Math.floor(ss.length / 400)), pick = ss.filter((_, i) => i % step === 0);
  const el0 = pick.map(s => s[8]).filter(v => v != null), lo = Math.min(...el0), hi = Math.max(...el0), vmax = Math.max(10, ...pick.map(s => s[3]));
  const x = d => d / D * W0, ye = v => H - 4 - (v - lo) / Math.max(5, hi - lo) * (H - 20), yv = v => H - 4 - v / vmax * (H - 20);
  const area = el0.length > 1 ? `<path class="oele" d="M0,${H}${pick.filter(s => s[8] != null).map(s => `L${x(s[1]).toFixed(1)},${ye(s[8]).toFixed(1)}`).join('')}L${W0},${H}Z"/>` : '';
  return `<svg class="kchart" viewBox="0 0 ${W0} ${H}">${area}<path class="kline" style="stroke-width:1.5" d="${pick.map((s, i) => `${i ? 'L' : 'M'}${x(s[1]).toFixed(1)},${yv(s[3]).toFixed(1)}`).join('')}"/>
    ${el0.length ? `<text x="2" y="10">${Math.round(hi)} m</text>` : ''}<text x="${W0 - 2}" y="10" text-anchor="end">${RUN ? pace(vmax / 3.6) + ' min/km' : fmtNum(vmax, 0) + ' km/h'}</text></svg>`;
}
function gpx(r) {
  const t0 = r.date - (r.elapsed || r.duration) * 1000, x = v => String(v).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RIDEFRAME" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${x(r.workout || W.dflt)}</name><type>${RUN ? 'running' : 'cycling'}</type><trkseg>`
    + r.samples.filter(s => s[6] != null).map(s => `<trkpt lat="${s[6]}" lon="${s[7]}">${s[8] != null ? `<ele>${s[8]}</ele>` : ''}<time>${new Date(t0 + s[0] * 1000).toISOString()}</time></trkpt>`).join('') + '</trkseg></trk></gpx>';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'application/gpx+xml' })); a.download = `RIDEFRAME_${new Date(r.date).toISOString().slice(0, 10)}_${(r.workout || W.dflt).replace(/[^\wäöüÄÖÜß-]+/g, '_')}.gpx`;
  document.body.append(a); a.click(); a.remove();
}

// ---------------- data ----------------
hub.addEventListener('data', () => { if (DEMO) return; live.power = hub.get('power'); live.cad = hub.get('cad'); live.hr = hub.get('hr'); });
hub.addEventListener('change', () => { if (view === 'ride' && R.state !== 'done' && !$('.psheet')) render(); });
let last = performance.now();
setInterval(() => {
  const now = performance.now(), dt = Math.min(2, (now - last) / 1000); last = now;
  if (!DEMO) { live.power = hub.get('power'); live.cad = hub.get('cad'); live.hr = hub.get('hr'); }
  tick(dt); paint();
  if (R.state === 'run' && now - draftAt > 10000) saveDraft();
}, 250);

await loadSettings();
await loadRoutes();
await hub.load(); hub.auto().catch(() => {});
const draft = await db.kvGet(DRAFT).catch(() => null);
render(); startGPS();
if (draft?.samples?.length && Date.now() - draft.savedAt < 12 * 3600e3) {
  const s = sheet(`<div class="label">Unfinished ${RUN ? 'run' : 'ride'}</div><h2 class="display" style="font-size:26px;margin:8px 0">${fmtNum(draft.d / 1000, 2)} km · ${fmtTime(draft.moving)}</h2>
    <p class="hint">${RUN ? 'The last run' : 'The last ride'} was not finished (page reloaded or battery empty).</p>
    <div class="pfoot col"><button class="btn" id="rGo">Resume</button><button class="btn ghost" id="rEnd">Finish and save</button><button class="btn danger" id="rDrop">Discard</button></div>`);
  const take = () => { R = { ...fresh(), ...draft, state: 'pause', last: null }; s.remove(); render(); };
  $('#rGo', s).onclick = () => { take(); start(); };
  $('#rEnd', s).onclick = () => { take(); endSheet(); };
  $('#rDrop', s).onclick = () => { db.kvDel(DRAFT).catch(() => {}); s.remove(); };
}
if (DEMO && params.has('run')) start();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
function demoSegs() { // two fake segments on the demo loop (?demo)
  const c = [67.9326, 13.0890], r = .006, at = (a0, a1, star, name) => { const pts = []; for (let a = a0; a <= a1; a += .02) pts.push([c[0] + Math.sin(a) * r, c[1] + Math.cos(a) * r * 2.4]);
    let o = '', pl = 0, pn = 0; const e = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
    for (const [x, y] of pts) { const la = Math.round(x * 1e5), lo = Math.round(y * 1e5); o += e(la - pl) + e(lo - pn); pl = la; pn = lo; } return { id: name, name, line: o, starred: star, pr: 30 }; };
  return [at(.1, .6, true, 'Demo climb'), { ...at(1.5, 2.2, false, 'Demo sprint'), kom: '0:24' }];
}
