import { db, uid } from './db.js';
import { readGoProGPS } from './gpmf.js';
import { buildTrack, improveElevation, parseGPX, STEP } from './track.js';
import { Trainer, HeartRate } from './trainer.js';
import { makeDemoTrack, demoThumb } from './demo.js';
import { makeCoastTrack } from './routes.js';
import { gearsFrom, CASSETTES, parseRings } from './gears.js';
import { profileSVG, drawDetailProfile } from './profile.js';
import { RideSession, simulateRide } from './ride.js';
import { fmtTime, fmtKm, fmtNum, esc, bestAvg } from './util.js';
import { openControllerTest } from './controller.js';
import { stravaExport } from './tcx.js';

const $ = s => document.querySelector(s);
const main = $('#main');

export const state = {
  settings: { riderKg: 75, bikeKg: 8.5, ftp: 250, cadence: 90, shiftMode: 'real', chainrings: '50,34', cassette: '11-34', wheel: 2105, realGear: '50x17', profileDone: false, difficulty: 100, downhill: 50, accent: 'orange', muteVideo: true, improveEle: true, ghost: 'best' },
  routes: [],
  rides: [],
  trainer: new Trainer(),
  hr: null,
  view: 'library',
};

const ACCENTS = { orange: '#ff5a1f', volt: '#d9ff3f', violet: '#8b6cff' };

// ---------------- built-in routes (no video) ----------------
const builtins = {};
const BUILTIN = {
  coast: () => { const track = makeCoastTrack(); return { id: 'coast', name: 'Felsenküste', place: 'Schwellen-Intervalle · 4 Anstiege 8–12 min · Mittelalter-Dörfer am Meer', source: 'demo', parts: [], track, createdAt: 1, thumb: demoThumb(track, 1200) }; },
  demo: () => { const track = makeDemoTrack(); return { id: 'demo', name: 'Passo Demo', place: 'Eingebaute Demo-Strecke · ohne Video', source: 'demo', parts: [], track, createdAt: 0, thumb: demoThumb(track) }; },
};
function getBuiltin(id) { return builtins[id] ||= BUILTIN[id](); }
function getDemoRoute() { return getBuiltin('demo'); }

// ---------------- boot ----------------
async function boot() {
  const saved = await db.kvGet('settings').catch(() => null);
  if (saved) Object.assign(state.settings, saved);
  const params = new URLSearchParams(location.search);
  if (params.get('accent')) state.settings.accent = params.get('accent');
  applyAccent();
  await reload();
  if (params.has('seed')) await seedDemoRides();
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.view)));
  $('#trainerPill').addEventListener('click', connectTrainer);
  $('#hrPill').addEventListener('click', connectHR);
  state.trainer.addEventListener('status', updateTrainerPill);
  $('#fileInput').addEventListener('change', e => { importFiles([...e.target.files]); e.target.value = ''; });
  document.addEventListener('dragover', e => { e.preventDefault(); document.querySelector('.add-card')?.classList.add('drag'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.querySelector('.add-card')?.classList.remove('drag'); });
  document.addEventListener('drop', e => { e.preventDefault(); document.querySelector('.add-card')?.classList.remove('drag'); if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]); });
  updateTrainerPill();
  const v = params.get('view');
  if (v === 'detail') go('detail', params.get('id') || 'demo');
  else if (v === 'ride') startRide(params.get('id') || 'demo', { autopilot: params.has('auto'), at: +params.get('at') || 0 });
  else go(v || 'library');
  if (!state.settings.profileDone && !params.has('noprofile') && v !== 'ride') profileModal();
  db.persist();
}

async function reload() {
  state.routes = (await db.all('routes')).sort((a, b) => b.createdAt - a.createdAt);
  state.rides = (await db.all('rides')).sort((a, b) => b.date - a.date);
}

export async function saveSettings() { await db.kvSet('settings', state.settings); }
function applyAccent() {
  document.documentElement.style.setProperty('--accent', ACCENTS[state.settings.accent] || ACCENTS.orange);
}

function allRoutes() { return [...state.routes, ...Object.keys(BUILTIN).map(getBuiltin)]; }
export function routeById(id) { return BUILTIN[id] ? getBuiltin(id) : state.routes.find(r => r.id === id); }
export function ridesFor(id) { return state.rides.filter(r => r.routeId === id); }
export function bestRide(id) { return ridesFor(id).filter(r => r.complete).sort((a, b) => a.duration - b.duration)[0]; }

export function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------- router ----------------
export function go(view, arg) {
  state.view = view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view || (view === 'detail' && t.dataset.view === 'library')));
  main.scrollTop = 0;
  ({ library, detail, history, settings })[view](arg);
}

