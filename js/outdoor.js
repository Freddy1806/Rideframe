// RIDEFRAME Draußen (Freddy 15.11.): record real rides outside like a bike computer app (Cadence): GPS track on a map,
// speed, distance, climbing, plus heart rate and a power meter over Bluetooth. Rides land in the same history
// (routeId 'outdoor', outdoor: true) and go to Strava as a real ride with the GPS track.
// Browser limits: the phone screen must stay on (wake lock keeps it on); Bluetooth needs Chrome (Android) or Bluefy (iPhone).
import { Trainer, HeartRate } from './trainer.js';
import { db, uid } from './db.js';
import { fmtTime, fmtNum, esc, bestAvg } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search), DEMO = params.has('demo');
const ACCENTS = { orange: '#ff5a1f', violet: '#8b6cff', lime: '#c6f432', cyan: '#2fd3e0', pink: '#ff4f9a' };
const TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', ATTR = '© OpenStreetMap, © CARTO';
const el = document.getElementById('out');
let S = { riderKg: 75, ftp: 250 }, O = { tiles: ['time', 'dist', 'avgSpeed', 'gain', 'hr', 'power', 'cad', 'alt', 'maxSpeed'], autoPause: true, bigMap: false };
const meter = new Trainer(), hrStrap = new HeartRate();
const live = { power: 0, cad: 0, hr: 0, fix: null, acc: null, gpsErr: '' };
let R = fresh(), view = 'ride', map = null, line = null, dot = null, follow = true, wake = null, watch = null;
function fresh() { return { state: 'ready', id: uid(), start: 0, wall: 0, moving: 0, d: 0, v: 0, vMax: 0, gain: 0, eleS: null, eleRef: null, last: null, still: 0, kj: 0, pw: [], samples: [], track: [], lastSec: -1, laps: [], lapAt: { t: 0, d: 0 } }; }

// ---------------- settings ----------------
async function loadSettings() {
  const st = await db.kvGet('settings').catch(() => null); if (st) Object.assign(S, st);
  Object.assign(O, S.outdoor || {});
  document.documentElement.style.setProperty('--accent', ACCENTS[S.accent] || ACCENTS.orange);
}
async function saveSettings() { const st = (await db.kvGet('settings').catch(() => null)) || {}; st.outdoor = { ...O }; await db.kvSet('settings', st).catch(() => {}); }

