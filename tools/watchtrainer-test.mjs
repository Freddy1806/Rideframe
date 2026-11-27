// The watch's indoor trainer (23.11.): js/watchtrainer.js (the link and the ride, = garmin/source/Trainer.mc) driven through js/watchflow.js
// against the pretend KICKR of js/watchkickr.js: scan -> connect -> subscribe -> request control -> start -> target; + / - steps and limits;
// latest wins (a burst = at most one write in flight, the newest value next); refused control (another app) -> state + retry; lost -> reconnect
// -> target sent again; pause / resume; finish -> summary and the upload body with the series.
// Usage: node --test tools/watchtrainer-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { newFlow, handle, SCR, homeItems, listItems, TEND_ROWS } from '../js/watchflow.js';
import { newLink, bleEv, linkTick, setTarget, shown, live, ibd, cpm, newRide, rideSec, rideSum, rideBody, nextTarget, nextStep, W_PAUSE, W_MIN, W_MAX, SER_MAX, CTL_S, REPAIR_S, CONN_S, OP_S } from '../js/watchtrainer.js';
import { fakeKickr } from '../js/watchkickr.js';

let n = 0;
const fl = (o = {}) => newFlow(null, { id: () => 'tr' + (++n), ...o });
/** the radio: every action of the link goes to the pretend trainer, its answers come back as 'ble' events, until nothing is left */
const radio = (F, K, now) => { for (let i = 0; i < 100 && F.link.act.length; i++) for (const a of F.link.act.splice(0)) for (const e of K.handle(a)) handle(F, 'ble', now, e); };
const ev = (F, K, now, ...evs) => { for (const e of evs) { if (Array.isArray(e)) handle(F, e[0], now, e[1]); else handle(F, e, now); radio(F, K, now); } };
const tgtWrites = K => K.writes.filter(w => w[0] === 'fcp' && w[1] === 0x05).map(w => w[2] + (w[3] << 8));
/** HOME -> Indoor trainer -> the list -> START: connected; then START, START (27.11.: the choice, Free ride on top): riding at the start target */
function ride(o = {}, K = fakeKickr(o.k)) {
  const F = fl(o.f); ev(F, K, 1000, ['item', homeItems(F).indexOf('trainer')]);
  if (shown(F.link) === 'scan') ev(F, K, 1000, 'start');
  handle(F, 'tick', 1000 + OP_S + .5); radio(F, K, 1000 + OP_S + .5);
  if (o.ride !== false) ev(F, K, 1005, 'start', 'start', 'start'); // the choice, Free ride, the heart rate step skipped
  return [F, K];
}