// ---------------- library ----------------
function library() {
  const routes = allRoutes();
  main.innerHTML = `
  <section class="view">
    <div class="view-head">
      <div>
        <div class="label">Bibliothek</div>
        <h1 class="display" style="margin-top:14px">Deine<br>Strecken</h1>
        <div class="meta">${routes.length} ${routes.length === 1 ? 'Strecke' : 'Strecken'} · ${fmtKm(routes.reduce((s, r) => s + r.track.length, 0))} km · ${fmtNum(routes.reduce((s, r) => s + r.track.gain, 0))} Höhenmeter</div>
      </div>
      <button class="btn" id="uploadBtn">＋ Strecke hochladen</button>
    </div>
    <div class="grid">
      ${routes.map(card).join('')}
      <button class="add-card" id="addCard">
        <div class="plus">+</div>
        <div><h3 class="display">GoPro-Video<br>hierher ziehen</h3>
        <p>MP4 direkt aus der GoPro mit GPS. Mehrere Kapitel (GX01…, GX02…) einfach zusammen auswählen. Optional mit GPX-Datei.</p></div>
      </button>
    </div>
  </section>`;
  $('#uploadBtn').onclick = $('#addCard').onclick = () => $('#fileInput').click();
  main.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => go('detail', c.dataset.id)));
}

function card(r) {
  const best = bestRide(r.id);
  const t = r.track;
  return `<div class="card" data-id="${r.id}">
    <div class="thumb" style="background-image:url('${r.thumb || ''}')">
      ${best ? `<span class="badge">PB ${fmtTime(best.duration)}</span>` : r.track.intervals ? '<span class="badge">Intervalle</span>' : r.source === 'demo' ? '<span class="badge">Demo</span>' : ''}
      <span class="go"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M7 4l12 8-12 8z" fill="currentColor"/></svg></span>
      ${profileSVG(t)}
    </div>
    <div class="body">
      <h3>${esc(r.name)}</h3>
      <div class="place">${esc(r.place || '')}</div>
      <div class="stats">
        <div class="stat"><div class="label">Distanz</div><div class="v">${fmtKm(t.length)}<small>km</small></div></div>
        <div class="stat"><div class="label">Anstieg</div><div class="v">${fmtNum(t.gain)}<small>hm</small></div></div>
        <div class="stat"><div class="label">Max</div><div class="v">${fmtNum(t.maxGrade, 1)}<small>%</small></div></div>
        <div class="stat"><div class="label">Fahrten</div><div class="v">${ridesFor(r.id).length}</div></div>
      </div>
    </div>
  </div>`;
}

// ---------------- detail ----------------
function detail(id) {
  const r = routeById(id); if (!r) return go('library');
  const t = r.track;
  const rides = ridesFor(id);
  const ranked = rides.filter(x => x.complete).sort((a, b) => a.duration - b.duration);
  const best = ranked[0];
  main.innerHTML = `
  <section class="view">
    <button class="back" id="back">← Alle Strecken</button>
    <div class="detail">
      <div>
        <div class="hero" style="background-image:url('${r.thumb || ''}')"></div>
        <div class="profile-wrap">
          <div class="label" style="margin-bottom:14px">Höhenprofil · ${t.eleSource === 'dem' ? 'Geländemodell' : 'GPS-Höhe'}</div>
          <canvas id="detailProfile"></canvas>
        </div>
      </div>
      <div>
        <div class="label">${esc(r.place || 'Strecke')}</div>
        <h1 class="display" style="margin-top:14px">${esc(r.name)}</h1>
        <div class="bigstats">
          <div><div class="label">Distanz</div><div class="v">${fmtKm(t.length)}<small>km</small></div></div>
          <div><div class="label">Anstieg</div><div class="v">${fmtNum(t.gain)}<small>hm</small></div></div>
          <div><div class="label">Max. Steigung</div><div class="v">${fmtNum(t.maxGrade, 1)}<small>%</small></div></div>
          <div><div class="label">Bestzeit</div><div class="v ${best ? 'accent' : ''}">${best ? fmtTime(best.duration) : '–'}</div></div>
          <div><div class="label">${r.source === 'demo' ? 'Dauer ca.' : 'Video'}</div><div class="v">${fmtTime(t.duration)}</div></div>
          <div><div class="label">Fahrten</div><div class="v">${rides.length}</div></div>
        </div>
        <div class="row-actions">
          <button class="btn" id="rideBtn">Losfahren ▸</button>
          ${t.world ? '<a class="btn ghost" href="preview.html?route=' + id + '">Vorschau ⏩</a>' : ''}
          <div class="field" style="border:0;padding:0;gap:10px">
            <span class="label">Gegner</span>
            <select id="ghostSel" style="width:auto">
              <option value="best">Bestzeit</option><option value="last">Letzte Fahrt</option><option value="none">Keiner</option>
            </select>
          </div>
        </div>
        ${t.intervals ? intervalPlan(t) : ''}
        <h2 class="section" style="margin-top:44px">Deine Zeiten</h2>
        ${ranked.length ? `<table class="table">
          <tr><th class="label">#</th><th class="label">Datum</th><th class="label">Zeit</th><th class="label">Ø Watt</th><th class="label">Ø km/h</th></tr>
          ${ranked.slice(0, 8).map((x, i) => `<tr class="${i === 0 ? 'pb' : ''}"><td class="rank">${i + 1}</td><td>${new Date(x.date).toLocaleDateString('de-DE')}</td><td>${fmtTime(x.duration)}</td><td>${x.avgPower} W</td><td>${fmtNum(x.distance / x.duration * 3.6, 1)}</td></tr>`).join('')}
        </table>` : '<div class="empty">Noch keine komplette Fahrt. Die erste Zeit wird deine Bestzeit.</div>'}
        <div class="row-actions" style="margin-top:32px">
          ${r.source !== 'demo' ? `<button class="btn ghost small" id="renameBtn">Umbenennen</button>
          ${r.track.eleSource !== 'dem' ? '<button class="btn ghost small" id="eleBtn">Höhendaten verbessern</button>' : ''}
          <button class="btn danger small" id="delBtn">Löschen</button>` : ''}
        </div>
      </div>
    </div>
  </section>`;
  $('#back').onclick = () => go('library');
  $('#ghostSel').value = state.settings.ghost;
  $('#ghostSel').onchange = e => { state.settings.ghost = e.target.value; saveSettings(); };
  $('#rideBtn').onclick = () => startRide(id);
  const prof = $('#detailProfile');
  requestAnimationFrame(() => drawDetailProfile(prof, t));
  if ($('#renameBtn')) $('#renameBtn').onclick = async () => {
    const name = prompt('Name der Strecke', r.name); if (!name) return;
    r.name = name; await db.put('routes', r); detail(id);
  };
  if ($('#delBtn')) $('#delBtn').onclick = async () => {
    if (!confirm(`„${r.name}“ mit Video und allen Fahrten löschen?`)) return;
    await db.deleteRoute(id); await reload(); go('library');
  };
  if ($('#eleBtn')) $('#eleBtn').onclick = async () => {
    try { r.track = await improveElevation(r.track); await db.put('routes', r); toast('Höhendaten aus Geländemodell übernommen'); detail(id); }
    catch (e) { toast('Ging nicht: ' + e.message); }
  };
}

