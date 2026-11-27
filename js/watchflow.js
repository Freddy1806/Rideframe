// RIDEFRAME on a Garmin watch: the whole state machine, no DOM, no network (17.11. strength, 18.11. start menu, run / ride /
// other sports, workouts). The browser preview (watch.html, js/watchsim.js) draws it, and garmin/source/Flow.mc is the same
// machine in Monkey C, one function per function. Time is in seconds (Monkey C numbers are 32 bit, Unix ms would not fit).
// Outputs the drawing layer drains: F.cues = vibrations ('set', 'pr', 'rest', 'done', 'start', 'stop', 'lap', 'seg', 'error'),
// F.out = requests ('send', 'pair', 'setup', 'exit', 'saveAct', 'tpl', 'keep' = store the setup: a finished session changed last time's sets).
// 23.11. (after the first fenix 8 run): START steps kg -> reps -> logs, DONE logs, START held switches; BACK set / rest -> list ->
// END (Keep / Finish / Discard); one Strength list (Exercises + workouts); paged summary with heart rate; "Save as workout?".
// Screens: HOME (start menu) -> SMODE (Exercises or a saved workout; 24.11.: no START ready screen any more) -> PICK <-> SET <-> REST -> SUM -> SAVEQ -> HOME;
// 23.11. (Freddy on his fenix 8): BACK goes back (SET / REST -> PICK -> END with sets logged), touch everywhere, the summary, save as workout.
// HOME -> MORE (other sports) -> READY; HOME -> READY (run / ride) -> REC (data pages, route page) <-> PAUSE -> RSUM.
// 19.11.: READY (run / ride) -> RPICK (UP / DOWN or a tap on the route line): None or a route sent from the phone
// (GET /api/watch/routes; out 'routes' asks for the list, out 'route' for one route, setRoutes / setRoute answer).
// 23.11. (second priority after strength): HOME -> TSCAN (find / connect the indoor trainer, js/watchtrainer.js) -> TREC (ERG: target, + / -,
// power, cadence, heart rate; 28.11.: the pages of tPages, UP / DOWN page) <-> TEND (Back to ride / Resume, +5 W, -5 W, Finish & save, Discard; never a pause) -> TSUM. Out 'trainer' keeps the trainer's
// name and the last target, 'saveAct' with sum.sp 'trainer' saves the ride (F.tbody = the upload).
import { compact, defaults, FIELDS, TOP } from './watchfields.js';
import { newLink, scan as tScan, connect as tConnect, stop as tStop, setTarget, bleEv, linkTick, live, shown, newRide, nextTarget, nextStep, newBlock, rideSec, rideSum, rideBody, W_START, W_MIN, W_MAX, W_PAUSE,
  newWk, wkAt, wkTarget, wkTune, nextBy, wkLeft, wkEasy, wkFallback, WK_FB_ID, wkRec, wkClose, rideReport, hrZones } from './watchtrainer.js';
export const SCR = { HOME: 'home', START: 'start', SMODE: 'smode', PICK: 'pick', SET: 'set', REST: 'rest', MENU: 'menu', SUM: 'sum', PAIR: 'pair', GLANCE: 'glance',
  MORE: 'more', READY: 'ready', REC: 'rec', PAUSE: 'pause', RSUM: 'rsum', RPICK: 'rpick', END: 'end', SAVEQ: 'saveq', TSCAN: 'tscan', TREC: 'trec', TEND: 'tend', TSUM: 'tsum', TPICK: 'tpick', THR: 'thr' };
export const KG_STEP = 2.5, KG_HOLD = 10, KG_MAX = 500, REPS_HOLD = 5, REPS_MAX = 100, SEC_STEP = 5, SEC_HOLD = 15, SEC_MAX = 600, REST_STEP = 15, PR_SECS = 3;
export const LAP_M = { run: 1000, ride: 5000, other: 1000 }, LAP_SECS = 5, SEG_SECS = 5, PAUSE_MS = .7; // auto lap distance, banner and result seconds, auto pause below 0.7 m/s
export const MENU = { EX: 'Change exercise', SKIP: 'Skip exercise', UNDO: 'Undo last set', FIN: 'Finish', PAUSE: 'Pause', SYNC: 'Sync now', PAIR: 'Pair with phone' };
export const HOME = { run: 'Run', ride: 'Ride', trainer: 'Indoor trainer', kraft: 'Strength', more: 'More' };
/** 23.11.: the trainer ride's menu (BACK): it does not pause (a stray BACK must not drop the watts), START pauses. 28.11. (the owner on his
 *  first ride: "BACK pauses too"): it never did, but its first row said "Resume" and the ride was out of sight; now the first row says
 *  "Back to ride" while it runs (only a paused ride shows "Resume"), the title RIDE MENU and the line under it "Riding 12:34, 180 W" */
export const TEND_ROWS = ['Back to ride', '+5 W', '-5 W', 'Finish & save', 'Discard'], TEND_RESUME = 'Resume';
/** 27.11.5: the menu's + / - (the fenix 8's held UP / DOWN are system keys): 5 W like the target page's + / - at the 5 W step (a workout:
 *  its offset), the menu stays open for the next press */
export const TEND_W = 5;
/** 28.11.: the ride's pages: the target page (the overview) always first, then the ones switched on in the phone's editor (watch config
 *  "tp", js/watchfields.js TRAINER_PAGES; a config without it: TP_DEF), the workout page only while a workout runs */
export const TP_DEF = ['wk', 'body', 'stats'];
export function tPages(F) {
  const c = F.cfg && Array.isArray(F.cfg.tp) ? F.cfg.tp : TP_DEF, r = ['target'];
  for (const x of c) if (TP_DEF.includes(x) && !r.includes(x) && (x !== 'wk' || F.wk)) r.push(x);
  return r;
}
/** the page of the ride on screen (R.pg counts in tPages) */
export function tPage(F) { const p = tPages(F); return F.tr ? p[F.tr.pg % p.length] : 'target'; }
/** 27.11.4: the summary's pages after a trainer ride (F.sel counts in them): 'ov' what did I do, 'iv' the intervals (a workout with one
 *  ridden), 'hr' heart rate, 'pw' power (the last: DONE) */
export function tsPages(F) { const s = F.tsum, r = ['ov']; if (s && s.iw && s.iw.length > 0) r.push('iv'); r.push('hr', 'pw'); return r; }
/** 27.11.4: the profile's cycling heart rate zones (the watch: UserProfile.getHeartRateZones; the preview: none or a demo), null = none */
export function setHrZones(F, z) { F.hrZ = hrZones(z); }
/** 23.11.: the strength list: the exercises (free), then the saved workouts (the phone's and those saved on the watch) */
export const FREE = 'Free';
/** shown in the menu title on the watch and in the preview, so the user can tell which file is on the watch; raise it with every watch file (garmin/source/Flow.mc VERSION) */
export const VERSION = '27.11.5';
/** BACK from the exercise list once sets are logged: nothing is lost without a second step */
export const END_ROWS = ['Keep training', 'Finish & save', 'Discard'];
/** the pause screen (every mode): BACK held this long (or a finger on the "Hold to finish" pill) saves; the short-press hint shows this long */
export const HOLD_S = 3, HINT_S = 2;
/** 23.11.: every list in screen fractions (watchsim list / tapAt, garmin Draw.list / FlowDelegate.onTap): title, counter, rows [offset, y]
 *  (at least 0.17 S apart around the selected row = 44 px touch targets on the 260 px fenix 8), the selected row's sub line;
 *  menus (3 rows with a pill); a finger dragged over a list moves it one row per DRAG_ROW of the screen */
export const LIST_LAY = { title: .12, count: .19, rows: [[-1, .3], [0, .5], [1, .72], [2, .845]], sub: .585, menu: [[-1, .33], [0, .5], [1, .67]] };
/** 23.11.7 (Freddy: "scrolling works really badly"): the finger moves a list by the distance between two rows as drawn, so the rows
 *  track the finger 1:1 (lists 0.2 of the screen = 52 px on the 260 px fenix 8, menus 0.17, the start menu HOME_LAY.dy); the movement
 *  is summed over the drag events (nothing lost between them). A swipe without drag events moves SWIPE_ROWS rows. */
export const DRAG_ROW = .2, DRAG_MENU = .17, SWIPE_ROWS = 3;
/** 23.11.7 (Freddy: "like a rotary wheel: over the 9 I move my finger slowly and it shows 10, 11, 12"): a finger dragged up or down over
 *  the kg or reps number (the trainer's target) steps it once per WHEEL_STEP of the screen (20 px on the fenix 8), finger up = more
 *  (a picker wheel: the higher value sits below and comes up with the finger); WHEEL_SHOW s after the finger lifts the neighbours go.
 *  A drag is told from a tap / swipe after DRAG_MIN of the screen. */
export const WHEEL_STEP = .075, WHEEL_SHOW = .6, DRAG_MIN = .03;

