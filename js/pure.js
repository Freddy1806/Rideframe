// RIDEFRAME Pure: the phone mode. No map, no video, no world: connect the trainer, set watts (ERG), a grade or a workout,
// and read every number big, like a bike computer. Portrait first. Rides land in the same history (routeId 'pure').
import { Trainer, HeartRate, BT_HELP } from './trainer.js';
import { db, uid } from './db.js';
import { fmtTime, fmtNum, esc, bestAvg, appHome } from './util.js';
import { allWorkouts, workoutById, workoutAt, workoutDuration, workoutSVG, setMyWorkouts, isHard, tunedTarget, tuneAdj, fmtAdj, setFtp } from './workouts.js';
import { defaultParams, step } from './physics.js';
import { stravaStatus, stravaConnect, stravaUpload } from './stravaup.js';
import { stravaExport } from './tcx.js';
import { applyTheme, icon } from './theme.js';
import { gearSet, gearName, parseGear, parseRings, shiftGrade, CASSETTES, COG_TEETH } from './gears.js';
import { click } from './zwiftclick.js';
import { padButtons } from './controller.js';

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search), DEMO = params.has('demo');
const S = { riderKg: 75, bikeKg: 8.5, ftp: 250, accent: 'orange', shiftMode: 'real' };
const P = { tiles: ['cad', 'hr', 'time', 'dist', 'speed', 'avg', 'np', 'kj', 'lapTime', 'lapAvg', 'max', 'tss'], smooth: 3, autoPause: true, erg: 200, grade: 0, mode: 'erg', workout: '' };

const trainer = new Trainer(), hrStrap = new HeartRate();
// screens to swipe through, like on a Wahoo (owner 19.11.): each has one big value and its own fields; pages[0].tiles is P.tiles
const PAGES0 = () => [{ big: 'pow', tiles: P.tiles }, { big: 'cad', tiles: ['pow', 'hr', 'time', 'dist'] }, { big: 'hr', tiles: ['pow', 'cad', 'time', 'kj'] }, { big: 'dist', tiles: ['speed', 'avgSpeed', 'time', 'wall', 'pow', 'cad'] }];
function fixPages() {
  const okK = k => typeof k === 'string' && k.length < 20;
  if (!Array.isArray(P.pages) || !P.pages.length) P.pages = PAGES0();
  P.pages = P.pages.filter(g => g && Array.isArray(g.tiles)).slice(0, 6).map(g => { const tiles = g.tiles.filter(okK).slice(0, 12); return { big: okK(g.big) ? g.big : 'pow', tiles, show: zoomFit(Number.isFinite(+g.show) ? +g.show : tiles.length, tiles.length) }; });
  if (!P.pages.length) P.pages = PAGES0();
  P.tiles = P.pages[0].tiles; P.page = Math.max(0, Math.min(P.pages.length - 1, P.page | 0));
}
// zoom like on a Wahoo: the fields are a list in order of importance; zooming in shows fewer of them, bigger
const ZOOM = [0, 1, 2, 3, 4, 6, 9, 12];
const zoomFit = (n, max) => ZOOM.filter(z => z <= max).reduce((a, z) => Math.abs(z - n) <= Math.abs(a - n) ? z : a, 0);
function zoom(d) { const g = pg(), zs = ZOOM.filter(z => z <= g.tiles.length), i = zs.indexOf(zoomFit(g.show, g.tiles.length)), to = zs[Math.max(0, Math.min(zs.length - 1, i + d))]; if (to === g.show) return; g.show = to; saveSettings(); render(); }
const pg = () => P.pages[P.page] || P.pages[0];
const goPage = d => { const n = P.pages.length, to = (P.page + d + n) % n; if (to === P.page) return; P.page = to; saveSettings(); render(); };
const R = { state: 'ready', moving: 0, wall: 0, d: 0, v: 0, kj: 0, samples: [], pw: [], laps: [], lap: null, max: 0, hrMax: 0, wT: 0, wDone: false, intensity: 100, wAdj: 0, adjAcc: 0, adjT: 0, lastSec: 0, idle: 0, roll30: [], np4: 0, npN: 0 };
const live = { power: 0, cad: 0, hr: 0, buf: [] };
let wake = null, demoW = 0, G = gearSet({}); // G: virtual gears (list, fixed real gear, current index)

// ---------------- settings ----------------
async function loadSettings() {
  const saved = await db.kvGet('settings').catch(() => null);
  if (saved) Object.assign(S, saved);
  Object.assign(P, S.pure || {}); fixPages();
  setMyWorkouts(S.myWorkouts); G = gearSet(S);
  await import('./myworkouts-store.js').then(m => m.loadPersonal()).catch(() => {}); // personal workouts selectable here too (js/myworkouts-store.js)
  { const w = params.get('workout'); if (w != null) { P.mode = 'work'; if (workoutById(w)) P.workout = w; else if (!workoutById(P.workout)) P.workout = allWorkouts()[0]?.id || ''; } } // from the phone app's "My workouts" (handy.html): straight into this workout
  applyTheme(S, 'trainer');
}
async function saveSettings() {
  const saved = (await db.kvGet('settings').catch(() => null)) || {}; // keep everything the main app stored
  saved.pure = { ...P }; if (S.myWorkouts) saved.myWorkouts = S.myWorkouts; saved.ftp = S.ftp; saved.riderKg = S.riderKg; saved.bikeKg = S.bikeKg;
  saved.shiftMode = S.shiftMode; if (S.realGear) saved.realGear = S.realGear; // the same switch and bike gear as the 3D ride
  await db.kvSet('settings', saved).catch(() => {});
}

