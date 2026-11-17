// watch.html: design preview of RIDEFRAME on a Garmin watch (17.11. strength, 18.11. start menu, run / ride / other sports with
// the data pages from the phone, route page, segment popup, guided workouts). Two faces run the same js/watchflow.js:
// Forerunner 265 (416 px AMOLED) and fenix 7X Pro (280 px MIP, 64 colours: every pixel is snapped to the palette).
// 19.11.: the ready screen's Route choice: the paired watch's routes (Bearer), else the signed-in phone account's (X-RF-Token), else demo routes.
// Drawn like the watch draws (dc.fillCircle / drawText / drawArc in garmin/source/Draw.mc), driven by the five buttons,
// touch (tap, swipe) or the keyboard, with demo data or against the real API (tools/watch-api.mjs) after pairing.
import { newFlow, handle, SCR, curEx, setNo, restLeft, clock, sent, paired, setSetup, setConfig, setRoute, setRoutes, routeFace, routeInfo, recPages, homeItems, listItems, workouts, planItem, HOME, HOME_FIT, HOME_LAY, homeTop } from './watchflow.js';
import { compact, defaults, fieldText, labelOf, TOP } from './watchfields.js';
import { groupOf } from './sports.js';
import { MODES } from './theme.js';
import { FACES, tint, DEG, txt, pill, arc, line, dot, startHint, tri, heart, icon, SPORT_ICON, drawPage, pageDots, recRing, snap64 } from './watchdraw.js';