export const e1rm = (kg, r) => kg > 0 && r > 0 ? (r === 1 ? kg : kg * (1 + r / 30)) : 0; // Epley, like kraftlib.js
const rid = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** a fresh app: setup = GET /api/watch/strength/setup (or the cached copy), o = { paired, queue, id, cfg (GET /api/watch/config), last (sport key), scr } */
export function newFlow(setup, o = {}) {
  const F = { setup: { ex: [], rest: 90 }, list: [], cfg: o.cfg && o.cfg.run ? o.cfg : compact(defaults()), last: HOME[o.last] ? o.last : 'run', paired: o.paired !== false, queue: o.queue || [], newId: o.id || rid,
    scr: o.scr || SCR.HOME, back: SCR.HOME, sel: 0, menu: [], cur: 0, focus: 0, kg: 0, reps: 0, sets: [], start: 0, restEnd: 0, restLen: 0, plan: null, endConf: false, saveq: null,
    flash: null, sum: null, pz: null, pauseT: 0, hr: 0, hrAt: 0, thr: 0, hrN: 0, hrSum: 0, hrMax: 0, pair: { d: [0, 0, 0, 0, 0, 0], i: 0, st: 'enter' }, cues: [], out: [],
    sp: 'run', type: '', rec: null, seg: null, route: null, rsum: null, routes: null, routeId: null, nav: null,
    link: newLink(o.trainer || ''), tr: null, tsum: null, tbody: null, tTgt: o.tgt >= W_MIN && o.tgt <= W_MAX ? o.tgt : W_START, tConf: false,
    rides: [], ftp: 0, wk: null, tw: -1, wkDone: 0, wkSum: null, hrZ: null };
  setSetup(F, setup);
  if (!F.paired) F.scr = SCR.PAIR;
  return F;
}
export const curEx = F => F.setup.ex[F.cur] || { id: '', n: 'Exercise', t: 'w' };
/** the free picker's order (indices into setup.ex): done lately, then the 20 standard exercises, then everything else (own ones) */
export function order(setup) {
  const ex = setup.ex, at = id => ex.findIndex(e => e.id === id), out = [];
  for (const id of [...(setup.recent || []), ...(setup.top || [])]) { const i = at(id); if (i >= 0 && !out.includes(i)) out.push(i); }
  for (let i = 0; i < ex.length; i++) if (!out.includes(i)) out.push(i);
  return out;
}
/** the workouts from the phone (with the setup, else with the config), only those with exercises */
export const savedW = F => (F.setup.workouts || F.cfg.w || []).filter(w => w.it && w.it.length);
/** 23.11.7 (Freddy: "the workouts should be in too, standard workouts"): six workouts built into the watch, no account or phone needed
 *  (garmin/source/Flow.mc stdWorkouts). Items [ex, sets, reps, kg, rest, name, type] from the 20 standard exercises (watchfields TOP);
 *  kg 0 = last time's weight (else the start value), as in any workout without a weight. [id, name, [[ex, sets, reps, rest]]] */
const STD_DEF = [
  ['std-push', 'Push day', [['bench', 4, 6, 120], ['ohp', 3, 8, 120], ['incline', 3, 10, 90], ['dip', 3, 10, 90], ['lateral', 3, 12, 60], ['tri', 3, 12, 60]]],
  ['std-pull', 'Pull day', [['pull', 4, 6, 120], ['row', 4, 8, 120], ['lat', 3, 10, 90], ['cable', 3, 12, 90], ['curl', 3, 12, 60]]],
  ['std-legs', 'Leg day', [['squat', 4, 6, 120], ['rdl', 3, 8, 120], ['legpress', 3, 10, 90], ['legcurl', 3, 12, 60], ['calf', 3, 15, 60]]],
  ['std-upper', 'Upper body', [['bench', 3, 8, 120], ['row', 3, 8, 120], ['ohp', 3, 10, 90], ['lat', 3, 10, 90], ['curl', 3, 12, 60], ['tri', 3, 12, 60]]],
  ['std-lower', 'Lower body', [['frontsquat', 3, 8, 120], ['dead', 3, 5, 120], ['lunge', 3, 10, 90], ['legcurl', 3, 12, 60], ['calf', 3, 15, 60]]],
  ['std-full', 'Full body', [['squat', 3, 8, 120], ['bench', 3, 8, 120], ['row', 3, 8, 90], ['ohp', 3, 10, 90], ['plank', 3, 60, 60]]],
  // 25.11. (Freddy: one-arm pull-up and one-arm push-up as standard workouts, his own plan revised). One exercise per arm with the keys of
  // js/kraftguide.js (oap_neg_l …) so phone and watch share the history; holds and negatives are timed (seconds); a 5th / 6th value = name, type.
  ['std-oapull', 'One-arm pull-up', [['pull', 2, 6, 90], ['oap_90_l', 3, 10, 90, 'OA hold 90 left', 'time'], ['oap_90_r', 3, 10, 90, 'OA hold 90 right', 'time'],
    ['oap_neg_l', 3, 6, 120, 'OA negative left', 'time'], ['oap_neg_r', 3, 6, 120, 'OA negative right', 'time'],
    ['oap_asst_l', 3, 3, 120, 'OA assisted left', 'bw'], ['oap_asst_r', 3, 3, 120, 'OA assisted right', 'bw']]],
  ['std-oapush', 'One-arm push-up', [['push', 2, 10, 60, 'Push-ups', 'bw'], ['oapu_inc_l', 4, 4, 120, 'OA incline left', 'bw'], ['oapu_inc_r', 4, 4, 120, 'OA incline right', 'bw'],
    ['archer_pu', 3, 4, 90, 'Archer push-ups', 'bw'], ['oapu_neg_l', 3, 5, 90, 'OA negative left', 'time'], ['oapu_neg_r', 3, 5, 90, 'OA negative right', 'time']]]];
/** the standard workouts' exercises that are not in TOP: { k, n, t }, for the server's exercise table (tools/watch-api.mjs catalog) */
export const STD_EX = [...new Map(STD_DEF.flatMap(([, , l]) => l.filter(x => x[4] && !TOP.some(e => e.id === x[0])).map(x => [x[0], { k: x[0], n: x[4], t: x[5], g: /^oapu|archer/.test(x[0]) ? 'Chest' : 'Back' }]))).values()];
export const STD_W = STD_DEF.map(([id, n, l]) => ({ id, n, std: true, it: l.map(([ex, k, r, rest, nm, t]) => { const e = nm ? { n: nm, t } : TOP.find(x => x.id === ex); return [ex, k, r, 0, rest, e.n, e.t]; }) }));
/** the strength list's workouts: the saved ones (account / watch) first, then the standard ones; a saved one with a standard one's name hides it */
export const workouts = F => { const s = savedW(F), nm = new Set(s.map(w => String(w.n).toLowerCase())); return [...s, ...STD_W.filter(w => !nm.has(w.n.toLowerCase()))]; };
/** 23.11.: a workout in progress: plan = { w (index into workouts), i (the item now), on (false while a free exercise is done in between), skip: [items] };
 *  a set logged on a planned item carries its index (pi), so jumping between items and undo keep every count right */
const planIts = F => F.plan ? (workouts(F)[F.plan.w] || { it: [] }).it : [];
/** the planned item now, [ex, sets, reps, kg, rest, name?], or null (no workout, or a free exercise in between) */
export const planItem = F => F.plan && F.plan.on ? planIts(F)[F.plan.i] || null : null;
/** sets logged on planned item i */
export const doneOf = (F, i) => F.sets.filter(s => s.pi === i).length;
/** the number of the set being entered (1 = first set of this exercise in this session; in a workout: of this item) */
export const setNo = F => planItem(F) ? doneOf(F, F.plan.i) + 1 : F.sets.filter(s => s.ex === curEx(F).id).length + 1;
/** the next planned item with sets left (after the one now, wrapping; skipped ones not), -1 = all done */
function nextOpen(F) { const it = planIts(F), n = it.length; for (let k = 1; k <= n; k++) { const j = (F.plan.i + k) % n; if (!F.plan.skip.includes(j) && doneOf(F, j) < it[j][1]) return j; } return -1; }
/** the exercise list's rows, [setup index, planned item or -1]: in a workout its items first (in its order), then every other exercise in the free order */
export function pickRows(F) {
  const rows = planIts(F).map((x, j) => [F.setup.ex.findIndex(e => e.id === x[0]), j]).filter(r => r[0] >= 0), inPlan = new Set(rows.map(r => r[0]));
  return [...rows, ...F.list.filter(i => !inPlan.has(i)).map(i => [i, -1])];
}
/** start menu: the sport used last on top */
export const homeItems = F => [F.last, ...Object.keys(HOME).filter(k => k !== F.last)];
/** start menu: HOME_FIT rows fit on the round screen at once (all four entries); the first row shown, so the selection stays visible
 *  if the list ever grows longer (then it scrolls page-wise and the scroll arc shows) */
export const HOME_FIT = 4;
/** its layout in screen fractions (watchsim DRAW / tapAt, garmin Draw.drawHome / FlowDelegate.onTap): logo y, first row y, row step
 *  (= the touch target: 64 px on the 416 px screen), selected pill width and height, week points y */
export const HOME_LAY = { logo: .12, y0: .27, dy: .155, w: .74, h: .13, pts: .87 };
export const homeTop = (sel, n) => sel < HOME_FIT ? 0 : Math.min(sel - HOME_FIT + 1, n - HOME_FIT);
export const restLeft = (F, now) => Math.max(0, Math.ceil(F.restEnd - now));
export const volume = sets => sets.reduce((a, s) => a + s.kg * s.reps, 0);
export const exCount = sets => sets.filter((s, i) => sets.findIndex(x => x.ex === s.ex) === i).length;
export const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