// ---------------- GPS ----------------
const R_E = 6371008.8, rad = x => x * Math.PI / 180;
function hav(a, b) { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]), x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R_E * Math.asin(Math.sqrt(x)); }
function startGPS() {
  if (DEMO) return demoGPS();
  if (!navigator.geolocation) { live.gpsErr = 'Dieses Gerät hat kein GPS im Browser.'; return; }
  watch = navigator.geolocation.watchPosition(onFix, e => { live.gpsErr = e.code === 1 ? 'Standort nicht erlaubt. Bitte in den Browser-Einstellungen erlauben.' : 'Kein GPS-Signal.'; paint(); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function onFix(p) {
  const c = p.coords, pt = [c.latitude, c.longitude], t = p.timestamp || Date.now();
  live.gpsErr = ''; live.acc = c.accuracy; live.alt = c.altitude; const prev = live.fix; live.fix = { pt, t, speed: c.speed, alt: c.altitude, acc: c.accuracy };
  if (dot) dot.setLatLng(pt); else if (map) onFixDot();
  if (map && follow) map.setView(pt, Math.max(map.getZoom(), 15), { animate: false });
  if (R.state !== 'run') { if (!prev && map) map.setView(pt, 16); return; }
  if (c.accuracy > 40) return; // too vague for distance
  if (!R.last) { R.last = { pt, t }; R.track.push(pt); line?.addLatLng(pt); return; }
  const d = hav(R.last.pt, pt), dt = Math.max(.2, (t - R.last.t) / 1000);
  let v = c.speed != null && c.speed >= 0 ? c.speed : d / dt;
  if (d / dt > 33) return; // a jump (>120 km/h): ignore this fix
  if (d < Math.max(2, Math.min(8, c.accuracy * .25)) && v < 1) { R.v = v < .8 ? 0 : v; return; } // standing: GPS wobble is not distance
  const moving = !O.autoPause || v > .8;
  if (moving) { R.d += d; R.track.push(pt); line?.addLatLng(pt); }
  R.v = v; R.vMax = Math.max(R.vMax, v < 30 ? v : 0); R.last = { pt, t };
  if (c.altitude != null) { // smoothed altitude, climbing counted with 3 m hysteresis (raw GPS height jumps)
    R.eleS = R.eleS == null ? c.altitude : R.eleS + (c.altitude - R.eleS) * .2;
    if (R.eleRef == null) R.eleRef = R.eleS; else if (R.eleS - R.eleRef > 3) { R.gain += R.eleS - R.eleRef; R.eleRef = R.eleS; } else if (R.eleRef - R.eleS > 3) R.eleRef = R.eleS;
  }
}
function demoGPS() { // a fake ride around the Lofoten village Reine, so the screen can be tested at the desk
  let a = 0, t = Date.now(); const c = [67.9326, 13.0890];
  setInterval(() => { a += .0035 * (1 + Math.sin(a * 3) * .3); t += 1000; const r = .006;
    onFix({ timestamp: t, coords: { latitude: c[0] + Math.sin(a) * r, longitude: c[1] + Math.cos(a) * r * 2.4, accuracy: 6, altitude: 20 + Math.sin(a * 4) * 15, speed: 7 + Math.sin(a * 5) * 2 } });
    live.power = Math.round(180 + Math.sin(a * 4) * 60); live.cad = 85; live.hr = 130 + Math.round(Math.sin(a * 4) * 10);
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
  if (!live.fix && !DEMO && !confirm('Noch kein GPS-Signal. Trotzdem starten? Die Strecke zählt ab dem ersten Signal.')) return;
  if (R.state === 'ready') R.start = Date.now();
  R.state = 'run'; R.last = null; lockScreen(); render();
}
function pause() { R.state = 'pause'; render(); saveDraft(); }
function lap() { if (R.state !== 'run') return; const t = R.moving - R.lapAt.t, d = R.d - R.lapAt.d; R.laps.push(Math.round(R.wall)); R.lapAt = { t: R.moving, d: R.d }; flash(`Runde ${R.laps.length}: ${fmtTime(t)} · ${fmtNum(d / 1000, 2)} km`); }
const avgP = () => R.pw.length ? R.pw.reduce((a, b) => a + b, 0) / R.pw.length : 0;
function NP() { const p = R.pw; if (p.length < 30) return avgP(); let s = 0, n = 0, w = 0; for (let i = 0; i < p.length; i++) { w += p[i]; if (i >= 30) w -= p[i - 30]; if (i >= 29) { s += (w / 30) ** 4; n++; } } return Math.pow(s / n, .25); }
const rideName = t => { const h = new Date(t).getHours(); return h < 11 ? 'Morgenrunde' : h < 14 ? 'Mittagsrunde' : h < 18 ? 'Nachmittagsrunde' : 'Abendrunde'; };
function record() {
  const pw = R.pw, hasP = pw.some(x => x > 0);
  return { id: R.id, routeId: 'outdoor', outdoor: true, date: Date.now(), complete: true, duration: Math.round(R.moving), elapsed: Math.round(R.wall), distance: Math.round(R.d), gain: Math.round(R.gain), startD: 0,
    workout: R.name || rideName(R.start), avgPower: hasP ? Math.round(avgP()) : 0, maxPower: hasP ? Math.max(...pw) : 0, best5: hasP ? bestAvg(pw, 300) : 0, best20: hasP ? bestAvg(pw, 1200) : 0,
    np: hasP ? Math.round(NP()) : 0, kj: Math.round(R.kj), maxSpeed: Math.round(R.vMax * 36) / 10, lapMarks: R.laps.length ? R.laps : undefined, samples: R.samples };
}
// a crash, a reload or an empty battery must not lose the ride: the state goes to kv every 10 s
let draftAt = 0;
function saveDraft() { const { last, ...r } = R; db.kvSet('outdoorDraft', { ...r, savedAt: Date.now() }).catch(() => {}); draftAt = performance.now(); }

// ---------------- metrics ----------------
const M = {
  time: { l: 'Fahrzeit', u: '', v: () => fmtTime(R.moving) },
  wall: { l: 'Gesamtzeit', u: '', v: () => fmtTime(R.wall) },
  dist: { l: 'Strecke', u: 'km', v: () => fmtNum(R.d / 1000, 2) },
  speed: { l: 'Tempo', u: 'km/h', v: () => fmtNum(R.v * 3.6, 1) },
  avgSpeed: { l: 'Ø Tempo', u: 'km/h', v: () => fmtNum(R.moving ? R.d / R.moving * 3.6 : 0, 1) },
  maxSpeed: { l: 'Max Tempo', u: 'km/h', v: () => fmtNum(R.vMax * 3.6, 1) },
  gain: { l: 'Höhenmeter', u: 'hm', v: () => Math.round(R.gain) },
  alt: { l: 'Höhe', u: 'm', v: () => R.eleS != null ? Math.round(R.eleS) : live.alt != null ? Math.round(live.alt) : '–' },
  hr: { l: 'Puls', u: 'bpm', v: () => live.hr || '–' },
  power: { l: 'Leistung', u: 'W', v: () => meter.connected || DEMO ? Math.round(live.power) : '–' },
  avgPower: { l: 'Ø Leistung', u: 'W', v: () => R.pw.some(x => x) ? Math.round(avgP()) : '–' },
  np: { l: 'NP', u: 'W', v: () => R.pw.some(x => x) ? Math.round(NP()) : '–' },
  cad: { l: 'Trittfrequenz', u: 'rpm', v: () => meter.connected || DEMO ? Math.round(live.cad) : '–' },
  kcal: { l: 'Kalorien', u: 'kcal', v: () => R.kj ? Math.round(R.kj * 1.1) : Math.round(R.moving / 3600 * 8 * (S.riderKg || 75)) },
  lapTime: { l: 'Runde Zeit', u: '', v: () => fmtTime(R.moving - R.lapAt.t) },
  lapDist: { l: 'Runde km', u: 'km', v: () => fmtNum((R.d - R.lapAt.d) / 1000, 2) },
  clock: { l: 'Uhrzeit', u: '', v: () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) },
  gps: { l: 'GPS-Genauigkeit', u: 'm', v: () => live.acc != null ? Math.round(live.acc) : '–' },
};

// ---------------- screen ----------------
function flash(t) { let f = $('#oflash'); if (!f) { f = document.createElement('div'); f.id = 'oflash'; f.className = 'pflash'; document.body.append(f); } f.textContent = t; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), 3500); }
function sheet(html) { const s = document.createElement('div'); s.className = 'psheet'; s.innerHTML = `<div class="psheetin">${html}</div>`; s.onclick = e => { if (e.target === s) s.remove(); }; document.body.append(s); return s; }
async function lockScreen() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R.state === 'run') { lockScreen(); } else if (R.state === 'run') saveDraft(); });
window.addEventListener('beforeunload', e => { if (R.samples.length && R.state !== 'done') { saveDraft(); e.preventDefault(); e.returnValue = ''; } });