// ---------------- metrics ----------------
const ftp = () => { const f = S.ftp || 200; setFtp(f); return f; };
const avgP = () => R.pw.length ? R.pw.reduce((a, b) => a + b, 0) / R.pw.length : 0;
const NP = () => R.npN ? Math.pow(R.np4 / R.npN, 0.25) : avgP();
const IF = () => NP() / ftp();
const lapNow = () => R.lap ? { t: R.moving - R.lap.t, d: R.d - R.lap.d, w: R.lap.n ? R.lap.sum / R.lap.n : 0 } : { t: 0, d: 0, w: 0 };
const shown = () => { const n = Math.max(1, Math.min(P.smooth, live.buf.length)); return live.buf.length ? live.buf.slice(-n).reduce((a, b) => a + b, 0) / n : live.power; };
const ZONES = [[55, 'Z1', '#6b7480'], [75, 'Z2', '#2f8fe0'], [90, 'Z3', '#2fb36b'], [105, 'Z4', '#f2b630'], [120, 'Z5', '#ff8a1f'], [150, 'Z6', '#ff4f3c'], [1e9, 'Z7', '#c43cff']];
const zoneOf = w => ZONES.find(z => w / ftp() * 100 < z[0]);
const noData = () => !trainer.connected && !DEMO && !R.pw.length; // nothing connected, nothing recorded: '–' instead of a fake 0
const nd = f => () => noData() ? '–' : f();
const M = {
  pow: { l: 'Power', u: 'W', v: nd(() => Math.round(shown())) },
  cad: { l: 'Cadence', u: 'rpm', v: nd(() => Math.round(live.cad)) },
  hr: { l: 'Heart rate', u: 'bpm', v: () => live.hr || '–' },
  time: { l: 'Time', u: '', v: () => fmtTime(R.moving) },
  wall: { l: 'Elapsed', u: '', v: () => fmtTime(R.wall) },
  dist: { l: 'Distance', u: 'km', v: () => fmtNum(R.d / 1000, 2) },
  speed: { l: 'Speed', u: 'km/h', v: nd(() => fmtNum(R.v * 3.6, 1)) },
  avgSpeed: { l: 'Avg speed', u: 'km/h', v: () => fmtNum(R.moving ? R.d / R.moving * 3.6 : 0, 1) },
  avg: { l: 'Avg power', u: 'W', v: nd(() => Math.round(avgP())) },
  np: { l: 'NP', u: 'W', v: nd(() => Math.round(NP())) },
  max: { l: 'Max power', u: 'W', v: nd(() => R.max) },
  kj: { l: 'Work', u: 'kJ', v: () => Math.round(R.kj) },
  kcal: { l: 'Calories', u: 'kcal', v: () => Math.round(R.kj * 1.1) },
  tss: { l: 'TSS', u: '', v: () => Math.round(R.moving * NP() * IF() / (ftp() * 3600) * 100) },
  if: { l: 'IF', u: '', v: () => fmtNum(IF(), 2) },
  wkg: { l: 'W/kg', u: '', v: nd(() => fmtNum(shown() / (S.riderKg || 75), 1)) },
  pct: { l: '% FTP', u: '%', v: nd(() => Math.round(shown() / ftp() * 100)) },
  zone: { l: 'Zone', u: '', v: nd(() => zoneOf(shown())[1]) },
  lapTime: { l: 'Lap time', u: '', v: () => fmtTime(lapNow().t) },
  lapAvg: { l: 'Lap avg', u: 'W', v: nd(() => Math.round(lapNow().w)) },
  lapDist: { l: 'Lap km', u: 'km', v: () => fmtNum(lapNow().d / 1000, 2) },
  laps: { l: 'Lap', u: '', v: () => R.laps.length + 1 },
  best5: { l: 'Best 5 min', u: 'W', v: () => bestAvg(R.pw, 300) || '–' },
  best20: { l: 'Best 20 min', u: 'W', v: () => bestAvg(R.pw, 1200) || '–' },
  hrMax: { l: 'Max HR', u: 'bpm', v: () => R.hrMax || '–' },
  target: { l: 'Target', u: 'W', v: () => targetW() ?? '–' },
  clock: { l: 'Clock', u: '', v: () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
};

// ---------------- control ----------------
const work = () => P.mode === 'work' ? workoutById(P.workout) : null;
const wAt = () => { const w = work(); return w ? workoutAt(w, R.wT, ftp()) : null; };
function targetW() {
  if (P.mode === 'erg') return P.erg;
  const a = wAt(); return a && !a.done ? tunedTarget(a.step, Math.round(a.target * R.intensity / 100), R.wAdj) : null;
}
/** workout: the hard intervals a few watts up or down (as in the 3D ride), on top of the % intensity; ERG follows */
function tune(d) {
  const w = work(); if (!w || R.wDone) return;
  R.wAdj = tuneAdj(R.wAdj, d); const b = $('#pAdj b'); if (b) { b.textContent = fmtAdj(R.wAdj); $('#pAdj').classList.toggle('adj', !!R.wAdj); }
  const a = wAt(), i = a?.i ?? 0, st = isHard(w.steps[i]) ? w.steps[i] : w.steps.slice(i).find(isHard) || w.steps.find(isHard);
  flash(`Intervals ${fmtAdj(R.wAdj)}${st ? ` · target ${tunedTarget(st, Math.round(Math.round(st.pct * ftp() / 100) * R.intensity / 100), R.wAdj)} W` : ''}`, 2000);
  applyTrainer(); paint(); const sv = $('#pWsvg'); if (sv) sv.innerHTML = workoutSVG(w, R.wT, 40, R.wAdj, ftp());
}
function applyTrainer() {
  const t = targetW();
  if (P.mode === 'grade' || t == null) { trainer.setPower(null); trainer.setGrade(P.mode === 'grade' ? simGrade() : 0); }
  else trainer.setPower(t);
}
// ---------------- virtual gears (Grade mode only: in ERG the trainer holds the watts whatever the gear) ----------------
const VG = () => S.shiftMode === 'virtual';
/** what goes to the trainer in Grade mode: the grade, with virtual gears the same maths as the 3D ride (gears.js) */
function simGrade() {
  if (!VG()) return P.grade;
  const k = G.gears[G.gi].ratio / G.real.ratio, ws = trainer.data?.speed > 0.5 ? trainer.data.speed : Math.max(1, R.v / k);
  return shiftGrade(P.grade, k, ws, (S.riderKg || 75) + (S.bikeKg || 8.5));
}
/** d = +1 harder / −1 easier, from the buttons, Q/E or the Zwift Click (src 'click' switches virtual gears on, like a pad in the 3D ride) */
function shift(d, src) {
  if (P.mode === 'work') return tune(d * 5); // in a workout + / − (keys, Zwift Click) move the interval watts
  if (P.mode !== 'grade') return flash(`${P.mode === 'erg' ? 'ERG' : 'The workout'} holds the watts. Gears work in Grade mode.`, 2500);
  if (!VG()) { S.shiftMode = 'virtual'; saveSettings(); render(); flash('Virtual gears on', 1500); } // the first shift from anywhere (screen, keys, pad, Click) switches them on
  G.gi = Math.max(0, Math.min(G.gears.length - 1, G.gi + d)); paintGear();
  if (trainer.connected) trainer.setGrade(simGrade(), true);
}
function paintGear() {
  const g = $('#pGear'); if (!g) return;
  g.querySelector('b').textContent = gearName(G.gears[G.gi]); g.querySelector('small').textContent = `Gear ${G.gi + 1}/${G.gears.length}`;
  g.classList.remove('hit'); void g.offsetWidth; g.classList.add('hit');
}
function setMode(m) {
  P.mode = m; if (m === 'work' && !workoutById(P.workout)) P.workout = allWorkouts()[0]?.id || '';
  if (m === 'grade') { trainer.setPower(null); trainer.setGrade(simGrade(), true); }
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
  if (P.mode === 'work' && !R.wDone) { R.wT += dt; const a = wAt(); if (a && isHard(a.step)) { R.adjAcc += R.wAdj * dt; R.adjT += dt; } if (a?.done) { R.wDone = true; flash('Workout done. Keep riding freely or finish.'); P.mode = 'erg'; P.erg = Math.round(ftp() * .5); render(); } }
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
function pause() { R.state = 'pause'; render(); saveDraft(); }
function lap() {
  if (R.state !== 'run') return;
  const l = lapNow(); R.laps.push({ t: Math.round(l.t), d: Math.round(l.d), w: Math.round(l.w) });
  R.lap = { t: R.moving, d: R.d, sum: 0, n: 0 }; flash(`Lap ${R.laps.length}: ${fmtTime(l.t)} · avg ${Math.round(l.w)} W`);
}
function record() {
  const pw = R.pw, w = work();
  return { id: uid(), routeId: 'pure', date: Date.now(), complete: true, duration: Math.round(R.moving), distance: Math.round(R.d), gain: 0, startD: 0,
    workout: w?.name || (P.mode === 'grade' ? 'Grade' : 'ERG'), avgPower: Math.round(avgP()), maxPower: Math.max(0, ...pw), best5: bestAvg(pw, 300), best20: bestAvg(pw, 1200),
    np: Math.round(NP()), kj: Math.round(R.kj), laps: R.laps.length ? [...R.laps, { t: Math.round(lapNow().t), d: Math.round(lapNow().d), w: Math.round(lapNow().w) }] : undefined, samples: R.samples,
    ...(R.wAdj || R.adjAcc ? { wAdj: R.wAdj, wAdjAvg: R.adjT ? Math.round(R.adjAcc / R.adjT) : R.wAdj } : {}) };
}
// a reload or crash must not lose the ride: the state goes to kv every 10 s (like outdoor)
let draftAt = 0;
function saveDraft() { if (R.state === 'run' || R.state === 'pause') db.kvSet('pureDraft', { ...R, savedAt: Date.now() }).catch(() => {}); draftAt = performance.now(); }
const dropDraft = () => db.kvDel('pureDraft').catch(() => {});

// ---------------- screen ----------------
const el = document.getElementById('pure');
function flash(t, ms = 3500) { const f = $('#pflash'); if (!f) return; f.textContent = t; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), ms); }
async function lockScreen() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (R.state === 'run') lockScreen(); } else saveDraft(); });
window.addEventListener('beforeunload', e => { if (R.samples.length && R.state !== 'done') { saveDraft(); e.preventDefault(); e.returnValue = ''; } });