/** the values for the next set of exercise e, [kg, reps]: the last set of this session, else last session's set n (or its last), else a start value;
 *  a workout suggests its own kg and reps */
export function prefillOf(F, e) {
  const mine = F.sets.filter(s => s.ex === e.id), n = mine.length, s = e.s || [];
  if (n) return [mine[n - 1].kg, mine[n - 1].reps];
  const p = s[n] || s[s.length - 1]; let kg, reps;
  if (p) { kg = p[0]; reps = p[1]; } else { kg = e.t === 'w' ? 20 : 0; reps = e.t === 'time' ? 60 : e.t === 'bw' ? 10 : 8; }
  const it = planItem(F); if (it && it[0] === e.id) { if (it[3] > 0 || e.t !== 'w') kg = it[3]; reps = it[2]; }
  return [kg, reps];
}
export function prefill(F) { [F.kg, F.reps] = prefillOf(F, curEx(F)); }
/** 24.11. (Freddy on his fenix 8: "I want to see what I did last time"): last session's set for the set being entered, [kg, reps]
 *  (timed: [0, sec]); past last time's count its final set; null = first time. The set screen shows it small above the big numbers. */
export function lastSet(F, e = curEx(F)) { const s = Array.isArray(e.s) ? e.s : []; return s.length ? s[Math.min(setNo(F), s.length) - 1] : null; }
const kgS = kg => String(Math.round(kg * 10) / 10);
/** last session's sets, short, one string per set (the exercise list's sub line joins them with " · "): a weight is written only when it changes
 *  (80×8 · 8 · 75×10), bodyweight only reps (+kg when added), timed the clock */
export function lastParts(t, s) {
  return (Array.isArray(s) ? s : []).map(([kg, r], i) => t === 'time' ? clock(r) : t === 'bw' ? (kg ? `+${kgS(kg)}×${r}` : String(r)) : i && s[i - 1][0] === kg ? String(r) : `${kgS(kg)}×${r}`);
}
/** the sub line from the first k parts: "Last 80×8 · 8 · 6", "Last 10 · 9 reps"; fewer than all end with " …" */
export function lastTxt(t, s, k = Infinity) {
  const p = lastParts(t, s); if (!p.length) return ''; const n = Math.max(1, Math.min(k, p.length)), bw = t === 'bw' && s.slice(0, n).every(x => !x[0]);
  return 'Last ' + p.slice(0, n).join(' · ') + (n < p.length ? ' …' : bw ? ' reps' : '');
}
/** a finished session in the cached setup at once (the watch may have no phone for days, and the server's setup may come back before the
 *  session is uploaded): each exercise done gets these sets as its last (s, at most 6) and the best (b) raised, recent and last updated */
export function keepLast(setup, sess) {
  if (!setup || !Array.isArray(setup.ex) || !sess || !Array.isArray(sess.sets) || !sess.sets.length) return;
  const by = new Map(); for (const x of sess.sets) { if (!by.has(x.ex)) by.set(x.ex, []); by.get(x.ex).push(x); }
  for (const [id, l] of by) {
    const e = setup.ex.find(y => y.id === id); if (!e) continue; const tm = e.t === 'time';
    e.s = l.slice(0, 6).map(x => tm ? [0, x.reps] : [x.kg, x.reps]);
    const best = Math.max(...l.map(x => e.t === 'bw' || tm ? x.reps : e1rm(x.kg, x.reps))); if (best > (e.b || 0)) e.b = Math.round(best * 10) / 10;
  }
  const ids = [...by.keys()]; setup.recent = [...ids, ...(Array.isArray(setup.recent) ? setup.recent : []).filter(id => !by.has(id))].slice(0, 8);
  if (!setup.last || !(setup.last.at > sess.start)) setup.last = { at: sess.start, sets: sess.sets.length, n: '' };
}
/** column c (0 kg, 1 reps / seconds) one step on (d = +1 / -1, big = held), inside the limits; the value, F unchanged (the wheel's neighbours) */
export function stepOf(F, c, d, big) {
  if (c === 0) return clamp(Math.round((F.kg + d * (big ? KG_HOLD : KG_STEP)) * 100) / 100, 0, KG_MAX);
  if (curEx(F).t === 'time') return clamp(F.reps + d * (big ? SEC_HOLD : SEC_STEP), 0, SEC_MAX); // a timed exercise: seconds
  return clamp(F.reps + d * (big ? REPS_HOLD : 1), 0, REPS_MAX);
}
/** UP / DOWN on the focused value: d = +1 / -1, big = held */
export function stepValue(F, d, big) { const v = stepOf(F, F.focus, d, big); if (F.focus === 0) F.kg = v; else F.reps = v; }
/** 23.11.7: the wheel (a finger dragged over a number), arg = [column, steps] (+ = finger up = more). SET: column 0 kg, 1 reps (timed:
 *  the seconds), the column takes the focus, steps of UP / DOWN in their limits; TREC: the target, steps of the current step size (sent
 *  latest wins). A step that changed something: cue 'tick' (a very short vibration). */
function wheel(F, now, arg) {
  const a = Array.isArray(arg) ? arg : [0, 0], n = Math.trunc(+a[1] || 0), d = n < 0 ? -1 : 1;
  if (F.scr === SCR.SET) {
    F.focus = curEx(F).t === 'time' || a[0] ? 1 : 0; const was = F.kg + ':' + F.reps;
    for (let k = 0; k < Math.abs(n); k++) stepValue(F, d, false);
    if (F.kg + ':' + F.reps !== was) F.cues.push('tick');
  } else if (F.scr === SCR.TREC && F.tr && tPage(F) === 'target') {
    const R = F.tr, t0 = R.tgt; let w = t0;
    if (F.wk) { if (n !== 0) { wkStep(F, n * R.step, now); if (R.tgt !== t0) F.cues.push('tick'); } return; } // 27.11.: a workout: the offset
    for (let k = 0; k < Math.abs(n); k++) { R.tgt = w; w = nextTarget(R, d, false); } R.tgt = t0;
    if (w !== t0) { tTarget(F, w, now); F.cues.push('tick'); }
  }
}
/** the finger distance (screen fraction) that moves the list on screen s by one row: the rows as drawn (FlowDelegate.dragRow) */
export const dragRow = s => s === SCR.HOME ? HOME_LAY.dy : [SCR.MENU, SCR.END, SCR.SAVEQ, SCR.TEND].includes(s) ? DRAG_MENU : DRAG_ROW;
function menuFor(F) {
  if (F.start) return [MENU.EX, ...(planItem(F) ? [MENU.SKIP] : []), ...(F.sets.length ? [MENU.UNDO] : []), MENU.FIN, MENU.PAUSE];
  return F.paired ? [MENU.SYNC, MENU.PAIR] : [MENU.PAIR];
}
function openMenu(F) { F.back = F.scr; F.menu = menuFor(F); F.sel = 0; F.scr = SCR.MENU; }
/** to exercise i: weight first (bodyweight and timed: reps / seconds), prefilled */
function choose(F, i) { F.cur = clamp(i, 0, Math.max(0, F.setup.ex.length - 1)); F.focus = curEx(F).t === 'w' ? 0 : 1; prefill(F); F.scr = SCR.SET; }
/** 23.11.: the exercise list (BACK from a set or the rest, Change exercise): a workout stays on, its items come first; keep = on the exercise now */
function toPick(F, keep) {
  F.restEnd = 0; const pi = F.plan && F.plan.on ? F.plan.i : -1, k = keep ? pickRows(F).findIndex(r => r[0] === F.cur && r[1] === pi) : -1;
  F.sel = Math.max(0, k); F.scr = SCR.PICK;
}
/** the setup index of exercise id (added with its name when the setup does not know it) */
function ensureEx(F, id, n, t) { let i = F.setup.ex.findIndex(e => e.id === id); if (i < 0) { F.setup.ex.push({ id, n: n || id, t: t === 'bw' || t === 'time' ? t : 'w' }); i = F.setup.ex.length - 1; F.list.push(i); } return i; }
/** to the planned item now */
function goPlan(F) { const it = planIts(F)[F.plan.i]; F.plan.on = true; choose(F, ensureEx(F, it[0], it[5], it[6])); }
export function startPlan(F, w, now) { F.plan = { w, i: 0, on: true, skip: [] }; if (!F.start) F.start = now; for (const it of planIts(F)) ensureEx(F, it[0], it[5], it[6]); goPlan(F); }

