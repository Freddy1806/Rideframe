// RIDEFRAME Pure: the phone mode. No map, no video, no world: connect the trainer, set watts (ERG), a grade or a workout,
// and read every number big, like a bike computer. Portrait first. Rides land in the same history (routeId 'pure').
import { Trainer, HeartRate } from './trainer.js';
import { db, uid } from './db.js';
import { fmtTime, fmtNum, esc, bestAvg } from './util.js';
import { allWorkouts, workoutById, workoutAt, workoutDuration, workoutSVG, setMyWorkouts } from './workouts.js';
import { defaultParams, step } from './physics.js';
import { stravaStatus, stravaConnect, stravaUpload } from './stravaup.js';
import { stravaExport } from './tcx.js';

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search), DEMO = params.has('demo');
const S = { riderKg: 75, bikeKg: 8.5, ftp: 250, accent: 'orange' };
const P = { tiles: ['cad', 'hr', 'time', 'dist', 'speed', 'avg', 'np', 'kj', 'lapTime', 'lapAvg', 'max', 'tss'], smooth: 3, autoPause: true, erg: 200, grade: 0, mode: 'erg', workout: '' };
const ACCENTS = { orange: '#ff5a1f', violet: '#8b6cff', lime: '#c6f432', cyan: '#2fd3e0', pink: '#ff4f9a' };

const trainer = new Trainer(), hrStrap = new HeartRate();
const R = { state: 'ready', moving: 0, wall: 0, d: 0, v: 0, kj: 0, samples: [], pw: [], laps: [], lap: null, max: 0, hrMax: 0, wT: 0, wDone: false, intensity: 100, lastSec: 0, idle: 0, roll30: [], np4: 0, npN: 0 };
const live = { power: 0, cad: 0, hr: 0, buf: [] };
let wake = null, demoW = 0;

// ---------------- settings ----------------
async function loadSettings() {
  const saved = await db.kvGet('settings').catch(() => null);
  if (saved) Object.assign(S, saved);
  Object.assign(P, S.pure || {});
  setMyWorkouts(S.myWorkouts);
  document.documentElement.style.setProperty('--accent', ACCENTS[S.accent] || ACCENTS.orange);
}
async function saveSettings() {
  const saved = (await db.kvGet('settings').catch(() => null)) || {}; // keep everything the main app stored
  saved.pure = { ...P }; saved.ftp = S.ftp; saved.riderKg = S.riderKg; saved.bikeKg = S.bikeKg;
  await db.kvSet('settings', saved).catch(() => {});
}