const $ = s => document.querySelector(s), LS = window.localStorage;
const store = { get: (k, d) => { try { const v = LS.getItem('rf_watch_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { v == null ? LS.removeItem('rf_watch_' + k) : LS.setItem('rf_watch_' + k, JSON.stringify(v)); } catch {} } };
const now = () => Date.now() / 1000;


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
const DEMO_W = [{ id: 'd1', n: 'Push day', it: [['bench', 3, 8, 80, 120], ['ohp', 3, 8, 45, 90], ['dip', 3, 10, 0, 90], ['lateral', 3, 12, 10, 60]] },
  { id: 'd2', n: 'Leg day', it: [['squat', 4, 5, 100, 150], ['rdl', 3, 8, 80, 120], ['lunge', 3, 10, 20, 90], ['plank', 2, 60, 0, 60]] }];
const demoSetup = () => ({ ...structuredClone(DEMO), workouts: cfg && cfg.w.length ? cfg.w : DEMO_W });
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
  const o = { queue: q, cfg: cfg || compact(defaults()), last: store.get('last', 'run') };
  F = live() ? newFlow(token ? store.get('setup', null) : null, { ...o, paired: !!token }) : newFlow(demoSetup(), o);
  sum = live() ? store.get('summary', null) : DEMO_SUM; net = ''; rsrc = 'demo'; demoAuto = demoNone = false;
  if (live() && token) { refresh(); push(); }
  window.__watch = { get F() { return F; }, get mode() { return mode; }, get net() { return net; }, get cfgFrom() { return cfgFrom; }, get rsrc() { return rsrc; }, ev, segDemo, loadCfg };
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
    const c = await api('GET', 'config'); if (c.ok) { cfg = c.j; cfgFrom = 'watch'; store.set('cfg', cfg); setConfig(F, cfg); } } catch {}
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
      try { const r = await api('POST', 'strength', s); res = r.ok ? 'ok' : r.status === 400 || r.status === 413 ? 'drop' : 'retry'; if (r.status === 401) { unpair('This watch was removed on the phone.'); break; } } catch {}
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
    else if (o.k === 'saveAct') net = `${o.sum.sp === 'other' ? labelOf(o.sum.type) : HOME[o.sum.sp]} saved on the watch. The watch sends it (POST /api/watch/activity), the preview does not.`;
    else if (o.k === 'routes') loadRoutes();
    else if (o.k === 'route') { demoAuto = false; loadRoute(o.id); }
  }
  if (F.last !== store.get('last', 'run')) store.set('last', F.last);
  autoRoute();
  if (live()) store.set('queue', F.queue);
  panel();
}
async function pairNow(code) {
  if (!live()) { mode = 'live'; store.set('mode', mode); }
  if (!near) { net = 'No phone nearby.'; paired(F, false); return paint(); }
  try { const r = await api('POST', 'pair', { code, label: 'Preview (browser)' });
    if (r.ok) { token = r.j.token; who = r.j.name; store.set('token', token); store.set('name', who); net = ''; paired(F, true, null); drain(); refresh(); }
    else { net = r.j.error || 'Pairing failed.'; paired(F, false); }
  } catch { net = 'Server not reachable.'; paired(F, false); }
  panel(); paint();
}
const ev = (e, arg) => { const was = F.scr, rid = F.routeId; handle(F, e, now(), arg); if (was === SCR.RPICK && F.scr === SCR.READY && rid != null && F.routeId == null) demoNone = true; drain(); paint(); };

/* ---- drawing: one function per screen, in watch pixels; the same numbers as Draw.mc ---- */
function dumbbell(g, x, y, s, col) { g.strokeStyle = col; g.lineWidth = s * .13; g.lineCap = 'round'; g.beginPath(); const p = (a, b, c, d) => { g.moveTo(x + (a - 12) * s / 24, y + (b - 12) * s / 24); g.lineTo(x + (c - 12) * s / 24, y + (d - 12) * s / 24); };
  p(3, 9, 3, 15); p(6, 7, 6, 17); p(18, 7, 18, 17); p(21, 9, 21, 15); p(6, 12, 18, 12); g.stroke(); }
const kgTxt = kg => (Math.round(kg * 10) / 10).toString();
const volTxt = v => v >= 10000 ? (Math.round(v / 100) / 10) + ' t' : Math.round(v).toLocaleString('en-GB');
const ago = t => { const d = Math.floor((now() - t) / 86400); return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : new Date(t * 1000).toLocaleDateString('en-GB', { weekday: 'short' }); };

const DRAW = {
  [SCR.START](g, S, C) {
    const L = F.setup.last; startHint(g, S, C);
    let w = txt(g, 'RIDE', 0, -99, S * .055, C.fg, { w: 900 }); const w2 = g.measureText('FRAME').width, x0 = S / 2 - (w + w2) / 2;
    txt(g, 'RIDE', x0, S * .2, S * .055, C.fg, { al: 'left', w: 900 }); txt(g, 'FRAME', x0 + w, S * .2, S * .055, C.acc, { al: 'left', w: 900 });
    dumbbell(g, S / 2, S * .31, S * .1, C.acc);
    txt(g, 'Strength', S / 2, S * .44, S * .13, C.fg, { w: 900, max: S * .8 });
    txt(g, L ? `${ago(L.at)}, ${L.sets} sets` : F.setup.ex.length ? 'First session' : 'Loading', S / 2, S * .56, S * .06, C.dim, { w: 600, max: S * .7 });
    if (sum && sum.pts != null) { const t = `${Math.round(sum.pts)} pts`, d = sum.delta || 0; const tw = txt(g, t, 0, -99, S * .058, C.fg, { w: 700 });
      txt(g, t, S / 2 - S * .04, S * .66, S * .058, C.fg, { w: 700 }); if (d) { tri(g, S / 2 + tw / 2 + S * .01, S * .66, S * .018, d > 0, C.acc); txt(g, Math.abs(Math.round(d)), S / 2 + tw / 2 + S * .035, S * .66, S * .05, C.acc, { al: 'left', w: 700 }); } }
    pill(g, S / 2, S * .81, S * .42, S * .13, C.acc); txt(g, 'START', S / 2, S * .812, S * .062, C.ink, { w: 900 });
  },
  [SCR.PICK](g, S, C) { list(g, S, C, listItems(F), F.sel, 'EXERCISE', i => { const e = F.setup.ex[F.list[i]]; return e.s ? setTxt(e, e.s[0][0], e.s[0][1]) : 'New'; }); },
  [SCR.SMODE](g, S, C) { list(g, S, C, listItems(F), F.sel, 'STRENGTH', null, true); txt(g, F.sel ? 'Pick as you go' : `${workouts(F).length} from the phone`, S / 2, S * .81, S * .05, C.fg, { w: 700, max: S * .6 }); },
  [SCR.WPICK](g, S, C) { list(g, S, C, listItems(F), F.sel, 'WORKOUT', i => { const w = workouts(F)[i]; return `${w.it.length} exercises · ${w.it.reduce((a, x) => a + x[1], 0)} sets`; }); },
  [SCR.HOME](g, S, C) { // all four entries at once (HOME_FIT rows), the selected one as the orange pill; the week points below
    const items = homeItems(F), n = items.length, top = homeTop(F.sel, n), V = HOME_LAY;
    let w = txt(g, 'RIDE', 0, -99, S * .045, C.fg, { w: 900 }); const w2 = g.measureText('FRAME').width, x0 = S / 2 - (w + w2) / 2;
    txt(g, 'RIDE', x0, S * V.logo, S * .045, C.fg, { al: 'left', w: 900 }); txt(g, 'FRAME', x0 + w, S * V.logo, S * .045, C.acc, { al: 'left', w: 900 });
    for (let r = 0; r < HOME_FIT; r++) { const i = top + r; if (i >= n) break; const k = items[i], y = S * (V.y0 + r * V.dy);
      if (i === F.sel) { pill(g, S / 2, y, S * V.w, S * V.h, C.acc); icon(g, SPORT_ICON[k], S * .25, y, S * .085, C.ink, 2.6); txt(g, HOME[k], S * .33, y + 1, S * .075, C.ink, { al: 'left', w: 900, max: S * .45 }); }
      else { icon(g, SPORT_ICON[k], S * .25, y, S * .075, C.acc, 2.4); txt(g, HOME[k], S * .33, y, S * .07, C.fg, { al: 'left', w: 800, max: S * .45 }); } }
    if (sum && sum.pts != null) { const t = `${Math.round(sum.pts)} pts`, d = Math.round(sum.delta || 0), tw = txt(g, t, 0, -99, S * .05, C.fg, { w: 800 }), dw = d ? S * .07 + String(Math.abs(d)).length * S * .03 : 0, x = S / 2 - (tw + dw) / 2;
      txt(g, t, x, S * V.pts, S * .05, C.fg, { al: 'left', w: 800 }); if (d) { tri(g, x + tw + S * .035, S * V.pts, S * .018, d > 0, C.good); txt(g, Math.abs(d), x + tw + S * .06, S * V.pts, S * .045, C.good, { al: 'left', w: 800 }); } }
    if (n > HOME_FIT) scrollArc(g, S, C, F.sel, n); startHint(g, S, C);
  },
  [SCR.MORE](g, S, C) { C = tint(C, 'other'); const n = listItems(F).length; list(g, S, C, listItems(F), F.sel, 'MORE SPORTS', i => (MODES[groupOf(F.cfg.more[i][0])] || MODES.other).name);
    if (!n) { txt(g, 'Choose sports in the app:', S / 2, S * .62, S * .048, C.fg, { w: 700, max: S * .7 }); txt(g, 'Settings > Watch > More', S / 2, S * .69, S * .048, C.fg, { w: 700, max: S * .7 }); } },
  [SCR.READY](g, S, C) {
    C = tint(C, F.sp); startHint(g, S, C);
    dot(g, S / 2, S * .25, S * .1, C.acc); icon(g, SPORT_ICON[F.sp], S / 2, S * .25, S * .12, C.ink, 2.6);
    txt(g, F.sp === 'other' ? labelOf(F.type) : HOME[F.sp], S / 2, S * .445, S * .115, C.fg, { w: 900, max: S * .8 });
    if (F.sp === 'other') { heart(g, S / 2 - S * .1, S * .565, S * .045, C.hr); txt(g, F.hr ? `${F.hr} bpm` : 'Heart rate', S / 2 - S * .06, S * .565, S * .055, C.fg, { al: 'left', w: 800 }); }
    else { dot(g, S / 2 - S * .135, S * .565, S * .02, C.good); txt(g, 'GPS ready', S / 2 - S * .1, S * .565, S * .055, C.good, { al: 'left', w: 800 }); }
    const pg = recPages(F), n = pg.filter(p => p !== 'route').length;
    if (F.sp === 'other') txt(g, `${n} data ${n === 1 ? 'page' : 'pages'}`, S / 2, S * .655, S * .048, C.lbl, { w: 800, max: S * .62 });
    else { // the route line: UP / DOWN or a tap opens the choice (RPICK)
      txt(g, `${n} data ${n === 1 ? 'page' : 'pages'}${pg.includes('route') ? ' + route' : ''}`, S / 2, S * .64, S * .044, C.lbl, { w: 800, max: S * .62 });
      const r = F.routeId && F.routes ? F.routes.find(x => x.id === F.routeId) : null;
      txt(g, r ? (F.route ? 'Route: ' + r.name : 'Loading route') : 'No route', S / 2, S * .7, S * .05, r ? C.acc : C.fg, { w: 900, max: S * .6 });
    }
    pill(g, S / 2, S * .81, S * .42, S * .13, C.acc); txt(g, 'START', S / 2, S * .812, S * .062, C.ink, { w: 900 });
  },
  [SCR.REC](g, S, C) {
    C = tint(C, F.sp); const R = F.rec, pages = recPages(F), i = R.pg % pages.length, pg = pages[i];
    if (F.seg && !F.seg.hide) return segScreen(g, S, C);
    if (pg === 'route') routePage(g, S, C); else drawPage(g, S, C, F.sp, pg, id => fieldText(id, R, now()));
    recRing(g, S, C, !R.auto); pageDots(g, S, C, pages.length, i);
    if (R.auto) { pill(g, S / 2, S * .06, S * .36, S * .062, C.acc); txt(g, 'AUTO PAUSE', S / 2, S * .061, S * .036, C.ink, { w: 900 }); }
  },
  [SCR.RPICK](g, S, C) { C = tint(C, F.sp); list(g, S, C, listItems(F), F.sel, 'ROUTE', i => { if (!i) return 'Data pages only'; const r = F.routes[i - 1]; return `${kmTxt(r.dist || 0)} km${r.climb ? ` · ${Math.round(r.climb)} m up` : ''}`; });
    if (F.routes && !F.routes.length) txt(g, rsrc === 'demo' || live() ? 'Send routes from the phone' : 'Phone: Routes > Send to watch', S / 2, S * .81, S * .042, C.lbl, { w: 700, max: S * .62 }); },
  [SCR.PAUSE](g, S, C) { C = tint(C, F.sp); list(g, S, C, listItems(F), F.sel, 'PAUSED · ' + clock(F.rec ? F.rec.t : 0), null, true); },
  [SCR.RSUM](g, S, C) {
    const s = F.rsum || { sp: 'run', t: 0, d: 0, kcal: 0 }; C = tint(C, s.sp);
    txt(g, '✓ SAVED', S / 2, S * .16, S * .058, C.acc, { w: 900 });
    txt(g, clock(s.t), S / 2, S * .33, S * .16, C.fg, { w: 900 }); txt(g, 'TIME', S / 2, S * .435, S * .042, C.lbl, { w: 800 });
    const mid = s.sp === 'ride' ? [(s.t ? s.d / s.t * 3.6 : 0).toFixed(1), 'KM/H'] : s.sp === 'run' ? [paceTxt(s.t, s.d), '/KM'] : [Math.round(s.kcal), 'KCAL'];
    const col = [[kmTxt(s.d), 'KM'], mid, s.sp === 'ride' ? [Math.round(s.avgPw), 'AVG W'] : s.sp === 'run' ? [Math.round(s.kcal), 'KCAL'] : [s.laps, 'LAPS']];
    col.forEach(([v, l], i) => { const x = S * (.27 + i * .23); txt(g, v, x, S * .59, S * .08, C.fg, { w: 900, max: S * .22 }); txt(g, l, x, S * .665, S * .04, C.lbl, { w: 800 }); });
    txt(g, s.sp === 'other' ? labelOf(s.type) : HOME[s.sp], S / 2, S * .76, S * .05, C.acc, { w: 900, max: S * .6 });
    txt(g, 'DONE', S / 2, S * .86, S * .05, C.lbl, { w: 900 });
  },
  [SCR.MENU](g, S, C) { list(g, S, C, F.menu, F.sel, 'MENU', null, true); },
  [SCR.SET](g, S, C) {
    const e = curEx(F); startHint(g, S, C);
    txt(g, clock(now() - F.start), S / 2, S * .12, S * .048, C.dim, { w: 700 });
    txt(g, e.n, S / 2, S * .22, S * .08, C.fg, { w: 800, max: S * .74 });
    const it = planItem(F); txt(g, it ? `SET ${setNo(F)} OF ${it[1]}` : 'SET ' + setNo(F), S / 2, S * .315, S * .055, C.acc, { w: 900 });
    if (e.t === 'time') { txt(g, clock(F.reps), S / 2, S * .5, S * .23, C.acc, { w: 900 }); g.fillStyle = C.acc; g.fillRect(S * .36, S * .615, S * .28, S * .016); txt(g, 'hold', S / 2, S * .665, S * .048, C.fg, { w: 700 }); }
    else { const bw = e.t === 'bw', val = [bw && !F.kg ? 'BW' : kgTxt(F.kg), String(F.reps)], unit = [bw ? '+kg' : 'kg', 'reps'], xs = [S * .285, S * .735];
      txt(g, '×', S * .515, S * .5, S * .08, C.dim, { w: 600 });
      for (const i of [0, 1]) { const on = F.focus === i; txt(g, val[i], xs[i], S * .5, S * .21, on ? C.acc : C.fg, { w: 900, max: i ? S * .27 : S * .32 });
        if (on) { g.fillStyle = C.acc; g.fillRect(xs[i] - S * .12, S * .615, S * .24, S * .016); } txt(g, unit[i], xs[i], S * .665, S * .048, on ? C.fg : C.lbl, { w: 700 }); } }
    pill(g, S / 2, S * .815, S * .4, S * .12, C.acc); txt(g, 'DONE', S / 2, S * .817, S * .062, C.ink, { w: 900 });
  },
  [SCR.REST](g, S, C) {
    const left = restLeft(F, now()), part = F.restLen ? Math.max(0, Math.min(1, (F.restEnd - now()) / F.restLen)) : 0, r = S / 2 - S * .04, e = curEx(F);
    arc(g, S / 2, S / 2, r, 0, Math.PI * 2, C.faint, S * .05); if (part > 0) arc(g, S / 2, S / 2, r, -Math.PI / 2, -Math.PI / 2 + part * Math.PI * 2, C.acc, S * .05);
    heart(g, S / 2 - S * .08, S * .27, S * .05, C.hr); txt(g, F.hr || '--', S / 2 - S * .03, S * .27, S * .065, C.fg, { al: 'left', w: 800 });
    txt(g, clock(left), S / 2, S * .46, S * .23, left <= 5 ? C.acc : C.fg, { w: 900 });
    const it = planItem(F), nx = it ? (F.setup.ex.find(x => x.id === it[0]) || { n: it[0] }) : e;
    txt(g, 'NEXT', S / 2, S * .625, S * .042, C.lbl, { w: 800 });
    txt(g, it ? `${nx.n} ${setNo(F)}/${it[1]}` : `Set ${setNo(F)}: ${e.n}`, S / 2, S * .7, S * .058, C.fg, { w: 700, max: S * .66 });
    txt(g, 'SKIP', S / 2, S * .82, S * .05, C.acc, { w: 900 });
  },
  [SCR.SUM](g, S, C) {
    const s = F.sum || { dur: 0, sets: 0, vol: 0, exs: 0, st: 'saved' };
    if (s.st === 'saved') txt(g, '✓ SAVED', S / 2, S * .17, S * .058, C.acc, { w: 900 });
    else if (s.st === 'sending') txt(g, 'SENDING', S / 2, S * .17, S * .055, C.dim, { w: 900 });
    else if (s.st === 'failed') txt(g, 'NOT SAVED', S / 2, S * .17, S * .055, C.acc, { w: 900 });
    else { txt(g, 'Will send when', S / 2, S * .14, S * .048, C.fg, { w: 700 }); txt(g, 'the phone is near', S / 2, S * .2, S * .048, C.fg, { w: 700 }); }
    txt(g, clock(s.dur), S / 2, S * .36, S * .16, C.fg, { w: 900 }); txt(g, 'TIME', S / 2, S * .46, S * .042, C.dim, { w: 800 });
    const col = [[s.sets, 'SETS'], [volTxt(s.vol), 'KG'], [s.exs, 'LIFTS']];
    col.forEach(([v, l], i) => { const x = S * (.27 + i * .23); txt(g, v, x, S * .6, S * .085, C.fg, { w: 900, max: S * .22 }); txt(g, l, x, S * .68, S * .04, C.dim, { w: 800 }); });
    if (s.prs) txt(g, `${s.prs} PR`, S / 2, S * .78, S * .055, C.acc, { w: 900 });
    txt(g, 'DONE', S / 2, S * .87, S * .05, C.dim, { w: 900 });
  },
  [SCR.PAIR](g, S, C) {
    const P = F.pair, bw = S * .1, gap = S * .018, x0 = S / 2 - (6 * bw + 5 * gap) / 2 + bw / 2;
    txt(g, 'PAIR', S / 2, S * .19, S * .065, C.acc, { w: 900 });
    txt(g, 'Code from the phone', S / 2, S * .28, S * .05, C.fg, { w: 700, max: S * .72 });
    P.d.forEach((d, i) => { const x = x0 + i * (bw + gap), on = i === P.i;
      g.beginPath(); g.roundRect(x - bw / 2, S * .5 - bw * .7, bw, bw * 1.4, S * .015); if (on) { g.fillStyle = C.acc; g.fill(); } else { g.strokeStyle = C.faint; g.lineWidth = 2; g.stroke(); }
      txt(g, d, x, S * .505, S * .09, on ? C.ink : i < P.i ? C.fg : C.dim, { w: 900 });
      if (on) { tri(g, x, S * .375, S * .022, true, C.acc); tri(g, x, S * .625, S * .022, false, C.acc); } });
    const st = P.st === 'sending' ? 'Pairing' : P.st === 'fail' ? 'Wrong code' : P.i === 5 ? 'START: pair' : 'START: next';
    txt(g, st, S / 2, S * .72, S * .055, P.st === 'fail' ? C.acc : C.dim, { w: 800 });
    txt(g, 'Phone: Settings > Devices', S / 2, S * .82, S * .042, C.dim, { w: 600, max: S * .66 });
  },
  [SCR.GLANCE](g, S, C) { // the glance loop on the watch face: neighbours dimmed, ours in the middle
    const row = (y, h, a) => { g.beginPath(); g.roundRect(S * .08, y - h / 2, S * .84, h, S * .04); g.fillStyle = a; g.fill(); };
    row(S * .17, S * .14, C.faint); row(S * .83, S * .14, C.faint);
    txt(g, 'Heart rate', S * .22, S * .17, S * .045, C.dim, { al: 'left', w: 600 }); txt(g, 'Calendar', S * .22, S * .83, S * .045, C.dim, { al: 'left', w: 600 });
    g.beginPath(); g.arc(S * .2, S * .5, S * .085, 0, Math.PI * 2); g.fillStyle = C.acc; g.fill(); dumbbell(g, S * .2, S * .5, S * .1, C.ink);
    txt(g, 'RIDEFRAME', S * .33, S * .39, S * .045, C.dim, { al: 'left', w: 800 });
    const p = sum && sum.pts != null ? Math.round(sum.pts) : '--'; const w = txt(g, p, S * .33, S * .5, S * .13, C.fg, { al: 'left', w: 900 }); txt(g, 'pts', S * .33 + w + S * .02, S * .53, S * .05, C.dim, { al: 'left', w: 700 });
    if (sum && sum.delta != null) { const d = Math.round(sum.delta); tri(g, S * .35, S * .615, S * .02, d >= 0, C.acc); txt(g, `${Math.abs(d)} vs last week`, S * .385, S * .615, S * .045, C.acc, { al: 'left', w: 700, max: S * .5 }); }
  },
};
function list(g, S, C, items, sel, title, sub, menu = false) {
  const n = items.length; txt(g, title, S / 2, S * .13, S * .045, C.dim, { w: 900 }); if (!n) return txt(g, 'Nothing yet', S / 2, S / 2, S * .07, C.dim);
  if (!menu) txt(g, `${sel + 1}/${n}`, S / 2, S * .185, S * .04, C.faint === '#555555' ? C.dim : C.dim, { w: 600 });
  const rows = menu ? [[-1, .33, .07], [0, .5, .085], [1, .67, .07]] : [[-2, .24, .05], [-1, .345, .065], [0, .5, .095], [1, .7, .065], [2, .8, .05]];
  for (const [o, y, px] of rows) { const i = sel + o; if (i < 0 || i >= n) continue; const on = !o;
    if (on && menu) { pill(g, S / 2, S * y, S * .78, S * .14, C.acc); txt(g, items[i], S / 2, S * y + 1, S * px, C.ink, { w: 900, max: S * .7 }); continue; }
    if (on) { g.fillStyle = C.acc; g.fillRect(S * .1, S * (y - .055), S * .012, S * .11); }
    txt(g, items[i], S / 2, S * y, S * px, on ? C.fg : Math.abs(o) > 1 ? (C.lbl === C.fg ? C.dim : C.faint) : C.dim, { w: on ? 900 : 700, max: S * (Math.abs(o) > 1 ? .55 : .74) }); // far rows: dark grey on AMOLED, light grey on MIP
    if (on && sub) txt(g, sub(i), S / 2, S * (y + .085), S * .055, C.acc, { w: 800, max: S * .7 }); }
  scrollArc(g, S, C, sel, n); startHint(g, S, C);
}
function scrollArc(g, S, C, sel, n) { if (n < 2) return; const a0 = 150 * DEG, span = 60 * DEG, p = sel / (n - 1); arc(g, S / 2, S / 2, S / 2 - S * .03, a0, a0 + span, C.faint, S * .012);
  arc(g, S / 2, S / 2, S / 2 - S * .03, a0 + span - p * span * .85 - span * .15, a0 + span - p * span * .85, C.acc, S * .012); }
const setTxt = (e, kg, r) => e.t === 'time' ? clock(r) : `${e.t === 'bw' && !kg ? 'BW' : kgTxt(kg) + ' kg'} × ${r}`;
const paceTxt = (t, d) => fieldText('avgPace', { t, d }, 0);
const kmTxt = m => m >= 10000 ? (m / 1000).toFixed(1) : (m / 1000).toFixed(2);
/** the route page: next turn on top, the line with the position dot, the distance left at the bottom */
function routePage(g, S, C) {
  const r = F.route, ri = routeInfo(F); if (!r || !ri) return;
  if (ri.off) { txt(g, 'OFF ROUTE', S / 2, S * .165, S * .055, C.bad, { w: 900 }); txt(g, `${ri.off >= 1000 ? (ri.off / 1000).toFixed(1) + ' km' : Math.round(ri.off) + ' m'} away`, S / 2, S * .235, S * .05, C.fg, { w: 800 }); }
  else if (ri.turn) { turnArrow(g, S * .28, S * .2, S * .08, ri.turn.dir, C.acc); const d = ri.turn.in < 1000 ? `${Math.round(ri.turn.in / 10) * 10} m` : `${(ri.turn.in / 1000).toFixed(1)} km`;
    txt(g, d, S * .37, S * .175, S * .085, C.fg, { al: 'left', w: 900, max: S * .42 }); txt(g, ri.turn.txt || (ri.turn.dir === 'L' ? 'Turn left' : 'Turn right'), S * .37, S * .245, S * .046, C.lbl, { al: 'left', w: 800, max: S * .4 }); }
  else txt(g, 'FINISH AHEAD', S / 2, S * .2, S * .05, C.acc, { w: 900 });
  const bx = S * .2, by = S * .315, bw = S * .6, bh = S * .38, P = r.pts.map(([u, v]) => [bx + u * bw, by + v * bh]);
  const seg = []; let tot = 0; for (let k = 1; k < P.length; k++) { const l = Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); seg.push(l); tot += l; }
  const path = to => { g.beginPath(); g.moveTo(...P[0]); let acc = 0, at = P[0]; for (let k = 1; k < P.length; k++) { if (acc + seg[k - 1] >= to) { const f = seg[k - 1] ? (to - acc) / seg[k - 1] : 0; at = [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * f, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * f]; g.lineTo(...at); return at; } acc += seg[k - 1]; g.lineTo(...P[k]); at = P[k]; } return at; };
  g.lineJoin = 'round'; g.lineCap = 'round'; path(tot); g.strokeStyle = C.lbl === C.fg ? C.dim : '#6a6a66'; g.lineWidth = S * .014; g.stroke();
  const at = path(ri.pos * tot); g.strokeStyle = C.acc; g.lineWidth = S * .022; g.stroke();
  g.fillStyle = C.fg; g.fillRect(P.at(-1)[0] - S * .016, P.at(-1)[1] - S * .016, S * .032, S * .032); // the finish
  dot(g, at[0], at[1], S * .034, C.acc); dot(g, at[0], at[1], S * .019, C.fg);
  const km = kmTxt(ri.left), w = txt(g, km, 0, -99, S * .1, C.fg, { w: 900 }), uw = S * .07;
  txt(g, km, S / 2 - (w + uw) / 2, S * .79, S * .1, C.fg, { al: 'left', w: 900 }); txt(g, 'km', S / 2 - (w + uw) / 2 + w + S * .015, S * .805, S * .045, C.lbl, { al: 'left', w: 800 });
  txt(g, 'TO FINISH', S / 2, S * .875, S * .04, C.lbl, { w: 800 });
}
function turnArrow(g, x, y, s, dir, col) { const k = dir === 'L' ? -1 : 1; g.strokeStyle = col; g.lineWidth = s * .3; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x - k * s * .3, y + s * .9); g.lineTo(x - k * s * .3, y); g.quadraticCurveTo(x - k * s * .3, y - s * .4, x + k * s * .2, y - s * .4); g.stroke();
  g.beginPath(); g.moveTo(x + k * s * .8, y - s * .4); g.lineTo(x + k * s * .2, y - s * .95); g.lineTo(x + k * s * .2, y + s * .15); g.closePath(); g.fillStyle = col; g.fill(); }