// ---------------- history & records ----------------
function history() {
  const rides = state.rides;
  const totalKm = rides.reduce((s, r) => s + r.distance, 0);
  const best20 = Math.max(0, ...rides.map(r => r.best20 || 0));
  const best20Ride = best20 ? rides.find(r => r.best20 === best20) : null;
  const mostGain = rides.slice().sort((a, b) => b.gain - a.gain)[0];
  const longest = rides.slice().sort((a, b) => b.distance - a.distance)[0];
  main.innerHTML = `
  <section class="view">
    <div class="view-head"><div><div class="label">Verlauf</div><h1 class="display" style="margin-top:14px">Fahrten &amp;<br>Rekorde</h1></div></div>
    <div class="records">
      <div class="record"><div class="label">Beste 20 Minuten</div><div class="v">${best20 || '–'}<small>W</small></div><div class="s">${best20Ride ? esc(routeById(best20Ride.routeId)?.name || '') + ' · ' + new Date(best20Ride.date).toLocaleDateString('de-DE') : 'Fahre mind. 20 Minuten'}</div></div>
      <div class="record"><div class="label">Gesamt</div><div class="v">${fmtKm(totalKm)}<small>km</small></div><div class="s">${rides.length} ${rides.length === 1 ? 'Fahrt' : 'Fahrten'} · ${(t => t >= 3600 ? `${Math.floor(t / 3600)} h ${Math.round(t % 3600 / 60)} min` : `${Math.round(t / 60)} min`)(rides.reduce((s, r) => s + r.duration, 0))}</div></div>
      <div class="record"><div class="label">Meiste Höhenmeter</div><div class="v">${mostGain ? fmtNum(mostGain.gain) : '–'}<small>hm</small></div><div class="s">${mostGain ? esc(routeById(mostGain.routeId)?.name || '') : ''}</div></div>
      <div class="record"><div class="label">Längste Fahrt</div><div class="v">${longest ? fmtKm(longest.distance) : '–'}<small>km</small></div><div class="s">${longest ? fmtTime(longest.duration) : ''}</div></div>
    </div>
    <h2 class="section">Alle Fahrten</h2>
    ${rides.length ? `<table class="table">
      <tr><th class="label">Datum</th><th class="label">Strecke</th><th class="label">Zeit</th><th class="label">Distanz</th><th class="label">Höhenmeter</th><th class="label">Ø Watt</th><th class="label">Ø km/h</th><th class="label"></th><th class="label"></th></tr>
      ${rides.map(x => { const pb = bestRide(x.routeId)?.id === x.id; return `<tr class="${pb ? 'pb' : ''}"><td>${new Date(x.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(routeById(x.routeId)?.name || 'Gelöschte Strecke')}</td><td>${fmtTime(x.duration)}</td><td>${fmtKm(x.distance)} km</td><td>${fmtNum(x.gain)} hm</td><td>${x.avgPower} W</td><td>${fmtNum(x.distance / x.duration * 3.6, 1)}</td><td>${pb ? 'BESTZEIT' : x.complete ? '' : '<span style="color:var(--muted)">abgebrochen</span>'}</td><td><button class="btn ghost small strava" data-id="${x.id}">Strava</button></td></tr>`; }).join('')}
    </table>` : '<div class="empty">Noch keine Fahrten. Wähle eine Strecke und fahr los.</div>'}
  </section>`;
  main.querySelectorAll('.strava').forEach(b => b.onclick = () => { const x = rides.find(r => r.id === b.dataset.id); if (x?.samples?.length) stravaExport(x, routeById(x.routeId)?.name || 'Fahrt'); else toast('Diese Fahrt hat keine Messwerte.'); });
}