/** set done: stored, record check, rest starts (a workout: on to the next item with sets left; none left = finished) */
export function completeSet(F, now) {
  if (!(F.reps > 0)) { F.cues.push('error'); return; }
  const e = curEx(F), val = s => e.t === 'w' ? e1rm(s.kg, s.reps) : s.reps, v = val(F), before = F.sets.filter(s => s.ex === e.id).map(val);
  const set = { ex: e.id, kg: F.kg, reps: F.reps, t: Math.max(0, Math.round(now - F.start - F.pauseT)) }, it = planItem(F);
  if (it) set.pi = F.plan.i;
  // a record beats the stored best (only when there is one) and every earlier set of this session, so it flashes once per new high
  if (e.b > 0 && v > e.b + .01 && v > Math.max(0, ...before) + .01) { set.pr = true; F.flash = { k: 'pr', until: now + PR_SECS, kg: F.kg, reps: F.reps, t: e.t }; F.cues.push('pr'); }
  else F.cues.push('set');
  F.sets.push(set);
  F.restLen = it && it[4] > 0 ? it[4] : F.setup.rest || 90;
  if (it && doneOf(F, F.plan.i) >= it[1]) { const j = nextOpen(F); if (j < 0) { finish(F, now); return; } F.plan.i = j; } // the last planned set ends the workout
  F.restEnd = now + F.restLen; F.scr = SCR.REST;
}
function endRest(F, cue) { F.restEnd = 0; if (planItem(F)) goPlan(F); else choose(F, F.cur); if (cue) F.cues.push('rest'); }
/** back on the last set with its values, to fix and tick again (a workout: back on its item) */
export function undo(F) {
  const s = F.sets.pop(); if (!s) return;
  const i = F.setup.ex.findIndex(e => e.id === s.ex); if (i >= 0) F.cur = i;
  if (F.plan) { if (s.pi != null) { F.plan.i = s.pi; F.plan.on = true; F.plan.skip = F.plan.skip.filter(x => x !== s.pi); } else F.plan.on = false; }
  F.focus = curEx(F).t === 'w' ? 0 : 1; F.kg = s.kg; F.reps = s.reps; F.restEnd = 0; F.scr = SCR.SET;
}
/** 23.11.: the session as a workout: one item per block (a planned item, else an exercise) in the order first done:
 *  [ex, sets, reps, kg, rest] with the last set's reps and kg, inside the phone editor's limits (js/watchfields.js LIM) */
export function tplOf(F) {
  const out = [], at = new Map(), its = planIts(F), r0 = F.setup.rest || 90;
  for (const s of F.sets) {
    const k = s.pi != null ? 'p' + s.pi : 'e' + s.ex; let b = at.get(k);
    if (!b) { const p = s.pi != null ? its[s.pi] : null; b = { ex: s.ex, n: 0, rest: p && p[4] > 0 ? p[4] : r0 }; at.set(k, b); out.push(b); }
    b.n++; b.last = s;
  }
  return out.slice(0, 20).map(b => [b.ex, clamp(b.n, 1, 10), clamp(b.last.reps, 1, 100), clamp(Math.round(b.last.kg * 4) / 4, 0, 500), clamp(Math.round(b.rest / 5) * 5, 0, 600)]);
}
/** what to ask after the summary: null (a saved or standard workout done as planned), else { it, n (name for a new one), w ({ id, n } of
 *  the saved workout done), rows }. A changed standard workout is saved as a new one under its name (it then hides the standard one);
 *  only saved workouts count against the 30. */
export function saveOffer(F) {
  const w = F.plan ? workouts(F)[F.plan.w] : null, its = planIts(F);
  if (w && !F.plan.skip.length && F.sets.every(s => s.pi != null) && its.every((x, j) => doneOf(F, j) === x[1])) return null;
  const it = tplOf(F), nm = it.map(x => (F.setup.ex.find(e => e.id === x[0]) || { n: x[0] }).n), room = savedW(F).length < 30, sv = w && !w.std ? w : null;
  const n = w && w.std ? w.n : (nm.slice(0, 2).join(' + ') + (nm.length > 2 ? ` +${nm.length - 2}` : '')).slice(0, 40);
  const rows = sv ? ['Update ' + sv.n, ...(room ? ['Save as new'] : []), 'No'] : room ? ['Save as workout', 'No'] : null;
  return rows ? { it, n, w: sv ? { id: sv.id, n: sv.n } : null, rows } : null;
}
/** the summary's exercises in the order first done: [{ id, n, t, s: [[kg, reps, pr]] }] */
function sumEx(F) {
  const out = [];
  for (const s of F.sets) { let x = out.find(y => y.id === s.ex); if (!x) { const e = F.setup.ex.find(y => y.id === s.ex) || { n: s.ex, t: 'w' }; x = { id: s.ex, n: e.n, t: e.t, s: [] }; out.push(x); } x.s.push([s.kg, s.reps, s.pr ? 1 : 0]); }
  return out;
}
/** finish: the session goes into the queue (sent and retried by the caller), the summary shows (then the question to save it as a workout) */
export function finish(F, now) {
  if (!F.sets.length) { reset(F); return; }
  const id = F.newId(), dur = Math.max(1, Math.round(now - F.start - F.pauseT)), sess = { id, start: Math.round(F.start), duration: dur, sets: F.sets.map(({ ex, kg, reps, t }) => ({ ex, kg, reps, t })) };
  const hr = F.hrN ? { avg: Math.round(F.hrSum / F.hrN), max: F.hrMax } : null; if (hr) sess.hr = hr;
  F.queue.push(sess); keepLast(F.setup, sess); F.list = order(F.setup); // 24.11.: the next session shows these sets as last time's, phone or not
  F.sum = { id, dur, sets: F.sets.length, vol: volume(F.sets), exs: exCount(F.sets), prs: F.sets.filter(s => s.pr).length, st: F.paired ? 'sending' : 'queued', hr, ex: sumEx(F) };
  F.saveq = saveOffer(F);
  F.sets = []; F.start = 0; F.pauseT = 0; F.restEnd = 0; F.plan = null; F.hrN = F.hrSum = F.hrMax = 0;
  F.sel = 0; F.scr = SCR.SUM; F.cues.push('done'); F.out.push({ k: 'keep' }, { k: 'send' });
}
/** 24.11.: a finished or discarded session (and BACK out of strength) ends on the start menu, Strength on top (there is no strength ready screen any more) */
function reset(F) { F.sets = []; F.start = 0; F.pauseT = 0; F.pz = null; F.restEnd = 0; F.plan = null; F.flash = null; F.sum = null; F.saveq = null; F.endConf = false; F.sel = 0; F.scr = SCR.HOME; }
/** 24.11. (Freddy: "that can come directly when you tap Strength"): Strength on the start menu opens the choice (Exercises + saved workouts)
 *  or, without saved workouts, the exercise list; the session clock starts here. No setup yet: asked for, the list says it is loading. */
function strength(F, now) {
  F.start = now; F.sets = []; F.sum = null; F.plan = null; F.last = 'kraft'; F.sel = 0;
  if (!F.setup.ex.length) F.out.push({ k: 'setup' });
  if (workouts(F).length) F.scr = SCR.SMODE; else toPick(F, false);
}
/** the exercise list has no exercises because the setup has not come yet */
export const loading = F => !F.setup.ex.length;
/** 23.11.: saves the session as a workout: on the watch at once (the strength list), for the account through the queue (POST /api/watch/workout) */
function saveTpl(F, asNew) {
  const q = F.saveq, w = asNew || !q.w ? { id: 'w' + F.newId(), n: q.n, it: q.it } : { id: q.w.id, n: q.w.n, it: q.it };
  for (const l of [F.setup.workouts, F.cfg.w].filter((l, i, a) => Array.isArray(l) && a.indexOf(l) === i)) { const k = l.findIndex(x => x.id === w.id); if (k >= 0) l[k] = { ...w }; else l.push({ ...w }); }
  F.queue.push({ id: 't' + F.newId(), tpl: w }); F.out.push({ k: 'tpl' }, { k: 'send' }); F.cues.push('done');
}
/** BACK on the exercise list: with sets logged the end question, else back to the choice (nothing to lose) */
function pickBack(F) { if (F.sets.length) { F.endConf = false; F.sel = 0; F.scr = SCR.END; } else { const w = workouts(F).length; reset(F); if (w) F.scr = SCR.SMODE; } }
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
/** a setup from the server (or the cache); sessions still in the queue (not on the server yet) go over it, so last time stays the newest */
export function setSetup(F, setup) { if (setup && Array.isArray(setup.ex)) { const id = curEx(F).id; for (const q of F.queue) if (!q.tpl) keepLast(setup, q);
  F.setup = setup; F.list = order(setup); const i = setup.ex.findIndex(e => e.id === id); F.cur = i < 0 ? 0 : i; } }
/** 27.11.: the ride workouts from the server (GET /api/watch/rides { ftp, rides }, tools/watch-api.mjs; the watch keeps them in Storage
 *  "rides") and the FTP they were made with; an answer without a list keeps the ones there are */
export function setRides(F, l, ftp) { if (Array.isArray(l)) F.rides = l.filter(w => w && typeof w.id === 'string' && Array.isArray(w.s) && typeof w.n === 'string').slice(0, 30); if (ftp > 0) F.ftp = Math.round(ftp); }
/** the trainer's workout list: the built-in 30 / 15 first when the server has not sent it (yet), then the server's */
export const rides = F => F.rides.some(w => w.id === WK_FB_ID) ? F.rides.slice() : [wkFallback(F.ftp), ...F.rides];
export const FREE_RIDE = 'Free ride (ERG)';
/** "Workout done" shows this long on the ERG page */
export const WK_DONE_S = 30;
/** a new config from the phone (GET /api/watch/config); a running recording keeps its pages */
export function setConfig(F, cfg) { if (cfg && cfg.run && cfg.ride && cfg.other) F.cfg = cfg; }