// ---------------- metrics ----------------
const ftp = () => S.ftp || 200;
const avgP = () => R.pw.length ? R.pw.reduce((a, b) => a + b, 0) / R.pw.length : 0;
const NP = () => R.npN ? Math.pow(R.np4 / R.npN, 0.25) : avgP();
const IF = () => NP() / ftp();
const lapNow = () => R.lap ? { t: R.moving - R.lap.t, d: R.d - R.lap.d, w: R.lap.n ? R.lap.sum / R.lap.n : 0 } : { t: 0, d: 0, w: 0 };
const shown = () => { const n = Math.max(1, Math.min(P.smooth, live.buf.length)); return live.buf.length ? live.buf.slice(-n).reduce((a, b) => a + b, 0) / n : live.power; };
const ZONES = [[55, 'Z1', '#6b7480'], [75, 'Z2', '#2f8fe0'], [90, 'Z3', '#2fb36b'], [105, 'Z4', '#f2b630'], [120, 'Z5', '#ff8a1f'], [150, 'Z6', '#ff4f3c'], [1e9, 'Z7', '#c43cff']];
const zoneOf = w => ZONES.find(z => w / ftp() * 100 < z[0]);
const M = {
  cad: { l: 'Trittfrequenz', u: 'rpm', v: () => Math.round(live.cad) },
  hr: { l: 'Puls', u: 'bpm', v: () => live.hr || '–' },
  time: { l: 'Fahrzeit', u: '', v: () => fmtTime(R.moving) },
  wall: { l: 'Gesamtzeit', u: '', v: () => fmtTime(R.wall) },
  dist: { l: 'Strecke', u: 'km', v: () => fmtNum(R.d / 1000, 2) },
  speed: { l: 'Tempo', u: 'km/h', v: () => fmtNum(R.v * 3.6, 1) },
  avgSpeed: { l: 'Ø Tempo', u: 'km/h', v: () => fmtNum(R.moving ? R.d / R.moving * 3.6 : 0, 1) },
  avg: { l: 'Ø Leistung', u: 'W', v: () => Math.round(avgP()) },
  np: { l: 'NP', u: 'W', v: () => Math.round(NP()) },
  max: { l: 'Max Leistung', u: 'W', v: () => R.max },
  kj: { l: 'Arbeit', u: 'kJ', v: () => Math.round(R.kj) },
  kcal: { l: 'Kalorien', u: 'kcal', v: () => Math.round(R.kj * 1.1) },
  tss: { l: 'TSS', u: '', v: () => Math.round(R.moving * NP() * IF() / (ftp() * 3600) * 100) },
  if: { l: 'IF', u: '', v: () => fmtNum(IF(), 2) },
  wkg: { l: 'W/kg', u: '', v: () => fmtNum(shown() / (S.riderKg || 75), 1) },
  pct: { l: '% FTP', u: '%', v: () => Math.round(shown() / ftp() * 100) },
  zone: { l: 'Zone', u: '', v: () => zoneOf(shown())[1] },
  lapTime: { l: 'Runde Zeit', u: '', v: () => fmtTime(lapNow().t) },
  lapAvg: { l: 'Runde Ø', u: 'W', v: () => Math.round(lapNow().w) },
  lapDist: { l: 'Runde km', u: 'km', v: () => fmtNum(lapNow().d / 1000, 2) },
  laps: { l: 'Runde', u: '', v: () => R.laps.length + 1 },
  best5: { l: 'Beste 5 min', u: 'W', v: () => bestAvg(R.pw, 300) || '–' },
  best20: { l: 'Beste 20 min', u: 'W', v: () => bestAvg(R.pw, 1200) || '–' },
  hrMax: { l: 'Max Puls', u: 'bpm', v: () => R.hrMax || '–' },
  target: { l: 'Ziel', u: 'W', v: () => targetW() ?? '–' },
  clock: { l: 'Uhrzeit', u: '', v: () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) },
};

// ---------------- control ----------------
const work = () => P.mode === 'work' ? workoutById(P.workout) : null;
const wAt = () => { const w = work(); return w ? workoutAt(w, R.wT, ftp()) : null; };
function targetW() {
  if (P.mode === 'erg') return P.erg;
  const a = wAt(); return a && !a.done ? Math.round(a.target * R.intensity / 100) : null;
}
function applyTrainer() {
  const t = targetW();
  if (P.mode === 'grade' || t == null) { trainer.setPower(null); trainer.setGrade(P.mode === 'grade' ? P.grade : 0); }
  else trainer.setPower(t);
}
function setMode(m) {
  P.mode = m; if (m === 'work' && !workoutById(P.workout)) P.workout = allWorkouts()[0]?.id || '';
  if (m === 'grade') { trainer.setPower(null); trainer.setGrade(P.grade, true); }
  saveSettings(); render(); applyTrainer();
}

