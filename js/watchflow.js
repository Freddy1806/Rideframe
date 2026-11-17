// RIDEFRAME on a Garmin watch: the whole state machine, no DOM, no network (17.11. strength, 18.11. start menu, run / ride /
// other sports, workouts). The browser preview (watch.html, js/watchsim.js) draws it, and garmin/source/Flow.mc is the same
// machine in Monkey C, one function per function. Time is in seconds (Monkey C numbers are 32 bit, Unix ms would not fit).
// Outputs the drawing layer drains: F.cues = vibrations ('set', 'pr', 'rest', 'done', 'start', 'stop', 'lap', 'seg', 'error'),
// F.out = requests ('send', 'pair', 'setup', 'exit', 'saveAct').
// Screens: HOME (start menu) -> START (strength ready) -> SMODE (workout or free) -> WPICK / PICK -> SET <-> REST -> SUM;
// HOME -> MORE (other sports) -> READY; HOME -> READY (run / ride) -> REC (data pages, route page) <-> PAUSE -> RSUM.
import { compact, defaults, FIELDS } from './watchfields.js';
export const SCR = { HOME: 'home', START: 'start', SMODE: 'smode', WPICK: 'wpick', PICK: 'pick', SET: 'set', REST: 'rest', MENU: 'menu', SUM: 'sum', PAIR: 'pair', GLANCE: 'glance',
  MORE: 'more', READY: 'ready', REC: 'rec', PAUSE: 'pause', RSUM: 'rsum' };
export const KG_STEP = 2.5, KG_HOLD = 10, KG_MAX = 500, REPS_HOLD = 5, REPS_MAX = 100, SEC_STEP = 5, SEC_HOLD = 15, SEC_MAX = 600, REST_STEP = 15, PR_SECS = 3;
export const LAP_M = { run: 1000, ride: 5000, other: 1000 }, LAP_SECS = 5, SEG_SECS = 5, PAUSE_MS = .7; // auto lap distance, banner and result seconds, auto pause below 0.7 m/s
export const MENU = { EX: 'Change exercise', SKIP: 'Skip exercise', UNDO: 'Undo last set', FIN: 'Finish', SYNC: 'Sync now', PAIR: 'Pair with phone' };
export const HOME = { run: 'Run', ride: 'Ride', kraft: 'Strength', more: 'More' };
export const SMODES = ['Workout', 'Free'], PAUSED = ['Resume', 'Save', 'Discard'];

export const e1rm = (kg, r) => kg > 0 && r > 0 ? (r === 1 ? kg : kg * (1 + r / 30)) : 0; // Epley, like kraftlib.js
const rid = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** a fresh app: setup = GET /api/watch/strength/setup (or the cached copy), o = { paired, queue, id, cfg (GET /api/watch/config), last (sport key), scr } */
export function newFlow(setup, o = {}) {
  const F = { setup: { ex: [], rest: 90 }, list: [], cfg: o.cfg && o.cfg.run ? o.cfg : compact(defaults()), last: HOME[o.last] ? o.last : 'run', paired: o.paired !== false, queue: o.queue || [], newId: o.id || rid,
    scr: o.scr || SCR.HOME, back: SCR.HOME, sel: 0, menu: [], cur: 0, focus: 0, kg: 0, reps: 0, sets: [], start: 0, restEnd: 0, restLen: 0, plan: null,
    flash: null, sum: null, hr: 0, hrN: 0, hrSum: 0, hrMax: 0, pair: { d: [0, 0, 0, 0, 0, 0], i: 0, st: 'enter' }, cues: [], out: [],
    sp: 'run', type: '', rec: null, seg: null, route: null, rsum: null };
  setSetup(F, setup);
  if (!F.paired) F.scr = SCR.PAIR;
  return F;
}
export const curEx = F => F.setup.ex[F.cur] || { id: '', n: 'Exercise', t: 'w' };
/** the number of the set being entered (1 = first set of this exercise in this session; in a workout: of this exercise's block) */
export const setNo = F => F.plan ? F.plan.n + 1 : F.sets.filter(s => s.ex === curEx(F).id).length + 1;
/** the free picker's order (indices into setup.ex): done lately, then the 20 standard exercises, then everything else (own ones) */
export function order(setup) {
  const ex = setup.ex, at = id => ex.findIndex(e => e.id === id), out = [];
  for (const id of [...(setup.recent || []), ...(setup.top || [])]) { const i = at(id); if (i >= 0 && !out.includes(i)) out.push(i); }
  for (let i = 0; i < ex.length; i++) if (!out.includes(i)) out.push(i);
  return out;
}
/** the workouts from the phone (with the setup, else with the config), only those with exercises */
export const workouts = F => (F.setup.workouts || F.cfg.w || []).filter(w => w.it && w.it.length);
/** the planned item now: [ex, sets, reps, kg, rest] or null */
export const planItem = F => F.plan ? (workouts(F)[F.plan.w] || { it: [] }).it[F.plan.i] || null : null;
/** start menu: the sport used last on top */
export const homeItems = F => [F.last, ...Object.keys(HOME).filter(k => k !== F.last)];
export const restLeft = (F, now) => Math.max(0, Math.ceil(F.restEnd - now));
export const volume = sets => sets.reduce((a, s) => a + s.kg * s.reps, 0);
export const exCount = sets => sets.filter((s, i) => sets.findIndex(x => x.ex === s.ex) === i).length;
export const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