test('scan list -> connect -> subscribe, request control, start -> the target goes out', () => {
  const K = fakeKickr({ others: [{ name: 'Assioma DUO', cps: true, rssi: -40 }, { name: '', cps: true, rssi: -30 }, { name: 'HRM-Pro', rssi: -50 }] });
  const F = fl(); assert.ok(homeItems(F).includes('trainer'));
  ev(F, K, 1000, ['item', homeItems(F).indexOf('trainer')]); assert.equal(F.scr, SCR.TSCAN); assert.equal(shown(F.link), 'scan'); assert.ok(K.scanning);
  assert.deepEqual(listItems(F), ['KICKR CORE 2 5A1F', 'Assioma DUO'], 'FTMS first, Cycling Power with a name next; nameless and non-trainers left out');
  ev(F, K, 1001, 'down', 'up', 'start'); assert.ok(!K.scanning, 'the scan stops for the connect');
  assert.deepEqual(K.sub, { ibd: 1, fcp: 2 }, 'Indoor Bike Data notified, the control point indicated');
  assert.deepEqual(K.writes, [['fcp', 0x00], ['fcp', 0x07]], 'request control, then start, one at a time');
  assert.equal(shown(F.link), 'ready', 'the 0x80 0x00 0x01 answer = control'); assert.ok(F.out.some(o => o.k === 'trainer'), 'the trainer is remembered');
  assert.equal(F.link.want, 'KICKR CORE 2 5A1F');
  ev(F, K, 1003, 'start'); assert.equal(F.scr, SCR.TPICK, '27.11.: START: Free ride or a workout'); assert.equal(listItems(F)[0], 'Free ride (ERG)'); assert.equal(F.sel, 0);
  ev(F, K, 1003, 'start'); assert.equal(F.scr, SCR.THR, '27.11.2: the heart rate step'); ev(F, K, 1003, 'start'); assert.equal(F.scr, SCR.TREC); assert.equal(F.wk, null, 'a free ride'); assert.equal(F.tr.tgt, 100, 'default 100 W'); assert.deepEqual(tgtWrites(K), [100]); assert.equal(K.tgt, 100);
  assert.equal(F.last, 'trainer');
});
test('the trainer used last connects by itself; a cancel goes back to the list without connecting again', () => {
  const K = fakeKickr(), F = fl({ trainer: 'KICKR CORE 2 5A1F', tgt: 185 });
  ev(F, K, 1000, ['item', homeItems(F).indexOf('trainer')]); assert.equal(shown(F.link), 'ready', 'seen in the scan: connected at once');
  ev(F, K, 1001, 'back'); assert.equal(shown(F.link), 'scan'); assert.ok(!K.paired, 'let go'); assert.equal(F.link.want, '');
  assert.deepEqual(listItems(F), ['KICKR CORE 2 5A1F'], 'listed, not connected'); ev(F, K, 1002, 'start', 'start', 'start', 'start'); assert.equal(F.tr.tgt, 185, 'the last target');
  const G = fl(); ev(G, K, 1000, ['item', homeItems(G).indexOf('trainer'), 'back']); ev(G, K, 1000, 'back'); assert.equal(G.scr, SCR.HOME, 'BACK on the list: home, scan off'); assert.ok(!K.scanning);
});
test('+ / - steps, step size 5 / 10 / 25 on a tap, held = 25 W, limits 30..1000', () => {
  const [F, K] = ride(); const R = F.tr;
  ev(F, K, 1010, 'up'); assert.equal(R.tgt, 105); ev(F, K, 1010, ['item', 0]); assert.equal(R.tgt, 100, 'the - zone');
  ev(F, K, 1010, ['item', 1]); assert.equal(R.tgt, 105, 'the + zone'); ev(F, K, 1010, ['item', 2]); assert.equal(R.step, 10, 'a tap on the target: 10 W steps');
  ev(F, K, 1010, 'up'); assert.equal(R.tgt, 110, 'onto the 10 grid'); ev(F, K, 1010, ['item', 2]); ev(F, K, 1010, 'down'); assert.equal(R.tgt, 100); assert.equal(R.step, 25);
  ev(F, K, 1010, ['item', 2]); assert.equal(R.step, 5); ev(F, K, 1010, 'upHold'); assert.equal(R.tgt, 125, 'held: 25 W'); ev(F, K, 1010, 'downHold', 'downHold'); assert.equal(R.tgt, 75);
  for (let i = 0; i < 20; i++) ev(F, K, 1010, 'down'); assert.equal(R.tgt, W_MIN); assert.equal(K.tgt, 30);
  for (let i = 0; i < 50; i++) ev(F, K, 1010, 'upHold'); assert.equal(R.tgt, W_MAX); assert.equal(K.tgt, 1000);
  assert.equal(nextTarget({ tgt: 103, step: 5 }, 1, false), 105); assert.equal(nextTarget({ tgt: 1000, step: 25 }, 1, true), 1000); assert.equal(nextStep(25), 5);
  assert.equal(F.tTgt, 1000, 'kept as the next start target'); assert.equal(F.scr, SCR.TREC);
});
test('latest wins: a burst of presses = one write in flight, then only the newest value', () => {
  const [F, K] = ride(); K.hold = true; const before = tgtWrites(K).length;
  for (let i = 0; i < 12; i++) { ev(F, K, 1010, 'up'); assert.ok(F.link.op && F.link.op.k === 'tgt'); }
  assert.equal(tgtWrites(K).length - before, 1, 'one write while the trainer has not answered'); assert.equal(tgtWrites(K).at(-1), 105);
  for (const e of K.release()) handle(F, 'ble', 1011, e); radio(F, K, 1011);
  assert.deepEqual(tgtWrites(K).slice(before), [105, 160], 'then the newest, nothing in between'); assert.equal(K.tgt, 160); assert.equal(F.link.sent, 160);
  // a write that never gets an answer: free again after the timeout, the newest goes out
  K.hold = true; ev(F, K, 1020, 'up'); K.pend = []; K.hold = false; ev(F, K, 1020, 'up', 'up'); assert.equal(tgtWrites(K).at(-1), 165);
  handle(F, 'tick', 1020 + OP_S + 1); assert.equal(shown(F.link), 'refused', 'no answer to a target = not taken'); assert.equal(F.link.sent, -1);
  handle(F, 'tick', 1020 + OP_S + 1 + CTL_S); radio(F, K, 1030); handle(F, 'tick', 1031); radio(F, K, 1031);
  assert.equal(shown(F.link), 'ready'); assert.equal(K.tgt, 175, 'control again, then the newest target');
});
test('refused control (another app controls it): the state, ride anyway, retried every 5 s, then the target', () => {
  const [F, K] = ride({ k: { refuse: true }, ride: false });
  assert.equal(shown(F.link), 'refused'); assert.equal(F.scr, SCR.TSCAN); assert.deepEqual(K.writes, [['fcp', 0], ['fcp', 7]], 'no target');
  const w0 = K.writes.length; handle(F, 'tick', 1004); radio(F, K, 1004); assert.equal(K.writes.length, w0, 'not before 5 s');
  handle(F, 'tick', 1005.5); radio(F, K, 1005.5); assert.deepEqual(K.writes.slice(w0), [['fcp', 0], ['fcp', 7]], 'asks for control again'); assert.equal(shown(F.link), 'refused');
  ev(F, K, 1006, 'start', 'start', 'start'); assert.equal(F.scr, SCR.TREC, 'riding anyway (the power is still recorded)'); assert.deepEqual(tgtWrites(K), [], 'no target without control');
  K.refuse = false; handle(F, 'tick', 1018); radio(F, K, 1018); assert.equal(shown(F.link), 'ready'); assert.equal(K.tgt, 100, 'the target once control is back');
  // refused mid-ride: the answer to a target is 0x05
  K.refuse = true; ev(F, K, 1020, 'up'); assert.equal(shown(F.link), 'refused'); K.refuse = false; handle(F, 'tick', 1020 + CTL_S); radio(F, K, 1026); handle(F, 'tick', 1027); radio(F, K, 1027);
  assert.equal(K.tgt, 105);
});
test('lost mid-ride: "lost, reconnecting", the system reconnects or the watch pairs again, the target is sent again', () => {
  const [F, K] = ride(); ev(F, K, 1010, 'up', 'up'); assert.equal(K.tgt, 110);
  K.tgt = 0; handle(F, 'ble', 1011, { k: 'drop' }); assert.equal(shown(F.link), 'lost'); assert.equal(F.scr, SCR.TREC, 'the ride goes on');
  ev(F, K, 1012, 'up'); assert.equal(F.tr.tgt, 115, 'the target can still change');
  handle(F, 'ble', 1013, { k: 'conn', ftms: true }); radio(F, K, 1013); handle(F, 'tick', 1013 + OP_S + .5); radio(F, K, 1017);
  assert.equal(shown(F.link), 'ready'); assert.equal(K.tgt, 115, 'sent again after the reconnect');
  // gone for longer: every 15 s the pairing is dropped and the trainer searched again, for as long as the ride lasts
  K.on = false; K.tgt = 0; handle(F, 'ble', 1020, { k: 'drop' }); for (let t = 1021; t < 1100; t++) { handle(F, 'tick', t); radio(F, K, t); }
  assert.equal(shown(F.link), 'lost'); assert.ok(K.scanning, 'still searching after more than a minute');
  K.on = true; handle(F, 'tick', 1100 + REPAIR_S); radio(F, K, 1115); handle(F, 'tick', 1115 + OP_S + .5); radio(F, K, 1119);
  assert.equal(shown(F.link), 'ready'); assert.equal(K.tgt, 115);
  assert.ok(CONN_S < REPAIR_S);
});
test('pause: the clock stops, the trainer goes to 30 W; changes wait; resume sends the target', () => {
  const [F, K] = ride(); for (let t = 1006; t <= 1015; t++) handle(F, 'tick', t); assert.equal(F.tr.t, 10);
  ev(F, K, 1015.5, 'start'); assert.equal(F.tr.st, 'pause'); assert.equal(K.tgt, W_PAUSE); assert.deepEqual(F.cues.slice(-1), ['stop']);
  ev(F, K, 1016, 'up', 'up'); assert.equal(F.tr.tgt, 110); assert.equal(K.tgt, W_PAUSE, 'not sent while paused');
  for (let t = 1016; t <= 1030; t++) handle(F, 'tick', t); assert.equal(F.tr.t, 10, 'no seconds while paused');
  ev(F, K, 1030.5, 'start'); assert.equal(F.tr.st, 'run'); assert.equal(K.tgt, 110); for (let t = 1031; t <= 1035; t++) handle(F, 'tick', t); assert.equal(F.tr.t, 15);
});
test('menu: Resume / Stats page / Finish & save / Discard (asks once more); BACK resumes; swipe = stats page', () => {
  const [F, K] = ride(); ev(F, K, 1010, 'swipeUp'); assert.equal(F.tr.pg, 1); ev(F, K, 1010, 'tap'); assert.equal(F.tr.pg, 0);
  ev(F, K, 1010, 'back'); assert.equal(F.scr, SCR.TEND); assert.deepEqual(listItems(F), TEND_ROWS); assert.equal(F.tr.st, 'run', 'the menu does not pause');
  ev(F, K, 1010, 'back'); assert.equal(F.scr, SCR.TREC); ev(F, K, 1010, 'menu', ['item', 1]); assert.equal(F.tr.pg, 1); assert.equal(F.scr, SCR.TREC);
  ev(F, K, 1010, 'back'); assert.equal(listItems(F)[1], 'ERG page'); ev(F, K, 1010, ['item', 3]); assert.deepEqual(listItems(F), ['Keep riding', 'Discard ride']);
  ev(F, K, 1010, 'back'); assert.equal(F.sel, 3); ev(F, K, 1010, 'start', 'down', 'start'); assert.equal(F.scr, SCR.HOME, 'discarded'); assert.equal(F.tr, null);
  assert.ok(!F.out.some(o => o.k === 'saveAct')); assert.ok(!K.paired, 'the trainer is let go');
  const [G, K2] = ride(); ev(G, K2, 1010, 'start', 'back', ['item', 0]); assert.equal(G.tr.st, 'run', 'Resume also ends a pause'); assert.equal(K2.tgt, 100);
});
test('finish: summary (time, avg / max power, NP, cadence, heart rate, kJ) and the upload body with the series', () => {
  const [F, K] = ride();
  for (let i = 1; i <= 120; i++) { const t = 1005 + i; handle(F, 'ble', t - .5, K.data(i <= 60 ? 200 : 250, 90)); handle(F, 'hr', t - .4, i <= 60 ? 130 : 150); handle(F, 'tick', t); }
  assert.equal(F.tr.t, 120); ev(F, K, 1126, 'back', ['item', 2]);
  assert.equal(F.scr, SCR.TSUM); const s = F.tsum;
  assert.deepEqual([s.t, s.avgPw, s.maxPw, s.cad, s.hr, s.maxHr, s.kj], [120, 225, 250, 90, 140, 150, 27]);
  assert.ok(s.np >= 225 && s.np <= 250, `NP ${s.np}`); assert.equal(s.name, 'KICKR CORE 2 5A1F');
  const o = F.out.find(x => x.k === 'saveAct'); assert.equal(o.sum.sp, 'trainer'); assert.ok(!K.paired, 'let go after the ride');
  const b = F.tbody; assert.equal(b.type, 'VirtualRide'); assert.deepEqual([b.moving, b.power, b.maxPower, b.kj, b.cad, b.dist, b.hr, b.maxHr], [120, 225, 250, 27, 90, 0, 140, 150]);
  assert.equal(b.s.dt, 10); assert.equal(b.s.pw.length, 12); assert.deepEqual(b.s.pw.slice(5, 7), [200, 250]); assert.deepEqual(new Set(b.s.tgt), new Set([100])); assert.deepEqual(b.s.cad[0], 90);
  assert.ok(JSON.stringify(b).length < 1000);
  ev(F, K, 1130, 'start'); assert.equal(F.scr, SCR.HOME); assert.equal(homeItems(F)[0], 'trainer');
  const [G, K2] = ride(); ev(G, K2, 1005, 'back', ['item', 2]); assert.equal(G.scr, SCR.HOME, 'nothing ridden: nothing saved'); assert.ok(!G.out.some(o => o.k === 'saveAct'));
});
test('a long ride: the series stays at most 240 values (two become one, dt doubles), the body under 8 KB', () => {
  const R = newRide(0, 200); for (let i = 0; i < 4 * 3600; i++) rideSec(R, 150 + (i % 100), 85 + (i % 7), 140 + (i % 20));
  assert.ok(R.s.pw.length <= SER_MAX); assert.equal(R.dt, 80); assert.equal(R.s.pw.length, R.s.hr.length);
  const b = rideBody(R, rideSum(R), 'abcdef12', 4 * 3600 + 30); assert.ok(JSON.stringify(b).length < 8000, `${JSON.stringify(b).length} bytes`);
  assert.equal(rideSum(R).avgPw, 200); assert.equal(rideSum(R).maxPw, 249);
});
test('the trainer data: FTMS Indoor Bike Data and Cycling Power with crank revolutions', () => {
  const L = newLink(); ibd(L, [0x44, 0, 0x10, 0x0e, 180, 0, 0xfa, 0], 5); assert.deepEqual([L.pw, L.cad], [250, 90]);
  ibd(L, [0x45, 0, 0x30, 0, 0x2c, 0x01], 6); assert.deepEqual([L.pw, L.cad], [300, 24], 'no speed field (bit 0), cadence 0.5 rpm');
  assert.deepEqual(live(L, 6 + 4), { pw: 0, cad: 0 }, 'silent for more than 3 s: 0');
  const W = newLink(); cpm(W, [0x20, 0, 200, 0, 10, 0, 0, 0], 1); cpm(W, [0x20, 0, 210, 0, 11, 0, 0, 3], 1.7); assert.deepEqual([W.pw, W.cad], [210, 80]);
});
test('Wahoo fallback (no FTMS): unlock, then ERG 0x42; power-only devices are read, never controlled', () => {
  const K = fakeKickr({ name: 'KICKR 1A2B', ftms: false, wahoo: true }); const [F] = ride({}, K);
  assert.deepEqual(K.sub, { cpm: 1, wcp: 2 }); assert.deepEqual(K.writes.slice(0, 2), [['wcp', 0x20, 0xee, 0xfc], ['wcp', 0x42, 100, 0]]); assert.equal(K.tgt, 100);
  handle(F, 'ble', 1010, K.data(180, 0)); assert.equal(F.link.pw, 180);
  const P = fakeKickr({ name: 'Assioma DUO', ftms: false }); const [G] = ride({}, P); assert.equal(shown(G.link), 'ready'); assert.equal(G.link.ctl, false); assert.equal(P.writes.length, 0, 'never written to');
});
test('the link alone: one GATT operation at a time, a failed subscription does not stop the setup', () => {
  const L = newLink(); L.st = 'conn'; bleEv(L, 0, { k: 'conn', ftms: true }); assert.equal(L.act.length, 1); assert.equal(L.act[0].k, 'cccd');
  bleEv(L, 0, { k: 'done', ok: false }); assert.equal(L.act.length, 2, 'next step after a failed CCCD write'); bleEv(L, 0, { k: 'done', ok: true });
  bleEv(L, 0, { k: 'done', ok: true }); bleEv(L, 0, { k: 'done', ok: true }); assert.equal(L.st, 'setup', 'waits for the control answer');
  linkTick(L, OP_S + 1); assert.equal(L.st, 'ready', 'no indication within 3 s: the writes went through, taken as control (VERIFY on the KICKR)');
  setTarget(L, 150, 5); setTarget(L, 160, 5); assert.equal(L.act.filter(a => a.k === 'write' && a.v[0] === 5).length, 1);
});