// ---- form controls: stepper (− value +) with optional "no answer", segmented switch ----
function stepper(id, value, { step = 1, min = 0, max = 9999, unit = '', optional = false } = {}) {
  const none = value == null || value === '';
  return `<div class="stepper-wrap"><div class="stepper ${none ? 'off' : ''}" data-step="${step}" data-min="${min}" data-max="${max}" id="${id}">
    <button type="button" class="sb" data-d="-1" aria-label="weniger">−</button>
    <span class="sv"><input type="text" inputmode="decimal" value="${none ? '' : String(value).replace('.', ',')}" placeholder="–">${unit ? `<small>${unit}</small>` : ''}</span>
    <button type="button" class="sb" data-d="1" aria-label="mehr">+</button></div>
    ${optional ? `<button type="button" class="nochip ${none ? 'on' : ''}" data-for="${id}">Keine Angabe</button>` : ''}</div>`;
}
function wireStepper(root, id, onChange, fallback) {
  const el = root.querySelector('#' + id), inp = el.querySelector('input'), chip = root.querySelector(`.nochip[data-for="${id}"]`);
  const st = +el.dataset.step, min = +el.dataset.min, max = +el.dataset.max;
  const read = () => { const v = parseFloat(inp.value.replace(',', '.')); return isFinite(v) ? Math.max(min, Math.min(max, v)) : null; };
  const set = v => { inp.value = v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ','); el.classList.toggle('off', v == null); chip?.classList.toggle('on', v == null); onChange(v); };
  el.querySelectorAll('.sb').forEach(b => b.onclick = () => { const v = read() ?? fallback; set(Math.max(min, Math.min(max, Math.round((v + st * +b.dataset.d) * 10) / 10))); });
  inp.onchange = () => { const v = read(); if (v == null && !chip) return set(fallback); set(v); };
  if (chip) chip.onclick = () => set(chip.classList.contains('on') ? fallback : null);
}
function seg(id, value, opts) {
  return `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function wireSeg(root, id, onChange) {
  const el = root.querySelector('#' + id);
  el.querySelectorAll('button').forEach(b => b.onclick = () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); onChange(b.dataset.v); });
}
const SHIFT_OPTS = [['real', 'Echt am Rad'], ['virtual', 'Virtuell']];
const LENS_OPTS = [['35', '35 mm'], ['24', '24 mm'], ['0', 'Normal'], ['14', '14 mm'], ['12', '12 mm']];
const VIEW_OPTS = [['0', 'Fahrer'], ['1', 'Verfolger'], ['2', 'Rückblick']];

function shiftHint(m) {
  return m === 'virtual'
    ? 'Rad bleibt in einem Gang. Du schaltest in der App, der KICKR ändert dafür den Widerstand.'
    : 'Du schaltest ganz normal am Rad. Der KICKR macht nur den Widerstand der Steigung, deine Trittfrequenz bestimmst du selbst.';
}

function profileModal() {
  const s = state.settings, tmp = { riderKg: s.riderKg, bikeKg: s.bikeKg, ftp: s.ftp, cadence: s.cadence, shiftMode: s.shiftMode };
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box"><div class="label">Willkommen</div><h2 class="display">Dein Profil</h2>
    <p>Damit Tempo am Berg und Intervall-Ziele stimmen. Was du nicht weißt, lässt du einfach leer. Alles später in den Einstellungen änderbar.</p>
    <div class="form">
      <div class="field"><div>Körpergewicht</div>${stepper('pKg', s.riderKg, { step: 0.5, min: 30, max: 200, unit: 'kg' })}</div>
      <div class="field"><div>Radgewicht</div>${stepper('pBike', s.bikeKg, { step: 0.1, min: 4, max: 30, unit: 'kg' })}</div>
      <div class="field"><div>FTP<div class="hint">Schwellenleistung. Ohne Angabe gibt es keine Watt-Ziele.</div></div>${stepper('pFtp', s.ftp, { step: 5, min: 80, max: 600, unit: 'W', optional: true })}</div>
      <div class="field"><div>Lieblings-Trittfrequenz<div class="hint">Für Schalt-Tipps.</div></div>${stepper('pCad', s.cadence, { step: 1, min: 50, max: 130, unit: 'rpm', optional: true })}</div>
      <div class="field"><div>Schaltung</div>${seg('pShift', s.shiftMode, SHIFT_OPTS)}</div>
    </div>
    <div class="actions"><button class="btn" id="pOk">Speichern</button></div></div>`;
  document.body.append(m);
  wireStepper(m, 'pKg', v => tmp.riderKg = v, 75); wireStepper(m, 'pBike', v => tmp.bikeKg = v, 8.5);
  wireStepper(m, 'pFtp', v => tmp.ftp = v, 250); wireStepper(m, 'pCad', v => tmp.cadence = v, 90);
  wireSeg(m, 'pShift', v => tmp.shiftMode = v);
  m.querySelector('#pOk').onclick = () => { m.querySelectorAll('input').forEach(i => i.onchange?.()); Object.assign(s, tmp, { profileDone: true }); saveSettings(); m.remove(); go(state.view); };
}