// ---------------- ride loop ----------------
function tick(dt) {
  if (DEMO) { // fake rider: follows the target with a little noise, so the screen can be tested without a trainer
    const t = targetW() ?? 150 + P.grade * 25; demoW += (t - demoW) * Math.min(1, dt * 1.5);
    live.power = Math.max(0, Math.round(demoW + (Math.random() - .5) * 14)); live.cad = 88 + Math.round((Math.random() - .5) * 6); live.hr = 120 + Math.round(demoW / 8);
  }
  if (R.state !== 'run') return;
  const pedal = live.power > 0 || live.cad > 0;
  R.idle = pedal ? 0 : R.idle + dt;
  const counting = !P.autoPause || R.idle < 3;
  R.wall += dt;
  const pp = defaultParams(S);
  R.v = step(R.v, live.power, P.mode === 'grade' ? P.grade : 0, dt, pp);
  if (!counting) { R.v = 0; return; }
  R.moving += dt; R.d += R.v * dt; R.kj += live.power * dt / 1000;
  if (P.mode === 'work' && !R.wDone) { R.wT += dt; const a = wAt(); if (a?.done) { R.wDone = true; flash('Workout geschafft. Weiter frei fahren oder beenden.'); P.mode = 'erg'; P.erg = Math.round(ftp() * .5); render(); } }
  if (Math.floor(R.moving) > R.lastSec) { // one sample per second
    R.lastSec = Math.floor(R.moving);
    const w = Math.round(live.power); R.pw.push(w); R.max = Math.max(R.max, w); R.hrMax = Math.max(R.hrMax, live.hr || 0);
    R.roll30.push(w); if (R.roll30.length > 30) R.roll30.shift();
    if (R.roll30.length === 30) { const a = R.roll30.reduce((x, y) => x + y, 0) / 30; R.np4 += a ** 4; R.npN++; }
    R.lap.sum += w; R.lap.n++;
    R.samples.push([R.lastSec, Math.round(R.d), w, Math.round(R.v * 36) / 10, Math.round(live.cad) || 0, live.hr || 0]);
  }
}

function start() {
  if (R.state === 'ready') { R.lap = { t: 0, d: 0, sum: 0, n: 0 }; R.startAt = Date.now(); }
  R.state = 'run'; lockScreen(); applyTrainer(); render();
}
function pause() { R.state = 'pause'; render(); }
function lap() {
  if (R.state !== 'run') return;
  const l = lapNow(); R.laps.push({ t: Math.round(l.t), d: Math.round(l.d), w: Math.round(l.w) });
  R.lap = { t: R.moving, d: R.d, sum: 0, n: 0 }; flash(`Runde ${R.laps.length}: ${fmtTime(l.t)} · Ø ${Math.round(l.w)} W`);
}
function record() {
  const pw = R.pw, w = work();
  return { id: uid(), routeId: 'pure', date: Date.now(), complete: true, duration: Math.round(R.moving), distance: Math.round(R.d), gain: 0, startD: 0,
    workout: w?.name || (P.mode === 'grade' ? 'Steigung' : 'ERG'), avgPower: Math.round(avgP()), maxPower: Math.max(0, ...pw), best5: bestAvg(pw, 300), best20: bestAvg(pw, 1200),
    np: Math.round(NP()), kj: Math.round(R.kj), laps: R.laps.length ? [...R.laps, { t: Math.round(lapNow().t), d: Math.round(lapNow().d), w: Math.round(lapNow().w) }] : undefined, samples: R.samples };
}

// ---------------- screen ----------------
const el = document.getElementById('pure');
function flash(t) { const f = $('#pflash'); if (!f) return; f.textContent = t; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), 3500); }
async function lockScreen() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R.state === 'run') lockScreen(); });
window.addEventListener('beforeunload', e => { if (R.samples.length && R.state !== 'done') { e.preventDefault(); e.returnValue = ''; } });