/** the values for set n of the current exercise: the last set of this session, else last session's set n (or its last), else a start value */
export function prefill(F) {
  const e = curEx(F), mine = F.sets.filter(s => s.ex === e.id), n = mine.length, s = e.s || [];
  if (n) { F.kg = mine[n - 1].kg; F.reps = mine[n - 1].reps; return; }
  const p = s[n] || s[s.length - 1];
  if (p) { F.kg = p[0]; F.reps = p[1]; } else { F.kg = e.t === 'w' ? 20 : 0; F.reps = e.t === 'time' ? 60 : e.t === 'bw' ? 10 : 8; }
  const it = planItem(F); if (it && it[0] === e.id) { if (it[3] > 0 || e.t !== 'w') F.kg = it[3]; F.reps = it[2]; } // a workout suggests its own kg and reps
}
/** UP / DOWN on the focused value: d = +1 / -1, big = held */
export function stepValue(F, d, big) {
  if (F.focus === 0) F.kg = clamp(Math.round((F.kg + d * (big ? KG_HOLD : KG_STEP)) * 100) / 100, 0, KG_MAX);
  else if (curEx(F).t === 'time') F.reps = clamp(F.reps + d * (big ? SEC_HOLD : SEC_STEP), 0, SEC_MAX); // a timed exercise: seconds
  else F.reps = clamp(F.reps + d * (big ? REPS_HOLD : 1), 0, REPS_MAX);
}
function menuFor(F) {
  if (F.start) return [MENU.EX, ...(F.plan ? [MENU.SKIP] : []), ...(F.sets.length ? [MENU.UNDO] : []), MENU.FIN];
  return F.paired ? [MENU.SYNC, MENU.PAIR] : [MENU.PAIR];
}
function openMenu(F) { F.back = F.scr; F.menu = menuFor(F); F.sel = 0; F.scr = SCR.MENU; }
function choose(F, i) { F.cur = clamp(i, 0, Math.max(0, F.setup.ex.length - 1)); F.focus = curEx(F).t === 'w' ? 0 : 1; prefill(F); F.scr = SCR.SET; }
function toPick(F) { F.plan = null; F.sel = F.sets.length ? Math.max(0, F.list.indexOf(F.cur)) : 0; F.scr = SCR.PICK; } // the free picker leaves a workout
/** to the planned exercise (added to the setup when the setup does not know it) */
function goPlan(F) {
  const it = planItem(F); let i = F.setup.ex.findIndex(e => e.id === it[0]);
  if (i < 0) { F.setup.ex.push({ id: it[0], n: it[5] || it[0], t: 'w' }); i = F.setup.ex.length - 1; F.list.push(i); }
  choose(F, i);
}
/** one step on in the workout: next set, next exercise, or done */
function advance(F) { const it = planItem(F); if (!it) return; F.plan.n++; if (F.plan.n >= it[1]) { F.plan.i++; F.plan.n = 0; } }
export function startPlan(F, w, now) { F.plan = { w, i: 0, n: 0 }; if (!F.start) F.start = now; goPlan(F); }