/* ---- run, ride and the other sports: data pages, route page, laps, pause, segment popup ---- */
/** the sport's settings: { p: pages, map, seg, lap, pause, vib } (other: pages only, no route, no segments) */
export const sportCfg = (F, sp = F.sp) => sp === 'other' ? { map: 0, seg: 0, lap: 0, pause: 0, vib: 1, ...F.cfg.other } : F.cfg[sp];
/** the pages while recording: the data pages, then the route page ('route') when it is switched on and a route is loaded */
export const recPages = F => { const c = sportCfg(F); return [...c.p.map(p => p.filter(f => FIELDS[F.sp][f])), ...(c.map && F.route ? ['route'] : [])]; };
export function newRec(now) { return { st: 'run', start: now, t: 0, d: 0, v: 0, hr: 0, hrMax: 190, cad: 0, pw: 0, p3: [], pwSum: 0, p30: [], np4: 0, npN: 0, gain: 0, kcal: 0, auto: false, pg: 0, lapT0: 0, lapD0: 0, laps: [] }; }
function cue(F, k) { if (!F.rec || sportCfg(F).vib) F.cues.push(k); }
function ready(F, sp, type) { F.sp = sp; F.type = type || ''; F.scr = SCR.READY; if (sp !== 'other' && F.routes == null) F.out.push({ k: 'routes' }); }
/** the routes from the phone (GET /api/watch/routes: [{ id, name, dist, climb }]), at most 20 */
export function setRoutes(F, list) { F.routes = (Array.isArray(list) ? list : []).filter(r => r && r.id && r.name).slice(0, 20); }
function openRoutes(F) { const i = F.routeId && F.routes ? F.routes.findIndex(r => r.id === F.routeId) : -1; F.sel = i + 1; F.scr = SCR.RPICK; if (F.routes == null) F.out.push({ k: 'routes' }); }
/** RPICK row i: 0 = no route, else that route (loaded with out 'route', the app answers with setRoute) */
function chooseRoute(F, i) {
  const r = i > 0 && F.routes ? F.routes[i - 1] : null;
  if (!r) { F.routeId = null; setRoute(F, null); }
  else if (F.routeId !== r.id || !F.route) { F.routeId = r.id; F.route = null; F.out.push({ k: 'route', id: r.id }); }
  F.sel = 0; F.scr = SCR.READY;
}
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
/** the segment popup (the watch's own tracker, js/watchfeed.js = garmin/source/Feed.mc): arg = { k: 'warn' | 'live' | 'end' | 'none', name, len (m), eta (s),
 *  done (m), delta (s, minus = ahead), need (m/s to beat the reference, 0 = out of reach), time (s), pr (warn: PR seconds; end: a new PR), ref ('PR' | 'KOM' | '' = none) } */
function segment(F, now, a) {
  if (a && a.k === 'none') { if (F.seg && F.seg.k !== 'end') F.seg = null; return; } // the watch's tracker: warning over or segment lost (a result stays its 5 s)
  if (!F.rec || !sportCfg(F).seg || !a || !['warn', 'live', 'end'].includes(a.k)) return;
  const was = F.seg; F.seg = { ...a, hide: !!(was && was.k === a.k && was.hide), until: a.k === 'end' ? now + SEG_SECS : 0 };
  if (!was || was.k !== a.k) cue(F, a.k === 'end' && a.pr ? 'pr' : 'seg');
}
/** the route page: where on the route (0..1), metres left, the next turn { dir: 'L' | 'R', in (m), txt } or null */
export function routeInfo(F) {
  const r = F.route, d = F.nav ? F.nav.along : F.rec ? F.rec.d : 0; if (!r || !(r.len > 0)) return null;
  const pos = Math.min(1, d / r.len), t = (r.turns || []).find(x => x.at > d), off = F.nav ? F.nav.off : 0;
  return { pos, left: Math.max(0, r.len - d), turn: t && !off ? { dir: t.dir, in: t.at - d, txt: t.txt || '' } : null, off };
}
/** where on the route the watch is (its own tracking of the GPS against the route): metres along, metres off (0 = on the route) */
export function routeNav(F, along, off) { F.nav = { along: Math.max(0, +along || 0), off: Math.max(0, Math.round(+off || 0)) }; }
/** a route from GET /api/watch/route ({ id, name, dist, p: [[lat, lon]], turns: [[at, L | R | U]] }) -> the route page's form:
 *  points as fractions of the drawing box (0.6 x 0.38 of the screen), one scale for both axes (north up), so a part of the
 *  length is the same part of the drawn line. garmin/source/Feed.mc does the same with flat arrays. */
export const BOX = [.6, .38];
export function routeFace(r) {
  const p = r && Array.isArray(r.p) ? r.p.filter(q => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])) : []; if (p.length < 2) return null;
  const R = 6371008.8, rad = Math.PI / 180, k = Math.cos(p[0][0] * rad), xy = p.map(([la, lo]) => [(lo - p[0][1]) * rad * k * R, (la - p[0][0]) * rad * R]);
  let len = 0; for (let i = 1; i < xy.length; i++) len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  const xs = xy.map(q => q[0]), ys = xy.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min(BOX[0] / Math.max(1, x1 - x0), BOX[1] / Math.max(1, y1 - y0)), ox = (BOX[0] - (x1 - x0) * sc) / 2, oy = (BOX[1] - (y1 - y0) * sc) / 2;
  const pts = xy.map(([x, y]) => [(ox + (x - x0) * sc) / BOX[0], (oy + (y1 - y) * sc) / BOX[1]]);
  const turns = (Array.isArray(r.turns) ? r.turns : []).filter(t => Array.isArray(t) && t[0] > 0).map(([at, d]) => ({ at, dir: d === 'R' ? 'R' : 'L', txt: d === 'U' ? 'U-turn' : d === 'R' ? 'Turn right' : 'Turn left' }));
  return { id: r.id, name: r.name || 'Route', len: r.dist > 0 ? r.dist : len, pts, turns };
}
export function setRoute(F, r) { F.route = r && r.len > 0 && Array.isArray(r.pts) && r.pts.length > 1 ? r : null; }
function begin(F, now) { F.rec = newRec(now); F.seg = null; F.nav = null; F.flash = null; F.scr = SCR.REC; F.last = F.sp === 'other' ? 'more' : F.sp; cue(F, 'start'); }
function saveRec(F, now) {
  const R = F.rec; F.rsum = { sp: F.sp, type: F.type, t: R.t, d: R.d, laps: R.laps.length + (R.d - R.lapD0 > 10 ? 1 : 0), kcal: R.kcal, avgPw: R.t ? R.pwSum / R.t : 0, gain: R.gain, start: R.start };
  F.out.push({ k: 'saveAct', sum: F.rsum }); F.rec = null; F.seg = null; F.flash = null; F.scr = SCR.RSUM; F.cues.push('done');
}

/* ---- pause, the same in every mode (run, ride, more, strength free and guided): START resumes, BACK held 3 s saves (Polar style,
 *      an orange ring fills with 3-2-1; released early = nothing), DOWN / a tap reaches Discard with a confirm step.
 *      A short BACK only shows the hint, so the app is never left with a recording running or lost. ---- */
/** pauses the recording (run / ride / more: START; strength: the menu's Pause). Strength: the clock and a running rest stop. */
export function pause(F, now) {
  const from = F.scr === SCR.MENU ? F.back : F.scr;
  F.pz = { from, sel0: F.sel, at: now, sel: 0, conf: false, hold: 0, hint: 0 }; if (F.rec) F.rec.st = 'pause';
  F.flash = null; F.sel = 0; F.scr = SCR.PAUSE; cue(F, 'stop');
}
function resume(F, now) {
  const P = F.pz; F.pz = null;
  if (F.rec) { F.rec.st = 'run'; F.scr = SCR.REC; }
  else { const d = Math.max(0, now - P.at); F.pauseT += d; if (F.restEnd) F.restEnd += d; F.scr = P.from; F.sel = P.sel0; }
  cue(F, 'start');
}
/** the hold is full: saved (run / ride / more: the activity; strength: the session, its time without the pauses) */
function endPaused(F, now) {
  const P = F.pz; F.pz = null;
  if (F.rec) saveRec(F, now); else { F.pauseT += Math.max(0, now - P.at); finish(F, now); }
}
function discardPaused(F) {
  F.pz = null;
  if (F.rec) { F.rec = null; F.seg = null; F.flash = null; F.sel = 0; F.scr = SCR.HOME; } else reset(F);
}
/** how full the finish ring is (0..1) and the 3-2-1 count; null when no hold runs */
export function holdPart(F, now) {
  const P = F.scr === SCR.PAUSE && F.pz; if (!P || !P.hold) return null;
  const p = Math.max(0, Math.min(1, (now - P.hold) / HOLD_S)); return { p, n: Math.max(1, Math.ceil(HOLD_S - (now - P.hold) - 1e-9)) };
}
/** the elapsed time shown on the pause screen: the moving time, strength: the session time without pauses */
export const pausedTime = F => F.rec ? F.rec.t : F.pz ? Math.max(0, F.pz.at - F.start - F.pauseT) : 0;
function onPause(F, ev, now, arg) {
  const P = F.pz;
  if (P.conf) { if (ev === 'start') discardPaused(F); else if (ev === 'back') P.conf = false; return; } // "Discard? START yes · BACK no"
  if (ev === 'up' || ev === 'down') P.sel = P.sel ? 0 : 1;
  else if (ev === 'start' || ev === 'tap') { if (P.sel) P.conf = true; else resume(F, now); }
  else if (ev === 'item') { if (arg === 1) { P.sel = 1; P.conf = true; } else resume(F, now); }
  else if (ev === 'back') P.hint = now + HINT_S;
}