function control() {
  if (P.mode === 'erg') return `<div class="pctl"><button data-d="-25">−25</button><button data-d="-5">−5</button><button class="pval" id="pSet"><b>${P.erg}</b><small>W</small></button><button data-d="5">+5</button><button data-d="25">+25</button></div>`;
  if (P.mode === 'grade') return `<div class="pctl"><button data-d="-1">−1</button><button data-d="-0.5">−½</button><button class="pval" id="pSet"><b>${fmtNum(P.grade, 1)}</b><small>%</small></button><button data-d="0.5">+½</button><button data-d="1">+1</button></div>`;
  const w = work();
  return `<div class="pwork"><select id="pWork">${allWorkouts().map(x => `<option value="${x.id}" ${x.id === P.workout ? 'selected' : ''}>${x.mine ? '★ ' : ''}${esc(x.name)} · ${Math.round(workoutDuration(x) / 60)} min</option>`).join('')}</select>
    <div class="pctl small"><button data-i="-5">−5 %</button><span class="pint" id="pInt">${R.intensity} %</span><button data-i="5">+5 %</button></div></div>
    ${w ? `<div class="pwsvg" id="pWsvg">${workoutSVG(w, R.wT, 40)}</div><div class="pstep" id="pStep"></div>` : ''}`;
}

function render() {
  if (R.state === 'done') return;
  const bt = !trainer.connected && !DEMO, bleOk = Trainer.supported();
  el.innerHTML = `
  <header class="ptop">
    <a class="pback" href="./" title="Zur App">‹</a><div class="pbrand"><b>RIDEFRAME </b><span>Pure</span></div>
    <button class="ppill ${trainer.connected || DEMO ? 'on' : ''}" id="pTr"><i></i>${DEMO ? 'Demo' : trainer.connected ? esc(trainer.device?.name || 'Trainer') : 'Trainer'}</button>
    <button class="ppill ${hrStrap.connected ? 'on' : ''}" id="pHr"><i></i>Puls</button>
    <button class="pgear" id="pSetBtn" title="Einstellungen">⚙</button>
  </header>
  ${!bleOk && !DEMO ? `<div class="pnote">Dieser Browser kann kein Bluetooth. Android: Chrome. iPhone: die kostenlose App <b>Bluefy</b> öffnen und diese Seite dort laden.</div>` : ''}
  <section class="pbig" id="pBig">
    <div class="label">Leistung ${P.smooth > 1 ? `· ${P.smooth} s` : ''}</div>
    <div class="pbigv"><b id="pPow">0</b><small>W</small></div>
    <div class="pbigs"><span id="pTarget"></span><span id="pZone"></span></div>
    <div class="pzbar"><i id="pZbar"></i></div>
  </section>
  <section class="ptiles">${P.tiles.map((k, i) => `<button class="ptile" data-t="${i}"><span class="label">${M[k]?.l || k}</span><b data-k="${k}">–</b><small>${M[k]?.u || ''}</small></button>`).join('')}</section>
  <section class="pmode">
    <div class="pseg">${[['erg', 'ERG'], ['grade', 'Steigung'], ['work', 'Workout']].map(([k, n]) => `<button class="${P.mode === k ? 'on' : ''}" data-m="${k}">${n}</button>`).join('')}</div>
    ${control()}
  </section>
  <footer class="pfoot">
    ${R.state === 'run' ? `<button class="btn ghost" id="pPause">Pause</button><button class="btn ghost" id="pLap">Runde</button>`
      : `<button class="btn" id="pStart">${R.state === 'pause' ? 'Weiter' : 'Start'}</button>${R.state === 'pause' ? '<button class="btn ghost" id="pEnd">Beenden</button>' : ''}`}
  </footer>
  <div class="pflash" id="pflash"></div>`;
  wire(); paint();
  if (bt && bleOk && R.state === 'ready') flash('Tippe oben auf „Trainer“, um den Rollentrainer zu verbinden.');
}

