// watch.html: design preview of RIDEFRAME on a Garmin watch (17.11. strength, 18.11. start menu, run / ride / other sports with
// the data pages from the phone, route page, segment popup, guided workouts). Two faces run the same js/watchflow.js:
// Forerunner 265 (416 px AMOLED) and fenix 7X Pro (280 px MIP, 64 colours: every pixel is snapped to the palette).
// 19.11.: the ready screen's Route choice: the paired watch's routes (Bearer), else the signed-in phone account's (X-RF-Token), else demo routes.
// Drawn like the watch draws (dc.fillCircle / drawText / drawArc in garmin/source/Draw.mc), driven by the five buttons,
// touch (tap, swipe) or the keyboard, with demo data or against the real API (tools/watch-api.mjs) after pairing.
// 23.11.: the indoor trainer (TSCAN, TREC, TEND, TSUM) against a pretend KICKR CORE 2 (js/watchkickr.js; the panel: in range, another app).
// 23.11.: the fenix 8 Solar face, drag scrolling on lists (pointermove), START held (button or Enter, 700 ms), the rest
// status (last sets, NEXT), END / SAVEQ screens, paged summary; __watch.texts = the fenix 8 face's drawn texts (tests).
// 24.11.: last time's values for the set small above the big numbers; the exercise list's sub line with all of last time's sets;
// no strength ready screen: Strength on the start menu opens the choice / the exercise list at once.
// 23.11.7: the wheel (a finger dragged over kg / reps / the trainer's target steps it, the neighbours show small above and below), lists
// track the finger 1:1 (dragRow), a drag is never also a tap or a swipe; the six standard workouts (watchflow STD_W) instead of demo ones.
import { newFlow, handle, SCR, tPage, curEx, setNo, restLeft, clock, sent, paired, setSetup, setConfig, setRoute, setRoutes, routeFace, routeInfo, recPages, homeItems, listItems, workouts, planItem, HOME, HOME_FIT, HOME_LAY, homeTop, holdPart, pausedTime, HOLD_S,
  LIST_LAY, healthBody, DEMO_HEALTH, dragRow, pickRows, doneOf, prefillOf, lastSet, lastTxt, loading, VERSION, stepOf, WHEEL_STEP, WHEEL_SHOW, DRAG_MIN, setRides } from './watchflow.js';
import { nextTarget } from './watchtrainer.js';
import { compact, defaults, fieldText, labelOf, TOP } from './watchfields.js';
import { shown, live as tLive } from './watchtrainer.js';
import { fakeKickr } from './watchkickr.js';
import { groupOf } from './sports.js';
import { MODES } from './theme.js';
import { FACES, snap64 } from './watchdraw.js';
import { Dc } from './watchdc.js';
import { screen, palette, LAY } from './watchscreens.js';