/** set done: stored, record check, rest starts */
export function completeSet(F, now) {
  if (!(F.reps > 0)) { F.cues.push('error'); return; }
  const e = curEx(F), val = s => e.t === 'w' ? e1rm(s.kg, s.reps) : s.reps, v = val(F), before = F.sets.filter(s => s.ex === e.id).map(val);
  const set = { ex: e.id, kg: F.kg, reps: F.reps, t: Math.max(0, Math.round(now - F.start)) };
  // a record beats the stored best (only when there is one) and every earlier set of this session, so it flashes once per new high
  if (e.b > 0 && v > e.b + .01 && v > Math.max(0, ...before) + .01) { set.pr = true; F.flash = { k: 'pr', until: now + PR_SECS, kg: F.kg, reps: F.reps, t: e.t }; F.cues.push('pr'); }
  else F.cues.push('set');
  F.sets.push(set);
  const it = planItem(F); F.restLen = it && it[4] > 0 ? it[4] : F.setup.rest || 90;
  if (it) { advance(F); if (!planItem(F)) { finish(F, now); return; } } // the last planned set ends the workout
  F.restEnd = now + F.restLen; F.scr = SCR.REST;
}
function endRest(F, cue) { F.restEnd = 0; if (planItem(F)) goPlan(F); else { prefill(F); F.scr = SCR.SET; } if (cue) F.cues.push('rest'); }
export function undo(F) {
  const s = F.sets.pop(); if (!s) return;
  if (F.plan) { if (F.plan.n > 0) F.plan.n--; else if (F.plan.i > 0) { F.plan.i--; F.plan.n = Math.max(0, planItem(F)[1] - 1); } }
  const i = F.setup.ex.findIndex(e => e.id === s.ex); if (i >= 0) F.cur = i;
  F.kg = s.kg; F.reps = s.reps; F.restEnd = 0; F.scr = SCR.SET; // back on that set with its values, to fix and tick again
}
/** finish: the session goes into the queue (sent and retried by the caller), the summary shows */
export function finish(F, now) {
  if (!F.sets.length) { reset(F); return; }
  const id = F.newId(), dur = Math.max(1, Math.round(now - F.start)), sess = { id, start: Math.round(F.start), duration: dur, sets: F.sets.map(({ ex, kg, reps, t }) => ({ ex, kg, reps, t })) };
  if (F.hrN) sess.hr = { avg: Math.round(F.hrSum / F.hrN), max: F.hrMax };
  F.queue.push(sess);
  F.sum = { id, dur, sets: F.sets.length, vol: volume(F.sets), exs: exCount(F.sets), prs: F.sets.filter(s => s.pr).length, st: F.paired ? 'sending' : 'queued' };
  F.sets = []; F.start = 0; F.restEnd = 0; F.plan = null; F.hrN = F.hrSum = F.hrMax = 0;
  F.scr = SCR.SUM; F.cues.push('done'); F.out.push({ k: 'send' });
}
function reset(F) { F.sets = []; F.start = 0; F.restEnd = 0; F.plan = null; F.flash = null; F.sum = null; F.scr = SCR.START; }
/** answer of one send: res = 'ok' (stored, also for a duplicate), 'drop' (the server refused it for good) or 'retry' (no phone / no server) */
export function sent(F, id, res) {
  if (res !== 'retry') F.queue = F.queue.filter(s => s.id !== id);
  if (F.sum && F.sum.id === id) F.sum.st = res === 'ok' ? 'saved' : res === 'drop' ? 'failed' : 'queued';
}
export function paired(F, ok, setup) {
  if (!ok) { F.pair.st = 'fail'; return; }
  F.paired = true; F.pair = { d: [0, 0, 0, 0, 0, 0], i: 0, st: 'enter' }; if (setup) setSetup(F, setup);
  F.sel = 0; F.scr = SCR.HOME; F.cues.push('done'); F.out.push({ k: 'setup' }, { k: 'send' });
}
export function setSetup(F, setup) { if (setup && Array.isArray(setup.ex)) { const id = curEx(F).id; F.setup = setup; F.list = order(setup); const i = setup.ex.findIndex(e => e.id === id); F.cur = i < 0 ? 0 : i; } }
/** a new config from the phone (GET /api/watch/config); a running recording keeps its pages */
export function setConfig(F, cfg) { if (cfg && cfg.run && cfg.ride && cfg.other) F.cfg = cfg; }