function wire() {
  $('#pTr').onclick = async () => { if (DEMO) return; try { await trainer.connect(); trainer.setSim({ riderKg: S.riderKg, bikeKg: S.bikeKg, crr: .004, cw: .51 }); applyTrainer(); } catch (e) { if (e.name !== 'NotFoundError') flash(e.message || String(e)); } render(); };
  $('#pHr').onclick = async () => { try { await hrStrap.connect(); } catch (e) { if (e.name !== 'NotFoundError') flash(e.message || String(e)); } render(); };
  $('#pSetBtn').onclick = settingsSheet;
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
    const d = +b.dataset.d;
    if (P.mode === 'erg') P.erg = Math.max(0, Math.min(2000, P.erg + d)); else P.grade = Math.max(-10, Math.min(20, Math.round((P.grade + d) * 2) / 2));
    $('#pSet b').textContent = P.mode === 'erg' ? P.erg : fmtNum(P.grade, 1); applyTrainer(); saveSettings();
  });
  el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { R.intensity = Math.max(50, Math.min(150, R.intensity + +b.dataset.i)); $('#pInt').textContent = R.intensity + ' %'; applyTrainer(); });
  const set = $('#pSet'); if (set) set.onclick = () => numberSheet();
  const ws = $('#pWork'); if (ws) ws.onchange = () => { P.workout = ws.value; R.wT = 0; R.wDone = false; saveSettings(); render(); applyTrainer(); };
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => tileSheet(+b.dataset.t));
  const on = (id, f) => { const x = $(id); if (x) x.onclick = f; };
  on('#pStart', start); on('#pPause', pause); on('#pLap', lap); on('#pEnd', endSheet);
}

function paint() {
  if (R.state === 'done' || !$('#pPow')) return;
  const w = shown(), z = zoneOf(w), t = targetW();
  $('#pPow').textContent = Math.round(w);
  $('#pTarget').textContent = t != null ? `Ziel ${t} W` : P.mode === 'grade' ? `Steigung ${fmtNum(P.grade, 1)} %` : '';
  $('#pZone').textContent = `${z[1]} · ${Math.round(w / ftp() * 100)} % FTP`;
  $('#pZbar').style.cssText = `width:${Math.min(100, w / ftp() / 1.5 * 100)}%;background:${z[2]}`;
  $('#pBig').style.setProperty('--z', z[2]);
  if (t !== paint.t) { paint.t = t; paint.at = performance.now(); } // red frame only once the trainer had time to reach a new target
  $('#pBig').classList.toggle('off', t != null && performance.now() - paint.at > 8000 && Math.abs(w - t) > Math.max(15, t * .08) && R.state === 'run');
  el.querySelectorAll('[data-k]').forEach(b => { const v = M[b.dataset.k]?.v(); if (b.textContent !== String(v)) b.textContent = v; });
  const a = wAt();
  if (a && $('#pStep')) {
    $('#pStep').innerHTML = a.done ? 'Workout fertig' : `<b>${esc(a.step.label || '')}</b> · noch ${fmtTime(a.left)}${a.next ? ` · danach ${Math.round(a.nextTarget * R.intensity / 100)} W` : ''}`;
    const w0 = work(); if (w0 && R.state === 'run') $('#pWsvg').innerHTML = workoutSVG(w0, R.wT, 40);
  }
  $('.ppill#pHr')?.classList.toggle('on', hrStrap.connected);
}