function control() {
  if (P.mode === 'erg') return `<div class="pctl"><button data-d="-25">−25</button><button data-d="-5">−5</button><button class="pval" id="pSet"><b>${P.erg}</b><small>W</small></button><button data-d="5">+5</button><button data-d="25">+25</button></div>`;
  if (P.mode === 'grade') return `<div class="pctl tight"><button data-d="-1">−1</button><button data-d="-0.5">−½</button><button class="pval" id="pSet"><b>${fmtNum(P.grade, 1)}</b><small>%</small></button><button data-d="0.5">+½</button><button data-d="1">+1</button></div>
    ${`<div class="pgears"><button data-sh="-1" aria-label="Easier gear">−</button><div class="pgv" id="pGear"><b>${gearName(G.gears[G.gi])}</b><small>Gear ${G.gi + 1}/${G.gears.length}</small></div><button data-sh="1" aria-label="Harder gear">+</button></div>`}`;
  const w = work();
  return `<div class="pwork"><select id="pWork" aria-label="Workout">${(() => { const all = allWorkouts(), opt = x => `<option value="${x.id}" ${x.id === P.workout ? 'selected' : ''}>${esc(x.name)} · ${Math.round(workoutDuration(x) / 60)} min</option>`, my = all.filter(x => x.mine || x.personal); // your own first, under their own heading (owner 19.11.: easy to find)
      return (my.length ? `<optgroup label="My workouts">${my.map(opt).join('')}</optgroup>` : '') + `<optgroup label="Standard workouts">${all.filter(x => !x.mine && !x.personal).map(opt).join('')}</optgroup>`; })()}</select>
    <div class="pctl small"><button data-i="-5" aria-label="Intensity −5 %">−5 %</button><span class="pint" id="pInt"><small>Intensity</small><b>${R.intensity} %</b></span><button data-i="5" aria-label="Intensity +5 %">+5 %</button></div>
    <div class="pctl small"><button data-wa="-5" aria-label="Intervals −5 W">−5 W</button><span class="pint${R.wAdj ? ' adj' : ''}" id="pAdj"><small>Intervals</small><b>${fmtAdj(R.wAdj)}</b></span><button data-wa="5" aria-label="Intervals +5 W">+5 W</button></div>
    ${R.state === 'ready' ? `<div class="pwed"><button class="btn ghost ksmall" id="pWAdapt">Adjust</button><button class="btn ghost ksmall" id="pWNew">+ Build new</button></div>` : ''}</div>
    ${w ? `<div class="pwsvg" id="pWsvg">${workoutSVG(w, R.wT, 40, R.wAdj, ftp())}</div><div class="pstep" id="pStep"></div>` : ''}`;
}

