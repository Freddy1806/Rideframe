// 23.11.8: every screen and state of the watch app with worst-case content (kg 102.5 and BW, 100 reps, "Incline bench press", a long
// workout name, heart rate 188, 1:23:45, 4-digit power, pace 12:34 ...), as js/watchflow.js states for js/watchscreens.js.
// Used by tools/watch-layout.mjs (the layout check on all five watches) and tools/watch-sheets.cjs (the contact sheets).
import { newFlow, handle, SCR, setRoutes, setRoute, startPlan, newRec, saveOffer, END_ROWS } from '../js/watchflow.js';
import { newLink, newRide, newWk, wkAt } from '../js/watchtrainer.js';

export const NOW = 1700000000;
const LONG_W = 'Push day with a very long name';
const SETUP = () => ({ v: 1, unit: 'kg', rest: 90, ex: [
  { id: 'incline', n: 'Incline bench press', t: 'w', s: [[102.5, 100], [102.5, 100], [100, 12], [97.5, 10], [95, 8], [92.5, 6]], b: 140 },
  { id: 'bench', n: 'Bench press', t: 'w', s: [[80, 8], [80, 8], [75, 10]], b: 104.5 },
  { id: 'pull', n: 'Pull-ups', t: 'bw', s: [[22.5, 100], [0, 12]], b: 12 },
  { id: 'dip', n: 'Dips', t: 'bw', s: [[0, 15], [0, 12]], b: 15 },
  { id: 'plank', n: 'Plank', t: 'time', s: [[0, 600], [0, 90]], b: 600 },
  { id: 'squat', n: 'Squat', t: 'w', s: [], b: 0 },
  { id: 'rdl', n: 'Romanian deadlift', t: 'w', s: [[140, 10]], b: 160 },
  { id: 'tri', n: 'Triceps pushdown', t: 'w' }],
  top: ['incline', 'bench', 'pull', 'dip', 'plank', 'squat', 'rdl', 'tri'], recent: ['incline'],
  workouts: [{ id: 'w1', n: LONG_W, it: [['incline', 10, 100, 102.5, 120], ['pull', 3, 12, 0, 90], ['plank', 2, 600, 0, 60], ['rdl', 4, 10, 140, 120]] }] });