/** the segment popup: warning before, live delta against the PR, the result for 5 s */
function segScreen(g, S, C) {
  const sg = F.seg, ride = F.sp === 'ride', len = sg.len >= 1000 ? `${(sg.len / 1000).toFixed(1)} km` : `${Math.round(sg.len)} m`;
  if (sg.k === 'warn') {
    arc(g, S / 2, S / 2, S / 2 - S * .03, 0, Math.PI * 2, C.acc, S * .03);
    txt(g, 'SEGMENT IN', S / 2, S * .22, S * .055, C.acc, { w: 900 });
    txt(g, clock(Math.max(0, sg.eta)), S / 2, S * .42, S * .25, C.fg, { w: 900 });
    txt(g, sg.name, S / 2, S * .62, S * .07, C.fg, { w: 800, max: S * .74 });
    txt(g, `${len}${sg.pr ? ' · PR ' + clock(sg.pr) : ''}`, S / 2, S * .72, S * .055, C.lbl, { w: 800, max: S * .6 });
    return;
  }
  if (sg.k === 'live') {
    const part = sg.len ? Math.min(1, sg.done / sg.len) : 0, ref = sg.ref == null ? 'PR' : sg.ref, ahead = sg.delta <= 0, col = ahead ? C.good : C.bad;
    arc(g, S / 2, S / 2, S / 2 - S * .03, 0, Math.PI * 2, C.faint, S * .03); arc(g, S / 2, S / 2, S / 2 - S * .03, -Math.PI / 2, -Math.PI / 2 + part * Math.PI * 2, C.acc, S * .03);
    txt(g, sg.name, S / 2, S * .17, S * .052, C.fg, { w: 800, max: S * .6 });
    if (!ref) { txt(g, clock(sg.time || 0), S / 2, S * .37, S * .22, C.fg, { w: 900 }); txt(g, 'NO TIME TO BEAT', S / 2, S * .505, S * .05, C.lbl, { w: 900 }); }
    else { txt(g, (ahead ? '−' : '+') + clock(Math.abs(sg.delta)), S / 2, S * .37, S * .22, col, { w: 900 });
      txt(g, `${ahead ? 'AHEAD OF' : 'BEHIND'} ${ref}`, S / 2, S * .505, S * .05, col, { w: 900 });
      if (sg.need > 0) { const need = ride ? `${(sg.need * 3.6).toFixed(1)} km/h` : `${paceTxt(1000 / sg.need, 1000)} /km`;
        txt(g, `Need ${need}`, S / 2, S * .63, S * .066, C.fg, { w: 900, max: S * .76 }); txt(g, 'FOR ' + ref, S / 2, S * .7, S * .042, C.lbl, { w: 800 }); }
      else txt(g, `${ref} out of reach`, S / 2, S * .655, S * .058, C.lbl, { w: 900, max: S * .7 }); }
    const left = Math.max(0, sg.len - sg.done); txt(g, `${left >= 1000 ? (left / 1000).toFixed(1) + ' km' : Math.round(left) + ' m'} to go`, S / 2, S * .81, S * .05, C.lbl, { w: 800 });
    return;
  }
  const col = sg.pr || sg.delta <= 0 ? C.good : C.bad, ink = sg.pr ? C.ink : C.fg;
  if (sg.pr) dot(g, S / 2, S / 2, S / 2, col);
  txt(g, sg.pr ? 'NEW PR' : 'SEGMENT DONE', S / 2, S * .22, S * .06, sg.pr ? ink : C.acc, { w: 900 });
  txt(g, sg.name, S / 2, S * .31, S * .05, ink, { w: 800, max: S * .66 }); txt(g, clock(sg.time), S / 2, S * .5, S * .22, ink, { w: 900 });
  const ref = sg.ref == null ? 'PR' : sg.ref; if (ref) txt(g, `${sg.delta <= 0 ? '−' : '+'}${clock(Math.abs(sg.delta))} vs ${ref}`, S / 2, S * .7, S * .075, sg.pr ? ink : col, { w: 900 });
}
function lapFlash(g, S, C) {
  const f = F.flash; C = tint(C, F.sp); dot(g, S / 2, S / 2, S / 2, C.acc);
  txt(g, `LAP ${f.n}`, S / 2, S * .26, S * .075, C.ink, { w: 900 }); txt(g, clock(f.t), S / 2, S * .47, S * .22, C.ink, { w: 900 });
  txt(g, F.sp === 'ride' ? `${(f.t ? f.d / f.t * 3.6 : 0).toFixed(1)} km/h` : F.sp === 'run' ? `${paceTxt(f.t, f.d)} /km` : `${kmTxt(f.d)} km`, S / 2, S * .69, S * .085, C.ink, { w: 900 });
}
function prFlash(g, S, C) {
  const f = F.flash; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fillStyle = C.acc; g.fill();
  txt(g, 'NEW RECORD', S / 2, S * .27, S * .06, C.ink, { w: 900 }); txt(g, 'PR', S / 2, S * .5, S * .3, C.ink, { w: 900 });
  txt(g, f.t === 'bw' ? `${f.reps} reps` : `${kgTxt(f.kg)} × ${f.reps}`, S / 2, S * .72, S * .085, C.ink, { w: 900 });
}

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
  const down = e => { e.preventDefault(); el.classList.add('on'); held = false; clearTimeout(t); clearInterval(rep);
    if (k === 'up' || k === 'down') t = setTimeout(() => { held = true; ev(k + 'Hold'); rep = setInterval(() => ev(k + 'Hold'), 350); }, 500);
    if (k === 'back') t = setTimeout(() => { held = true; ev('menu'); }, 700); };
  const up = e => { if (!el.classList.contains('on')) return; el.classList.remove('on'); clearTimeout(t); clearInterval(rep); if (held) return;
    if (k === 'light') { light = !light; paint(); return; } ev(k); };
  el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', () => { if (el.classList.contains('on')) { el.classList.remove('on'); clearTimeout(t); clearInterval(rep); } });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