function render() {
  if (R.state === 'done') return;
  const bt = !trainer.connected && !DEMO, bleOk = Trainer.supported();
  el.innerHTML = `
  <header class="ptop">
    <a class="pback" href="${appHome()}" title="Back to app">‹</a><div class="pbrand"><b>RIDEFRAME </b><span>Indoor</span></div>
    <button class="ppill ${trainer.connected || DEMO ? 'on' : ''}" id="pTr"><i></i><span class="pname">${DEMO ? 'Demo' : trainer.connected ? esc(trainer.device?.name || 'Trainer') : 'Trainer'}</span></button>
    <button class="ppill ${sensOn() ? 'on' : ''}" id="pSens"><i></i>Sensors</button>
    <button class="pgear" id="pSetBtn" title="Settings" aria-label="Settings">${icon('gear', 'gico')}</button>
  </header>
  ${!bleOk && !DEMO ? `<div class="pnote">${BT_HELP}</div>` : ''}
  <div class="ppages" id="pPages">
  <section class="pbig${pg().big === 'pow' ? '' : ' alt'}" id="pBig">
    <div class="label" id="pBigL">${pg().big === 'pow' ? `Power ${P.smooth > 1 ? `· ${P.smooth} s` : ''}` : esc(M[pg().big]?.l || '')}</div>
    <div class="pbigv"><b id="pPow">–</b><small>${pg().big === 'pow' ? 'W' : M[pg().big]?.u || ''}</small></div>
    <div class="pbigs"><span id="pTarget"></span><span id="pZone"></span></div>
    <div class="pzbar"><i id="pZbar"></i></div>
  </section>
  <section class="ptiles n${pg().show}">${pg().tiles.slice(0, pg().show).map((k, i) => `<button class="ptile" data-t="${i}"><span class="label">${M[k]?.l || k}</span><b data-k="${k}">–</b><small>${M[k]?.u || ''}</small></button>`).join('')}</section>
  <nav class="pdots" id="pDots" aria-label="Screens"><button class="pzoom" data-z="-1" aria-label="Fewer, bigger fields" ${pg().show <= 0 ? 'disabled' : ''}>−</button>
    <span class="pdotrow">${P.pages.map((_, i) => `<button class="pdot ${i === P.page ? 'on' : ''}" data-pg="${i}" aria-label="Screen ${i + 1}"></button>`).join('')}</span>
    <button class="pzoom" data-z="1" aria-label="More fields" ${pg().show >= pg().tiles.length ? 'disabled' : ''}>+</button><button class="pzoom pedit" id="pEdit" aria-label="Edit screens">Edit</button></nav>
  </div>
  <section class="pmode">
    <div class="pseg">${[['erg', 'ERG'], ['grade', 'Grade'], ['work', 'Workout']].map(([k, n]) => `<button class="${P.mode === k ? 'on' : ''}" data-m="${k}">${n}</button>`).join('')}</div>
    ${control()}
  </section>
  <footer class="pfoot">
    ${R.state === 'run' ? `<button class="btn ghost" id="pPause">Pause</button><button class="btn ghost" id="pLap">Lap</button>`
      : `<button class="btn" id="pStart">${R.state === 'pause' ? 'Resume' : 'Start'}</button>${R.state === 'pause' ? '<button class="btn ghost" id="pEnd">Finish</button>' : ''}`}
  </footer>
  <div class="pflash" id="pflash"></div>`;
  wire(); paint(); fitRO.disconnect(); fitRO.observe($('.ptiles'));
}
// portrait: the tile rows fill the free height exactly; when not all fit, they shrink to whole rows that scroll (no half-cut row, no empty band)
const fitRO = new ResizeObserver(() => fitTiles());
function fitTiles() {
  const t = $('.ptiles'); if (!t) return; if (!matchMedia('(orientation: portrait)').matches) return void (t.style.gridAutoRows = '');
  const cs = getComputedStyle(t), g = parseFloat(cs.rowGap) || 8, n = Math.ceil(t.children.length / cs.gridTemplateColumns.split(' ').length), H = t.clientHeight, fit = Math.max(1, Math.min(n, Math.floor((H + g) / (58 + g))));
  t.style.gridAutoRows = Math.floor((H - (fit - 1) * g) / fit) + 'px';
}

function wire() {
  // the message comes AFTER render(): render rebuilds the page and would wipe it (Freddy 16.11.: "der Button reagiert gar nicht" on the iPhone)
  $('#pTr').onclick = async () => { if (DEMO) return; const err = await connectTrainer(); render(); if (err) flash(err, 9000); };
  $('#pSens').onclick = sensorsSheet;
  el.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => shift(+b.dataset.sh));
  $('#pSetBtn').onclick = settingsSheet;
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
    const d = +b.dataset.d;
    if (P.mode === 'erg') P.erg = Math.max(0, Math.min(2000, P.erg + d)); else P.grade = Math.max(-10, Math.min(20, Math.round((P.grade + d) * 2) / 2));
    $('#pSet b').textContent = P.mode === 'erg' ? P.erg : fmtNum(P.grade, 1); applyTrainer(); saveSettings();
  });
  el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { R.intensity = Math.max(50, Math.min(150, R.intensity + +b.dataset.i)); $('#pInt b').textContent = R.intensity + ' %'; applyTrainer(); });
  el.querySelectorAll('[data-wa]').forEach(b => b.onclick = () => tune(+b.dataset.wa));
  const set = $('#pSet'); if (set) set.onclick = () => numberSheet();
  const wed = async from => { const t = await import('./training.js'), wk = await import('./workouts.js'), cur = work();
    const own = !from && cur?.mine ? (S.myWorkouts || []).find(d => d.id === cur.id) : null;
    const res = from === 'new' ? await t.editorModal(null, ftp()) : own ? await t.editorModal(own, ftp()) : await t.editorModal(wk.defFrom(cur), ftp(), true);
    if (!res) return; const list = (S.myWorkouts || []).filter(d => d.id !== (res.del || res.id)); if (!res.del) list.unshift(res);
    S.myWorkouts = list; setMyWorkouts(list); P.workout = res.del ? allWorkouts()[0]?.id || '' : res.id; R.wT = 0; R.wDone = false; await saveSettings(); render(); applyTrainer(); };
  const wa = $('#pWAdapt'); if (wa) wa.onclick = () => wed(); const wn = $('#pWNew'); if (wn) wn.onclick = () => wed('new');
  const ws = $('#pWork'); if (ws) ws.onchange = () => { P.workout = ws.value; R.wT = 0; R.wDone = false; saveSettings(); render(); applyTrainer(); };
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if (Date.now() - swiped > 400) tileSheet(+b.dataset.t); });
  el.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => goPage(+b.dataset.pg - P.page));
  el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => zoom(+b.dataset.z)); { const e = $('#pEdit'); if (e) e.onclick = () => bigSheet(); }
  const pp = $('#pPages'); if (pp) { let x0 = null, y0 = 0; // swipe left / right: next / previous screen
    pp.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    pp.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 55 && Math.abs(dx) > 1.6 * Math.abs(dy)) { swiped = Date.now(); goPage(dx < 0 ? 1 : -1); } }, { passive: true }); }
  $('#pBig').onclick = () => { if (Date.now() - swiped > 400 && R.state !== 'run') bigSheet(); }; // while riding only the Edit key opens the editor
  const on = (id, f) => { const x = $(id); if (x) x.onclick = f; };
  on('#pStart', start); on('#pPause', pause); on('#pLap', lap); on('#pEnd', endSheet);
}