/* ---- 23.11.: the indoor trainer (ERG). The link (js/watchtrainer.js) finds, connects and controls the trainer; the ride counts one
 *      second at a time on the tick (not while paused) and keeps the series for the upload. ---- */
function tOpen(F, now) { F.sel = 0; F.tw = -1; F.scr = SCR.TSCAN; if (F.link.st === 'off') tScan(F.link, now); }
/** the ride starts: free ERG at the last target, or the workout chosen on TPICK (F.tw: 0 = free, k = rides(F)[k - 1]) at its first target */
function tBegin(F, now) {
  const k = F.tw, l = rides(F), W = k > 0 && k <= l.length ? newWk(l[k - 1]) : null; F.tw = -1; F.wk = W; F.wkSum = W; F.wkDone = 0;
  F.tr = newRide(now, W ? clamp(wkTarget(W, 0), W_MIN, W_MAX) : F.tTgt); F.tr.zb = F.hrZ; F.tsum = null; F.tbody = null; F.tConf = false; setTarget(F.link, F.tr.tgt, now); F.last = 'trainer'; F.scr = SCR.TREC; F.cues.push('start');
}
/* ---- 27.11.: a workout on the trainer (js/watchtrainer.js newWk ...): the watch steps through it by the ride's clock (R.t, so a pause keeps
 *      the place), each new target goes to the trainer at once (a ramp once a second), 3-2-1 before a hard step ('set'), one at its end
 *      ('stop'); + / - move the hard or the easy offset; at the end free ERG at an easy target and "Workout done". ---- */
function wkApply(F, now) { const W = F.wk, R = F.tr; const w = clamp(wkTarget(W, R.t), W_MIN, W_MAX); if (w !== R.tgt) { R.tgt = w; if (R.st === 'run') setTarget(F.link, w, now); } }
function wkEnd(F, now) { const W = F.wk, R = F.tr, w = wkEasy(W); F.wk = null; F.wkDone = now + WK_DONE_S; R.tgt = w; R.pg = 0; newBlock(R); if (R.st === 'run') setTarget(F.link, w, now); F.cues.push('done'); } // the target page says "Workout done" (the workout page is gone)
/** one second of the workout (after the ride counted it) */
function wkSec(F, now) {
  const W = F.wk, R = F.tr; if (!W || !R) return;
  const i0 = W.i; wkAt(W, R.t);
  if (W.i >= W.dur.length) { wkEnd(F, now); return; }
  if (W.i !== i0) { newBlock(R); if (W.hard[i0] && !W.hard[W.i]) F.cues.push('stop'); }
  const left = wkLeft(W, R.t);
  if (W.i + 1 < W.dur.length && W.hard[W.i + 1] && !W.hard[W.i] && left >= 1 && left <= 3) F.cues.push('set');
  wkApply(F, now);
}
/** + / - in a workout: d W on the offset of the step now (hard or easy), sent at once (paused: on the resume) */
function wkStep(F, d, now) { wkTune(F.wk, d); wkApply(F, now); }
/** + / - d W (the target page's + / -, the menu's + / - 5 W): a workout the offset of the step now (27.11.), a free ride the target on
 *  the grid of |d| */
function tPlus(F, d, now) { const R = F.tr; if (F.wk) wkStep(F, d, now); else tTarget(F, nextBy(R.tgt, d > 0 ? 1 : -1, d > 0 ? d : -d), now); }
/** a new target: shown at once, sent when the line is free (latest wins); while paused it waits for the resume */
function tTarget(F, w, now) { const R = F.tr; if (w === R.tgt) return; R.tgt = w; F.tTgt = w; newBlock(R); if (R.st === 'run') setTarget(F.link, w, now); }
/** pause: the clock stops and the trainer goes down to W_PAUSE (easy to spin, no ERG spiral when the legs start again); resume: the target again */
function tPause(F, now) { F.tr.st = 'pause'; setTarget(F.link, W_PAUSE, now); F.cues.push('stop'); }
function tResume(F, now) { F.tr.st = 'run'; setTarget(F.link, F.tr.tgt, now); F.cues.push('start'); }
function tFinish(F, now) {
  const R = F.tr; if (!R.t) { tDiscard(F); return; }
  const W = F.wkSum; if (W) wkClose(W); // 27.11.4: the workout's numbers stay for the summary (also once it is over: wkEnd)
  F.wk = null; F.wkSum = null; F.wkDone = 0; const sum = rideSum(R); F.tbody = rideBody(R, sum, F.newId(), now); F.tsum = rideReport({ ...sum, name: F.link.name }, R, W);
  F.out.push({ k: 'saveAct', sum: { sp: 'trainer', ...sum } }, { k: 'trainer' }); tStop(F.link); F.tr = null; F.sel = 0; F.scr = SCR.TSUM; F.cues.push('done');
}
function tDiscard(F) { tStop(F.link); F.tr = null; F.wk = null; F.wkSum = null; F.wkDone = 0; F.tConf = false; F.sel = 0; F.scr = SCR.HOME; }
/** the ride's seconds up to now (at most 5 at once, a longer gap is not made up) */
function tSecs(F, now) {
  const R = F.tr; if (!R) return; if (now - R.ts > 5) R.ts = Math.floor(now) - 5;
  while (R.ts + 1 <= now) { R.ts++; if (R.st === 'run') { const d = live(F.link, now); rideSec(R, d.pw, d.cad, F.hr); if (F.wkSum) wkRec(F.wkSum, R.t, d.pw, F.hr, R.tgt); wkSec(F, now); } }
}
/** TSCAN: the list while searching (UP / DOWN, drag, START or a tap connects), else the state with START to ride */
function onTScan(F, ev, now, arg) {
  const L = F.link, v = shown(L), n = L.list.length;
  if (v === 'scan' || v === 'off') {
    if (ev === 'scroll') { F.sel = clamp(F.sel + Math.round(+arg || 0), 0, Math.max(0, n - 1)); return; }
    if (ev === 'back') { tStop(L); F.sel = 0; F.scr = SCR.HOME; return; }
    if (!n) return;
    if (ev === 'up') F.sel = (F.sel + n - 1) % n; else if (ev === 'down') F.sel = (F.sel + 1) % n;
    else if (ev === 'start' || ev === 'tap' || ev === 'item') tConnect(L, L.list[clamp(ev === 'item' ? arg | 0 : F.sel, 0, n - 1)].name, now);
    return;
  }
  // 27.11.: START (a tap) opens the choice Free ride / a workout (TPICK), also while connecting; once chosen and connected START rides
  // (refused: ride anyway, the power is recorded); UP / DOWN open the choice again
  const go = v === 'ready' || v === 'refused';
  if (ev === 'start' || ev === 'tap') { if (go && F.tw >= 0) tHr(F, now); else if (go || v === 'conn') tPick(F); }
  else if (ev === 'up' || ev === 'down') { if (go || v === 'conn') tPick(F); }
  else if (ev === 'back') { tStop(L); L.want = ''; F.tw = -1; tScan(L, now); F.sel = 0; } // cancel: back to the list, no automatic connect this time
}
/* ---- 27.11.2: the heart rate step between the choice and the ride (THR). A watch app cannot pair a strap (the watch's own Sensors menu
 *      does), so the step only waits for a heart rate: one that came in the last HR_LIVE_S seconds is shown HR_SHOW_S seconds, then the ride
 *      starts by itself; START (a tap) starts at once, with or without one; BACK = the trainer's state. ---- */
export const HR_LIVE_S = 15, HR_SHOW_S = 2;
export const hrOn = (F, now) => F.hr > 0 && now - F.hrAt <= HR_LIVE_S;
function tHr(F, now) { F.sel = 0; F.thr = hrOn(F, now) ? now : 0; F.scr = SCR.THR; }
function onTHr(F, ev, now) {
  if (ev === 'start' || ev === 'tap') tBegin(F, now);
  else if (ev === 'back') { F.sel = 0; F.scr = SCR.TSCAN; }
}
function tPick(F) { F.sel = F.tw > 0 ? F.tw : 0; F.scr = SCR.TPICK; }
/** TPICK row i: 0 = free ride, else that workout; connected: the ride starts, else back to the trainer's state until it is */
function tChoose(F, i, now) { F.tw = i; const v = shown(F.link); if (v === 'ready' || v === 'refused') tHr(F, now); else { F.sel = 0; F.scr = SCR.TSCAN; } }
/** TREC (28.11., the owner's first ride: "UP / DOWN must page like Garmin's own activity screens"): UP / DOWN = the previous / next page
 *  (wrapping; swipe down / up the same), UP / DOWN held = + / - one step of the current size (repeating while held, 'tick' each), the - / +
 *  touch zones of the target page (item 0 / 1) = one step, a tap on its target (item 2) = step size 5 / 10 / 25; a tap on another page =
 *  back to the target page; START = pause / resume; BACK (BACK held, swipe left / right) = the menu, which does not pause */