function intervalPlan(t) {
  const s = state.settings, lo = Math.round(s.ftp * .95), hi = Math.round(s.ftp * 1.05);
  const goal = s.ftp ? `Ziel: ${lo}–${hi} W (95–105 % deiner FTP von ${s.ftp} W).` : 'Trag in den Einstellungen deine FTP ein, dann zeigt die App dir Watt-Ziele.';
  return `<h2 class="section" style="margin-top:44px">Intervall-Plan</h2>
  <p class="hint" style="margin:6px 0 14px">Jeder Anstieg ist so gebaut, dass er bei Schwelle 8–12 Minuten dauert. ${goal} Dazwischen Abfahrt und flache Küste zum Erholen.</p>
  <table class="table"><tr><th class="label">#</th><th class="label">Anstieg</th><th class="label">ab km</th><th class="label">Länge</th><th class="label">Ø</th><th class="label">Dauer ca.</th></tr>
  ${t.intervals.map((c, i) => `<tr><td class="rank">${i + 1}</td><td>${esc(c.name)}</td><td>${fmtKm(c.from)}</td><td>${fmtKm(c.to - c.from)} km</td><td>${fmtNum(c.grade, 1)} %</td><td>${c.minutes} min</td></tr>`).join('')}
  </table>`;
}

// ---------------- settings ----------------
function settings() {
  const s = state.settings;
  main.innerHTML = `
  <section class="view">
    <div class="view-head"><div><div class="label">Setup</div><h1 class="display" style="margin-top:14px">Einstel&shy;lungen</h1></div></div>
    <div class="settings">
      <div class="panel"><h3>Fahrer</h3>
        <label class="field"><div>Körpergewicht<div class="hint">Wichtig für realistisches Tempo am Berg.</div></div>${stepper('riderKg', s.riderKg, { step: 0.5, min: 30, max: 200, unit: 'kg' })}</label>
        <label class="field"><div>Radgewicht</div>${stepper('bikeKg', s.bikeKg, { step: 0.1, min: 4, max: 30, unit: 'kg' })}</label>
        <label class="field"><div>FTP<div class="hint">Schwellenleistung in Watt. Daraus kommen die Zielbereiche in den Intervallen.</div></div>${stepper('ftp', s.ftp, { step: 5, min: 80, max: 600, unit: 'W', optional: true })}</label>
        <label class="field"><div>Lieblings-Trittfrequenz<div class="hint">Die App sagt dir, wann du leichter oder schwerer schalten solltest.</div></div>${stepper('cadence', s.cadence, { step: 1, min: 50, max: 130, unit: 'rpm', optional: true })}</label>
      </div>
      <div class="panel"><h3>Schaltung</h3>
        <label class="field"><div>Modus<div class="hint" id="shiftHint">${shiftHint(s.shiftMode)}</div></div>
          ${seg('shiftMode', s.shiftMode, SHIFT_OPTS)}</label>
        <label class="field"><div>Kettenblätter</div><input type="text" id="chainrings" value="${esc(s.chainrings)}" style="width:110px"></label>
        <label class="field"><div>Kassette</div><select id="cassette" style="width:auto">${Object.keys(CASSETTES).map(k => `<option ${k === s.cassette ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="field" id="realGearRow" ${s.shiftMode === 'virtual' ? '' : 'hidden'}><div>Gang am Rad (bleibt fest)<div class="hint">Leg diesen Gang am Rad ein und schalte nur noch virtuell: Tasten Q/E, Gamepad LB/RB, später Di2-Knöpfe.</div></div><input type="text" id="realGear" value="${esc(s.realGear)}" style="width:110px"></label>
        <label class="field"><div>Radumfang<div class="hint">mm, 700×28c = 2136, 700×25c = 2105</div></div>${stepper('wheel', s.wheel, { step: 1, min: 1500, max: 2400, unit: 'mm' })}</label>
        <div class="field"><div>Gänge<div class="hint">${gearsFrom(s).map(g => g.f + '×' + g.r).join(' · ')}</div></div></div>
      </div>
      <div class="panel"><h3>Trainer</h3>
        <label class="field"><div>Realismus Steigung <b id="diffV">${s.difficulty}%</b><div class="hint">100 % = echte Steigung. 50 % = Steigungen fühlen sich halb so steil an.</div></div><input type="range" id="difficulty" min="0" max="100" step="5" value="${s.difficulty}"></label>
        <label class="field"><div>Abfahrten <b id="downV">${s.downhill}%</b><div class="hint">Wie stark der Trainer bergab entlastet.</div></div><input type="range" id="downhill" min="0" max="100" step="5" value="${s.downhill}"></label>
        <div class="field"><div>Controller testen<div class="hint">Z. B. Di2-Zusatzknöpfe (D-FLY), Zwift Click, Gamepad. Zeigt, was die Knöpfe senden.</div></div><button class="btn ghost small" id="ctBtn">Testen</button></div>
        <div class="field"><div>Herzfrequenz-Gurt<div class="hint">Optional, per Bluetooth.</div></div><div style="display:flex;gap:8px"><button class="btn ghost small" id="hrAll" title="Wenn der Gurt in der normalen Suche fehlt">Alle Geräte</button><button class="btn ghost small" id="hrBtn">${state.hr?.connected ? 'Verbunden' : 'Verbinden'}</button></div></div>
      </div>
      <div class="panel"><h3>Video &amp; Daten</h3>
        <label class="field"><div>Video-Ton aus</div><input type="checkbox" class="toggle" id="muteVideo" ${s.muteVideo ? 'checked' : ''}></label>
        <label class="field"><div>Höhendaten verbessern<div class="hint">Beim Import Höhe aus Geländemodell holen (Open-Meteo). GoPro-Höhe ist ungenau.</div></div><input type="checkbox" class="toggle" id="improveEle" ${s.improveEle ? 'checked' : ''}></label>
        <div class="field"><div>Speicher<div class="hint" id="usage">…</div></div></div>
      </div>
      <div class="panel"><h3>Ansicht 3D-Welt</h3>
        <label class="field"><div>Sichtfeld (Brennweite)<div class="hint">Kleinere mm = weiter Blick. Normal entspricht ca. 17 mm. Während der Fahrt: Tasten [ und ].</div></div>${seg('lensMm', String(s.lensMm || 0), LENS_OPTS)}</label>
        <label class="field"><div>Lenker im Bild<div class="hint">Rennlenker mit Griffen und Unterarmen in der Fahrersicht.</div></div><input type="checkbox" class="toggle" id="cockpit" ${s.cockpit !== false ? 'checked' : ''}></label>
        <label class="field"><div>Kamera<div class="hint">Während der Fahrt umschalten mit Taste V oder dem Kamera-Knopf.</div></div>${seg('view3d', String(s.view3d || 0), VIEW_OPTS)}</label>
      </div>
      <div class="panel"><h3>Design</h3>
        <div class="field"><div>Akzentfarbe</div><div class="swatches">${Object.entries(ACCENTS).map(([k, c]) => `<button class="swatch ${s.accent === k ? 'on' : ''}" data-acc="${k}" style="background:${c}"></button>`).join('')}</div></div>
      </div>
      <div class="panel"><h3>Quellen</h3>
        <div class="field"><div>Gelände Lofoten<div class="hint">Höhenmodell DTM 10 © Kartverket, CC BY 4.0. Fernes Gelände: Terrain Tiles (Mapzen / AWS Open Data).</div></div></div>
        <div class="field"><div>Satellitenfarben<div class="hint">Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0.</div></div></div>
        <div class="field"><div>3D-Grafik<div class="hint">three.js (MIT). Boden-Texturen Poly Haven (CC0). Figuren und Gebäude teils Quaternius (CC0), teils eigene Blender- und KI-Modelle.</div></div></div>
      </div>
    </div>
  </section>`;
  const num = (id, key) => $('#' + id).addEventListener('change', e => { s[key] = +e.target.value; saveSettings(); });
  const stp = (id, key, fb) => wireStepper(main, id, v => { s[key] = v; saveSettings(); }, fb);
  stp('riderKg', 'riderKg', 75); stp('bikeKg', 'bikeKg', 8.5); stp('ftp', 'ftp', 250); stp('cadence', 'cadence', 90); stp('wheel', 'wheel', 2105);
  $('#cockpit').onchange = e => { s.cockpit = e.target.checked; saveSettings(); };
  wireSeg(main, 'lensMm', v => { s.lensMm = +v; saveSettings(); });
  wireSeg(main, 'view3d', v => { s.view3d = +v; saveSettings(); });
  wireSeg(main, 'shiftMode', v => { s.shiftMode = v; saveSettings(); settings(); });
  $('#cassette').onchange = e => { s.cassette = e.target.value; saveSettings(); settings(); };
  const valid = { chainrings: v => parseRings(v), realGear: v => { const m = String(v).match(/^\s*(\d+)\s*[x×/\- ]\s*(\d+)\s*$/); return !!m && +m[1] >= 20 && +m[1] <= 60 && +m[2] >= 9 && +m[2] <= 40; } };
  const txt = (id) => $('#' + id).addEventListener('change', e => {
    if (!valid[id](e.target.value)) { toast(id === 'chainrings' ? 'Kettenblätter bitte als Zahlen, z. B. 50,34' : 'Gang bitte so: 50x17', 3500); e.target.value = s[id]; return; }
    s[id] = e.target.value; saveSettings(); settings(); });
  txt('chainrings'); txt('realGear');
  $('#difficulty').oninput = e => { s.difficulty = +e.target.value; $('#diffV').textContent = s.difficulty + '%'; saveSettings(); };
  $('#downhill').oninput = e => { s.downhill = +e.target.value; $('#downV').textContent = s.downhill + '%'; saveSettings(); };
  $('#muteVideo').onchange = e => { s.muteVideo = e.target.checked; saveSettings(); };
  $('#improveEle').onchange = e => { s.improveEle = e.target.checked; saveSettings(); };
  main.querySelectorAll('.swatch').forEach(b => b.onclick = () => { s.accent = b.dataset.acc; applyAccent(); saveSettings(); settings(); });
  $('#hrBtn').onclick = () => connectHR(false); $('#hrAll').onclick = () => connectHR(true);
  $('#ctBtn').onclick = openControllerTest;
  db.usage().then(u => { if (u) $('#usage').textContent = `${fmtNum(u.usage / 1e9, 1)} GB belegt von ${fmtNum(u.quota / 1e9, 0)} GB verfügbar`; });
}

// ---------------- trainer ----------------
async function connectTrainer() {
  const t = state.trainer;
  if (!Trainer.supported()) return toast('Bluetooth geht nur in Chrome oder Edge.', 4000);
  if (t.connected) { if (confirm('Trainer trennen?')) t.disconnect(); return; }
  try { await t.connect(); await t.setSim({ riderKg: state.settings.riderKg, bikeKg: state.settings.bikeKg, crr: 0.004, cw: 0.51 }); }
  catch (e) { if (e.name !== 'NotFoundError') toast('Verbindung fehlgeschlagen: ' + e.message, 4000); updateTrainerPill(); }
}
function updateTrainerPill() {
  const t = state.trainer, pill = $('#trainerPill');
  const on = t.connected;
  pill.classList.toggle('on', on);
  pill.querySelector('.t').innerHTML = on ? `✓ ${esc(t.device.name || 'Trainer')} verbunden <span class="sub">${t.mode === 'ftms' ? 'FTMS' : t.mode === 'wahoo' ? 'Wahoo' : 'nur Watt'}</span>` : 'KICKR verbinden';
  pill.title = on ? 'Verbunden. Klicken zum Trennen.' : 'Trainer per Bluetooth verbinden';
}
function updateHrPill() { // heart rate strap: its own Bluetooth connection, runs alongside the KICKR
  const h = state.hr, on = !!h?.connected, pill = $('#hrPill');
  pill.classList.toggle('on', on);
  pill.querySelector('.t').textContent = on ? (h.hr ? `♥ ${h.hr} · verbunden` : '♥ verbunden') : 'Puls verbinden';
}
async function connectHR(all) {
  if (all instanceof Event) all = false;
  if (state.hr?.connected) { if (confirm('Pulsgurt trennen?')) { state.hr.device.gatt.disconnect(); updateHrPill(); } return; }
  try { state.hr = new HeartRate(); state.hr.addEventListener('hr', updateHrPill); await state.hr.connect(!!all); updateHrPill(); toast('Pulsgurt verbunden');
    state.hr.device.addEventListener('gattserverdisconnected', updateHrPill); if (document.querySelector('#hrBtn')) settings(); }
  catch (e) {
    if (e.name !== 'NotFoundError') return toast('Pulsgurt: ' + e.message);
    // nothing picked: most often the strap is asleep (not worn) or still paired with a watch/phone/bike computer
    if (!all) toast('Kein Gurt gewählt? Gurt anlegen, Elektroden anfeuchten (er sendet nur getragen) und Bluetooth an Uhr/Handy/Radcomputer kurz aus. In den Einstellungen gibt es „Alle Geräte“.', 7000);
  }
}

// ---------------- import ----------------
function gpChapterKey(name) {
  // GoPro: GX010123.MP4 -> chapter 01, file 0123 ; GOPR0123 / GP010123 for older models
  const m = name.match(/^G[XHOP][A-Z]?(\d{2})(\d{4})/i) || name.match(/^GOPR(\d{4})/i);
  if (!m) return name;
  return m.length === 3 ? `${m[2]}-${m[1]}` : `${m[1]}-00`;
}

async function importFiles(files) {
  const videos = files.filter(f => /\.(mp4|mov)$/i.test(f.name)).sort((a, b) => gpChapterKey(a.name).localeCompare(gpChapterKey(b.name)));
  const gpx = files.find(f => /\.gpx$/i.test(f.name));
  if (!videos.length) return toast('Bitte ein Video (MP4) auswählen.');
  const modal = document.createElement('div'); modal.className = 'modal';
  modal.innerHTML = `<div class="box"><div class="label">Import</div><h2 class="display" style="margin-top:10px">Strecke wird<br>eingelesen</h2>
    <p id="impStep">GPS-Daten lesen…</p><div class="bar"><div id="impBar"></div></div><p id="impInfo" class="num"></p></div>`;
  document.body.append(modal);
  const setP = (txt, p) => { modal.querySelector('#impStep').textContent = txt; modal.querySelector('#impBar').style.width = Math.round(p * 100) + '%'; };
  try {
    const parts = []; let offset = 0; let points = []; let fps = 0;
    for (let i = 0; i < videos.length; i++) {
      const f = videos[i];
      const info = await readGoProGPS(f, p => setP(`GPS lesen: ${f.name}`, (i + p) / videos.length * 0.5));
      const duration = info.duration || await probeDuration(f);
      fps = fps || info.fps;
      parts.push({ file: f, name: f.name, duration, offset });
      points.push(...info.points.map(p => ({ ...p, t: p.t + offset })));
      offset += duration;
    }
    if (gpx) points = parseGPX(await gpx.text());
    if (points.length < 5) throw new Error('In dem Video sind keine GPS-Daten. Bei der GoPro GPS einschalten oder eine GPX-Datei dazu legen.');
    setP('Strecke berechnen…', 0.55);
    let track = buildTrack(points);
    if (state.settings.improveEle) {
      try { track = await improveElevation(track, p => setP('Höhendaten aus Geländemodell…', 0.55 + p * 0.15)); } catch { /* offline: keep GPS altitude */ }
    }
    setP('Vorschaubild…', 0.72);
    const thumb = await makeThumb(parts[0].file, Math.min(parts[0].duration * 0.15, 30));
    const place = await guessPlace(track).catch(() => '');
    modal.querySelector('#impInfo').textContent = `${fmtKm(track.length)} km · ${fmtNum(track.gain)} hm · ${fmtTime(track.duration)} Video · ${Math.round(fps)} fps`;
    const name = await askName(modal, videos[0].name.replace(/\.[^.]+$/, ''), place);
    if (name === null) { modal.remove(); return; }
    setP('Video speichern (kann bei großen Dateien dauern)…', 0.8);
    const route = { id: uid(), name, place, createdAt: Date.now(), source: 'gopro', fps, thumb, track, parts: [] };
    for (const p of parts) {
      const videoId = uid();
      await db.put('videos', { id: videoId, blob: p.file, name: p.name, type: p.file.type || 'video/mp4' });
      route.parts.push({ videoId, name: p.name, duration: p.duration, offset: p.offset });
    }
    await db.put('routes', route);
    setP('Fertig', 1);
    await reload(); modal.remove(); go('detail', route.id);
  } catch (e) {
    console.error(e);
    modal.querySelector('.box').innerHTML = `<div class="label">Import</div><h2 class="display" style="margin-top:10px">Hat nicht<br>geklappt</h2><p>${esc(e.message)}</p><div class="actions"><button class="btn small">OK</button></div>`;
    modal.querySelector('button').onclick = () => modal.remove();
  }
}

function askName(modal, def, place) {
  return new Promise(res => {
    const box = modal.querySelector('.box');
    const info = modal.querySelector('#impInfo').textContent;
    box.innerHTML = `<div class="label">Fast fertig</div><h2 class="display" style="margin-top:10px">Wie heißt<br>die Strecke?</h2><p class="num">${info}</p>
      <div class="field" style="border:0;margin-top:18px"><input type="text" id="nm" value="${esc(place ? place.split(',')[0] : def)}"></div>
      <div class="bar"><div id="impBar" style="width:75%"></div></div><p id="impStep"></p><p id="impInfo"></p>
      <div class="actions"><button class="btn ghost small" id="cancel">Abbrechen</button><button class="btn small" id="ok">Speichern</button></div>`;
    box.querySelector('#nm').select();
    box.querySelector('#ok').onclick = () => res(box.querySelector('#nm').value.trim() || def);
    box.querySelector('#cancel').onclick = () => res(null);
    box.querySelector('#nm').onkeydown = e => { if (e.key === 'Enter') box.querySelector('#ok').click(); };
  });
}

function probeDuration(file) {
  return new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.src = URL.createObjectURL(file); v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); }; v.onerror = () => res(0); });
}
function makeThumb(file, at) {
  return new Promise(res => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
    const done = d => { URL.revokeObjectURL(v.src); res(d); };
    v.onloadeddata = () => { v.currentTime = at; };
    v.onseeked = () => { const c = document.createElement('canvas'); c.width = 960; c.height = Math.round(960 * v.videoHeight / v.videoWidth) || 540; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); done(c.toDataURL('image/jpeg', 0.82)); };
    v.onerror = () => done('');
    setTimeout(() => done(''), 15000);
  });
}
async function guessPlace(track) {
  const i = Math.floor(track.lat.length / 2);
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&accept-language=de&lat=${track.lat[i]}&lon=${track.lon[i]}`);
  const j = await r.json(); const a = j.address || {};
  return [a.village || a.town || a.city || a.municipality || a.county, a.state, a.country].filter(Boolean).join(', ');
}