const gpsTxt = () => live.gpsErr ? 'GPS fehlt' : !live.fix ? 'GPS sucht' : live.acc > 40 ? `GPS ±${Math.round(live.acc)} m` : 'GPS';
function render() {
  if (map) { map.remove(); map = null; line = null; dot = null; }
  if (view === 'list') return listView();
  const bleOk = Trainer.supported();
  el.innerHTML = `<header class="ptop"><a class="pback" href="./" title="Zur App">‹</a><div class="pbrand"><b>RIDEFRAME </b><span>Draußen</span></div>
      <span class="ppill ${live.fix && live.acc <= 40 ? 'on' : ''}" id="oGps"><i></i>${gpsTxt()}</span>
      ${bleOk ? `<button class="ppill ${hrStrap.connected ? 'on' : ''}" id="oHr"><i></i>Puls</button><button class="ppill ${meter.connected ? 'on' : ''}" id="oPm"><i></i>Watt</button>` : ''}
      <button class="pgear" id="oSet" title="Einstellungen">⚙</button></header>
    ${live.gpsErr ? `<div class="pnote">${esc(live.gpsErr)}</div>` : ''}
    <div class="omap ${O.bigMap ? 'big' : ''}" id="oMap"><button class="omapbtn" id="oFollow" title="Auf mich zentrieren">◎</button><button class="omapbtn r" id="oBig" title="Karte größer/kleiner">${O.bigMap ? '▴' : '▾'}</button></div>
    <section class="pbig obig"><div class="label">Tempo</div><div class="pbigv"><b id="oSpd">0,0</b><small>km/h</small></div></section>
    <section class="ptiles">${O.tiles.map((k, i) => `<button class="ptile" data-t="${i}"><span class="label">${M[k]?.l || k}</span><b data-k="${k}">–</b><small>${M[k]?.u || ''}</small></button>`).join('')}</section>
    <footer class="pfoot">${R.state === 'run' ? `<button class="btn ghost" id="oPause">Pause</button><button class="btn ghost" id="oLap">Runde</button>`
      : `${R.state === 'ready' ? '<button class="btn ghost" id="oList">Fahrten</button>' : ''}<button class="btn" id="oStart">${R.state === 'pause' ? 'Weiter' : 'Start'}</button>${R.state === 'pause' ? '<button class="btn ghost" id="oEnd">Beenden</button>' : ''}`}</footer>`;
  initMap();
  const on = (id, f) => { const x = $(id); if (x) x.onclick = f; };
  on('#oStart', start); on('#oPause', pause); on('#oLap', lap); on('#oEnd', endSheet); on('#oList', () => { view = 'list'; render(); }); on('#oSet', settingsSheet);
  on('#oHr', async () => { try { await hrStrap.connect(); } catch (e) { if (e.name !== 'NotFoundError') flash(e.message || String(e)); } render(); });
  on('#oPm', async () => { try { await meter.connect(); } catch (e) { if (e.name !== 'NotFoundError') flash(e.message || String(e)); } render(); });
  on('#oFollow', () => { follow = true; if (live.fix) map.setView(live.fix.pt, Math.max(map.getZoom(), 15)); });
  on('#oBig', () => { O.bigMap = !O.bigMap; saveSettings(); render(); });
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => tileSheet(+b.dataset.t));
  paint();
}
function initMap() {
  if (!window.L) return;
  map = L.map('oMap', { zoomControl: false, attributionControl: true }).setView(live.fix?.pt || R.track[R.track.length - 1] || [51.16, 10.45], live.fix || R.track.length ? 16 : 5);
  L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19, subdomains: 'abcd' }).addTo(map);
  line = L.polyline(R.track, { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5a1f', weight: 5, opacity: .95 }).addTo(map);
  if (live.fix) onFixDot();
  map.on('dragstart', () => { follow = false; });
}
function onFixDot() { dot = L.circleMarker(live.fix.pt, { radius: 7, color: '#fff', weight: 2, fillColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5a1f', fillOpacity: 1 }).addTo(map); }
function paint() {
  if (view !== 'ride' || !$('#oSpd')) return;
  $('#oSpd').textContent = fmtNum(R.state === 'run' || DEMO ? R.v * 3.6 : (live.fix?.speed || 0) * 3.6, 1);
  el.querySelectorAll('[data-k]').forEach(b => { const v = String(M[b.dataset.k]?.v()); if (b.textContent !== v) b.textContent = v; });
  const g = $('#oGps'); if (g) { const t = gpsTxt(); if (!g.textContent.endsWith(t)) g.innerHTML = `<i></i>${t}`; g.classList.toggle('on', !!live.fix && live.acc <= 40); }
}
function tileSheet(i) {
  const s = sheet(`<div class="label">Feld ${i + 1}: Wert wählen</div><div class="ppick">${Object.entries(M).map(([k, m]) => `<button data-k2="${k}" class="${O.tiles[i] === k ? 'on' : ''}">${m.l}</button>`).join('')}</div>`);
  s.querySelectorAll('[data-k2]').forEach(b => b.onclick = () => { O.tiles[i] = b.dataset.k2; saveSettings(); s.remove(); render(); });
}
function settingsSheet() {
  const s = sheet(`<div class="label">Einstellungen</div>
    <label class="prow">Auto-Pause<input id="sAp" type="checkbox" class="toggle" ${O.autoPause ? 'checked' : ''}></label>
    <p class="hint">Der Bildschirm bleibt während der Fahrt an. Geht er aus oder wechselst du die App, kann der Browser kein GPS mehr aufzeichnen. Am besten das Handy in eine Lenkerhalterung.</p>
    <div class="pfoot"><button class="btn" id="sOk">Fertig</button></div>`);
  $('#sOk', s).onclick = () => { O.autoPause = $('#sAp', s).checked; saveSettings(); s.remove(); };
}
function endSheet() {
  const rec = record();
  const s = sheet(`<div class="label">Fahrt beenden</div><input class="ksearch" id="eName" value="${esc(rec.workout)}" style="font-size:20px;font-weight:900">
    <div class="psum"><div><span>Fahrzeit</span><b>${fmtTime(rec.duration)}</b></div><div><span>Strecke</span><b>${fmtNum(rec.distance / 1000, 2)} km</b></div>
      <div><span>Ø Tempo</span><b>${fmtNum(rec.duration ? rec.distance / rec.duration * 3.6 : 0, 1)} km/h</b></div><div><span>Höhenmeter</span><b>${rec.gain} hm</b></div>
      ${rec.avgPower ? `<div><span>Ø Leistung</span><b>${rec.avgPower} W</b></div><div><span>NP</span><b>${rec.np} W</b></div>` : ''}</div>
    <div class="pfoot col"><button class="btn" id="eSave">Speichern</button><button class="btn ghost" id="eStrava">Speichern + Strava</button><button class="btn ghost" id="eBack">Weiterfahren</button><button class="btn danger" id="eDrop">Verwerfen</button></div>`);
  const save = async () => { rec.workout = $('#eName', s).value.trim() || rec.workout; R.state = 'done'; await db.put('rides', rec).catch(() => {}); db.kvDel('outdoorDraft').catch(() => {});
    import('./account.js').then(a => a.pushRide?.(rec)).catch(() => {}); try { wake?.release(); } catch {} };
  $('#eBack', s).onclick = () => s.remove();
  $('#eDrop', s).onclick = () => { if (!confirm('Fahrt wirklich verwerfen?')) return; R = fresh(); db.kvDel('outdoorDraft').catch(() => {}); s.remove(); render(); };
  $('#eSave', s).onclick = async () => { await save(); s.remove(); R = fresh(); view = 'list'; render(); detail(rec); };
  $('#eStrava', s).onclick = async e => { e.target.disabled = true; await save(); s.remove(); R = fresh(); view = 'list'; render(); detail(rec); toStrava(rec); };
}
async function toStrava(rec, btn) {
  const { stravaStatus, stravaConnect, stravaUpload } = await import('./stravaup.js'), { stravaExport } = await import('./tcx.js');
  const st = await stravaStatus();
  if (!st.configured) return stravaExport(rec, rec.workout);
  try {
    if (!st.connected && !(await stravaConnect())) throw new Error('Nicht mit Strava verbunden.');
    const url = await stravaUpload(rec, rec.workout, null, t => { if (btn) btn.textContent = t; else flash(t); });
    flash('Auf Strava ✓'); window.open(url, '_blank');
  } catch (e) { flash(e.message || String(e)); }
  if (btn) btn.textContent = 'Zu Strava hochladen';
}

// ---------------- list + detail ----------------
async function listView() {
  const rides = (await db.ridesFor('outdoor').catch(() => [])).sort((a, b) => b.date - a.date);
  const wk = Date.now() - 7 * 864e5, w = rides.filter(r => r.date > wk), tot = rides.reduce((a, r) => a + r.distance, 0);
  el.innerHTML = `<header class="ptop"><button class="pback" id="oBack">‹</button><div class="pbrand"><b>RIDEFRAME </b><span>Draußen</span></div></header>
    <section class="kcard"><div class="label">Letzte 7 Tage</div><div class="kstats"><div><b>${w.length}</b><small>Fahrten</small></div><div><b>${fmtNum(w.reduce((a, r) => a + r.distance, 0) / 1000, 0)}</b><small>km</small></div>
      <div><b>${fmtNum(w.reduce((a, r) => a + r.gain, 0))}</b><small>hm</small></div><div><b>${fmtTime(w.reduce((a, r) => a + r.duration, 0))}</b><small>Zeit</small></div></div>
      <div class="hint" style="margin-top:8px">Insgesamt ${rides.length} ${rides.length === 1 ? 'Fahrt' : 'Fahrten'} · ${fmtNum(tot / 1000, 0)} km draußen</div></section>
    ${rides.length ? rides.map(r => `<div class="kcard orow" data-id="${r.id}">${shape(r)}<div class="oinfo"><b>${esc(r.workout || 'Ausfahrt')}</b><span>${new Date(r.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
      <div class="khm"><span>${fmtNum(r.distance / 1000, 1)} km</span><span>${fmtTime(r.duration)}</span><span>${r.gain} hm</span><span>${fmtNum(r.duration ? r.distance / r.duration * 3.6 : 0, 1)} km/h</span></div></div></div>`).join('')
      : '<p class="hint">Noch keine Fahrt draußen aufgezeichnet. Zurück, Start drücken und losfahren.</p>'}`;
  $('#oBack').onclick = () => { view = 'ride'; render(); };
  el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => detail(rides.find(r => r.id === b.dataset.id)));
}
/** the ride's outline as a small SVG (no map tiles needed in the list) */
function shape(r, w = 64, h = 64) {
  const p = (r.samples || []).filter(s => s[6] != null).map(s => [s[6], s[7]]); if (p.length < 2) return `<svg class="oshape" viewBox="0 0 ${w} ${h}"></svg>`;
  const la = p.map(x => x[0]), lo = p.map(x => x[1]), k = Math.cos(rad((Math.min(...la) + Math.max(...la)) / 2));
  const x0 = Math.min(...lo), y1 = Math.max(...la), sx = (Math.max(...lo) - x0) * k, sy = y1 - Math.min(...la), sc = (w - 8) / Math.max(sx, sy, 1e-6);
  const ox = (w - sx * sc) / 2, oy = (h - sy * sc) / 2, step = Math.max(1, Math.floor(p.length / 300));
  return `<svg class="oshape" viewBox="0 0 ${w} ${h}"><path d="${p.filter((_, i) => i % step === 0).map((q, i) => `${i ? 'L' : 'M'}${(ox + (q[1] - x0) * k * sc).toFixed(1)},${(oy + (y1 - q[0]) * sc).toFixed(1)}`).join('')}"/></svg>`;
}
function detail(r) {
  if (!r) return;
  const pts = (r.samples || []).filter(s => s[6] != null), hrs = r.samples.map(s => s[5]).filter(Boolean);
  const s = sheet(`<div class="label">${new Date(r.date).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })}</div><h2 class="display" style="font-size:28px;margin:6px 0 10px">${esc(r.workout || 'Ausfahrt')}</h2>
    <div class="omap det" id="dMap"></div>
    <div class="psum"><div><span>Strecke</span><b>${fmtNum(r.distance / 1000, 2)} km</b></div><div><span>Fahrzeit</span><b>${fmtTime(r.duration)}</b></div>
      <div><span>Ø Tempo</span><b>${fmtNum(r.duration ? r.distance / r.duration * 3.6 : 0, 1)} km/h</b></div><div><span>Max Tempo</span><b>${fmtNum(r.maxSpeed || 0, 1)} km/h</b></div>
      <div><span>Höhenmeter</span><b>${r.gain} hm</b></div><div><span>Gesamtzeit</span><b>${fmtTime(r.elapsed || r.duration)}</b></div>
      ${hrs.length ? `<div><span>Ø Puls</span><b>${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)}</b></div><div><span>Max Puls</span><b>${Math.max(...hrs)}</b></div>` : ''}
      ${r.avgPower ? `<div><span>Ø Leistung</span><b>${r.avgPower} W</b></div><div><span>NP</span><b>${r.np} W</b></div>` : ''}</div>
    <div class="label" style="margin-top:10px">Höhe &amp; Tempo</div>${profile(r)}
    <div class="pfoot col"><button class="btn" id="dStrava">Zu Strava hochladen</button><button class="btn ghost" id="dGpx">GPX herunterladen</button><button class="btn danger" id="dDel">Löschen</button></div>`);
  if (window.L && pts.length > 1) setTimeout(() => {
    const m = L.map($('#dMap', s), { zoomControl: false }); L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19, subdomains: 'abcd' }).addTo(m);
    const ln = L.polyline(pts.map(p => [p[6], p[7]]), { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), weight: 4 }).addTo(m);
    L.circleMarker([pts[0][6], pts[0][7]], { radius: 6, color: '#fff', fillColor: '#2fb36b', fillOpacity: 1, weight: 2 }).addTo(m);
    L.circleMarker([pts[pts.length - 1][6], pts[pts.length - 1][7]], { radius: 6, color: '#fff', fillColor: '#ff4f3c', fillOpacity: 1, weight: 2 }).addTo(m);
    m.fitBounds(ln.getBounds(), { padding: [16, 16] });
  }, 30); else $('#dMap', s).remove();
  $('#dStrava', s).onclick = e => toStrava(r, e.target);
  $('#dGpx', s).onclick = () => gpx(r);
  $('#dDel', s).onclick = async () => { if (!confirm('Fahrt endgültig löschen?')) return;
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
    ${el0.length ? `<text x="2" y="10">${Math.round(hi)} m</text>` : ''}<text x="${W0 - 2}" y="10" text-anchor="end">${fmtNum(vmax, 0)} km/h</text></svg>`;
}
function gpx(r) {
  const t0 = r.date - (r.elapsed || r.duration) * 1000, x = v => String(v).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RIDEFRAME" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${x(r.workout || 'Ausfahrt')}</name><type>cycling</type><trkseg>`
    + r.samples.filter(s => s[6] != null).map(s => `<trkpt lat="${s[6]}" lon="${s[7]}">${s[8] != null ? `<ele>${s[8]}</ele>` : ''}<time>${new Date(t0 + s[0] * 1000).toISOString()}</time></trkpt>`).join('') + '</trkseg></trk></gpx>';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'application/gpx+xml' })); a.download = `RIDEFRAME_${new Date(r.date).toISOString().slice(0, 10)}_${(r.workout || 'Ausfahrt').replace(/[^\wäöüÄÖÜß-]+/g, '_')}.gpx`;
  document.body.append(a); a.click(); a.remove();
}