function onTRec(F, ev, now, arg) {
  const R = F.tr; if (!R) { F.scr = SCR.HOME; return; }
  const n = tPages(F).length, plus = ev === 'upHold' || (ev === 'item' && arg === 1), minus = ev === 'downHold' || (ev === 'item' && arg === 0);
  if (plus || minus) {
    const t0 = R.tgt;
    tPlus(F, plus ? R.step : -R.step, now);
    if (ev !== 'item' && R.tgt !== t0) F.cues.push('tick'); // held on any page: felt, not only seen
  }
  else if (ev === 'item') R.step = nextStep(R.step);
  else if (ev === 'up' || ev === 'swipeDown') R.pg = (R.pg % n + n - 1) % n;
  else if (ev === 'down' || ev === 'swipeUp') R.pg = (R.pg % n + 1) % n;
  else if (ev === 'start') { if (R.st === 'run') tPause(F, now); else tResume(F, now); }
  else if (ev === 'tap') R.pg = 0; // another page: a tap goes back to the target page
  else if (ev === 'back' || ev === 'menu') { F.tConf = false; F.sel = 0; F.scr = SCR.TEND; }
}

/** 27.11.4: the summary after a trainer ride (tsPages): UP / DOWN (swipe down / up) = the previous / next page, wrapping, a tap = the next
 *  page; START, BACK (swipe right) or the last page's DONE (FlowDelegate / watchsim: 'done') = done, the start menu */
function onTSum(F, ev) {
  const n = tsPages(F).length;
  if (ev === 'up' || ev === 'swipeDown') F.sel = (F.sel % n + n - 1) % n;
  else if (ev === 'down' || ev === 'swipeUp' || ev === 'tap') F.sel = (F.sel % n + 1) % n;
  else if (ev === 'start' || ev === 'back' || ev === 'done') { F.sel = 0; F.scr = SCR.HOME; }
}

/** every input: ev = up, down, upHold, downHold, start, startHold (START held: weight <-> reps), done (the set screen's DONE pill), back, menu,
 *  swipeUp, swipeDown, swipeLeft, swipeRight, scroll (a finger dragged over a list or the summary, arg = rows, + = on down the list), tap, item (arg = index),
 *  wheel (23.11.7: a finger dragged over the set screen's kg / reps or the trainer's target, arg = [column 0 kg / 1 reps, steps, + = finger up = more]),
 *  focus (arg = 0 kg / 1 reps / digit), hr (arg = bpm), tick, sample (arg = one second of movement), seg (arg = segment state),
 *  holdStart / holdEnd (BACK pressed / released, or a finger on the pause screen's "Hold to finish" pill) */