// ---------------- ride ----------------
let session = null;
async function startRide(id, opts = {}) {
  const route = routeById(id); if (!route) return;
  const rides = ridesFor(id);
  let ghost = null;
  if (state.settings.ghost === 'best') ghost = bestRide(id);
  if (state.settings.ghost === 'last') ghost = rides.filter(r => r.complete)[0];
  session = new RideSession({ route, ghost, state, ...opts, onExit: async saved => { session = null; await reload(); if (saved) go('detail', id); else go(state.view === 'detail' ? 'detail' : state.view, id); } });
  await session.start();
}

// ---------------- screenshot seed ----------------
async function seedDemoRides() {
  if (state.rides.some(r => r.routeId === 'demo')) return;
  const t = getDemoRoute().track;
  const mk = (daysAgo, pw) => { const sim = simulateRide(t, pw, state.settings); return { id: uid(), routeId: 'demo', date: Date.now() - daysAgo * 864e5, duration: sim.duration, distance: Math.round(t.length), gain: t.gain, avgPower: pw, maxPower: pw + 140, best5: pw + 22, best20: pw + 6, complete: true, samples: sim.samples }; };
  for (const r of [mk(2, 238), mk(9, 226), mk(16, 214), mk(23, 205)]) await db.put('rides', r);
  await reload();
}

boot();