let swiped = 0;
function paint() {
  if (R.state === 'done' || !$('#pPow')) return;
  const w = shown(), z = zoneOf(w), t = targetW();
  const bigK = pg().big, bigV = bigK === 'pow' ? (noData() ? '–' : Math.round(w)) : M[bigK]?.v() ?? '–';
  if ($('#pPow').textContent !== String(bigV)) $('#pPow').textContent = bigV; $('#pPow').classList.toggle('nd', bigV === '–');
  $('#pTarget').textContent = (bigK === 'pow' || noData() ? '' : `${Math.round(w)} W · `) + (t != null ? `Target ${t} W` : P.mode === 'grade' ? `Grade ${fmtNum(P.grade, 1)} %` : ''); // power stays in sight on every screen
  $('#pZone').textContent = noData() ? '' : `${z[1]} · ${Math.round(w / ftp() * 100)} % FTP`;
  $('#pZbar').style.cssText = `width:${Math.min(100, w / ftp() / 1.5 * 100)}%;background:${z[2]}`;
  $('#pBig').style.setProperty('--z', z[2]);
  if (t !== paint.t) { paint.t = t; paint.at = performance.now(); } // red frame only once the trainer had time to reach a new target
  $('#pBig').classList.toggle('off', t != null && performance.now() - paint.at > 8000 && Math.abs(w - t) > Math.max(15, t * .08) && R.state === 'run');
  el.querySelectorAll('[data-k]').forEach(b => { const v = M[b.dataset.k]?.v(); if (b.textContent !== String(v)) b.textContent = v; });
  const a = wAt();
  if (a && $('#pStep')) {
    $('#pStep').innerHTML = a.done ? 'Workout done' : `<b>${esc(a.step.label || '')}</b> · ${fmtTime(a.left)} left${a.next ? ` · then ${tunedTarget(a.next, Math.round(a.nextTarget * R.intensity / 100), R.wAdj)} W` : ''}`;
    const w0 = work(); if (w0 && R.state === 'run') $('#pWsvg').innerHTML = workoutSVG(w0, R.wT, 40, R.wAdj, ftp());
  }
  $('#pSens')?.classList.toggle('on', sensOn());
}

// ---------------- sheets ----------------
function sheet(html) {
  const s = document.createElement('div'); s.className = 'psheet'; s.innerHTML = `<div class="psheetin">${html}</div>`;
  s.onclick = e => { if (e.target === s) s.remove(); };
  document.body.append(s); return s;
}
function numberSheet() {
  const erg = P.mode === 'erg';
  const s = sheet(`<div class="label">${erg ? 'Target power' : 'Grade'}</div>
    <input id="pNum" type="number" inputmode="decimal" value="${erg ? P.erg : P.grade}" step="${erg ? 5 : 0.5}">
    ${erg ? `<div class="pquick">${[50, 65, 75, 90, 100, 105, 120].map(p => `<button data-p="${p}">${p} %<small>${Math.round(ftp() * p / 100)} W</small></button>`).join('')}</div>` : ''}
    <div class="pfoot"><button class="btn ghost" id="pNo">Cancel</button><button class="btn" id="pOk">OK</button></div>`);
  const inp = $('#pNum', s); setTimeout(() => { inp.focus(); inp.select(); }, 50);
  const ok = v => { if (Number.isFinite(v)) { if (erg) P.erg = Math.max(0, Math.min(2000, Math.round(v))); else P.grade = Math.max(-10, Math.min(20, v)); saveSettings(); applyTrainer(); } s.remove(); render(); };
  s.querySelectorAll('[data-p]').forEach(b => b.onclick = () => ok(ftp() * b.dataset.p / 100));
  $('#pOk', s).onclick = () => ok(parseFloat(inp.value.replace(',', '.')));
  inp.onkeydown = e => { if (e.key === 'Enter') $('#pOk', s).click(); };
  $('#pNo', s).onclick = () => s.remove();
}
function tileSheet(i) {
  const s = sheet(`<div class="label">Field ${i + 1}: choose value</div><div class="ppick">${Object.entries(M).map(([k, m]) => `<button data-k2="${k}" class="${P.tiles[i] === k ? 'on' : ''}">${m.l}</button>`).join('')}</div>`);
  s.querySelectorAll('[data-k2]').forEach(b => b.onclick = () => { pg().tiles[i] = b.dataset.k2; saveSettings(); s.remove(); render(); });
}
/** the screen editor: the big value, the fields in their order (first = stays longest when you zoom in), move, add and remove
 *  fields and screens. Everything a Wahoo's page setup does, but on the device itself. */