// ---------------- sheets ----------------
function sheet(html) {
  const s = document.createElement('div'); s.className = 'psheet'; s.innerHTML = `<div class="psheetin">${html}</div>`;
  s.onclick = e => { if (e.target === s) s.remove(); };
  document.body.append(s); return s;
}
function numberSheet() {
  const erg = P.mode === 'erg';
  const s = sheet(`<div class="label">${erg ? 'Ziel-Leistung' : 'Steigung'}</div>
    <input id="pNum" type="number" inputmode="decimal" value="${erg ? P.erg : P.grade}" step="${erg ? 5 : 0.5}">
    ${erg ? `<div class="pquick">${[50, 65, 75, 90, 100, 105, 120].map(p => `<button data-p="${p}">${p} %<small>${Math.round(ftp() * p / 100)} W</small></button>`).join('')}</div>` : ''}
    <div class="pfoot"><button class="btn ghost" id="pNo">Abbrechen</button><button class="btn" id="pOk">OK</button></div>`);
  const inp = $('#pNum', s); setTimeout(() => { inp.focus(); inp.select(); }, 50);
  const ok = v => { if (Number.isFinite(v)) { if (erg) P.erg = Math.max(0, Math.min(2000, Math.round(v))); else P.grade = Math.max(-10, Math.min(20, v)); saveSettings(); applyTrainer(); } s.remove(); render(); };
  s.querySelectorAll('[data-p]').forEach(b => b.onclick = () => ok(ftp() * b.dataset.p / 100));
  $('#pOk', s).onclick = () => ok(parseFloat(inp.value.replace(',', '.')));
  inp.onkeydown = e => { if (e.key === 'Enter') $('#pOk', s).click(); };
  $('#pNo', s).onclick = () => s.remove();
}
function tileSheet(i) {
  const s = sheet(`<div class="label">Feld ${i + 1}: Wert wählen</div><div class="ppick">${Object.entries(M).map(([k, m]) => `<button data-k2="${k}" class="${P.tiles[i] === k ? 'on' : ''}">${m.l}</button>`).join('')}</div>`);
  s.querySelectorAll('[data-k2]').forEach(b => b.onclick = () => { P.tiles[i] = b.dataset.k2; saveSettings(); s.remove(); render(); });
}
function settingsSheet() {
  const s = sheet(`<div class="label">Einstellungen</div>
    <label class="prow">FTP<input id="sFtp" type="number" inputmode="numeric" value="${S.ftp || ''}"><small>W</small></label>
    <label class="prow">Gewicht<input id="sKg" type="number" inputmode="decimal" value="${S.riderKg}"><small>kg</small></label>
    <label class="prow">Leistung glätten<select id="sSm">${[1, 3, 5, 10].map(n => `<option value="${n}" ${P.smooth === n ? 'selected' : ''}>${n} s</option>`).join('')}</select></label>
    <label class="prow">Auto-Pause<input id="sAp" type="checkbox" class="toggle" ${P.autoPause ? 'checked' : ''}></label>
    <button class="btn ghost small" id="sReset" style="margin-top:6px">Felder zurücksetzen</button>
    <div class="pfoot"><button class="btn" id="sOk">Fertig</button></div>`);
  $('#sReset', s).onclick = () => { P.tiles = ['cad', 'hr', 'time', 'dist', 'speed', 'avg', 'np', 'kj', 'lapTime', 'lapAvg', 'max', 'tss']; };
  $('#sOk', s).onclick = () => {
    S.ftp = Math.max(50, Math.min(700, +$('#sFtp', s).value || S.ftp)); S.riderKg = Math.max(30, Math.min(200, parseFloat($('#sKg', s).value.replace(',', '.')) || S.riderKg));
    P.smooth = +$('#sSm', s).value; P.autoPause = $('#sAp', s).checked; saveSettings(); s.remove(); render();
  };
}
function endSheet() {
  const rec = record(), rows = [['Fahrzeit', fmtTime(rec.duration)], ['Strecke', fmtNum(rec.distance / 1000, 2) + ' km'], ['Ø Leistung', rec.avgPower + ' W'], ['NP', rec.np + ' W'],
    ['Max', rec.maxPower + ' W'], ['Arbeit', rec.kj + ' kJ'], ['TSS', M.tss.v()], ['IF', M.if.v()], ['Ø Puls', avgHr() || '–'], ['Max Puls', R.hrMax || '–']];
  const s = sheet(`<div class="label">Fahrt beenden</div><h2 class="display" style="font-size:34px;margin:8px 0 14px">${esc(rec.workout)}</h2>
    <div class="psum">${rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    ${rec.laps ? `<div class="label" style="margin:14px 0 6px">Runden</div><div class="plaps">${rec.laps.map((l, i) => `<div><span>${i + 1}</span><span>${fmtTime(l.t)}</span><span>${fmtNum(l.d / 1000, 2)} km</span><b>${l.w} W</b></div>`).join('')}</div>` : ''}
    <div class="pfoot col"><button class="btn" id="eSave">Speichern</button><button class="btn ghost" id="eStrava">Speichern + Strava</button>
      <button class="btn ghost" id="eBack">Weiterfahren</button><button class="btn danger" id="eDrop">Verwerfen</button></div>`);
  const save = async () => { R.state = 'done'; trainer.setPower(null); await db.put('rides', rec).catch(() => {}); import('./account.js').then(a => a.pushRide?.(rec)).catch(() => {}); };
  $('#eBack', s).onclick = () => s.remove();
  $('#eDrop', s).onclick = () => { if (!confirm('Fahrt wirklich verwerfen?')) return; R.state = 'done'; trainer.setPower(null); location.href = './pure.html' + location.search; };
  $('#eSave', s).onclick = async () => { await save(); s.remove(); doneScreen(rec); };
  $('#eStrava', s).onclick = async e => { await save(); await toStrava(e.target, rec); s.remove(); doneScreen(rec); };
}
const avgHr = () => { const h = R.samples.map(x => x[5]).filter(Boolean); return h.length ? Math.round(h.reduce((a, b) => a + b, 0) / h.length) : 0; };
async function toStrava(btn, rec) {
  const name = rec.workout === 'ERG' || rec.workout === 'Steigung' ? 'Pure ' + rec.workout : rec.workout;
  const st = await stravaStatus();
  if (!st.configured) { stravaExport(rec, name); return; }
  try {
    if (!st.connected && !(await stravaConnect())) throw new Error('Nicht mit Strava verbunden.');
    const url = await stravaUpload(rec, name, null, t => { btn.textContent = t; });
    window.open(url, '_blank');
  } catch (e) { alert(e.message || String(e)); }
}
function doneScreen(rec) {
  el.innerHTML = `<header class="ptop"><a class="pback" href="./">‹</a><div class="pbrand">RIDEFRAME <span>Pure</span></div></header>
    <section class="pdone"><div class="label">Gespeichert</div><h1 class="display">${fmtTime(rec.duration)}</h1>
    <p>${fmtNum(rec.distance / 1000, 1)} km · Ø ${rec.avgPower} W · NP ${rec.np} W · ${rec.kj} kJ</p>
    <div class="pfoot col"><a class="btn" href="./pure.html${location.search}">Neue Fahrt</a><a class="btn ghost" href="./">Zur App</a></div></section>`;
}