test('23.11.7 wheel on the ERG target: one step of the current size per finger step, latest wins, limits, not on the stats page', () => {
  const [F, K] = ride(); assert.equal(F.tr.tgt, 100); F.cues = [];
  ev(F, K, 1006, ['wheel', [0, 1]]); assert.equal(F.tr.tgt, 105); ev(F, K, 1006, ['wheel', [0, 2]]); assert.equal(F.tr.tgt, 115); assert.equal(K.tgt, 115, 'sent');
  assert.deepEqual(F.cues, ['tick', 'tick']); ev(F, K, 1006, ['item', 2]); assert.equal(F.tr.step, 10); ev(F, K, 1006, ['wheel', [0, -1]]); assert.equal(F.tr.tgt, 110, 'onto the 10 grid');
  K.hold = true; const w0 = tgtWrites(K).length; ev(F, K, 1007, ['wheel', [0, 1]], ['wheel', [0, 1]], ['wheel', [0, 1]]); assert.equal(F.tr.tgt, 140);
  for (const e of K.release()) handle(F, 'ble', 1007, e); radio(F, K, 1007); assert.equal(K.tgt, 140, 'the newest target reached the trainer'); assert.ok(tgtWrites(K).length <= w0 + 2, 'latest wins: no write per step');
  ev(F, K, 1008, ['wheel', [0, -500]]); assert.equal(F.tr.tgt, W_MIN); ev(F, K, 1008, ['wheel', [0, 500]]); assert.equal(F.tr.tgt, W_MAX);
  F.tr.pg = 1; ev(F, K, 1009, ['wheel', [0, -3]]); assert.equal(F.tr.tgt, W_MAX, 'the stats page: no wheel'); assert.equal(F.scr, SCR.TREC);
});