export function handle(F, ev, now, arg) {
  const ev0 = ev;
  if (ev === 'hr') { F.hr = arg || 0; if (arg > 0) F.hrAt = now; if (F.start && arg > 0) { F.hrN++; F.hrSum += arg; F.hrMax = Math.max(F.hrMax, arg); } return; }
  if (ev === 'sample') { sample(F, now, arg || {}); return; }
  if (ev === 'seg') { segment(F, now, arg); return; }
  if (ev === 'ble') { const w = F.link.want; bleEv(F.link, now, arg); if (F.link.want && F.link.want !== w) F.out.push({ k: 'trainer' }); return; } // the trainer's radio (js/watchtrainer.js)
  if (ev === 'holdStart' || ev === 'holdEnd') { // BACK pressed / released (and the touch pill): only the pause screen listens
    const P = F.scr === SCR.PAUSE && F.pz; if (!P || P.conf) return;
    if (ev === 'holdStart') P.hold = now; else if (P.hold) { P.hold = 0; P.hint = now + HINT_S; } // released early: nothing, the hint
    return;
  }
  if (ev === 'tick') {
    linkTick(F.link, now); tSecs(F, now);
    if (F.scr === SCR.THR) { const on = hrOn(F, now); if (!on) F.thr = 0; else if (!F.thr) F.thr = now; if (F.thr && now - F.thr >= HR_SHOW_S) { tBegin(F, now); return; } }
    if (F.scr === SCR.PAUSE && F.pz && F.pz.hold && now - F.pz.hold >= HOLD_S) { endPaused(F, now); return; }
    if (F.flash && now >= F.flash.until) F.flash = null;
    if (F.seg && F.seg.k === 'end' && now >= F.seg.until) F.seg = null;
    if (F.scr === SCR.REST && now >= F.restEnd) endRest(F, true);
    return;
  }
  if (F.flash) { F.flash = null; if (ev !== 'menu') return; } // the first touch after a record only clears the flash
  if (ev === 'wheel') { wheel(F, now, arg); return; }
  if (ev === 'swipeLeft') ev = 'menu';
  if (ev === 'swipeRight') ev = 'back';
  const s = F.scr, list = [SCR.PICK, SCR.MENU, SCR.HOME, SCR.MORE, SCR.SMODE, SCR.RPICK, SCR.END, SCR.SAVEQ, SCR.TEND, SCR.TPICK].includes(s), paged = list || s === SCR.REC || s === SCR.PAUSE || s === SCR.SUM || s === SCR.TSCAN;
  if (s === SCR.THR) { onTHr(F, ev, now); return; }
  if (s === SCR.TREC) { onTRec(F, ev, now, arg); return; } // before the swipe mapping: swipe up / down pages there like UP / DOWN
  if (s === SCR.TSUM) { onTSum(F, ev); return; }
  // 23.11.7: a swipe on a list (only when no drag events came: FlowDelegate / watchsim swallow the swipe that ends a drag) moves it
  // SWIPE_ROWS rows with the finger, no wrapping; the data pages and the summary a page; a number counts up
  if ((ev === 'swipeUp' || ev === 'swipeDown') && (list || s === SCR.TSCAN)) { ev = 'scroll'; arg = ev0 === 'swipeUp' ? SWIPE_ROWS : -SWIPE_ROWS; }
  if (ev === 'swipeUp') ev = paged ? 'down' : 'up';
  if (ev === 'swipeDown') ev = paged ? 'up' : 'down';
  if (s === SCR.TSCAN) { onTScan(F, ev, now, arg); return; }
  if (ev === 'scroll') { // the finger dragged: the list follows it row by row (no wrapping)
    const d = Math.round(+arg || 0); if (list) F.sel = clamp(F.sel + d, 0, Math.max(0, listItems(F).length - 1)); else if (s === SCR.SUM && F.sum) F.sel = clamp(F.sel + d, 0, F.sum.ex.length);
    return;
  }
  if (ev === 'menu') { if (s === SCR.HOME || s === SCR.PICK || s === SCR.SET || s === SCR.REST) openMenu(F); return; }
  if (s === SCR.PAUSE) { if (F.pz) onPause(F, ev, now, arg); else F.scr = F.rec ? SCR.REC : SCR.HOME; return; }
  if (s === SCR.GLANCE) { if (ev === 'start' || ev === 'tap') { F.sel = 0; F.scr = F.paired ? SCR.HOME : SCR.PAIR; } return; }
  if (s === SCR.READY) {
    if (ev === 'start' || ev === 'tap') begin(F, now);
    else if ((ev === 'up' || ev === 'down') && F.sp !== 'other') openRoutes(F);
    else if (ev === 'back') { F.sel = 0; F.scr = F.sp === 'other' ? SCR.MORE : SCR.HOME; }
    return;
  }
  if (s === SCR.REC) {
    const n = recPages(F).length, R = F.rec;
    if (ev === 'up' || ev === 'down') R.pg = (R.pg + (ev === 'down' ? 1 : n - 1)) % n;
    else if (ev === 'start') pause(F, now);
    else if (ev === 'back' || ev === 'tap') { if (F.seg && !F.seg.hide) F.seg.hide = true; else if (ev === 'back') lap(F, now); } // BACK = lap (like Garmin); first it closes the segment popup
    return;
  }
  if (list) {
    const items = listItems(F), n = items.length;
    if (!n) { if (ev === 'back') { if (s === SCR.MENU) F.scr = F.back; else if (s === SCR.MORE) F.scr = SCR.HOME; else if (s === SCR.HOME) F.out.push({ k: 'exit' }); else if (s === SCR.RPICK) F.scr = SCR.READY; else if (s === SCR.PICK) pickBack(F); else reset(F); } return; }
    if (ev === 'up') F.sel = (F.sel + n - 1) % n;
    else if (ev === 'down') F.sel = (F.sel + 1) % n;
    else if (ev === 'start' || ev === 'item' || (ev === 'tap' && s !== SCR.PICK && s !== SCR.MENU)) pickItem(F, ev === 'item' ? clamp(arg | 0, 0, n - 1) : F.sel, now);
    else if (ev === 'back') {
      if (s === SCR.MENU) F.scr = F.back;
      else if (s === SCR.HOME) F.out.push({ k: 'exit' });
      else if (s === SCR.MORE) { F.sel = 0; F.scr = SCR.HOME; }
      else if (s === SCR.RPICK) { F.sel = 0; F.scr = SCR.READY; }
      else if (s === SCR.PICK) pickBack(F);
      else if (s === SCR.END) { if (F.endConf) { F.endConf = false; F.sel = 2; } else toPick(F, true); } // BACK = keep training
      else if (s === SCR.SAVEQ) reset(F); // = No
      else if (s === SCR.TEND) { if (F.tConf) { F.tConf = false; F.sel = 4; } else F.scr = SCR.TREC; } // BACK = back to the ride (a paused one stays paused)
      else if (s === SCR.TPICK) { F.sel = 0; F.scr = SCR.TSCAN; } // the trainer's state, still connected
      else reset(F); // SMODE: the strength screen
    }
    return;
  }
  if (s === SCR.RSUM) { if (ev === 'start' || ev === 'back' || ev === 'tap') { F.rsum = null; F.sel = 0; F.scr = SCR.HOME; } return; }
  if (s === SCR.SET) {
    const timed = curEx(F).t === 'time';
    if (ev === 'up' || ev === 'down') stepValue(F, ev === 'up' ? 1 : -1, false);
    else if (ev === 'upHold' || ev === 'downHold') stepValue(F, ev === 'upHold' ? 1 : -1, true);
    else if (ev === 'focus') F.focus = arg ? 1 : 0; // touch: a tap on the weight or the reps
    else if (ev === 'startHold') { if (!timed) F.focus = 1 - F.focus; } // buttons: START held moves between weight and reps
    else if (ev === 'start') { if (!timed && F.focus === 0) F.focus = 1; else completeSet(F, now); } // START: weight, then reps, then the set is logged
    else if (ev === 'done') completeSet(F, now); // the DONE pill logs at once; a stray tap elsewhere never logs a set
    else if (ev === 'back') toPick(F, true); // 23.11.: BACK goes back: to the exercise list (nothing logged is lost)
    return;
  }
  if (s === SCR.REST) {
    if (ev === 'start' || ev === 'tap') endRest(F, false);
    else if (ev === 'back') toPick(F, true);
    else if (ev === 'up') { F.restEnd += REST_STEP; F.restLen += REST_STEP; }
    else if (ev === 'down') F.restEnd = Math.max(now + 1, F.restEnd - REST_STEP);
    return;
  }
  if (s === SCR.SUM) { // 23.11.: page 0 the totals, then one page per exercise; done: the question to save it as a workout (when there is one)
    const n = F.sum ? F.sum.ex.length + 1 : 1;
    if (ev === 'up' || ev === 'down') F.sel = (F.sel + (ev === 'down' ? 1 : n - 1)) % n;
    else if (ev === 'start' || ev === 'back' || ev === 'tap') { if (F.saveq) { F.sel = 0; F.scr = SCR.SAVEQ; } else reset(F); }
    return;
  }
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
  if (s === SCR.PICK) return pickRows(F).map(([i]) => F.setup.ex[i].n);
  if (s === SCR.HOME) return homeItems(F).map(k => HOME[k]);
  if (s === SCR.MORE) return F.cfg.more.map(m => m[1]);
  if (s === SCR.SMODE) return [FREE, ...workouts(F).map(w => w.n)];
  if (s === SCR.RPICK) return ['None', ...(F.routes || []).map(r => r.name)];
  if (s === SCR.END) return F.endConf ? ['Keep', `Discard ${F.sets.length} ${F.sets.length === 1 ? 'set' : 'sets'}`] : END_ROWS;
  if (s === SCR.SAVEQ) return F.saveq ? F.saveq.rows : [];
  if (s === SCR.TEND) return F.tConf ? ['Keep riding', 'Discard ride'] : TEND_ROWS.map((r, i) => i === 0 && F.tr && F.tr.st !== 'run' ? TEND_RESUME : r);
  if (s === SCR.TSCAN) return F.link.list.map(x => x.name);
  if (s === SCR.TPICK) return [FREE_RIDE, ...rides(F).map(w => w.n)];
  return [];
}
function pickItem(F, i, now) {
  const s = F.scr;
  if (s === SCR.PICK) { const [x, j] = pickRows(F)[i]; if (j >= 0) { F.plan.i = j; F.plan.skip = F.plan.skip.filter(k => k !== j); goPlan(F); } else { if (F.plan) F.plan.on = false; choose(F, x); } }
  else if (s === SCR.MENU) act(F, F.menu[i], now);
  else if (s === SCR.HOME) { const k = homeItems(F)[i]; F.sel = 0; if (k === 'kraft') strength(F, now); else if (k === 'more') F.scr = SCR.MORE; else if (k === 'trainer') tOpen(F, now); else ready(F, k, ''); }
  else if (s === SCR.MORE) ready(F, 'other', F.cfg.more[i][0]);
  else if (s === SCR.SMODE) { if (!F.start) F.start = now; if (i === 0) toPick(F, false); else startPlan(F, i - 1, now); }
  else if (s === SCR.RPICK) chooseRoute(F, i);
  else if (s === SCR.END) {
    if (F.endConf) { if (i === 1) reset(F); else { F.endConf = false; F.sel = 2; } } // the second step: Discard for real, or keep
    else if (i === 0) toPick(F, true); else if (i === 1) finish(F, now); else { F.endConf = true; F.sel = 0; }
  }
  else if (s === SCR.TEND) {
    if (F.tConf) { if (i === 1) tDiscard(F); else { F.tConf = false; F.sel = 4; } } // the second step: Discard for real, or keep riding
    else if (i === 0) { F.scr = SCR.TREC; if (F.tr.st !== 'run') tResume(F, now); } // Back to ride (Resume: a paused one goes on)
    else if (i === 1 || i === 2) tPlus(F, i === 1 ? TEND_W : -TEND_W, now); // 27.11.5: + / - 5 W, the menu stays
    else if (i === 3) tFinish(F, now); else { F.tConf = true; F.sel = 0; }
  }
  else if (s === SCR.TPICK) tChoose(F, i, now);
  else if (s === SCR.SAVEQ) { const q = F.saveq, k = q.rows.length - 1; if (i < k) saveTpl(F, !q.w || i === 1); reset(F); } // the last row is No
}
function act(F, item, now) {
  if (item === MENU.EX) toPick(F, true);
  else if (item === MENU.SKIP) { F.plan.skip.push(F.plan.i); F.restEnd = 0; const j = nextOpen(F); if (j < 0) finish(F, now); else { F.plan.i = j; goPlan(F); } }
  else if (item === MENU.UNDO) undo(F);
  else if (item === MENU.FIN) finish(F, now);
  else if (item === MENU.PAUSE) pause(F, now);
  else if (item === MENU.SYNC) { F.out.push({ k: 'setup' }, { k: 'send' }); F.scr = F.back; }
  else if (item === MENU.PAIR) { F.pair = { d: [0, 0, 0, 0, 0, 0], i: 0, st: 'enter' }; F.scr = SCR.PAIR; }
}

/* ---- 25.11.: Garmin's own recovery values (garmin/source/Health.mc healthSnapshot, the server: tools/health-api.mjs) ----
 * The watch reads them once per app start and before each upload and sends POST /api/watch/health { day, t, ss?, bb?, … }.
 * raw = what the watch's APIs gave (null / missing = the device does not have it): { sleepScore, bodyBattery, recoveryMin, stress,
 * restingHr, vo2Run, vo2Bike, trainingStatus, respiration, pulseOx, steps }. Only real values go out: numbers that are finite and
 * in range (rounded like the watch's toNumber), the training status as text; the local day as the watch sees it. */
export const HEALTH_KEYS = [['ss', 'sleepScore', 0, 100], ['bb', 'bodyBattery', 0, 100], ['rt', 'recoveryMin', 0, 10080], ['st', 'stress', 0, 100], ['rhr', 'restingHr', 25, 150],
  ['v2r', 'vo2Run', 10, 100], ['v2b', 'vo2Bike', 10, 100], ['rr', 'respiration', 3, 60], ['spo2', 'pulseOx', 50, 100], ['steps', 'steps', 0, 200000]];
const p2 = n => String(n).padStart(2, '0');
/** now = Unix seconds; returns the upload body, or null when the watch has none of the values */
export function healthBody(raw, now) {
  const d = new Date(now * 1000), o = { day: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, t: now }; let n = 0;
  for (const [k, f, lo, hi] of HEALTH_KEYS) { const v = raw ? raw[f] : null; if (typeof v === 'number' && Number.isFinite(v)) { const x = k === 'rr' ? Math.round(v * 10) / 10 : Math.round(v); if (x >= lo && x <= hi) { o[k] = x; n++; } } }
  const ts = raw ? raw.trainingStatus : null; if (typeof ts === 'string' && ts.trim()) { o.ts = ts.trim().slice(0, 40); n++; }
  return n ? o : null;
}
/** the preview's watch (demo data): a morning after a good night; the demo never sends it */
export const DEMO_HEALTH = { sleepScore: 84, bodyBattery: 78, recoveryMin: 540, stress: 22, restingHr: 47, vo2Run: 53, vo2Bike: 55, trainingStatus: 'Productive', respiration: 13.4, pulseOx: 97, steps: 2310 };