// ---------------- data ----------------
trainer.addEventListener('data', e => { live.power = e.detail.power || 0; live.cad = e.detail.cadence || 0; if (!hrStrap.connected && e.detail.hr) live.hr = e.detail.hr; });
trainer.addEventListener('status', () => { if (R.state !== 'done') render(); });
hrStrap.addEventListener('hr', e => { live.hr = e.detail; });
hrStrap.addEventListener('change', () => { if (!hrStrap.connected) live.hr = 0; });

let last = performance.now(), bufAt = 0;
setInterval(() => {
  const now = performance.now(), dt = Math.min(1, (now - last) / 1000); last = now;
  if (trainer.connected && trainer.lastData && now - trainer.lastData > 3000) { live.power = 0; live.cad = 0; }
  tick(dt);
  if (now - bufAt >= 1000) { bufAt = now; live.buf.push(live.power); if (live.buf.length > 10) live.buf.shift(); }
  if (R.state === 'run') applyTrainer();
  paint();
}, 250);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || $('.psheet')) return;
  if (e.code === 'Space') { e.preventDefault(); R.state === 'run' ? pause() : R.state !== 'done' && start(); }
  else if (e.key === 'l' || e.key === 'L') lap();
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') el.querySelector(`[data-d="${e.key === 'ArrowUp' ? (P.mode === 'erg' ? 5 : 0.5) : (P.mode === 'erg' ? -5 : -0.5)}"]`)?.click();
});

await loadSettings();
render();
if (DEMO && params.has('run')) start();