/* ---- 27.11.: workouts on the watch (js/watchtrainer.js newWk ... = Trainer.mc TWork; js/watchflow.js tPick ... = Flow.mc) ---- */
import { readFileSync } from 'node:fs';
import { newWk, wkAt, wkTarget, wkTune, wkFallback, wkFromRide, wkCompact, wkDur, wkEasy, wkShown, WK_FB_HARD, WK_FB_ID, WK_STEPS } from '../js/watchtrainer.js';
import * as WT from '../js/watchtrainer.js';
import { rides, setRides, FREE_RIDE, WK_DONE_S, VERSION, hrOn } from '../js/watchflow.js';
import { WORKOUTS, workoutDuration, workoutState, setFtp, isHard } from '../js/workouts.js';
const WO = WORKOUTS.find(w => w.id === WK_FB_ID);
/** the watch's target at every second of a workout (step by step like the flow does) */
function wkTrack(W, from = 0, to = W.tot) { const out = []; for (let t = from; t < to; t++) { wkAt(W, t); out.push(wkTarget(W, t)); } return out; }

test('the built-in 30 / 15: 39 hard 30 s in 3 sets of 13 (+ 3 sprints), every step as long as js/workouts.js c_30_15_3x13, the same watts', () => {
  const W = newWk(wkFallback(250));
  assert.equal(W.tot, workoutDuration(WO), 'the same length'); assert.equal(W.dur.length, WO.steps.length, 'the same steps');
  assert.deepEqual(W.dur, WO.steps.map(s => s.dur), 'every step as long');
  const h30 = W.hard.map((h, i) => h && W.dur[i] === 30).filter(Boolean).length; assert.equal(h30, 39, '39 hard intervals of 30 s'); assert.equal(W.hard.filter(Boolean).length, 42, '+ 3 sprints');
  setFtp(250); const woHard = [...new Set(WO.steps.filter(s => s.dur === 30 && isHard(s)).map(s => s.watts))];
  assert.equal(woHard.length, 1, 'js/workouts.js: one hard wattage'); assert.ok(woHard[0] >= 340 && woHard[0] <= WK_FB_HARD, `js/workouts.js hard ${woHard[0]} W, the watch's built-in ${WK_FB_HARD} W (the owner's +10..30 W)`);
  WO.steps.forEach((s, i) => { if (s.dur === 30 && isHard(s)) assert.equal(W.w[i], WK_FB_HARD); else if (s.watts) assert.equal(W.w[i], s.watts, `step ${i} ${s.label}`);
    else { assert.equal(W.w[i], Math.round(s.pct / 100 * 250), `step ${i} ${s.label}`); assert.equal(W.w2[i], s.pct2 != null ? Math.round(s.pct2 / 100 * 250) : -1); }
    assert.equal(W.hard[i], isHard(s), `step ${i} hard`); });
  assert.deepEqual([W.cnt[8], W.cnt[W.dur.length - 2]], ['1/13, SET 1', '13/13, SET 3'], 'the counter of the first and the last 30 s');
  W.i = 8; assert.equal(wkShown(W), '1/13, SET 1'); W.i = 9; assert.equal(wkShown(W), 'FLOAT'); W.i = 0; assert.equal(wkShown(W), 'WARM-UP');
  assert.equal(wkDur(wkFallback(250).s), W.tot, 'wkDur without expanding');
  assert.equal(newWk(wkFallback(300)).w[0], 120, 'the ramps follow the FTP sent last (40 % of 300)');
});
test('server form: every built-in workout of js/workouts.js comes out second by second as workoutState (ERG ramps) gives it, with and without offsets', () => {
  for (const ftp of [287]) for (const w of WORKOUTS) {
    setFtp(ftp); const c = wkFromRide(w, ftp, isHard);
    if (w.steps.some(s => s.free)) { assert.equal(c, null, `${w.id}: a free (non-ERG) step: not for the watch`); continue; }
    assert.ok(c && JSON.stringify(c).length < 800, `${w.id}: ${JSON.stringify(c).length} bytes`);
    for (const [ha, ea] of [[0, 0], [15, -10]]) {
      const W = newWk(c); W.ha = ha; W.ea = ea; assert.equal(W.tot, workoutDuration(w), w.id);
      // every 7th second and every second within 12 s of a step's start (ramps in / out, the jumps); workoutState is slow
      const got = wkTrack(W), near = new Set(); let s0 = 0; for (const st of w.steps) { for (let d = -12; d <= 12; d++) near.add(s0 + d); s0 += st.dur; }
      const bad = []; for (let t = 0; t < W.tot; t++) { if (t % 7 && !near.has(t)) continue; const y = workoutState(w, t, ftp, { ramp: true, hardAdj: ha, easyAdj: ea }).target; if (Math.abs(got[t] - y) > 1) bad.push([t, got[t], y]); }
      assert.deepEqual(bad.slice(0, 3), [], `${w.id} at FTP ${ftp}, offsets ${ha} / ${ea}: watch vs js/workouts.js`);
    }
  }
});
test('server form: repeats fold (the 30 / 15 in a few hundred bytes), labels lose their counters, ASCII only', () => {
  setFtp(250); const c = wkFromRide(WO, 250, isHard), j = JSON.stringify(c);
  assert.ok(j.length < 480, `${j.length} bytes`); assert.equal(c.n, '30 / 15, 3 x 13'); assert.ok(/^[\x20-\x7e]*$/.test(j));
  const set = c.s.find(e => Array.isArray(e[1]) && e[0] === 3 && Array.isArray(e[1][0][1])); assert.ok(set, 'three sets of [13 x (30 / 15), rest]');
  assert.deepEqual(set[1][0][1][0].slice(0, 4), [30, WO.steps.find(s => s.dur === 30 && isHard(s)).watts, null, 1]); assert.equal(set[1][0][1][0][4], '30 / 15');
  assert.deepEqual(wkCompact([{ sec: 60, w: 100, hard: false, label: 'A' }, { sec: 60, w: 100, hard: false, label: 'A' }]), [[120, 100, null, 0, 'A']], 'the same step twice: one');
  assert.equal(newWk({ id: 'x', n: 'x', s: [[100000, [[1, 100, null, 0, 'a']], 0]] }).dur.length, 100, 'at most 100 rounds');
  assert.equal(newWk({ id: 'x', n: 'x', s: [[100, [[100, [[1, 100, null, 0, 'a']], 0]], 0]] }).dur.length, WK_STEPS, `at most ${WK_STEPS} steps`);
  assert.equal(newWk({ id: 'x', n: 'x', s: [['a', 1], [0, 100, null, 0, 'a']] }), null, 'nothing usable: null');
});
/** a ride with a workout: connected, START (the choice), the workout's row, START */
function wkRide(row = 1, o = {}) { const [F, K] = ride({ ...o, ride: false }); if (o.rides) setRides(F, o.rides, o.ftp); ev(F, K, 1005, 'start'); assert.equal(F.scr, SCR.TPICK); for (let i = 0; i < row; i++) ev(F, K, 1005, 'down'); ev(F, K, 1005, 'start', 'start'); return [F, K]; }
/** n seconds of riding, one tick per second; the cues */
function secs(F, K, n) { const cues = []; for (let i = 0; i < n; i++) { const t = F.tr.ts + 1; handle(F, 'tick', t); radio(F, K, t); cues.push(...F.cues.splice(0)); } return cues; }
test('choice: Free ride (ERG) or a workout, also while connecting (then START rides it once connected); BACK keeps the link', () => {
  const [F, K] = ride({ ride: false }); ev(F, K, 1005, 'start'); assert.deepEqual(listItems(F), [FREE_RIDE, '30/15, 3 x 13'], 'no sync yet: the built-in 30 / 15');
  ev(F, K, 1005, 'back'); assert.equal(F.scr, SCR.TSCAN); assert.equal(shown(F.link), 'ready', 'still connected');
  ev(F, K, 1005, 'down'); assert.equal(F.scr, SCR.TPICK, 'UP / DOWN open it too'); ev(F, K, 1005, ['item', 1], 'start'); assert.equal(F.scr, SCR.TREC); assert.equal(F.wk.n, '30/15, 3 x 13');
  // while connecting: the choice waits, START rides it once connected
  const G = fl(), K2 = fakeKickr(); ev(G, K2, 1000, ['item', homeItems(G).indexOf('trainer')]); K2.hold = true; ev(G, K2, 1000, 'start'); assert.equal(shown(G.link), 'conn');
  ev(G, K2, 1000, 'start'); assert.equal(G.scr, SCR.TPICK); ev(G, K2, 1000, 'down', 'start'); assert.equal(G.scr, SCR.TSCAN, 'not connected yet: back to the state'); assert.equal(G.tw, 1);
  for (const e of K2.release()) handle(G, 'ble', 1001, e); K2.hold = false; radio(G, K2, 1001); handle(G, 'tick', 1001 + OP_S + .5); radio(G, K2, 1005); assert.equal(shown(G.link), 'ready');
  ev(G, K2, 1005, 'start', 'start'); assert.equal(G.scr, SCR.TREC); assert.ok(G.wk, 'the workout chosen while connecting'); assert.equal(G.tw, -1);
  // the server's list replaces the built-in one when it has the 30 / 15
  setFtp(260); const srv = [wkFromRide(WORKOUTS[0], 260, isHard), wkFromRide(WO, 260, isHard)]; const H = fl(); setRides(H, srv, 260);
  assert.deepEqual(rides(H).map(w => w.id), ['ss3x10', WK_FB_ID]); setRides(H, [srv[0]], 260); assert.deepEqual(rides(H).map(w => w.id), [WK_FB_ID, 'ss3x10'], 'without it: the built-in first');
  setRides(H, null, 0); assert.equal(rides(H).length, 2, 'an answer without a list keeps them'); assert.equal(H.ftp, 260);
});
test('riding the 30 / 15: steps by the clock, ramps once a second, short efforts jump, 3-2-1 before each hard one and one at its end, the end', () => {
  const [F, K] = wkRide(); const W = F.wk; assert.equal(F.tr.tgt, 100, 'the warm-up ramp starts at 40 % of 250'); assert.equal(K.tgt, 100);
  const w0 = tgtWrites(K).length; let c = secs(F, K, 600); const ramp = tgtWrites(K).slice(w0);
  assert.ok(ramp.length <= 600 && ramp.length >= 70, `the ramp 100 -> 180 W: ${ramp.length} writes in 600 s`); assert.ok(ramp.every((x, i) => !i || x > ramp[i - 1]), 'rising only');
  c.push(...secs(F, K, 180 + 60 + 60 + 10 + 170 - 3)); assert.equal(F.tr.t, 1077); assert.equal(K.tgt, 130, 'spin before the first 30 s');
  c.push(...secs(F, K, 3)); assert.equal(K.tgt, WK_FB_HARD, 'the first 30 s: the target jumps, no ramp'); assert.equal(wkShown(W), '1/13, SET 1');
  assert.deepEqual(c.slice(-3), ['set', 'set', 'set'], '3-2-1 before it');
  c = secs(F, K, 29); assert.equal(K.tgt, WK_FB_HARD); c.push(...secs(F, K, 1)); assert.equal(K.tgt, 125, 'the float: 125 W at once'); assert.deepEqual(c.filter(x => x !== 'set'), ['stop'], 'one cue at its end');
  c = secs(F, K, W.tot - F.tr.t + 2); assert.equal(c.filter(x => x === 'set').length, 38 * 3, 'the other 38 30 s: 3-2-1 each'); assert.equal(c.filter(x => x === 'stop').length, 38);
  assert.equal(F.wk, null, 'over'); assert.ok(c.includes('done')); assert.equal(F.tr.tgt, wkEasy(W)); assert.equal(K.tgt, 88, 'free ERG at the cool-down\'s end (35 % of 250), at most 100 W');
  assert.ok(F.wkDone > F.tr.ts && F.wkDone <= F.tr.ts + WK_DONE_S, '"Workout done" for a while');
  ev(F, K, F.tr.ts, 'up'); assert.equal(F.tr.tgt, 90, 'then + / - as in a free ride (onto the 5 W grid)');
});
test('+ / - in a workout: hard offset in a hard step, easy offset in an easy one, both stay; held = 25 W; the wheel; sent at once', () => {
  const [F, K] = wkRide(); const W = F.wk; secs(F, K, 1080 + 5); assert.equal(K.tgt, WK_FB_HARD);
  ev(F, K, F.tr.ts, 'up', 'up'); assert.equal(W.ha, 10); assert.equal(F.tr.tgt, WK_FB_HARD + 10); assert.equal(K.tgt, WK_FB_HARD + 10, 'sent at once');
  secs(F, K, 30); assert.equal(K.tgt, 125, 'the float unchanged'); ev(F, K, F.tr.ts, 'down'); assert.equal(W.ea, -5); assert.equal(K.tgt, 120);
  secs(F, K, 15); assert.equal(K.tgt, WK_FB_HARD + 10, 'the next 30 s keeps +10'); secs(F, K, 30); assert.equal(K.tgt, 120, 'the next float keeps -5');
  secs(F, K, 15 + 45 * 11 + 30); assert.equal(K.tgt, 125, 'the rest between the sets: 130 - 5'); assert.equal(wkShown(W), 'REST');
  ev(F, K, F.tr.ts, ['item', 1]); assert.equal(W.ea, 0, 'the + zone'); ev(F, K, F.tr.ts, 'upHold'); assert.equal(W.ea, 25, 'held: 25 W'); assert.equal(K.tgt, 155);
  ev(F, K, F.tr.ts, ['item', 2], 'down'); assert.equal(F.tr.step, 10); assert.equal(W.ea, 15, 'the step size counts');
  handle(F, 'wheel', F.tr.ts, [0, -2]); radio(F, K, F.tr.ts); assert.equal(W.ea, -5, 'the wheel: 2 steps down'); assert.equal(K.tgt, 125); assert.ok(F.cues.includes('tick'));
  for (let i = 0; i < 40; i++) ev(F, K, F.tr.ts, 'downHold'); assert.equal(W.ea, -150, 'at most -150 W'); assert.equal(K.tgt, 50, 'never below 50 W');
  assert.equal(W.ha, 10, 'the hard offset is its own');
});
test('pause in a workout keeps the place: the clock stands, 30 W while paused, + / - wait; resume goes on where it was', () => {
  const [F, K] = wkRide(); secs(F, K, 1080 + 10); const i = F.wk.i, t = F.tr.t, left = F.wk.s0 + F.wk.dur[i] - t;
  ev(F, K, F.tr.ts, 'start'); assert.equal(F.tr.st, 'pause'); assert.equal(K.tgt, W_PAUSE);
  secs(F, K, 300); assert.equal(F.tr.t, t); assert.equal(F.wk.i, i, 'the same step'); assert.equal(K.tgt, W_PAUSE, 'still easy');
  ev(F, K, F.tr.ts, 'up'); assert.equal(K.tgt, W_PAUSE, 'a change waits for the resume'); assert.equal(F.tr.tgt, WK_FB_HARD + 5);
  ev(F, K, F.tr.ts, 'start'); assert.equal(K.tgt, WK_FB_HARD + 5, 'resume: the hard target again, with the offset'); secs(F, K, left - 1); assert.equal(F.wk.i, i); secs(F, K, 1); assert.equal(F.wk.i, i + 1);
});
test('a long hard step ramps in and out (js/workouts.js rampIn / rampOut), finish and discard end the workout, the upload as before', () => {
  const W = newWk({ id: 'l', n: 'Long', s: [[60, 100, null, 0, 'Easy'], [120, 300, null, 1, 'VO2'], [60, 100, null, 0, 'Easy']] });
  const tr = wkTrack(W); assert.deepEqual(tr.slice(49, 61), [100, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300], 'the last 10 s up to 300');
  assert.deepEqual(tr.slice(180, 186), [300, 260, 220, 180, 140, 100], 'the first 5 s down');
  const [F, K] = wkRide(); secs(F, K, 100); ev(F, K, F.tr.ts, 'back'); assert.equal(F.scr, SCR.TEND); ev(F, K, F.tr.ts, 'down', 'down', 'start');
  assert.equal(F.scr, SCR.TSUM); assert.equal(F.wk, null); assert.equal(F.tbody.type, 'VirtualRide'); assert.equal(F.tbody.moving, 100);
  const [G, K2] = wkRide(); secs(G, K2, 5); ev(G, K2, G.tr.ts, 'back', 'down', 'down', 'down', 'start', 'down', 'start'); assert.equal(G.scr, SCR.HOME); assert.equal(G.wk, null);
});
test('Monkey C: Trainer.mc TWork / Flow.mc have the JavaScript\'s constants, functions and the built-in 30 / 15 entry by entry; the version', () => {
  const tmc = readFileSync(new URL('../garmin/source/Trainer.mc', import.meta.url), 'utf8'), fmc = readFileSync(new URL('../garmin/source/Flow.mc', import.meta.url), 'utf8');
  for (const k of ['WK_STEPS', 'WK_ADJ', 'WK_FLOOR', 'WK_SHORT', 'WK_RI', 'WK_RO', 'WK_EASY', 'WK_FB_HARD']) assert.match(tmc, new RegExp(`const ${k} = ${WT[k]};`), k);
  assert.match(tmc, new RegExp(`const WK_FB_ID = "${WK_FB_ID}";`)); assert.match(fmc, new RegExp(`const FREE_RIDE = "${FREE_RIDE.replace(/[()]/g, '\\$&')}";`)); assert.match(fmc, new RegExp(`const WK_DONE_S = ${WK_DONE_S};`));
  for (const f of ['wkCnt', 'wkAdd', 'wkBase', 'wkPlat', 'wkAt', 'wkTarget', 'wkTune', 'wkAdj', 'wkEasy', 'wkShown', 'wkNextW', 'wkDur', 'wkFallback', 'newWk']) assert.match(tmc, new RegExp(`js: ${f}\\(`), `Trainer.mc ports ${f}`);
  for (const f of ['setRides', 'rides', 'tBegin', 'wkApply', 'wkEnd', 'wkSec', 'wkStep', 'tPick', 'tChoose']) assert.match(fmc, new RegExp(`\\b${f}\\b`), `Flow.mc ports ${f}`);
  // the built-in workout's entries, read from Trainer.mc wkFallback (rnd(x.0 * f / 100) = Math.round(x * f / 100))
  const body = tmc.slice(tmc.indexOf('function wkFallback')); const src = body.slice(body.indexOf('"s" => [') + 7, body.indexOf('] } as Dictionary;') + 1);
  for (const ftp of [250, 287]) {
    const mcS = Function('f', 'rnd', 'WK_FB_HARD', `return ${src};`)(ftp, x => Math.round(x), WK_FB_HARD), js = wkFallback(ftp);
    assert.deepEqual(mcS, js.s, `the 30 / 15 at FTP ${ftp}: Trainer.mc = js`);
  }
  assert.match(tmc, /"n" => "30\/15, 3 x 13", "ri" => 3, "ro" => 2/); assert.deepEqual([wkFallback(1).n, wkFallback(1).ri, wkFallback(1).ro], ['30/15, 3 x 13', 3, 2]);
  assert.match(fmc, new RegExp(`RF_VERSION = "${VERSION.replace(/\./g, '\\.')}"`)); assert.equal(VERSION, '27.11.2');
});