/* ---- run, ride and the other sports: data pages, route page, laps, pause, segment popup ---- */
/** the sport's settings: { p: pages, map, seg, lap, pause, vib } (other: pages only, no route, no segments) */
export const sportCfg = (F, sp = F.sp) => sp === 'other' ? { map: 0, seg: 0, lap: 0, pause: 0, vib: 1, ...F.cfg.other } : F.cfg[sp];
/** the pages while recording: the data pages, then the route page ('route') when it is switched on and a route is loaded */
export const recPages = F => { const c = sportCfg(F); return [...c.p.map(p => p.filter(f => FIELDS[F.sp][f])), ...(c.map && F.route ? ['route'] : [])]; };
export function newRec(now) { return { st: 'run', start: now, t: 0, d: 0, v: 0, hr: 0, hrMax: 190, cad: 0, pw: 0, p3: [], pwSum: 0, p30: [], np4: 0, npN: 0, gain: 0, kcal: 0, auto: false, pg: 0, lapT0: 0, lapD0: 0, laps: [] }; }
function cue(F, k) { if (!F.rec || sportCfg(F).vib) F.cues.push(k); }
function ready(F, sp, type) { F.sp = sp; F.type = type || ''; F.scr = SCR.READY; }
export function lap(F, now) {
  const R = F.rec, l = { t: R.t - R.lapT0, d: R.d - R.lapD0 }; R.laps.push(l); R.lapT0 = R.t; R.lapD0 = R.d;
  F.flash = { k: 'lap', n: R.laps.length, t: l.t, d: l.d, until: now + LAP_SECS }; cue(F, 'lap');
}
/** one second of movement (GPS, sensors): arg = { dt, v (m/s), hr, pw (W), cad, up (m climbed) } */
function sample(F, now, a) {
  const R = F.rec; if (!R || R.st !== 'run') return; const dt = a.dt > 0 ? a.dt : 1, v = Math.max(0, +a.v || 0), c = sportCfg(F);
  R.v = v; R.hr = a.hr | 0; R.cad = +a.cad || 0; R.pw = Math.max(0, +a.pw || 0); R.p3.push(R.pw); if (R.p3.length > 3) R.p3.shift();
  if (R.hr > 0) F.hr = R.hr;
  R.auto = !!c.pause && F.sp !== 'other' && v < PAUSE_MS; if (R.auto) return; // auto pause: the clock stops while standing
  R.t += dt; R.d += v * dt; R.pwSum += R.pw * dt; R.gain += Math.max(0, +a.up || 0);
  R.kcal += F.sp === 'ride' ? R.pw * dt / 1000 : F.sp === 'run' ? v * dt / 1000 * 70 : dt / 60 * (R.hr > 0 ? Math.max(3, (R.hr - 60) / 10) : 5); // ride: kJ ≈ kcal; run: ~70 kcal/km; else from the heart rate
  if (F.sp === 'ride') { R.p30.push(R.pw); if (R.p30.length > 30) R.p30.shift(); if (R.p30.length === 30) { const m = R.p30.reduce((x, y) => x + y, 0) / 30; R.np4 += m * m * m * m; R.npN++; } }
  if (c.lap && R.d - R.lapD0 >= LAP_M[F.sp]) lap(F, now);
}
/** the segment popup (outdoor.js segtrack on the phone, later the watch's own): arg = { k: 'warn' | 'live' | 'end', name, len (m), eta (s), done (m), delta (s, minus = ahead of the PR), need (m/s for the PR), time (s), pr } */
function segment(F, now, a) {
  if (!F.rec || !sportCfg(F).seg || !a || !['warn', 'live', 'end'].includes(a.k)) return;
  const was = F.seg; F.seg = { ...a, hide: !!(was && was.k === a.k && was.hide), until: a.k === 'end' ? now + SEG_SECS : 0 };
  if (!was || was.k !== a.k) cue(F, a.k === 'end' && a.pr ? 'pr' : 'seg');
}
/** the route page: where on the route (0..1), metres left, the next turn { dir: 'L' | 'R', in (m), txt } or null */
export function routeInfo(F) {
  const r = F.route, d = F.rec ? F.rec.d : 0; if (!r || !(r.len > 0)) return null;
  const pos = Math.min(1, d / r.len), t = (r.turns || []).find(x => x.at > d);
  return { pos, left: Math.max(0, r.len - d), turn: t ? { dir: t.dir, in: t.at - d, txt: t.txt || '' } : null };
}
export function setRoute(F, r) { F.route = r && r.len > 0 && Array.isArray(r.pts) && r.pts.length > 1 ? r : null; }
function begin(F, now) { F.rec = newRec(now); F.seg = null; F.flash = null; F.scr = SCR.REC; F.last = F.sp === 'other' ? 'more' : F.sp; cue(F, 'start'); }
function saveRec(F, now) {
  const R = F.rec; F.rsum = { sp: F.sp, type: F.type, t: R.t, d: R.d, laps: R.laps.length + (R.d - R.lapD0 > 10 ? 1 : 0), kcal: R.kcal, avgPw: R.t ? R.pwSum / R.t : 0, gain: R.gain, start: R.start };
  F.out.push({ k: 'saveAct', sum: F.rsum }); F.rec = null; F.seg = null; F.flash = null; F.scr = SCR.RSUM; F.cues.push('done');
}