function bigSheet(pickFor = null) {
  const g = pg(), n = P.pages.length, name = k => M[k]?.l || k;
  const save = () => { g.show = Math.min(g.show, g.tiles.length); fixPages(); saveSettings(); render(); };
  const picker = (title, cur, cb) => { const s2 = sheet(`<div class="label">${title}</div><div class="ppick">${Object.entries(M).map(([k, m]) => `<button data-kp="${k}" class="${cur === k ? 'on' : ''}">${m.l}</button>`).join('')}</div>`);
    s2.querySelectorAll('[data-kp]').forEach(b => b.onclick = () => { s2.remove(); cb(b.dataset.kp); }); };
  const s = sheet(`<div class="pedhead"><button class="btn ghost ksmall" id="edL" ${P.page <= 0 ? 'disabled' : ''} aria-label="Move this screen left">◀</button><div class="label">Screen ${P.page + 1} of ${n}</div><button class="btn ghost ksmall" id="edR" ${P.page >= n - 1 ? 'disabled' : ''} aria-label="Move this screen right">▶</button></div>
    <button class="pedrow big" id="edBig"><small>Big value</small><b>${esc(name(g.big))}</b><i>Change</i></button>
    <div class="label" style="margin:12px 0 6px">Fields · in order of importance · ${g.show} of ${g.tiles.length} shown</div>
    <div class="pedlist">${g.tiles.map((k, i) => `<div class="pedrow${i >= g.show ? ' hid' : ''}" data-i="${i}"><small>${i + 1}</small><button class="pedname" data-ch="${i}">${esc(name(k))}</button>
      <button data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button data-dn="${i}" ${i < g.tiles.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button><button data-rm="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>
    <div class="pfoot"><button class="btn ghost" id="edAdd" ${g.tiles.length >= 12 ? 'disabled' : ''}>+ Field</button><button class="btn ghost" id="bgAdd" ${n >= 6 ? 'disabled' : ''}>+ Screen</button><button class="btn ghost" id="bgDel" ${n <= 1 ? 'disabled' : ''}>Remove screen</button></div>
    <p class="phint">Swipe left or right on the numbers to change screens. − and + next to the dots zoom: fewer fields, bigger numbers. Fields further down hide first.</p>
    <div class="pfoot"><button class="btn" id="edOk">Done</button></div>`);
  const again = () => { save(); s.remove(); bigSheet(); };
  const swap = (i, j) => { [g.tiles[i], g.tiles[j]] = [g.tiles[j], g.tiles[i]]; again(); };
  s.querySelectorAll('[data-up]').forEach(b => b.onclick = () => swap(+b.dataset.up, +b.dataset.up - 1));
  s.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => swap(+b.dataset.dn, +b.dataset.dn + 1));
  s.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { g.tiles.splice(+b.dataset.rm, 1); again(); });
  s.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => picker(`Field ${+b.dataset.ch + 1}`, g.tiles[+b.dataset.ch], k => { g.tiles[+b.dataset.ch] = k; again(); }));
  $('#edBig', s).onclick = () => picker('Big value', g.big, k => { g.big = k; again(); });
  $('#edAdd', s).onclick = () => picker('New field', null, k => { g.tiles.push(k); g.show = zoomFit(12, g.tiles.length); again(); });
  const move = d => { const i = P.page, j = i + d; [P.pages[i], P.pages[j]] = [P.pages[j], P.pages[i]]; P.page = j; again(); };
  $('#edL', s).onclick = () => move(-1); $('#edR', s).onclick = () => move(1);
  $('#bgAdd', s).onclick = () => { P.pages.splice(P.page + 1, 0, { big: 'cad', tiles: ['pow', 'hr', 'time', 'dist'], show: 4 }); P.page++; again(); };
  $('#bgDel', s).onclick = () => { P.pages.splice(P.page, 1); P.page = Math.max(0, P.page - 1); again(); };
  $('#edOk', s).onclick = () => { save(); s.remove(); };
}
function settingsSheet() {
  const s = sheet(`<div class="label">Settings</div>
    <label class="prow">FTP<input id="sFtp" type="number" inputmode="numeric" value="${S.ftp || ''}"><small>W</small></label>
    <label class="prow">Weight<input id="sKg" type="number" inputmode="decimal" value="${S.riderKg}"><small>kg</small></label>
    <label class="prow">Smooth power<select id="sSm">${[1, 3, 5, 10].map(n => `<option value="${n}" ${P.smooth === n ? 'selected' : ''}>${n} s</option>`).join('')}</select></label>
    <label class="prow">Auto-Pause<input id="sAp" type="checkbox" class="toggle" ${P.autoPause ? 'checked' : ''}></label>
    <label class="prow">Virtual gears<input id="sVg" type="checkbox" class="toggle" ${VG() ? 'checked' : ''}></label>
    <label class="prow pwide" id="sRgRow" ${VG() ? '' : 'hidden'}>Gear on the bike<select id="sRg">${bikeGears().map(([v, l]) => `<option value="${v}" ${v === curGear() ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="phint">One sprocket (Zwift Cog: big ring × ${COG_TEETH}) or a bike left in one gear: − / + or a Zwift Click shift like real gears. Grade mode only, ERG holds the watts.</p>
    <button class="btn ghost small" id="sReset" style="margin-top:6px">Reset screens and fields</button>
    <div class="pfoot"><button class="btn" id="sOk">Done</button></div>`);
  $('#sVg', s).onchange = e => { $('#sRgRow', s).hidden = !e.target.checked; };
  $('#sReset', s).onclick = () => { P.tiles = ['cad', 'hr', 'time', 'dist', 'speed', 'avg', 'np', 'kj', 'lapTime', 'lapAvg', 'max', 'tss']; P.pages = null; P.page = 0; fixPages(); };
  $('#sOk', s).onclick = () => {
    S.ftp = Math.max(50, Math.min(700, +$('#sFtp', s).value || S.ftp)); S.riderKg = Math.max(30, Math.min(200, parseFloat($('#sKg', s).value.replace(',', '.')) || S.riderKg));
    P.smooth = +$('#sSm', s).value; P.autoPause = $('#sAp', s).checked;
    S.shiftMode = $('#sVg', s).checked ? 'virtual' : 'real';
    const rg = $('#sRg', s).value; if (rg !== curGear()) { S.realGear = rg; G = gearSet(S); }
    saveSettings(); s.remove(); render(); applyTrainer();
  };
}
/** the fixed gear on the bike for virtual shifting: every ring × cog (plus the Cog's 14), as "50x14" like the 3D ride stores it */
const curGear = () => { const g = parseGear(S.realGear); return `${g.f}x${g.r}`; };
function bikeGears() {
  const rings = (parseRings(S.chainrings) || [50, 34]).sort((a, b) => b - a), cass = CASSETTES[S.cassette] || CASSETTES['11-34'];
  const cogs = [...new Set([...cass, COG_TEETH])].sort((a, b) => a - b), out = rings.flatMap(f => cogs.map(r => [`${f}x${r}`, `${f}×${r}${r === COG_TEETH ? ' · Cog' : ''}`]));
  if (!out.some(o => o[0] === curGear())) out.unshift([curGear(), curGear().replace('x', '×')]);
  return out;
}

// ---------------- sensors: trainer, heart rate strap, Zwift Click (Bluetooth lives as long as this page) ----------------
const CLICK_ID = 'rf_click';
const sensOn = () => hrStrap.connected || click.connected;
async function connectTrainer() {
  try { await trainer.connect(); trainer.setSim({ riderKg: S.riderKg, bikeKg: S.bikeKg, crr: .004, cw: .51 }); applyTrainer(); return ''; }
  catch (e) { return e.name === 'NotFoundError' ? '' : e.message || String(e); }
}
function clickLine() {
  const c = click, s = c.status;
  if (s === 'on') return `${esc(c.name)} · connected${c.battery != null ? ` · battery ${c.battery}&nbsp;%` : ''}${c.locked ? ' · locked: open the Zwift app' : ''}`;
  return { connecting: 'Connecting …', reconnecting: 'Connection lost, reconnecting …', lost: 'Connection lost. Wake it up and connect again.' }[s] || 'Not connected';
}
let sensDraw = null;
function sensorsSheet() {
  const s = sheet(''), box = $('.psheetin', s), ok = Trainer.supported(); let err = '';
  const row = (id, name, st, on) => `<div class="psens"><div><b>${name}</b><small>${st}</small></div><button class="btn ${on ? 'ghost ' : ''}psm" id="${id}" ${ok && !DEMO ? '' : 'disabled'}>${on ? 'Disconnect' : 'Connect'}</button></div>`;
  const go = async f => { err = ''; try { await f(); } catch (e) { if (e.name !== 'NotFoundError') err = e.message || String(e); } render(); sensDraw?.(); };
  (sensDraw = () => {
    if (!s.isConnected) return void (sensDraw = null);
    box.innerHTML = `<div class="label">Sensors</div>${ok ? '' : `<p class="phint">${BT_HELP}</p>`}
      ${row('sTr', 'Smart trainer', trainer.connected ? `${esc(trainer.device?.name || 'Trainer')} · connected` : 'Not connected', trainer.connected)}
      ${row('sHr', 'Heart rate strap', hrStrap.connected ? `${esc(hrStrap.device?.name || 'Strap')} · connected${hrStrap.battery != null ? ` · battery ${hrStrap.battery}&nbsp;%` : ''}` : 'Not connected', hrStrap.connected)}
      ${row('sClk', 'Zwift Click', clickLine(), !!click.device)}
      ${err ? `<p class="phint perr">${esc(err)}</p>` : ''}
      <p class="phint">Zwift Click: + harder, − easier (virtual gears in Grade mode). Click v2: open it in the Zwift app once a day, or it drops after a minute.</p>
      <p class="phint">Connections belong to this page and end when you leave it.</p>
      <div class="pfoot"><button class="btn ghost" id="sDone">Done</button></div>`;
    $('#sTr', s).onclick = () => trainer.connected ? (trainer.disconnect(), render(), sensDraw?.()) : go(async () => { const e = await connectTrainer(); if (e) throw new Error(e); });
    $('#sHr', s).onclick = () => hrStrap.connected ? (hrStrap.disconnect(), render(), sensDraw?.()) : go(() => { hrStrap.closing = false; return hrStrap.connect(); });
    $('#sClk', s).onclick = () => { if (!click.device) return go(() => click.connect()); click.disconnect(); try { localStorage.removeItem(CLICK_ID); } catch {} };
    $('#sDone', s).onclick = () => { s.remove(); sensDraw = null; };
  })();
}
click.on('state', c => {
  if (c.status === 'on' && c.device?.id) try { localStorage.setItem(CLICK_ID, c.device.id); } catch {} // for the silent reconnect next time
  if (c.locked && !click._said) { click._said = true; flash('Zwift Click is locked: open it in the Zwift app once, then connect again.', 6000); }
  $('#pSens')?.classList.toggle('on', sensOn()); sensDraw?.();
});
click.on('shift', d => { if (R.state !== 'done') shift(d, 'click'); });
/** the Click from last time, without the chooser where the browser allows it (Chrome getDevices; not Bluefy): never throws */
async function clickResume() {
  try {
    const id = localStorage.getItem(CLICK_ID), bt = navigator.bluetooth;
    if (!id || click.device || typeof bt?.getDevices !== 'function') return;
    const d = (await bt.getDevices()).find(x => x.id === id);
    if (d && await click.resume(d)) flash(`${click.name} connected · + / − shift`, 2500);
  } catch {}
}
function endSheet() {
  const rec = record(), rows = [['Time', fmtTime(rec.duration)], ['Distance', fmtNum(rec.distance / 1000, 2) + ' km'], ['Avg power', rec.avgPower + ' W'], ['NP', rec.np + ' W'],
    ['Max', rec.maxPower + ' W'], ['Work', rec.kj + ' kJ'], ['TSS', M.tss.v()], ['IF', M.if.v()], ['Avg HR', avgHr() || '–'], ['Max HR', R.hrMax || '–']];
  const s = sheet(`<div class="label">Finish ride</div><h2 class="display" style="font-size:34px;margin:8px 0 14px">${esc(rec.workout)}</h2>
    <div class="psum">${rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    ${rec.laps ? `<div class="label" style="margin:14px 0 6px">Laps</div><div class="plaps">${rec.laps.map((l, i) => `<div><span>${i + 1}</span><span>${fmtTime(l.t)}</span><span>${fmtNum(l.d / 1000, 2)} km</span><b>${l.w} W</b></div>`).join('')}</div>` : ''}
    <div class="pfoot col"><button class="btn" id="eSave">Save</button><button class="btn ghost" id="eStrava">Save + Strava</button>
      <button class="btn ghost" id="eBack">Resume</button><button class="btn danger" id="eDrop">Discard</button></div>`);
  const save = async () => { R.state = 'done'; trainer.setPower(null); dropDraft(); await db.put('rides', rec).catch(() => {}); import('./account.js').then(a => a.pushRide?.(rec)).catch(() => {}); };
  $('#eBack', s).onclick = () => s.remove();
  $('#eDrop', s).onclick = async () => { if (!confirm('Really discard this ride?')) return; R.state = 'done'; trainer.setPower(null); await dropDraft(); location.href = './pure.html' + location.search; };
  $('#eSave', s).onclick = async () => { await save(); s.remove(); doneScreen(rec); };
  if (S.autoStrava) { $('#eSave', s).onclick = () => $('#eStrava', s).click(); $('#eSave', s).textContent = 'Save + Strava'; $('#eStrava', s).hidden = true; } // settings: upload on its own
  $('#eStrava', s).onclick = async e => { await save(); await toStrava(e.target, rec); s.remove(); doneScreen(rec); };
}
const avgHr = () => { const h = R.samples.map(x => x[5]).filter(Boolean); return h.length ? Math.round(h.reduce((a, b) => a + b, 0) / h.length) : 0; };
async function toStrava(btn, rec) {
  const name = rec.workout === 'ERG' || rec.workout === 'Grade' ? 'Pure ' + rec.workout : rec.workout;
  const st = await stravaStatus();
  if (!st.configured) { stravaExport(rec, name); return; }
  try {
    if (!st.connected && !(await stravaConnect())) throw new Error('Not connected to Strava.');
    const url = await stravaUpload(rec, name, null, t => { btn.textContent = t; });
    window.open(url, '_blank');
  } catch (e) { alert(e.message || String(e)); }
}
function doneScreen(rec) {
  el.innerHTML = `<header class="ptop"><a class="pback" href="${appHome()}">‹</a><div class="pbrand">RIDEFRAME <span>Indoor</span></div></header>
    <section class="pdone"><div class="label">Saved</div><h1 class="display">${fmtTime(rec.duration)}</h1>
    <p>${fmtNum(rec.distance / 1000, 1)} km · avg ${rec.avgPower} W · NP ${rec.np} W · ${rec.kj} kJ</p>
    <div class="pfoot col"><a class="btn" href="./pure.html${location.search}">New ride</a><a class="btn ghost" href="${appHome()}">Back to app</a></div></section>`;
}

// ---------------- data ----------------
trainer.addEventListener('data', e => { live.power = e.detail.power || 0; live.cad = e.detail.cadence || 0; if (!hrStrap.connected && e.detail.hr) live.hr = e.detail.hr; });
trainer.addEventListener('status', () => { if (R.state !== 'done') render(); sensDraw?.(); });
hrStrap.addEventListener('hr', e => { live.hr = e.detail; });
hrStrap.addEventListener('change', () => { if (!hrStrap.connected) live.hr = 0; sensDraw?.(); });

let last = performance.now(), lastWall = Date.now(), bufAt = 0;
setInterval(() => {
  const now = performance.now(), wallNow = Date.now(), gap = (wallNow - lastWall) / 1000, dt = Math.min(1, (now - last) / 1000); last = now; lastWall = wallNow;
  // in the background (another app, screen locked) the browser slows or stops this timer: the ride goes on, so the time is
  // caught up from the clock (owner 19.11.: "dass die Zeit weiterläuft"), second by second with the watts last seen; after
  // 10 minutes without a sign of life only the elapsed time counts on
  if (gap > 2.5 && R.state === 'run') { const n = Math.min(4 * 3600, Math.floor(gap - dt)), held = live.power, cad = live.cad;
    for (let i = 0; i < n; i++) { if (i >= 600) { R.wall += n - i; break; } live.power = held; live.cad = cad; tick(1); }
    if (n > 5) flash(`Back: ${fmtTime(n)} in the background counted`); }
  if (trainer.connected && trainer.lastData && now - trainer.lastData > 3000) { live.power = 0; live.cad = 0; }
  tick(dt);
  if (now - bufAt >= 1000) { bufAt = now; live.buf.push(live.power); if (live.buf.length > 10) live.buf.shift(); }
  if (R.state === 'run') applyTrainer();
  if ((R.state === 'run' || R.state === 'pause') && now - draftAt > 10000) saveDraft();
  paint();
}, 250);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || $('.psheet')) return;
  if (e.code === 'Space') { e.preventDefault(); R.state === 'run' ? pause() : R.state !== 'done' && start(); }
  else if (e.key === 'l' || e.key === 'L') lap();
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); goPage(e.key === 'ArrowRight' ? 1 : -1); } // laptop: the screens you swipe on the phone
  else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && P.mode === 'work') { e.preventDefault(); tune((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 5)); } // workout: interval watts, Shift 1 W
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') el.querySelector(`[data-d="${e.key === 'ArrowUp' ? (P.mode === 'erg' ? 5 : 0.5) : (P.mode === 'erg' ? -5 : -0.5)}"]`)?.click();
  else if ('qQ,-'.includes(e.key) || e.key === 'PageDown') { e.preventDefault(); shift(-1); } // as in the 3D ride; PageUp/Down: presenters and media remotes
  else if ('eE.+='.includes(e.key) || e.key === 'PageUp') { e.preventDefault(); shift(1); }
});