// ---------------- data ----------------
meter.addEventListener('data', e => { live.power = e.detail.power || 0; live.cad = e.detail.cadence || 0; if (!hrStrap.connected && e.detail.hr) live.hr = e.detail.hr; });
meter.addEventListener('status', () => { if (view === 'ride' && R.state !== 'done') render(); });
hrStrap.addEventListener('hr', e => { live.hr = e.detail; });
hrStrap.addEventListener('change', () => { if (!hrStrap.connected) live.hr = 0; });
let last = performance.now();
setInterval(() => {
  const now = performance.now(), dt = Math.min(2, (now - last) / 1000); last = now;
  if (meter.connected && meter.lastData && now - meter.lastData > 3000) { live.power = 0; live.cad = 0; }
  tick(dt); paint();
  if (R.state === 'run' && now - draftAt > 10000) saveDraft();
}, 250);

await loadSettings();
const draft = await db.kvGet('outdoorDraft').catch(() => null);
render(); startGPS();
if (draft?.samples?.length && Date.now() - draft.savedAt < 12 * 3600e3) {
  const s = sheet(`<div class="label">Offene Fahrt</div><h2 class="display" style="font-size:26px;margin:8px 0">${fmtNum(draft.d / 1000, 2)} km · ${fmtTime(draft.moving)}</h2>
    <p class="hint">Die letzte Fahrt wurde nicht beendet (Seite neu geladen oder Akku leer).</p>
    <div class="pfoot col"><button class="btn" id="rGo">Fortsetzen</button><button class="btn ghost" id="rEnd">Beenden und speichern</button><button class="btn danger" id="rDrop">Verwerfen</button></div>`);
  const take = () => { R = { ...fresh(), ...draft, state: 'pause', last: null }; s.remove(); render(); };
  $('#rGo', s).onclick = () => { take(); start(); };
  $('#rEnd', s).onclick = () => { take(); endSheet(); };
  $('#rDrop', s).onclick = () => { db.kvDel('outdoorDraft').catch(() => {}); s.remove(); };
}
if (DEMO && params.has('run')) start();