test('27.11.2 the heart rate step: a live heart rate starts the ride after 2 s, none waits, START skips, BACK = the trainer; stale after 15 s', () => {
  const [F, K] = ride({ ride: false }); ev(F, K, 1005, 'start', 'start'); assert.equal(F.scr, SCR.THR); assert.equal(hrOn(F, 1005), false);
  for (let t = 1006; t <= 1012; t++) handle(F, 'tick', t); assert.equal(F.scr, SCR.THR, 'no heart rate: it waits');
  handle(F, 'hr', 1013, 72); assert.equal(hrOn(F, 1013), true); handle(F, 'tick', 1013); handle(F, 'tick', 1014); assert.equal(F.scr, SCR.THR, 'shown first');
  handle(F, 'tick', 1015); assert.equal(F.scr, SCR.TREC, 'then the ride'); assert.equal(F.tr.tgt, 100);
  assert.equal(hrOn(F, 1028), true); assert.equal(hrOn(F, 1029), false, 'no value for 15 s: the heart is off');
  const [G, K2] = ride({ ride: false }); handle(G, 'hr', 1004, 60); ev(G, K2, 1005, 'start', 'start'); assert.equal(G.scr, SCR.THR, 'already there: still shown');
  ev(G, K2, 1005, 'back'); assert.equal(G.scr, SCR.TSCAN); assert.equal(shown(G.link), 'ready', 'still connected'); ev(G, K2, 1005, 'start'); assert.equal(G.scr, SCR.THR);
  handle(G, 'tick', 1006); assert.equal(G.scr, SCR.THR); handle(G, 'tick', 1007); assert.equal(G.scr, SCR.TREC);
});