/** every input: ev = up, down, upHold, downHold, start, back, menu, swipeUp, swipeDown, swipeLeft, swipeRight, tap, item (arg = index),
 *  focus (arg = 0 kg / 1 reps / digit), hr (arg = bpm), tick, sample (arg = one second of movement), seg (arg = segment state) */
export function handle(F, ev, now, arg) {
  if (ev === 'hr') { F.hr = arg || 0; if (F.start && arg > 0) { F.hrN++; F.hrSum += arg; F.hrMax = Math.max(F.hrMax, arg); } return; }
  if (ev === 'sample') { sample(F, now, arg || {}); return; }
  if (ev === 'seg') { segment(F, now, arg); return; }
  if (ev === 'tick') {
    if (F.flash && now >= F.flash.until) F.flash = null;
    if (F.seg && F.seg.k === 'end' && now >= F.seg.until) F.seg = null;
    if (F.scr === SCR.REST && now >= F.restEnd) endRest(F, true);
    return;
  }
  if (F.flash) { F.flash = null; if (ev !== 'menu') return; } // the first touch after a record only clears the flash
  if (ev === 'swipeLeft') ev = 'menu';
  if (ev === 'swipeRight') ev = 'back';
  const s = F.scr, list = [SCR.PICK, SCR.MENU, SCR.HOME, SCR.MORE, SCR.SMODE, SCR.WPICK, SCR.PAUSE].includes(s);
  if (ev === 'swipeUp') ev = list || s === SCR.REC ? 'down' : 'up';     // a list (and the data pages) scroll with the finger, a number counts up
  if (ev === 'swipeDown') ev = list || s === SCR.REC ? 'up' : 'down';
  if (ev === 'menu') { if (s === SCR.HOME || s === SCR.START || s === SCR.PICK || s === SCR.SET || s === SCR.REST) openMenu(F); return; }
  if (s === SCR.GLANCE) { if (ev === 'start' || ev === 'tap') { F.sel = 0; F.scr = F.paired ? SCR.HOME : SCR.PAIR; } return; }
  if (s === SCR.START) {
    if (ev === 'start' || ev === 'tap') { if (!F.setup.ex.length) { F.out.push({ k: 'setup' }); return; } F.start = now; F.sets = []; F.sum = null; F.plan = null; F.last = 'kraft';
      if (workouts(F).length) { F.sel = 0; F.scr = SCR.SMODE; } else toPick(F); }
    else if (ev === 'back') { F.sel = 0; F.scr = SCR.HOME; }
    return;
  }
  if (s === SCR.READY) {
    if (ev === 'start' || ev === 'tap') begin(F, now);
    else if (ev === 'back') { F.sel = 0; F.scr = F.sp === 'other' ? SCR.MORE : SCR.HOME; }
    return;
  }
  if (s === SCR.REC) {
    const n = recPages(F).length, R = F.rec;
    if (ev === 'up' || ev === 'down') R.pg = (R.pg + (ev === 'down' ? 1 : n - 1)) % n;
    else if (ev === 'start') { R.st = 'pause'; F.sel = 0; F.scr = SCR.PAUSE; cue(F, 'stop'); }
    else if (ev === 'back' || ev === 'tap') { if (F.seg && !F.seg.hide) F.seg.hide = true; else if (ev === 'back') lap(F, now); } // BACK = lap (like Garmin); first it closes the segment popup
    return;
  }
  if (list) {
    const items = listItems(F), n = items.length;
    if (!n) { if (ev === 'back') F.scr = s === SCR.MENU ? F.back : s === SCR.MORE ? SCR.HOME : s === SCR.WPICK ? SCR.SMODE : s === SCR.HOME ? (F.out.push({ k: 'exit' }), SCR.HOME) : SCR.START; return; }
    if (ev === 'up') F.sel = (F.sel + n - 1) % n;
    else if (ev === 'down') F.sel = (F.sel + 1) % n;
    else if (ev === 'start' || ev === 'item' || (ev === 'tap' && s !== SCR.PICK && s !== SCR.MENU)) pickItem(F, ev === 'item' ? clamp(arg | 0, 0, n - 1) : F.sel, now);
    else if (ev === 'back') {
      if (s === SCR.MENU) F.scr = F.back;
      else if (s === SCR.HOME) F.out.push({ k: 'exit' });
      else if (s === SCR.MORE) { F.sel = 0; F.scr = SCR.HOME; }
      else if (s === SCR.PAUSE) { F.rec.st = 'run'; F.scr = SCR.REC; cue(F, 'start'); }
      else if (s === SCR.WPICK) { F.sel = 0; F.scr = SCR.SMODE; }
      else if (F.sets.length) { if (planItem(F)) goPlan(F); else { prefill(F); F.scr = SCR.SET; } } else reset(F); // PICK / SMODE
    }
    return;
  }
  if (s === SCR.RSUM) { if (ev === 'start' || ev === 'back' || ev === 'tap') { F.rsum = null; F.sel = 0; F.scr = SCR.HOME; } return; }
  if (s === SCR.SET) {
    if (ev === 'up' || ev === 'down') stepValue(F, ev === 'up' ? 1 : -1, false);
    else if (ev === 'upHold' || ev === 'downHold') stepValue(F, ev === 'upHold' ? 1 : -1, true);
    else if (ev === 'focus') F.focus = arg ? 1 : 0;
    else if (ev === 'back') F.focus = 1 - F.focus; // no touch needed: BACK moves between weight and reps
    else if (ev === 'start') completeSet(F, now); // touch: the drawn DONE button sends 'start'; a stray tap never logs a set
    return;
  }
  if (s === SCR.REST) {
    if (ev === 'start' || ev === 'tap') endRest(F, false);
    else if (ev === 'back') toPick(F);
    else if (ev === 'up') { F.restEnd += REST_STEP; F.restLen += REST_STEP; }
    else if (ev === 'down') F.restEnd = Math.max(now + 1, F.restEnd - REST_STEP);
    return;
  }
  if (s === SCR.SUM) { if (ev === 'start' || ev === 'back' || ev === 'tap') reset(F); return; }
  if (s === SCR.PAIR) {
    const P = F.pair; if (P.st === 'sending') return;
    if (P.st === 'fail' && ev !== 'back') P.st = 'enter';
    if (ev === 'up') P.d[P.i] = (P.d[P.i] + 1) % 10;
    else if (ev === 'down') P.d[P.i] = (P.d[P.i] + 9) % 10;
    else if (ev === 'focus') P.i = clamp(arg | 0, 0, 5);
    else if (ev === 'start' || ev === 'tap') { if (P.i < 5) P.i++; else { P.st = 'sending'; F.out.push({ k: 'pair', code: P.d.join('') }); } }
    else if (ev === 'back') { if (P.i > 0) P.i--; else if (F.paired) { F.sel = 0; F.scr = SCR.HOME; } else F.out.push({ k: 'exit' }); }
  }
}
/** the rows of the list on screen */
export function listItems(F) {
  const s = F.scr;
  if (s === SCR.MENU) return F.menu;
  if (s === SCR.PICK) return F.list.map(i => F.setup.ex[i].n);
  if (s === SCR.HOME) return homeItems(F).map(k => HOME[k]);
  if (s === SCR.MORE) return F.cfg.more.map(m => m[1]);
  if (s === SCR.SMODE) return SMODES;
  if (s === SCR.WPICK) return workouts(F).map(w => w.n);
  if (s === SCR.PAUSE) return PAUSED;
  return [];
}
function pickItem(F, i, now) {
  const s = F.scr;
  if (s === SCR.PICK) choose(F, F.list[i]);
  else if (s === SCR.MENU) act(F, F.menu[i], now);
  else if (s === SCR.HOME) { const k = homeItems(F)[i]; F.sel = 0; if (k === 'kraft') F.scr = SCR.START; else if (k === 'more') F.scr = SCR.MORE; else ready(F, k, ''); }
  else if (s === SCR.MORE) ready(F, 'other', F.cfg.more[i][0]);
  else if (s === SCR.SMODE) { if (i === 0) { F.sel = 0; F.scr = SCR.WPICK; } else toPick(F); }
  else if (s === SCR.WPICK) startPlan(F, i, now);
  else if (s === SCR.PAUSE) { if (i === 0) { F.rec.st = 'run'; F.scr = SCR.REC; cue(F, 'start'); } else if (i === 1) saveRec(F, now); else { F.rec = null; F.seg = null; F.flash = null; F.sel = 0; F.scr = SCR.HOME; } }
}
function act(F, item, now) {
  if (item === MENU.EX) toPick(F);
  else if (item === MENU.SKIP) { F.plan.i++; F.plan.n = 0; F.restEnd = 0; if (planItem(F)) goPlan(F); else finish(F, now); }
  else if (item === MENU.UNDO) undo(F);
  else if (item === MENU.FIN) finish(F, now);
  else if (item === MENU.SYNC) { F.out.push({ k: 'setup' }, { k: 'send' }); F.scr = F.back; }
  else if (item === MENU.PAIR) { F.pair = { d: [0, 0, 0, 0, 0, 0], i: 0, st: 'enter' }; F.scr = SCR.PAIR; }
}