const SUM = { pts: 12450, prev: 12000, delta: -1234 };
const mk = (o = {}) => newFlow(SETUP(), { id: () => 'id' + Math.random().toString(36).slice(2, 8), last: 'kraft', ...o });
const go = (F, evs, t = NOW) => { for (const e of evs) Array.isArray(e) ? handle(F, e[0], t, e[1]) : handle(F, e, t); return F; };
const exI = (F, id) => F.setup.ex.findIndex(e => e.id === id);
/** a strength session on exercise id: n sets logged before, the set screen with kg / reps */
function onSet(id, { kg, reps, logged = 0, plan = false, focus } = {}) {
  const F = mk(); F.start = NOW - 5025; F.hr = 188;
  if (plan) startPlan(F, 0, NOW - 5025); else { F.cur = exI(F, id); F.scr = SCR.SET; }
  if (plan && id !== 'incline') { const j = F.setup.workouts[0].it.findIndex(x => x[0] === id); F.plan.i = j; F.cur = exI(F, id); }
  for (let i = 0; i < logged; i++) F.sets.push({ ex: id, kg: kg ?? 0, reps: reps ?? 0, t: 60 * i, ...(plan ? { pi: F.plan.i } : {}) });
  F.scr = SCR.SET; F.kg = kg ?? 0; F.reps = reps ?? 0; F.focus = focus ?? (F.setup.ex[F.cur].t === 'w' ? 0 : 1);
  return F;
}
function rec(sp, o = {}) {
  const F = mk({ last: sp === 'other' ? 'more' : sp }); F.sp = sp; F.type = o.type || ''; F.hr = 188;
  const R = newRec(NOW - 5025); Object.assign(R, { t: 5025, d: 123456, v: 1000 / 754, hr: 188, cad: 188, pw: 1250, p3: [1250, 1250, 1250], pwSum: 1250 * 5025, np4: 1250 ** 4 * 10, npN: 10, gain: 2345, kcal: 12345, lapT0: 0, lapD0: 0, pg: o.pg || 0, auto: !!o.auto });
  if (sp === 'run') Object.assign(R, { d: 23960, v: 1000 / 754, lapT0: 4271, lapD0: 23000 }); // pace 12:34, lap pace 12:34
  F.rec = R; F.scr = SCR.REC;
  return F;
}
const ROUTES = [{ id: 'r1', name: 'Riverside loop around the old harbour', dist: 123456, climb: 2345 }, { id: 'r2', name: 'Lake', dist: 8000, climb: 0 }];
const routeOf = () => { const pts = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 1.7 - 2.2; pts.push([.5 + .45 * Math.cos(a), .5 + .45 * Math.sin(a)]); } return { name: ROUTES[0].name, len: 123456, pts, turns: [{ at: 24500, dir: 'L', txt: 'Harbour Road North' }] }; };
function trainer(st, o = {}) {
  const F = mk({ last: 'trainer' }); F.hr = 188; F.hrAt = NOW; const L = F.link = newLink('');
  L.list = [{ name: 'KICKR CORE 2 5A1F', ftms: true }, { name: 'Assioma DUO power meter', ftms: false }, { name: 'Tacx Neo 2T', ftms: true }];
  L.st = st; L.name = 'KICKR CORE 2 5A1F'; L.ctl = o.ctl !== false; L.ever = !!o.ever; L.pw = 1250; L.cad = 120; L.at = NOW;
  if (o.empty) L.list = [];
  F.scr = SCR.TSCAN; F.sel = 0;
  return F;
}
function ride(o = {}) {
  const F = trainer('ready', o); const R = F.tr = newRide(NOW - 5025, 1000);
  Object.assign(R, { t: 5025, tgt: o.tgt || 1000, step: 25, pg: o.pg || 0, st: o.paused ? 'pause' : 'run', pwSum: 1250 * 5025, pwMax: 1888, kj: 6281, np4: 1250 ** 4 * 10, npN: 10, cadSum: 120 * 5025, cadN: 5025, hrSum: 188 * 5025, hrN: 5025, hrMax: 199, bT0: 25, bSum: 1250 * 5000, bN: 5000 });
  F.scr = SCR.TREC; return F;
}
const W = (c, scr) => ({ wheel: { c, scr, until: Infinity } });
// 27.11.: a trainer workout with worst-case text: 13 x 3 hard 1250 W (4 digits), the 13th of set 3, +25 W, a long label, 1:23:45 left
const LONG_RIDE = 'Threshold over-unders XL';
const WKDEF = { id: 'wx', n: LONG_RIDE, s: [[3000, 100, 250, 0, 'Warm-up'], [3, [[13, [[600, 1250, null, 1, '30/15'], [600, 1125, null, 0, 'Recovery spin']], 1], [600, 130, null, 0, 'Rest']], 1], [600, 1250, 999, 0, 'Cool-down']] };
function wkRide(o = {}) {
  const F = ride(o), W = F.wk = newWk(WKDEF); W.ha = o.ha ?? 25; W.ea = o.ea ?? 0;
  const t = o.last ? W.tot - 300 : o.at ?? W.tot - 1200 + 1; wkAt(W, t); F.tr.t = t; F.tr.tgt = o.tgt || 1275;
  return F;
}