const $ = s => document.querySelector(s), LS = window.localStorage;
const store = { get: (k, d) => { try { const v = LS.getItem('rf_watch_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { v == null ? LS.removeItem('rf_watch_' + k) : LS.setItem('rf_watch_' + k, JSON.stringify(v)); } catch {} } };
// 27.11.: the clock can run faster (window.__watch.speed(k), the UI test rides a whole trainer workout in a few minutes)
let spd = 1, spd0 = Date.now(), spdOff = Date.now();
const now = () => (spdOff + (Date.now() - spd0) * spd) / 1000;
function speed(k) { spdOff = now() * 1000; spd0 = Date.now(); spd = k > 0 ? k : 1; }


/* ---- demo data: what GET /api/watch/strength/setup and /summary answer ---- */
const DEMO = { v: 1, unit: 'kg', rest: 90, last: { at: Math.round(now() - 2 * 86400), sets: 18, n: 'Push day' }, ex: [
  { id: 'bench', n: 'Bench press', t: 'w', s: [[80, 8], [80, 8], [80, 7]], b: 104.5 }, { id: 'squat', n: 'Squat', t: 'w', s: [[100, 5], [100, 5], [100, 5]], b: 120 },
  { id: 'pull', n: 'Pull-ups', t: 'bw', s: [[0, 10], [0, 9]], b: 12 }, { id: 'ohp', n: 'Overhead press', t: 'w', s: [[47.5, 6]], b: 58 },
  { id: 'row', n: 'Barbell row', t: 'w', s: [[70, 8]], b: 86 }, { id: 'dead', n: 'Deadlift', t: 'w', s: [[140, 3]], b: 158 },
  { id: 'dip', n: 'Dips', t: 'bw', s: [[0, 12]], b: 15 }, { id: 'lat', n: 'Lat pulldown', t: 'w', s: [[60, 10]], b: 80 },
  { id: 'legpress', n: 'Leg press', t: 'w' }, { id: 'curl', n: 'Biceps curls', t: 'w', s: [[14, 10]], b: 18.7 }, { id: 'my_thai', n: 'Thai kicks on bag', t: 'bw' } ] };
const DEMO_SUM = { pts: 245, prev: 233, delta: 12, sessions: 4, strength: 2, streak: 3 };
// 18.11.: the free picker's order (done lately, then the 20 standard exercises) and two workouts, while the account has none
for (const e of TOP) if (!DEMO.ex.some(x => x.id === e.id)) DEMO.ex.push({ ...e });
Object.assign(DEMO, { top: TOP.map(e => e.id), recent: ['bench', 'squat', 'pull'] });
// 23.11.7: no demo workouts any more: the watch has its six standard ones (js/watchflow.js STD_W), the account's come first
const demoSetup = () => ({ ...structuredClone(DEMO), workouts: cfg && cfg.w.length ? cfg.w : [] });
/** a demo route for the route page: a loop with four turns, as fractions of a square (the real ones: GET /api/watch/route, js/watchflow.js routeFace) */
function demoRoute(sp) {
  const len = sp === 'ride' ? 42000 : 8000, pts = [];
  for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 1.7 - 2.2; pts.push([.5 + .42 * Math.cos(a) + .06 * Math.sin(3 * a), .5 + .36 * Math.sin(a) * (1 + .25 * Math.cos(a))]); }
  return { sp, name: sp === 'ride' ? 'Lake loop' : 'Riverside 8k', len, pts, turns: [[.12, 'L', 'Bridge St'], [.38, 'R', 'Harbour Rd'], [.61, 'R', 'Mill Lane'], [.84, 'L', 'Park Ave']].map(([f, dir, txt]) => ({ at: f * len, dir, txt })) };
}

const DEMO_ROUTES = [{ id: 'demo-run', name: 'Riverside 8k', dist: 8000, climb: 40 }, { id: 'demo-ride', name: 'Lake loop', dist: 42000, climb: 310 }];

/* ---- app state around the flow: mode, token, queue, phone nearby ---- */
let mode = store.get('mode', 'demo'), token = store.get('token', null), who = store.get('name', ''), F, sum = null, near = true, net = '', light = false, fast = false;
let rsrc = 'demo', demoAuto = false, demoNone = false; // where the routes come from; the demo route is chosen for the sport until None is picked
let cfg = null, cfgFrom = 'defaults'; // the watch config: from the paired watch's account, else the signed-in phone account, else the defaults
const live = () => mode === 'live';
function boot() {
  const q = live() ? store.get('queue', []) : [];
  if (live()) { cfg = token ? store.get('cfg', null) : null; cfgFrom = cfg ? 'watch' : 'defaults'; }
  const o = { queue: q, cfg: cfg || compact(defaults()), last: store.get('last', 'run'), trainer: store.get('trainer', ''), tgt: store.get('tgt', 100) };
  K.paired = false; K.sub = {}; K.scanning = false;
  F = live() ? newFlow(token ? store.get('setup', null) : null, { ...o, paired: !!token }) : newFlow(demoSetup(), o);
  if (live() && token) { const rd = store.get('rides', null); if (rd) setRides(F, rd.rides, rd.ftp); } // 27.11.: the trainer's workouts (Storage "rides" on the watch)
  sum = live() ? store.get('summary', null) : DEMO_SUM; net = ''; rsrc = 'demo'; demoAuto = demoNone = false;
  if (live() && token) { refresh(); push(); }
  window.__watch = { get F() { return F; }, get mode() { return mode; }, get net() { return net; }, get cfgFrom() { return cfgFrom; }, get rsrc() { return rsrc; }, get texts() { return shown8.texts.slice(); }, get boxes() { return shown8.boxes.slice(); }, get kickr() { return K; }, get wheel() { return wheelUi; }, ev, segDemo, loadCfg, speed };
  panel(); paint(); loadCfg();
}
/** the config: the paired watch asks with its token (GET /api/watch/config), the preview without a watch with the phone login */
async function loadCfg() {
  try {
    if (live()) { if (!token || !near) return; const r = await api('GET', 'config'); if (r.ok) { cfg = r.j; cfgFrom = 'watch'; store.set('cfg', cfg); } }
    else { let a = null; try { a = JSON.parse(LS.getItem('rf_account') || 'null'); } catch {}
      if (a && a.token) { const r = await fetch('/api/watch/config', { cache: 'no-store', headers: { 'X-RF-Token': a.token } }); if (r.ok) { cfg = compact((await r.json()).config); cfgFrom = 'account'; } } }
  } catch {}
  if (cfg) { setConfig(F, cfg); if (!live()) setSetup(F, demoSetup()); }
  panel(); paint();
}
const acct = () => { try { const a = JSON.parse(LS.getItem('rf_account') || 'null'); return a && a.token ? a.token : null; } catch { return null; } };
/** a routes call: the paired watch with its token, the preview without a watch with the phone login; null = not available */
async function routeApi(path) {
  if (live()) { if (!token || !near) return null; const r = await api('GET', path); if (r.status === 401) unpair('This watch was removed on the phone.'); return r.ok ? r.j : null; }
  const t = acct(); if (!t) return null;
  const r = await fetch('/api/watch/' + path, { cache: 'no-store', headers: { 'X-RF-Token': t } }); return r.ok ? r.json() : null;
}
/** the list for RPICK (GET /api/watch/routes); in live mode without an answer it stays unknown, so the next ready screen asks again */
async function loadRoutes() {
  if (!live() && !acct()) { rsrc = 'demo'; setRoutes(F, DEMO_ROUTES); return; }
  let j = null; try { j = await routeApi('routes'); } catch {}
  if (j && Array.isArray(j.routes)) { rsrc = live() ? 'watch' : 'account'; setRoutes(F, j.routes); }
  else if (!live()) { rsrc = 'demo'; setRoutes(F, DEMO_ROUTES); }
  autoRoute(); panel(); paint();
}
/** one route (GET /api/watch/route?id=), turned into the route page's form; the demo ones are drawn from demoRoute */
async function loadRoute(id) {
  if (id.startsWith('demo-')) { setRoute(F, demoRoute(id === 'demo-ride' ? 'ride' : 'run')); return; }
  let j = null; try { j = await routeApi('route?id=' + encodeURIComponent(id)); } catch {}
  if (F.routeId !== id) return; const r = routeFace(j); setRoute(F, r); if (!r) { net = 'The route could not be loaded.'; F.routeId = null; } panel(); paint();
}
/** demo data: the demo route of the sport is chosen, until None is picked */
function autoRoute() {
  if (rsrc !== 'demo' || demoNone || F.scr !== SCR.READY || F.sp === 'other' || !F.routes) return;
  if (F.routeId == null || (demoAuto && F.routeId !== 'demo-' + F.sp)) { F.routeId = 'demo-' + F.sp; demoAuto = true; setRoute(F, demoRoute(F.sp)); }
}
async function api(method, path, body) {
  const r = await fetch('/api/watch/' + path, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j };
}
async function refresh() { // setup + summary, kept for the next start (the watch keeps them in Application.Storage)
  if (!near) return;
  try { const s = await api('GET', 'strength/setup'); if (s.status === 401) return unpair('This watch was removed on the phone.'); if (s.ok) { setSetup(F, s.j); store.set('setup', s.j); }
    const g = await api('GET', 'summary'); if (g.ok) { sum = g.j; store.set('summary', sum); }
    const c = await api('GET', 'config'); if (c.ok) { cfg = c.j; cfgFrom = 'watch'; store.set('cfg', cfg); setConfig(F, cfg); }
    const w = await api('GET', 'rides'); if (w.ok) { setRides(F, w.j.rides, w.j.ftp); store.set('rides', w.j); } } catch {}
  paint();
}
let pushing = false;
async function push() { // the queue, oldest first; kept on any network trouble, dropped only when the server refuses a session for good
  if (pushing) return; pushing = true;
  try {
    for (const s of F.queue.slice()) {
      if (!near) { sent(F, s.id, 'retry'); continue; }
      if (!live()) { await new Promise(r => setTimeout(r, 500)); sent(F, s.id, 'ok'); continue; }
      let res = 'retry';
      try { const r = await api('POST', s.tpl ? 'workout' : 'strength', s.tpl || s); /* 23.11.: a workout saved on the watch, else a session */ res = r.ok ? 'ok' : r.status === 400 || r.status === 413 ? 'drop' : 'retry'; if (r.status === 401) { unpair('This watch was removed on the phone.'); break; } } catch {}
      sent(F, s.id, res);
    }
  } finally { pushing = false; if (live()) store.set('queue', F.queue); panel(); paint(); }
  if (live() && near && F.sets.length === 0) refresh();
}
function unpair(t) { token = null; store.set('token', null); net = t || ''; F.paired = false; F.scr = SCR.PAIR; panel(); paint(); }
function drain() {
  const cues = F.cues.splice(0), out = F.out.splice(0);
  if (cues.length) buzz(cues[cues.length - 1]);
  for (const o of out) {
    if (o.k === 'send') push();
    else if (o.k === 'setup') { if (live()) refresh(); else { setSetup(F, structuredClone(DEMO)); } }
    else if (o.k === 'exit') F.scr = SCR.GLANCE;
    else if (o.k === 'pair') pairNow(o.code);
    else if (o.k === 'trainer') { store.set('trainer', F.link.want); store.set('tgt', F.tTgt); }
    else if (o.k === 'saveAct' && o.sum.sp === 'trainer') net = `Indoor ride saved on the watch (${o.sum.avgPw} W avg). The watch sends it as a VirtualRide with power and cadence (POST /api/watch/activity), the preview does not.`;
    else if (o.k === 'saveAct') net = `${o.sum.sp === 'other' ? labelOf(o.sum.type) : HOME[o.sum.sp]} saved on the watch. The watch sends it (POST /api/watch/activity), the preview does not.`;
    else if (o.k === 'routes') loadRoutes();
    else if (o.k === 'tpl') { if (live()) { store.set('setup', F.setup); if (cfg) store.set('cfg', F.cfg); } else net = 'Saved as a workout on the watch. The watch sends it (POST /api/watch/workout), the demo does not.'; }
    else if (o.k === 'route') { demoAuto = false; loadRoute(o.id); }
    else if (o.k === 'keep' && live()) store.set('setup', F.setup); // 24.11.: last time's sets of the session just finished, kept for the next start
  }
  if (F.last !== store.get('last', 'run')) store.set('last', F.last);
  autoRoute();
  if (live()) store.set('queue', F.queue);
  radio();
  panel();
}
/** the pretend trainer: every radio action of the link (F.link.act) answered a moment later, like the watch's BleDelegate callbacks */
const K = fakeKickr({ others: [{ name: 'Assioma DUO', cps: true, rssi: -74 }] });
function radio() { for (const a of F.link.act.splice(0)) { const evs = K.handle(a); evs.forEach((e, i) => setTimeout(() => ev('ble', e), 90 + i * 40)); } }
async function pairNow(code) {
  if (!live()) { mode = 'live'; store.set('mode', mode); }
  if (!near) { net = 'No phone nearby.'; paired(F, false); return paint(); }
  try { const r = await api('POST', 'pair', { code, label: 'Preview (browser)' });
    if (r.ok) { token = r.j.token; who = r.j.name; store.set('token', token); store.set('name', who); net = ''; paired(F, true, null); drain(); refresh(); }
    else { net = r.j.error || 'Pairing failed.'; paired(F, false); }
  } catch { net = 'Server not reachable.'; paired(F, false); }
  panel(); paint();
}
const ev = (e, arg) => { if (e === 'ble' && F.link.st === 'off') return; // an answer that comes after the trainer was let go
 evIn(e, arg); };
const evIn = (e, arg) => { const was = F.scr, rid = F.routeId; handle(F, e, now(), arg); if (was === SCR.RPICK && F.scr === SCR.READY && rid != null && F.routeId == null) demoNone = true; drain(); paint(); };

/* ---- drawing: js/watchscreens.js (garmin/source/Draw.mc line by line) on a js/watchdc.js Dc that measures like each watch ---- */
const PAUSE_LAY = { discard: .68, pill: .82 }; // the pause screen's Discard row and touch pill (Draw.mc drawPause, the tap table)
let wheelUi = { c: -1, scr: '', until: 0 };
let shown8 = { texts: [], boxes: [] }; // the texts drawn on the fenix 8 face (the UI test: __watch.texts / boxes)

/* ---- faces on the page: bezel, five buttons, touch ---- */
const BTN = [['light', 'LIGHT', 300], ['up', 'UP', 262], ['down', 'DOWN', 218], ['start', 'START', 60], ['back', 'BACK', 120]];
const views = [];
function mount() {
  const host = $('#faces');
  for (const f of FACES) {
    const fig = document.createElement('figure'); fig.className = `wface ${f.mip ? 'mip' : 'amoled'}`; fig.dataset.face = f.id; fig.style.setProperty('--S', f.S + 'px');
    fig.innerHTML = `<div class="wscale"><div class="wbody">${BTN.map(([k, l, a]) => `<button class="wbtn ${k}" data-k="${k}" style="--a:${a}deg" aria-label="${l}"><i></i><span>${l}</span></button>`).join('')}
      <div class="wbezel">${f.mip ? '<b></b><b></b><b></b><b></b>' : ''}<canvas width="${f.S}" height="${f.S}" aria-label="${f.name} screen"></canvas><div class="wbuzz"></div></div></div></div>
      <figcaption><b>${f.name}</b><span>${f.sub}</span></figcaption>`;
    host.append(fig);
    const cv = fig.querySelector('canvas'), dpr = f.mip ? 1 : Math.min(3, window.devicePixelRatio || 1);
    cv.width = cv.height = f.S * dpr; const g = cv.getContext('2d'); views.push({ f, fig, cv, g, dpr });
    fig.querySelectorAll('.wbtn').forEach(b => holdable(b, b.dataset.k));
    touch(cv, f);
  }
  scale(); window.addEventListener('resize', scale);
}
function scale() { // phones: the watch shrinks to fit (the buttons stay clickable, taps are mapped back to watch pixels)
  for (const v of views) { const room = Math.min(document.documentElement.clientWidth - 32, 900), need = v.f.S + 170, k = Math.min(1, room / need); v.fig.style.setProperty('--k', k); }
}
function holdable(el, k) { // UP / DOWN: short = one step, held = big steps every 350 ms; BACK held = menu
  let t = 0, rep = 0, held = false;
  const down = e => { e.preventDefault(); el.classList.add('on'); held = false; clearTimeout(t); clearInterval(rep); if (k === 'back') ev('holdStart'); // the pause screen's hold to finish
    if (k === 'up' || k === 'down') t = setTimeout(() => { held = true; ev(k + 'Hold'); rep = setInterval(() => ev(k + 'Hold'), 350); }, 500);
    if (k === 'back') t = setTimeout(() => { held = true; ev('menu'); }, 700);
    if (k === 'start') t = setTimeout(() => { held = true; ev('startHold'); }, 700); }; // the set screen: weight <-> reps
  const up = e => { if (!el.classList.contains('on')) return; el.classList.remove('on'); clearTimeout(t); clearInterval(rep); if (k === 'back') ev('holdEnd'); if (held) return;
    if (k === 'light') { light = !light; paint(); return; } ev(k); };
  el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', () => { if (el.classList.contains('on')) { el.classList.remove('on'); clearTimeout(t); clearInterval(rep); if (k === 'back') ev('holdEnd'); } });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
function touch(cv, f) {
  let p0 = null;
  let pillHold = false; // the pause screen's "Hold to finish" pill (touch face): pressed = holdStart, lifted = holdEnd
  const onPill = e => { const r = cv.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height; return !f.mip && F.scr === SCR.PAUSE && F.pz && !F.pz.conf && v > PAUSE_LAY.pill - .07 && Math.abs(u - .5) < .27; };
  cv.addEventListener('pointerdown', e => { p0 = { x: e.clientX, y: e.clientY, y1: e.clientY, mode: '', col: 0 }; cv.setPointerCapture?.(e.pointerId); if (onPill(e)) { pillHold = true; ev('holdStart'); } });
  // 23.11.7 (FlowDelegate.onDrag on the watch): once the finger has moved DRAG_MIN up or down the drag is decided by where it started:
  // over the set screen's numbers / the trainer's target the wheel (one step per WHEEL_STEP, finger up = more), on a list the list
  // (one row per row distance as drawn); the movement is summed (the remainder kept), and the lift after it is no tap and no swipe
  cv.addEventListener('pointermove', e => { if (!p0 || pillHold || p0.mode === 'none') return; const r = cv.getBoundingClientRect(), k = f.S / r.width;
    if (!p0.mode) { const dx = Math.abs(e.clientX - p0.x) * k, dy = Math.abs(e.clientY - p0.y) * k; if (Math.max(dx, dy) < f.S * DRAG_MIN) return;
      const m = dy > dx ? dragMode((p0.x - r.left) / r.width, (p0.y - r.top) / r.height, f) : null; p0.mode = m ? m[0] : 'none'; if (!m) return; p0.col = m[1];
      if (p0.mode === 'wheel') { wheelUi = { c: p0.col, scr: F.scr, until: Infinity }; paint(); } }
    const wh = p0.mode === 'wheel', step = f.S * (wh ? WHEEL_STEP : dragRow(F.scr)), n = Math.trunc((p0.y1 - e.clientY) * k / step);
    if (n) { p0.y1 -= n * step / k; ev(wh ? 'wheel' : 'scroll', wh ? [p0.col, n] : n); } });
  const lift = () => { if (p0 && p0.mode === 'wheel') { wheelUi.until = now() + WHEEL_SHOW; setTimeout(paint, WHEEL_SHOW * 1000 + 30); } };
  cv.addEventListener('pointercancel', () => { if (pillHold) { pillHold = false; ev('holdEnd'); } lift(); p0 = null; });
  cv.addEventListener('pointerup', e => {
    if (pillHold) { pillHold = false; p0 = null; ev('holdEnd'); return; }
    if (!p0) return; lift(); const r = cv.getBoundingClientRect(), k = f.S / r.width, dx = (e.clientX - p0.x) * k, dy = (e.clientY - p0.y) * k, drag = p0.mode === 'wheel' || p0.mode === 'list'; p0 = null; if (drag) return;
    if (Math.hypot(dx, dy) > f.S * .08) return ev(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'swipeLeft' : 'swipeRight') : (dy < 0 ? 'swipeUp' : 'swipeDown'));
    tapAt((e.clientX - r.left) * k / f.S, (e.clientY - r.top) * k / f.S, f);
  });
}
/** 23.11.7: what a vertical drag that starts at (u, v) does (FlowDelegate.dragModeAt): ['wheel', column] over the set screen's numbers
 *  (timed: the seconds) or the trainer's target, ['list'] on a list, null = nothing (the lift is a swipe then) */
function dragMode(u, v, f) {
  if (F.flash) return null; const L = f.lay || LAY;
  if (F.scr === SCR.SET && v > .36 && v < .72) return ['wheel', curEx(F).t === 'time' || u >= .51 ? 1 : 0];
  if (F.scr === SCR.TREC && F.tr && tPage(F) === 'target' && v > L.t0 && v < L.t1) return ['wheel', 0];
  return scrollable() ? ['list', 0] : null;
}
/** the screens a dragged finger scrolls (FlowDelegate.scrollable) */
const scrollable = () => ([SCR.PICK, SCR.MENU, SCR.HOME, SCR.MORE, SCR.SMODE, SCR.RPICK, SCR.END, SCR.SAVEQ, SCR.SUM, SCR.TEND, SCR.TPICK].includes(F.scr) || F.scr === SCR.TSCAN && tList()) && !F.flash;
/** the trainer screen shows the list (searching), not one trainer's state */
const tList = () => ['scan', 'off'].includes(shown(F.link));
/** the row drawn nearest to v (within 0.09 S): [offset, y] or null (23.11.8: the rows as the face drew them, js/watchscreens.js LAY) */
const rowAt = (rows, v) => { let b = null; for (const r of rows) if (Math.abs(r[1] - v) < .09 && (!b || Math.abs(r[1] - v) < Math.abs(b[1] - v))) b = r; return b; };
/** a tap in face coordinates (0..1) on face f -> the flow's event; the same table is in garmin/source/FlowDelegate.mc onTap */
function tapAt(u, v, f) {
  const s = F.scr, L = f.lay || LAY;
  if (F.flash) return ev('tap');
  if (s === SCR.SET) { if (v > .72 && Math.abs(u - .5) < .24) return ev('done'); if (v > .36 && v < .72) return ev('focus', u < .51 ? 0 : 1); return; } // DONE logs; a value takes the focus
  if (s === SCR.READY && F.sp !== 'other' && L.route > 0 && Math.abs(v - L.route) < .04) return ev('down'); // the route line
  if (s === SCR.TREC) { if (F.tr && tPage(F) !== 'target') return ev('tap'); // another page: back to the target page
    if (v > L.t0 && v < L.t1) return ev('item', u < .31 ? 0 : u > .69 ? 1 : 2); // - / + (the whole side) and the target (step size)
    if (v > .78 && F.tr && F.tr.st !== 'run') return ev('start'); return; } // the resume pill
  if (s === SCR.THR || s === SCR.TSCAN && !tList()) return ev('tap');
  if (s === SCR.PAUSE) { const P = F.pz || {}; // conf: the Discard pill = yes, elsewhere = no; else Discard row = ask, the top = resume
    if (P.conf) return ev(Math.abs(v - PAUSE_LAY.discard) < .06 ? 'start' : 'back');
    if (Math.abs(v - PAUSE_LAY.discard) < .055) return ev('item', 1); if (v < .62) return ev('item', 0); return; }
  const menu = [SCR.MENU, SCR.END, SCR.SAVEQ, SCR.TEND].includes(s), pick = [SCR.PICK, SCR.MORE, SCR.SMODE, SCR.RPICK, SCR.TSCAN, SCR.TPICK].includes(s);
  if (s === SCR.HOME) { const n = listItems(F).length, r = rowAt(L.rows, v), i = r ? homeTop(F.sel, n) + r[0] : -1; // the rows as drawn
    if (i >= 0 && i < n) ev('item', i); return; }
  if (menu || pick) { const r = rowAt(L.rows, v), n = listItems(F).length, i = r ? F.sel + r[0] : -1; // the title, the counter: no row
    if (i >= 0 && i < n) ev('item', i); return; }
  if (s === SCR.PAIR) { if (v > .4 && v < .6 && u > .13 && u < .87) return ev('focus', Math.min(5, Math.max(0, Math.floor((u - .146) / .118)))); return ev('tap'); }
  ev('tap');
}
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'start', ' ': 'start', Escape: 'back', Backspace: 'back' };
function keys() {
  const st = {};
  addEventListener('keydown', e => { if (e.target.closest?.('input, textarea, select')) return; const k = KEYS[e.key]; if (e.key === 'ArrowLeft') { e.preventDefault(); return ev('swipeLeft'); } if (e.key === 'ArrowRight') { e.preventDefault(); return ev('swipeRight'); }
    if (e.key === 'm') return ev('menu'); if (!k) return; e.preventDefault(); if (e.repeat) return; if (k === 'back') ev('holdStart');
    st[k] = { at: Date.now(), held: false, t: setTimeout(function hold() { st[k].held = true; if (k === 'back') return ev('menu'); if (k === 'start') return ev('startHold'); if (k === 'up' || k === 'down') { ev(k + 'Hold'); st[k].t = setTimeout(hold, 350); } }, k === 'back' || k === 'start' ? 700 : 500) }; });
  addEventListener('keyup', e => { const k = KEYS[e.key]; if (!k || !st[k]) return; clearTimeout(st[k].t); const h = st[k].held; delete st[k]; if (k === 'back') ev('holdEnd'); if (!h) ev(k); });
}

/* ---- vibration shown on the page: the watch shakes, a ring pulses ---- */
let buzzT = 0;
function buzz(kind) { if (kind === 'tick') { const b = $('#wCue'); if (b) b.textContent = 'Vibration: tick (one wheel step, 20 ms)'; return; } // 23.11.7: too short to shake the preview
  for (const v of views) { v.fig.classList.remove('buzz', 'long'); void v.fig.offsetWidth; v.fig.classList.add('buzz'); if (kind === 'pr' || kind === 'rest') v.fig.classList.add('long'); }
  clearTimeout(buzzT); buzzT = setTimeout(() => views.forEach(v => v.fig.classList.remove('buzz', 'long')), 1200); const b = $('#wCue'); if (b) { b.textContent = { set: 'Vibration: short (set saved)', pr: 'Vibration: long double (record)', rest: 'Vibration: triple (rest over)', done: 'Vibration: long (finished)', error: 'Vibration: short double (no reps)',
  start: 'Vibration: short (timer started)', stop: 'Vibration: double (paused)', lap: 'Vibration: long (lap)', seg: 'Vibration: double (segment)' }[kind] || ''; } }

/* ---- 64-colour MIP: every pixel snapped to the palette (channels 00 / 55 / AA / FF), no soft edges, no transparency ---- */
function paint() {
  for (const { f, g, dpr } of views) {
    const S = f.S, C = f.C; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = C.bg; g.fillRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
    const dc = new Dc({ dev: f.id, g }); screen(dc, F, palette(!f.mip), now(), sum, { hasTouch: f.touch, wheel: wheelUi });
    f.lay = { rows: LAY.rows.slice(), route: LAY.route, t0: LAY.t0, t1: LAY.t1 }; // where this face drew its rows (tapAt)
    if (f.id === 'fenix8solar47mm') shown8 = { texts: dc.texts.map(t => t.t), boxes: dc.texts.map(t => [t.t, t.x0, t.iy0, t.x1, t.iy1]) };
    g.restore();
    if (f.mip) { if (light) { g.globalCompositeOperation = 'lighter'; g.fillStyle = '#003355'; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over'; } snap64(g, S); }
  }
  const s = $('#wScr'); if (s) s.textContent = F.scr;
}

/* ---- the panel next to the faces ---- */
function panel() {
  const p = $('#wPanel'); if (!p) return;
  const q = F.queue.length;
  p.querySelector('#wMode').innerHTML = [['demo', 'Demo data'], ['live', 'My account']].map(([k, l]) => `<button data-mode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('');
  p.querySelector('#wState').textContent = live() ? (token ? `Paired${who ? ' with ' + who : ''}. Sessions go to this account.` : 'Not paired. On the phone: Settings, Devices, Garmin watch, Pair a watch. Enter the code here on the watch.') : 'Demo data. Nothing is sent.';
  p.querySelector('#wNet').textContent = [net, q ? `${q} ${q === 1 ? 'session waits' : 'sessions wait'} for the phone.` : ''].filter(Boolean).join(' ');
  p.querySelector('#wUnpair').hidden = !(live() && token);
  p.querySelector('#wCfg').textContent = cfgFrom === 'defaults' ? 'Screens and workouts: defaults. Sign in on the phone (Settings, Devices, Watch) to use your own.' : `Screens and workouts: from ${cfgFrom === 'watch' ? 'the paired account' : 'your account'}.`;
  p.querySelector('#wRoutes').textContent = rsrc === 'demo' ? 'Routes: two demo routes.' : `Routes: ${F.routes ? F.routes.length : 0} sent from the phone (Routes, Send to watch).`;
  const hw = p.querySelector('#wHealth'); if (hw) { const h = healthBody(live() ? null : DEMO_HEALTH, now()); // 25.11.: what the watch sends at its start (POST /api/watch/health)
    hw.textContent = h ? `Recovery values (demo, not sent): sleep ${h.ss} · body battery ${h.bb} · resting HR ${h.rhr} · recovery ${Math.round(h.rt / 60)} h. The watch sends Garmin's own at every start.` : 'Recovery values: the watch sends Garmin\'s own (sleep score, body battery, resting HR …) at every start.'; }
  p.querySelector('#wSeg').disabled = !(F.rec && F.sp !== 'other' && F.scr === SCR.REC);
  p.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (mode === b.dataset.mode) return; mode = b.dataset.mode; store.set('mode', mode); boot(); });
}
function wirePanel() {
  $('#wNear').onchange = e => { near = e.target.checked; if (near && F.queue.length) push(); panel(); };
  $('#wGlance').onclick = () => { F.scr = SCR.GLANCE; paint(); };
  $('#wRestart').onclick = () => boot();
  $('#wSeg').onclick = segDemo;
  $('#wFast').onchange = e => { fast = e.target.checked; };
  $('#wKOn').onchange = e => { K.on = e.target.checked; if (!K.on && K.paired) { K.paired = false; K.sub = {}; ev('ble', { k: 'drop' }); } }; // out of range: the link drops
  $('#wKRefuse').onchange = e => { K.refuse = e.target.checked; };
  $('#wUnpair').onclick = () => { if (confirm('Forget the pairing on this preview watch?')) unpair('Unpaired.'); };
}

mount(); keys(); wirePanel(); boot();
setInterval(() => { handle(F, 'tick', now()); drain(); paint(); }, 200);
setInterval(() => { const base = F.scr === SCR.REST ? 128 - Math.min(30, (now() - (F.restEnd - F.restLen)) * .5) : F.start ? 112 : 72; ev('hr', Math.round(base + Math.random() * 6)); }, 2000); // a simulated heart rate (Sensor on the watch)
setInterval(() => { if (F.queue.length && near) push(); }, 30e3); // retry, like the watch does on its timer
setInterval(() => { if (F.rec && F.rec.st === 'run') ev('sample', simSample(fast ? 10 : 1)); }, 1000);
// the pretend trainer's data once a second: in ERG it holds the target (a little noise), else what the legs give
setInterval(() => { if (K.scanning && K.on) for (const e of K.handle({ k: 'scan', on: true })) ev('ble', e); // a scan keeps reporting what is in range
  if (!K.paired || !K.on || !K.sub.ibd) return; const t = now(), erg = F.link.ctl && K.tgt > 0; ev('ble', K.data((erg ? K.tgt : 150) + 6 * Math.sin(t * 1.7) + 3 * Math.sin(t / 3), 88 + 3 * Math.sin(t / 5))); }, 1000); // GPS and sensors while recording (Position / Sensor on the watch)
/** one simulated second (or ten): a steady run at about 5:10 /km, a ride at about 34 km/h with power, other sports by heart rate */
function simSample(dt) {
  const t = now(), w = Math.sin(t / 7), sp = F.sp;
  if (sp === 'run') return { dt, v: 3.22 + .12 * w, hr: Math.round(150 + 4 * w), cad: Math.round(172 + 2 * w), up: .04 * dt };
  if (sp === 'ride') return { dt, v: 9.4 + 1.2 * w, hr: Math.round(142 + 5 * w), cad: Math.round(88 + 3 * w), pw: Math.round(232 + 40 * Math.sin(t / 3) + 20 * w), up: .12 * dt };
  return { dt, v: ['Walk', 'Hike'].includes(F.type) ? 1.35 : 0, hr: Math.round(118 + 8 * w) };
}
/** the segment sequence the phone's segment tracker will send: warning with a countdown, then live against the PR, then the result */
let segT = [];
function segDemo() {
  if (!F.rec || F.sp === 'other') return; segT.forEach(clearTimeout); segT = [];
  const ride = F.sp === 'ride', name = ride ? 'Col de la Croix climb' : 'Riverside sprint', len = ride ? 2400 : 800, need = ride ? 10.6 : 3.63, pr = ride ? 244 : 221;
  const at = (ms, a) => segT.push(setTimeout(() => ev('seg', { name, len, ...a }), ms));
  for (let i = 0; i <= 6; i++) at(i * 1000, { k: 'warn', eta: 30 - i * 5, pr });
  const deltas = [-4, -4, -3, -2, -1, 1, 2, 1, -1, -2, -3, -3];
  deltas.forEach((d, i) => at(7000 + i * 1000, { k: 'live', done: (i + 1) / deltas.length * len * .96, delta: d, need }));
  at(7000 + deltas.length * 1000, { k: 'end', time: pr - 3, delta: -3, pr: true });
}
document.fonts?.ready.then(paint);
