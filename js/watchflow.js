// RIDEFRAME Strength on a Garmin watch: the whole state machine, no DOM, no network (17.11.). The browser preview
// (watch.html, js/watchsim.js) draws it, and garmin/source/Flow.mc is the same machine in Monkey C, one function per function.
// Time is in seconds (Monkey C numbers are 32 bit, Unix ms would not fit). Outputs the drawing layer drains:
// F.cues = vibrations ('set', 'pr', 'rest', 'done'), F.out = requests ('send', 'pair', 'setup', 'sync', 'exit').
export const SCR = { START: 'start', PICK: 'pick', SET: 'set', REST: 'rest', MENU: 'menu', SUM: 'sum', PAIR: 'pair', GLANCE: 'glance' };
export const KG_STEP = 2.5, KG_HOLD = 10, KG_MAX = 500, REPS_HOLD = 5, REPS_MAX = 100, REST_STEP = 15, PR_SECS = 3;
export const MENU = { EX: 'Change exercise', UNDO: 'Undo last set', FIN: 'Finish', SYNC: 'Sync now', PAIR: 'Pair with phone' };

export const e1rm = (kg, r) => kg > 0 && r > 0 ? (r === 1 ? kg : kg * (1 + r / 30)) : 0; // Epley, like kraftlib.js
const rid = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** a fresh app: setup = GET /api/watch/strength/setup (or the cached copy), o = { paired, queue, id } */
export function newFlow(setup, o = {}) {
  const F = { setup: setup && Array.isArray(setup.ex) ? setup : { ex: [], rest: 90 }, paired: o.paired !== false, queue: o.queue || [], newId: o.id || rid,
    scr: SCR.START, back: SCR.START, sel: 0, menu: [], cur: 0, focus: 0, kg: 0, reps: 0, sets: [], start: 0, restEnd: 0, restLen: 0,
    flash: null, sum: null, hr: 0, hrN: 0, hrSum: 0, hrMax: 0, pair: { d: [0, 0, 0, 0, 0, 0], i: 0, st: 'enter' }, cues: [], out: [] };
  if (!F.paired) F.scr = SCR.PAIR;
  return F;
}
export const curEx = F => F.setup.ex[F.cur] || { id: '', n: 'Exercise', t: 'w' };
/** the number of the set being entered (1 = first set of this exercise in this session) */
export const setNo = F => F.sets.filter(s => s.ex === curEx(F).id).length + 1;
export const restLeft = (F, now) => Math.max(0, Math.ceil(F.restEnd - now));
export const volume = sets => sets.reduce((a, s) => a + s.kg * s.reps, 0);
export const exCount = sets => sets.filter((s, i) => sets.findIndex(x => x.ex === s.ex) === i).length;
export const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

/** the values for set n of the current exercise: the last set of this session, else last session's set n (or its last), else a start value */
export function prefill(F) {
  const e = curEx(F), mine = F.sets.filter(s => s.ex === e.id), n = mine.length, s = e.s || [];
  if (n) { F.kg = mine[n - 1].kg; F.reps = mine[n - 1].reps; return; }
  const p = s[n] || s[s.length - 1];
  if (p) { F.kg = p[0]; F.reps = p[1]; } else { F.kg = e.t === 'bw' ? 0 : 20; F.reps = e.t === 'bw' ? 10 : 8; }
}
/** UP / DOWN on the focused value: d = +1 / -1, big = held */
export function stepValue(F, d, big) {
  if (F.focus === 0) F.kg = clamp(Math.round((F.kg + d * (big ? KG_HOLD : KG_STEP)) * 100) / 100, 0, KG_MAX);
  else F.reps = clamp(F.reps + d * (big ? REPS_HOLD : 1), 0, REPS_MAX);
}
function menuFor(F) {
  if (F.start) return F.sets.length ? [MENU.EX, MENU.UNDO, MENU.FIN] : [MENU.EX, MENU.FIN];
  return F.paired ? [MENU.SYNC, MENU.PAIR] : [MENU.PAIR];
}
function openMenu(F) { F.back = F.scr; F.menu = menuFor(F); F.sel = 0; F.scr = SCR.MENU; }
function choose(F, i) { F.cur = clamp(i, 0, Math.max(0, F.setup.ex.length - 1)); F.focus = curEx(F).t === 'bw' ? 1 : 0; prefill(F); F.scr = SCR.SET; }
function toPick(F) { F.sel = F.cur; F.scr = SCR.PICK; }