/** [id, label, () => { F, now?, sum?, ui? }] */
export const SCENES = [
  ['home', 'Start menu (Strength on top), week points', () => ({ F: mk(), sum: SUM })],
  ['home-sel2', 'Start menu, Indoor trainer selected', () => { const F = mk({ last: 'run' }); F.sel = 2; return { F, sum: { pts: 245, delta: 12 } }; }],
  ['more', 'More sports', () => { const F = mk(); F.cfg = { ...F.cfg, more: [['HighIntensityIntervalTraining', 'High intensity interval training'], ['Walk', 'Walk'], ['StandUpPaddling', 'Stand up paddling'], ['Yoga', 'Yoga']] }; F.scr = SCR.MORE; F.sel = 0; return { F }; }],
  ['more-empty', 'More sports, none chosen', () => { const F = mk(); F.cfg = { ...F.cfg, more: [] }; F.scr = SCR.MORE; return { F }; }],
  ['smode-free', 'Strength: Free', () => ({ F: go(mk(), ['start']) })],
  ['smode-saved', 'Strength: a saved workout (long name)', () => { const F = go(mk(), ['start']); F.sel = 1; return { F }; }],
  ['smode-std', 'Strength: a standard workout', () => { const F = go(mk(), ['start']); F.sel = 3; return { F }; }],
  ['pick-loading', 'Exercises loading', () => { const F = newFlow({ ex: [] }, { last: 'kraft' }); F.scr = SCR.PICK; return { F }; }],
  ['pick-last', 'Exercise list, Last ... sub line', () => { const F = go(mk(), ['start', 'start']); F.sel = 0; return { F }; }],
  ['pick-done', 'Exercise list, sets done', () => { const F = onSet('incline', { kg: 102.5, reps: 100, logged: 12 }); F.scr = SCR.PICK; F.sel = 0; return { F }; }],
  ['pick-plan', 'Exercise list in a workout', () => { const F = onSet('incline', { kg: 102.5, reps: 100, logged: 3, plan: true }); F.scr = SCR.PICK; F.sel = 1; return { F }; }],
  ['set-kg', 'SET: 102.5 kg x 100, last time, SET 10 OF 10', () => ({ F: onSet('incline', { kg: 102.5, reps: 100, logged: 9, plan: true }), now: NOW })],
  ['set-reps', 'SET: reps focused, free', () => ({ F: onSet('incline', { kg: 102.5, reps: 100, logged: 1, focus: 1 }) })],
  ['set-wheel-kg', 'SET: wheel on kg mid-drag', () => { const F = onSet('incline', { kg: 102.5, reps: 100, logged: 1 }); return { F, ui: W(0, SCR.SET) }; }],
  ['set-wheel-reps', 'SET: wheel on reps mid-drag', () => { const F = onSet('incline', { kg: 102.5, reps: 99, logged: 1, focus: 1 }); return { F, ui: W(1, SCR.SET) }; }],
  ['set-bw', 'SET: bodyweight BW x 100', () => ({ F: onSet('pull', { kg: 0, reps: 100, logged: 1 }) })],
  ['set-bw-plus', 'SET: bodyweight +22.5 kg', () => ({ F: onSet('pull', { kg: 22.5, reps: 100, logged: 0, focus: 0 }) })],
  ['set-bw-wheel', 'SET: bodyweight wheel on kg', () => { const F = onSet('pull', { kg: 2.5, reps: 100, logged: 1, focus: 0 }); return { F, ui: W(0, SCR.SET) }; }],
  ['set-time', 'SET: timed 10:00 (GO)', () => ({ F: onSet('plank', { kg: 0, reps: 595, logged: 0 }) })],
  ['set-time-held', 'SET: timed, hold clock running', () => { const F = onSet('plank', { kg: 0, reps: 600, logged: 1 }); F.holdAt = NOW - 599; return { F }; }],
  ['set-time-wheel', 'SET: timed wheel', () => { const F = onSet('plank', { kg: 0, reps: 595, logged: 1 }); return { F, ui: W(1, SCR.SET) }; }],
  ['rest', 'REST: 3 sets, NEXT', () => { const F = onSet('incline', { kg: 102.5, reps: 100, logged: 5 }); F.scr = SCR.REST; F.restLen = 600; F.restEnd = NOW + 595; return { F }; }],
  ['rest-plan', 'REST: next exercise of a workout', () => { const F = onSet('incline', { kg: 102.5, reps: 100, logged: 10, plan: true }); F.plan.i = 3; F.scr = SCR.REST; F.restLen = 120; F.restEnd = NOW + 4; return { F }; }],
  ['sum', 'Summary page 1', () => { const F = mk(); F.scr = SCR.SUM; F.sel = 0; F.sum = { dur: 5025, sets: 188, vol: 123456, exs: 12, prs: 12, st: 'saved', hr: { avg: 188, max: 199 }, ex: [] }; return { F }; }],
  ['sum-queued', 'Summary, waiting for the phone', () => { const F = mk(); F.scr = SCR.SUM; F.sel = 0; F.sum = { dur: 5025, sets: 18, vol: 9999, exs: 4, prs: 0, st: 'queued', hr: null, ex: [] }; return { F }; }],
  ['sum-ex', 'Summary, one exercise (6 sets, PR)', () => { const F = mk(); F.scr = SCR.SUM; F.sel = 1; F.sum = { dur: 5025, sets: 6, vol: 1, exs: 1, prs: 1, st: 'saved', hr: null, ex: [{ n: 'Incline bench press', t: 'w', s: [[102.5, 100, 1], [102.5, 100, 0], [100, 12, 0], [97.5, 10, 0], [95, 8, 0], [92.5, 6, 0]] }] }; return { F }; }],
  ['saveq', 'Save as workout?', () => { const F = mk(); F.scr = SCR.SAVEQ; F.sel = 0; F.saveq = { it: [['incline', 10, 100, 102.5, 120], ['pull', 3, 12, 0, 90]], n: 'Incline bench press + Pull-ups +12', w: { id: 'w1', n: LONG_W }, rows: ['Update ' + LONG_W, 'Save as new', 'No'] }; return { F }; }],
  ['end', 'END WORKOUT?', () => { const F = onSet('incline', { kg: 102.5, reps: 100, logged: 188 }); F.scr = SCR.END; F.sel = 1; return { F }; }],
  ['end-conf', 'DISCARD?', () => { const F = onSet('incline', { kg: 102.5, reps: 100, logged: 188 }); F.scr = SCR.END; F.endConf = true; F.sel = 1; return { F }; }],
  ['menu', 'Menu with version and touch line', () => { const F = onSet('incline', { kg: 102.5, reps: 100, logged: 3, plan: true }); go(F, ['menu']); F.sel = 1; return { F, ui: { touch: 'touch 1234: drag wheel 259,259' } }; }],
  ['pair', 'Pair, wrong code', () => { const F = mk({ paired: false }); F.pair = { d: [8, 8, 8, 8, 8, 8], i: 5, st: 'fail' }; return { F }; }],
  ['ready-search', 'Run ready, GPS search, long route', () => { const F = mk({ last: 'run' }); go(F, ['start']); setRoutes(F, ROUTES); F.routeId = 'r1'; setRoute(F, routeOf()); F.gps = 0; F.hr = 188; return { F }; }],
  ['ready-weak', 'Ride ready, GPS weak', () => { const F = mk({ last: 'ride' }); go(F, ['start']); setRoutes(F, ROUTES); F.gps = 1; return { F }; }],
  ['ready-other', 'More sport ready (heart rate)', () => { const F = mk(); F.sp = 'other'; F.type = 'HighIntensityIntervalTraining'; F.scr = SCR.READY; F.hr = 188; return { F }; }],
  ['rpick', 'Route pick', () => { const F = mk({ last: 'run' }); go(F, ['start']); setRoutes(F, ROUTES); F.scr = SCR.RPICK; F.sel = 1; return { F }; }],
  ['rpick-empty', 'Route pick, no routes', () => { const F = mk({ last: 'run' }); go(F, ['start']); setRoutes(F, []); F.scr = SCR.RPICK; F.sel = 0; return { F }; }],
  ['run-p1', 'Run page 1 (4 fields)', () => ({ F: rec('run') })],
  ['run-p2', 'Run page 2', () => ({ F: rec('run', { pg: 1 }) })],
  ['ride-p1', 'Ride page 1, auto pause', () => ({ F: rec('ride', { auto: true }) })],
  ['ride-p2', 'Ride page 2', () => ({ F: rec('ride', { pg: 1 }) })],
  ['ride-3', 'Ride, 3 fields', () => { const F = rec('ride'); F.cfg = { ...F.cfg, ride: { ...F.cfg.ride, p: [['power3s', 'speed', 'hr']] } }; return { F }; }],
  ['ride-2', 'Ride, 2 fields', () => { const F = rec('ride'); F.cfg = { ...F.cfg, ride: { ...F.cfg.ride, p: [['time', 'hr']] } }; return { F }; }],
  ['ride-1', 'Ride, 1 field', () => { const F = rec('ride'); F.cfg = { ...F.cfg, ride: { ...F.cfg.ride, p: [['time']] } }; return { F }; }],
  ['other-p1', 'More sport page', () => ({ F: rec('other', { type: 'Yoga' }) })],
  ['route', 'Route page, next turn', () => { const F = rec('ride'); setRoute(F, routeOf()); F.rec.d = 23456; F.rec.pg = 2; return { F }; }],
  ['route-off', 'Route page, off route', () => { const F = rec('ride'); setRoute(F, routeOf()); F.nav = { along: 23456, off: 1234 }; F.rec.pg = 2; return { F }; }],
  ['seg-warn', 'Segment in', () => { const F = rec('ride'); F.seg = { k: 'warn', name: 'Col de la Croix de Fer climb', len: 12345, eta: 5025, pr: 5025 }; return { F }; }],
  ['seg-live', 'Segment live', () => { const F = rec('run'); F.seg = { k: 'live', name: 'Col de la Croix de Fer climb', len: 12345, done: 1000, delta: 3725, need: 1.326, ref: 'KOM' }; return { F }; }],
  ['seg-live-none', 'Segment live, nothing to beat', () => { const F = rec('run'); F.seg = { k: 'live', name: 'Riverside sprint', len: 800, done: 100, delta: 0, time: 5025, ref: '' }; return { F }; }],
  ['seg-end', 'Segment done, new PR', () => { const F = rec('ride'); F.seg = { k: 'end', name: 'Col de la Croix de Fer climb', time: 5025, delta: -1234, pr: true, ref: 'KOM' }; return { F }; }],
  ['pause', 'Paused', () => { const F = rec('run'); go(F, ['start']); F.pz.sel = 1; F.pz.hint = NOW + 2; return { F }; }],
  ['pause-hold', 'Paused, hold ring', () => { const F = rec('run'); go(F, ['start']); F.pz.hold = NOW - 1.2; return { F }; }],
  ['pause-conf', 'Discard?', () => { const F = rec('ride'); go(F, ['start']); F.pz.conf = true; return { F }; }],
  ['rsum-run', 'Run saved', () => { const F = mk(); F.scr = SCR.RSUM; F.rsum = { sp: 'run', t: 5025, d: 23960, kcal: 12345, laps: 24 }; return { F }; }],
  ['rsum-ride', 'Ride saved', () => { const F = mk(); F.scr = SCR.RSUM; F.rsum = { sp: 'ride', t: 5025, d: 123456, kcal: 4321, avgPw: 1250, laps: 25 }; return { F }; }],
  ['rsum-other', 'More sport saved', () => { const F = mk(); F.scr = SCR.RSUM; F.rsum = { sp: 'other', type: 'HighIntensityIntervalTraining', t: 5025, d: 0, kcal: 12345, laps: 188 }; return { F }; }],
  ['tscan-empty', 'Trainer: searching', () => ({ F: trainer('scan', { empty: true }) })],
  ['tscan-list', 'Trainer: list', () => { const F = trainer('scan'); F.sel = 1; return { F }; }],
  ['tscan-conn', 'Trainer: connecting', () => ({ F: trainer('conn') })],
  ['tscan-ready', 'Trainer: connected', () => ({ F: trainer('ready', { ctl: false }) })],
  ['tscan-refused', 'Trainer: refuses control', () => ({ F: trainer('refused') })],
  ['tscan-lost', 'Trainer: lost', () => ({ F: trainer('lost', { ever: true }) })],
  ['trec', 'Trainer ride: 1000 W target', () => ({ F: ride() })],
  ['trec-paused', 'Trainer ride: paused, no ERG', () => ({ F: ride({ paused: true, ctl: false }) })],
  ['trec-wheel', 'Trainer ride: wheel on the target', () => { const F = ride({ tgt: 975 }); return { F, ui: W(0, SCR.TREC) }; }],
  ['trec-stats', 'Trainer ride: stats page', () => ({ F: ride({ pg: 1 }) })],
  ['tend', 'Trainer menu', () => { const F = ride({ paused: true }); F.scr = SCR.TEND; F.sel = 1; return { F }; }],
  ['tend-conf', 'Trainer: discard ride?', () => { const F = ride(); F.scr = SCR.TEND; F.tConf = true; F.sel = 1; return { F }; }],
  ['thr', 'Trainer: heart rate found', () => { const F = trainer('ready'); F.scr = SCR.THR; return { F }; }],
  ['thr-none', 'Trainer: no heart rate yet', () => { const F = trainer('ready'); F.hr = 0; F.scr = SCR.THR; return { F }; }],
  ['trec-nohr', 'Trainer ride: lost, no heart rate', () => { const F = ride(); F.link.st = 'lost'; F.hr = 0; return { F }; }],
  ['tpick', 'Trainer: Free ride or a workout (long name)', () => { const F = trainer('ready'); F.rides = [WKDEF, { id: 'w2', n: '30 / 15, 3 x 13', s: [[30, 370, null, 1, '30/15']] }]; F.scr = SCR.TPICK; F.sel = 1; return { F }; }],
  ['tpick-free', 'Trainer: Free ride, still connecting', () => { const F = trainer('conn'); F.scr = SCR.TPICK; F.sel = 0; return { F }; }],
  ['tscan-chosen', 'Trainer: connected, a workout chosen', () => { const F = trainer('ready'); F.rides = [WKDEF]; F.tw = 1; return { F }; }],
  ['tscan-conn-chosen', 'Trainer: connecting, a workout chosen', () => { const F = trainer('conn'); F.rides = [WKDEF]; F.tw = 1; return { F }; }],
  ['trec-wk-hard', 'Workout: 13/13, SET 3, 1275 W, +25 W, next 1125 W', () => ({ F: wkRide() })],
  ['trec-wk-easy', 'Workout: recovery, -150 W, 1:23:45 left', () => { const F = wkRide({ at: 3000 + 600 + 1, ea: -150, tgt: 975 }); F.wk.tot = 5025 + 3601; return { F }; }],
  ['trec-wk-last', 'Workout: the last step', () => ({ F: wkRide({ last: true, tgt: 1000 }) })],
  ['trec-wk-paused', 'Workout: paused', () => ({ F: wkRide({ paused: true }) })],
  ['trec-wk-wheel', 'Workout: wheel on the target', () => { const F = wkRide(); return { F, ui: W(0, SCR.TREC) }; }],
  ['trec-wk-done', 'Workout done, free ERG', () => { const F = ride({ tgt: 100 }); F.wkDone = NOW + 20; return { F }; }],
  ['tsum', 'Trainer saved', () => { const F = mk(); F.scr = SCR.TSUM; F.tsum = { t: 5025, avgPw: 1250, maxPw: 1888, kj: 6281, cad: 120, hr: 188, maxHr: 199, name: 'KICKR' }; return { F }; }],
  ['pr-flash', 'New record flash', () => { const F = onSet('incline', { kg: 102.5, reps: 100 }); F.flash = { k: 'pr', until: NOW + 3, kg: 102.5, reps: 100, t: 'w' }; return { F }; }],
  ['lap-flash', 'Lap flash', () => { const F = rec('run'); F.flash = { k: 'lap', n: 188, t: 5025, d: 1000, until: NOW + 5 }; return { F }; }],
  ['glance', 'Glance', () => { const F = mk(); F.scr = SCR.GLANCE; return { F, sum: SUM }; }],
];
export { END_ROWS, saveOffer };