function touch(cv, f) {
  let p0 = null;
  cv.addEventListener('pointerdown', e => { p0 = { x: e.clientX, y: e.clientY }; cv.setPointerCapture?.(e.pointerId); });
  cv.addEventListener('pointerup', e => {
    if (!p0) return; const r = cv.getBoundingClientRect(), k = f.S / r.width, dx = (e.clientX - p0.x) * k, dy = (e.clientY - p0.y) * k; p0 = null;
    if (Math.hypot(dx, dy) > f.S * .08) return ev(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'swipeLeft' : 'swipeRight') : (dy < 0 ? 'swipeUp' : 'swipeDown'));
    tapAt((e.clientX - r.left) * k / f.S, (e.clientY - r.top) * k / f.S);
  });
}
/** a tap in face coordinates (0..1) -> the flow's event; the same table is in garmin/source/Delegates.mc onTap */
function tapAt(u, v) {
  const s = F.scr;
  if (F.flash) return ev('tap');
  if (s === SCR.SET) { if (v > .72 && Math.abs(u - .5) < .24) return ev('start'); if (v > .36 && v < .72) return ev('focus', u < .51 ? 0 : 1); return; }
  if (s === SCR.READY && F.sp !== 'other' && v > .665 && v < .74) return ev('down'); // the route line
  const menu = [SCR.MENU, SCR.PAUSE, SCR.SMODE].includes(s), pick = [SCR.PICK, SCR.MORE, SCR.WPICK, SCR.RPICK].includes(s);
  if (s === SCR.HOME) { const n = listItems(F).length, r = Math.round((v - HOME_LAY.y0) / HOME_LAY.dy), i = homeTop(F.sel, n) + r; // the rows as DRAW[SCR.HOME] draws them
    if (r >= 0 && r < HOME_FIT && i < n) ev('item', i); return; }
  if (menu || pick) { const rows = menu ? [[-1, .33], [0, .5], [1, .67]] : [[-2, .24], [-1, .345], [0, .5], [1, .7], [2, .8]];
    const [o] = rows.reduce((a, r) => Math.abs(r[1] - v) < Math.abs(a[1] - v) ? r : a); const n = listItems(F).length, i = F.sel + o;
    if (i >= 0 && i < n) ev('item', i); return; }
  if (s === SCR.PAIR) { if (v > .4 && v < .6 && u > .13 && u < .87) return ev('focus', Math.min(5, Math.max(0, Math.floor((u - .146) / .118)))); return ev('tap'); }
  ev('tap');
}
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'start', ' ': 'start', Escape: 'back', Backspace: 'back' };
function keys() {
  const st = {};
  addEventListener('keydown', e => { if (e.target.closest?.('input, textarea, select')) return; const k = KEYS[e.key]; if (e.key === 'ArrowLeft') { e.preventDefault(); return ev('swipeLeft'); } if (e.key === 'ArrowRight') { e.preventDefault(); return ev('swipeRight'); }
    if (e.key === 'm') return ev('menu'); if (!k) return; e.preventDefault(); if (e.repeat) return;
    st[k] = { at: Date.now(), held: false, t: setTimeout(function hold() { st[k].held = true; if (k === 'back') return ev('menu'); if (k === 'up' || k === 'down') { ev(k + 'Hold'); st[k].t = setTimeout(hold, 350); } }, k === 'back' ? 700 : 500) }; });
  addEventListener('keyup', e => { const k = KEYS[e.key]; if (!k || !st[k]) return; clearTimeout(st[k].t); const h = st[k].held; delete st[k]; if (!h) ev(k); });
}