/** set done: stored, record check, rest starts */
export function completeSet(F, now) {
  if (!(F.reps > 0)) { F.cues.push('error'); return; }
  const e = curEx(F), v = e.t === 'bw' ? F.reps : e1rm(F.kg, F.reps), before = F.sets.filter(s => s.ex === e.id).map(s => e.t === 'bw' ? s.reps : e1rm(s.kg, s.reps));
  const set = { ex: e.id, kg: F.kg, reps: F.reps, t: Math.max(0, Math.round(now - F.start)) };
  // a record beats the stored best (only when there is one) and every earlier set of this session, so it flashes once per new high
  if (e.b > 0 && v > e.b + .01 && v > Math.max(0, ...before) + .01) { set.pr = true; F.flash = { k: 'pr', until: now + PR_SECS, kg: F.kg, reps: F.reps, t: e.t }; F.cues.push('pr'); }
  else F.cues.push('set');
  F.sets.push(set);
  F.restLen = F.setup.rest || 90; F.restEnd = now + F.restLen; F.scr = SCR.REST;
}
function endRest(F, cue) { F.restEnd = 0; prefill(F); F.scr = SCR.SET; if (cue) F.cues.push('rest'); }
export function undo(F) {
  const s = F.sets.pop(); if (!s) return;
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
  F.sets = []; F.start = 0; F.restEnd = 0; F.hrN = F.hrSum = F.hrMax = 0;
  F.scr = SCR.SUM; F.cues.push('done'); F.out.push({ k: 'send' });
}
function reset(F) { F.sets = []; F.start = 0; F.restEnd = 0; F.flash = null; F.sum = null; F.scr = SCR.START; }
/** answer of one send: res = 'ok' (stored, also for a duplicate), 'drop' (the server refused it for good) or 'retry' (no phone / no server) */
export function sent(F, id, res) {
  if (res !== 'retry') F.queue = F.queue.filter(s => s.id !== id);
  if (F.sum && F.sum.id === id) F.sum.st = res === 'ok' ? 'saved' : res === 'drop' ? 'failed' : 'queued';
}
export function paired(F, ok, setup) {
  if (!ok) { F.pair.st = 'fail'; return; }
  F.paired = true; F.pair = { d: [0, 0, 0, 0, 0, 0], i: 0, st: 'enter' }; if (setup) F.setup = setup;
  F.scr = SCR.START; F.cues.push('done'); F.out.push({ k: 'setup' }, { k: 'send' });
}
export function setSetup(F, setup) { if (setup && Array.isArray(setup.ex)) { const id = curEx(F).id; F.setup = setup; const i = setup.ex.findIndex(e => e.id === id); F.cur = i < 0 ? 0 : i; } }

/** every input: ev = up, down, upHold, downHold, start, back, menu, swipeUp, swipeDown, swipeLeft, swipeRight, tap, item (arg = index), focus (arg = 0 kg / 1 reps / digit), hr (arg = bpm), tick */
export function handle(F, ev, now, arg) {
  if (ev === 'hr') { F.hr = arg || 0; if (F.start && arg > 0) { F.hrN++; F.hrSum += arg; F.hrMax = Math.max(F.hrMax, arg); } return; }
  if (ev === 'tick') {
    if (F.flash && now >= F.flash.until) F.flash = null;
    if (F.scr === SCR.REST && now >= F.restEnd) endRest(F, true);
    return;
  }
  if (F.flash) { F.flash = null; if (ev !== 'menu') return; } // the first touch after a record only clears the flash
  if (ev === 'swipeLeft') ev = 'menu';
  if (ev === 'swipeRight') ev = 'back';
  const list = F.scr === SCR.PICK || F.scr === SCR.MENU;
  if (ev === 'swipeUp') ev = list ? 'down' : 'up';     // a list scrolls with the finger, a number counts up
  if (ev === 'swipeDown') ev = list ? 'up' : 'down';
  const s = F.scr;
  if (ev === 'menu') { if (s === SCR.START || s === SCR.PICK || s === SCR.SET || s === SCR.REST) openMenu(F); return; }
  if (s === SCR.GLANCE) { if (ev === 'start' || ev === 'tap') F.scr = F.paired ? SCR.START : SCR.PAIR; return; }
  if (s === SCR.START) {
    if (ev === 'start' || ev === 'tap') { if (!F.setup.ex.length) { F.out.push({ k: 'setup' }); return; } F.start = now; F.sets = []; F.sum = null; toPick(F); }
    else if (ev === 'back') F.out.push({ k: 'exit' });
    return;
  }
  if (s === SCR.PICK || s === SCR.MENU) {
    const n = s === SCR.PICK ? F.setup.ex.length : F.menu.length; if (!n) { if (ev === 'back') F.scr = s === SCR.MENU ? F.back : SCR.START; return; }
    if (ev === 'up') F.sel = (F.sel + n - 1) % n;
    else if (ev === 'down') F.sel = (F.sel + 1) % n;
    else if (ev === 'start' || ev === 'item') { const i = ev === 'item' ? arg : F.sel; if (s === SCR.PICK) choose(F, i); else act(F, F.menu[i], now); }
    else if (ev === 'back') { if (s === SCR.MENU) F.scr = F.back; else if (F.sets.length) { prefill(F); F.scr = SCR.SET; } else reset(F); }
    return;
  }
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
    else if (ev === 'back') { if (P.i > 0) P.i--; else if (F.paired) F.scr = SCR.START; else F.out.push({ k: 'exit' }); }
  }
}
function act(F, item, now) {
  if (item === MENU.EX) toPick(F);
  else if (item === MENU.UNDO) undo(F);
  else if (item === MENU.FIN) finish(F, now);
  else if (item === MENU.SYNC) { F.out.push({ k: 'setup' }, { k: 'send' }); F.scr = F.back; }
  else if (item === MENU.PAIR) { F.pair = { d: [0, 0, 0, 0, 0, 0], i: 0, st: 'enter' }; F.scr = SCR.PAIR; }
}