await loadSettings();
render();
const draft = await db.kvGet('pureDraft').catch(() => null);
if (draft?.samples?.length && Date.now() - draft.savedAt < 12 * 3600e3) {
  const s = sheet(`<div class="label">Unfinished ride</div><h2 class="display" style="font-size:26px;margin:8px 0">${fmtNum(draft.d / 1000, 2)} km · ${fmtTime(draft.moving)}</h2>
    <p class="hint">The last ride was not finished (page reloaded or closed).</p>
    <div class="pfoot col"><button class="btn" id="rGo">Resume ride</button><button class="btn danger" id="rDrop">Discard</button></div>`);
  $('#rGo', s).onclick = () => { const { savedAt, ...r } = draft; Object.assign(R, r, { state: 'pause' }); s.remove(); start(); };
  $('#rDrop', s).onclick = () => { dropDraft(); s.remove(); };
} else { if (draft) dropDraft(); if (DEMO && params.has('run')) start(); if (location.hash === '#sensors') sensorsSheet(); } // handy.html settings → Devices
// ---------------- gamepad (owner 18.11.: the pad must work here too, like in the 3D ride) ----------------
// L / R and D-pad ↑ ↓: ERG ±5 W, Grade: L / R shift, D-pad ±0.5 %, workout target ±1 W · L2 / R2: ±25 W, ±1 %, ±5 W
// A or Start: start / pause · B: lap · Select: next mode (ERG, Grade, Workout). Pair the pad in the computer's Bluetooth settings.
let padWas = [], padSeen = false;
function padTick() {
  requestAnimationFrame(padTick);
  const pad = navigator.getGamepads?.().find(Boolean); if (!pad) { padWas = []; return; }
  const now = padButtons(pad).map(Boolean), was = padWas, hit = i => now[i] && !was[i]; padWas = now;
  if (!was.length || $('.psheet') || !now.some((v, i) => v && !was[i])) return;
  if (!padSeen) { padSeen = true; flash('Controller ready', 1500); }
  const d = k => el.querySelector(`[data-d="${k}"]`)?.click(), up = hit(5) || hit(12), dn = hit(4) || hit(13), big = hit(7) ? 1 : hit(6) ? -1 : 0;
  if (hit(0) || hit(9) || hit(16)) R.state === 'run' ? pause() : R.state !== 'done' && start();
  else if (hit(1)) { if (R.state === 'run') lap(); }
  else if (hit(8)) setMode({ erg: 'grade', grade: 'work', work: 'erg' }[P.mode] || 'erg');
  else if (P.mode === 'work') { if (up || dn) tune(up ? 1 : -1); else if (big) tune(big * 5); }
  else if (P.mode === 'erg') { if (up || dn) d(up ? 5 : -5); else if (big) d(big * 25); }
  else if (P.mode === 'grade') { if (hit(4) || hit(5)) shift(hit(5) ? 1 : -1); else if (up || dn) d(up ? 0.5 : -0.5); else if (big) d(big); }
}
if (navigator.getGamepads) requestAnimationFrame(padTick);
clickResume();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