/* ---- vibration shown on the page: the watch shakes, a ring pulses ---- */
let buzzT = 0;
function buzz(kind) { for (const v of views) { v.fig.classList.remove('buzz', 'long'); void v.fig.offsetWidth; v.fig.classList.add('buzz'); if (kind === 'pr' || kind === 'rest') v.fig.classList.add('long'); }
  clearTimeout(buzzT); buzzT = setTimeout(() => views.forEach(v => v.fig.classList.remove('buzz', 'long')), 1200); const b = $('#wCue'); if (b) { b.textContent = { set: 'Vibration: short (set saved)', pr: 'Vibration: long double (record)', rest: 'Vibration: triple (rest over)', done: 'Vibration: long (finished)', error: 'Vibration: short double (no reps)',
  start: 'Vibration: short (timer started)', stop: 'Vibration: double (paused)', lap: 'Vibration: long (lap)', seg: 'Vibration: double (segment)' }[kind] || ''; } }

/* ---- 64-colour MIP: every pixel snapped to the palette (channels 00 / 55 / AA / FF), no soft edges, no transparency ---- */
function paint() {
  for (const { f, g, dpr } of views) {
    const S = f.S, C = f.C; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = C.bg; g.fillRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
    (DRAW[F.scr] || DRAW[SCR.HOME])(g, S, C); if (F.flash) (F.flash.k === 'lap' ? lapFlash : prFlash)(g, S, C);
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
  p.querySelector('#wSeg').disabled = !(F.rec && F.sp !== 'other' && F.scr === SCR.REC);
  p.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (mode === b.dataset.mode) return; mode = b.dataset.mode; store.set('mode', mode); boot(); });
}
function wirePanel() {
  $('#wNear').onchange = e => { near = e.target.checked; if (near && F.queue.length) push(); panel(); };
  $('#wGlance').onclick = () => { F.scr = SCR.GLANCE; paint(); };
  $('#wRestart').onclick = () => boot();
  $('#wSeg').onclick = segDemo;
  $('#wFast').onchange = e => { fast = e.target.checked; };
  $('#wUnpair').onclick = () => { if (confirm('Forget the pairing on this preview watch?')) unpair('Unpaired.'); };
}

mount(); keys(); wirePanel(); boot();
setInterval(() => { handle(F, 'tick', now()); drain(); paint(); }, 200);
setInterval(() => { const base = F.scr === SCR.REST ? 128 - Math.min(30, (now() - (F.restEnd - F.restLen)) * .5) : F.start ? 112 : 72; ev('hr', Math.round(base + Math.random() * 6)); }, 2000); // a simulated heart rate (Sensor on the watch)
setInterval(() => { if (F.queue.length && near) push(); }, 30e3); // retry, like the watch does on its timer
setInterval(() => { if (F.rec && F.rec.st === 'run') ev('sample', simSample(fast ? 10 : 1)); }, 1000); // GPS and sensors while recording (Position / Sensor on the watch)
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
