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
  assert.deepEqual(K.sub, { ibd: 1, fcp: 2, cpm: 1 }, 'Indoor Bike Data notified, the control point indicated, 27.11.3: Cycling Power too (the crank cadence)');
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
test('+ / - steps, step size 5 / 10 / 25 on a tap, 27.11.3: held UP / DOWN = one step (felt), limits 30..1000', () => {
  const [F, K] = ride(); const R = F.tr; F.cues = [];
  ev(F, K, 1010, 'upHold'); assert.equal(R.tgt, 105); assert.deepEqual(F.cues, ['tick'], 'held: felt'); ev(F, K, 1010, ['item', 0]); assert.equal(R.tgt, 100, 'the - zone');
  ev(F, K, 1010, ['item', 1]); assert.equal(R.tgt, 105, 'the + zone'); ev(F, K, 1010, ['item', 2]); assert.equal(R.step, 10, 'a tap on the target: 10 W steps');
  ev(F, K, 1010, 'upHold'); assert.equal(R.tgt, 110, 'onto the 10 grid'); ev(F, K, 1010, ['item', 2]); ev(F, K, 1010, 'downHold'); assert.equal(R.tgt, 100); assert.equal(R.step, 25);
  ev(F, K, 1010, ['item', 2]); assert.equal(R.step, 5); ev(F, K, 1010, 'upHold'); assert.equal(R.tgt, 105, 'held: one step, never 25 W'); ev(F, K, 1010, 'downHold', 'downHold'); assert.equal(R.tgt, 95);
  for (let i = 0; i < 20; i++) ev(F, K, 1010, ['item', 0]); assert.equal(R.tgt, W_MIN); assert.equal(K.tgt, 30);
  ev(F, K, 1010, ['item', 2], ['item', 2]); assert.equal(R.step, 25);
  for (let i = 0; i < 50; i++) ev(F, K, 1010, 'upHold'); assert.equal(R.tgt, W_MAX); assert.equal(K.tgt, 1000);
  ev(F, K, 1010, ['item', 2]); assert.equal(R.step, 5); assert.equal(nextTarget({ tgt: 103, step: 5 }, 1, false), 105); assert.equal(nextTarget({ tgt: 1000, step: 25 }, 1, true), 1000); assert.equal(nextStep(25), 5);
  assert.equal(F.tTgt, 1000, 'kept as the next start target'); assert.equal(F.scr, SCR.TREC);
});
test('latest wins: a burst of presses = one write in flight, then only the newest value', () => {
  const [F, K] = ride(); K.hold = true; const before = tgtWrites(K).length;
  for (let i = 0; i < 12; i++) { ev(F, K, 1010, ['item', 1]); assert.ok(F.link.op && F.link.op.k === 'tgt'); }
  assert.equal(tgtWrites(K).length - before, 1, 'one write while the trainer has not answered'); assert.equal(tgtWrites(K).at(-1), 105);
  for (const e of K.release()) handle(F, 'ble', 1011, e); radio(F, K, 1011);
  assert.deepEqual(tgtWrites(K).slice(before), [105, 160], 'then the newest, nothing in between'); assert.equal(K.tgt, 160); assert.equal(F.link.sent, 160);
  // a write that never gets an answer: free again after the timeout, the newest goes out
  K.hold = true; ev(F, K, 1020, ['item', 1]); K.pend = []; K.hold = false; ev(F, K, 1020, ['item', 1], ['item', 1]); assert.equal(tgtWrites(K).at(-1), 165);
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
  K.refuse = true; ev(F, K, 1020, ['item', 1]); assert.equal(shown(F.link), 'refused'); K.refuse = false; handle(F, 'tick', 1020 + CTL_S); radio(F, K, 1026); handle(F, 'tick', 1027); radio(F, K, 1027);
  assert.equal(K.tgt, 105);
});
test('lost mid-ride: "lost, reconnecting", the system reconnects or the watch pairs again, the target is sent again', () => {
  const [F, K] = ride(); ev(F, K, 1010, ['item', 1], ['item', 1]); assert.equal(K.tgt, 110);
  K.tgt = 0; handle(F, 'ble', 1011, { k: 'drop' }); assert.equal(shown(F.link), 'lost'); assert.equal(F.scr, SCR.TREC, 'the ride goes on');
  ev(F, K, 1012, ['item', 1]); assert.equal(F.tr.tgt, 115, 'the target can still change');
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
  ev(F, K, 1016, 'upHold', 'upHold'); assert.equal(F.tr.tgt, 110); assert.equal(K.tgt, W_PAUSE, 'not sent while paused');
  for (let t = 1016; t <= 1030; t++) handle(F, 'tick', t); assert.equal(F.tr.t, 10, 'no seconds while paused');
  ev(F, K, 1030.5, 'start'); assert.equal(F.tr.st, 'run'); assert.equal(K.tgt, 110); for (let t = 1031; t <= 1035; t++) handle(F, 'tick', t); assert.equal(F.tr.t, 15);
});
test('27.11.3 menu: Back to ride / +5 W / -5 W / Finish & save / Discard (asks once more); it never pauses, BACK = back to the ride; Resume only when paused', () => {
  const [F, K] = ride(); ev(F, K, 1010, 'swipeUp'); assert.equal(F.tr.pg, 1); ev(F, K, 1010, 'tap'); assert.equal(F.tr.pg, 0);
  ev(F, K, 1010, 'back'); assert.equal(F.scr, SCR.TEND); assert.deepEqual(listItems(F), ['Back to ride', '+5 W', '-5 W', 'Finish & save', 'Discard']); assert.deepEqual(listItems(F), TEND_ROWS);
  assert.equal(F.tr.st, 'run', 'the menu does not pause'); assert.equal(K.tgt, 100, 'the trainer keeps the target');
  const t0 = F.tr.t; for (let t = 1011; t <= 1015; t++) handle(F, 'tick', t); assert.ok(F.tr.t >= t0 + 4, 'the clock runs on behind the menu');
  ev(F, K, 1015, 'back'); assert.equal(F.scr, SCR.TREC); assert.equal(F.tr.pg, 0); ev(F, K, 1015, 'menu'); assert.equal(F.scr, SCR.TEND, 'MENU too'); ev(F, K, 1015, ['item', 0]); assert.equal(F.scr, SCR.TREC);
  ev(F, K, 1015, 'back', ['item', 4]); assert.deepEqual(listItems(F), ['Keep riding', 'Discard ride']);
  ev(F, K, 1015, 'back'); assert.equal(F.sel, 4); assert.equal(F.scr, SCR.TEND); ev(F, K, 1015, 'start', 'down', 'start'); assert.equal(F.scr, SCR.HOME, 'discarded'); assert.equal(F.tr, null);
  assert.ok(!F.out.some(o => o.k === 'saveAct')); assert.ok(!K.paired, 'the trainer is let go');
  const [G, K2] = ride(); ev(G, K2, 1010, 'start', 'back'); assert.equal(listItems(G)[0], 'Resume', 'paused: the first row says so'); assert.equal(G.tr.st, 'pause');
  ev(G, K2, 1010, 'back'); assert.equal(G.tr.st, 'pause', 'BACK leaves a pause paused'); ev(G, K2, 1010, 'back', ['item', 0]); assert.equal(G.tr.st, 'run', 'Resume ends it'); assert.equal(K2.tgt, 100);
});
test('finish: summary (time, avg / max power, NP, cadence, heart rate, kJ) and the upload body with the series', () => {
  const [F, K] = ride();
  for (let i = 1; i <= 120; i++) { const t = 1005 + i; handle(F, 'ble', t - .5, K.data(i <= 60 ? 200 : 250, 90)); handle(F, 'hr', t - .4, i <= 60 ? 130 : 150); handle(F, 'tick', t); }
  assert.equal(F.tr.t, 120); ev(F, K, 1126, 'back', ['item', 3]);
  assert.equal(F.scr, SCR.TSUM); const s = F.tsum;
  assert.deepEqual([s.t, s.avgPw, s.maxPw, s.cad, s.hr, s.maxHr, s.kj], [120, 225, 250, 90, 140, 150, 27]);
  assert.ok(s.np >= 225 && s.np <= 250, `NP ${s.np}`); assert.equal(s.name, 'KICKR CORE 2 5A1F');
  const o = F.out.find(x => x.k === 'saveAct'); assert.equal(o.sum.sp, 'trainer'); assert.ok(!K.paired, 'let go after the ride');
  const b = F.tbody; assert.equal(b.type, 'VirtualRide'); assert.deepEqual([b.moving, b.power, b.maxPower, b.kj, b.cad, b.dist, b.hr, b.maxHr], [120, 225, 250, 27, 90, 0, 140, 150]);
  assert.equal(b.s.dt, 10); assert.equal(b.s.pw.length, 12); assert.deepEqual(b.s.pw.slice(5, 7), [200, 250]); assert.deepEqual(new Set(b.s.tgt), new Set([100])); assert.deepEqual(b.s.cad[0], 90);
  assert.ok(JSON.stringify(b).length < 1000);
  ev(F, K, 1130, 'start'); assert.equal(F.scr, SCR.HOME); assert.equal(homeItems(F)[0], 'trainer');
  const [G, K2] = ride(); ev(G, K2, 1005, 'back', ['item', 3]); assert.equal(G.scr, SCR.HOME, 'nothing ridden: nothing saved'); assert.ok(!G.out.some(o => o.k === 'saveAct'));
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
  F.tr.pg = 1; ev(F, K, 1009, ['wheel', [0, -3]]); assert.equal(F.tr.tgt, W_MAX, 'another page: no wheel'); assert.equal(F.scr, SCR.TREC);
});

/* ---- 27.11.: workouts on the watch (js/watchtrainer.js newWk ... = Trainer.mc TWork; js/watchflow.js tPick ... = Flow.mc) ---- */
import { readFileSync } from 'node:fs';
import { newWk, wkAt, wkTarget, wkTune, wkFallback, wkFromRide, wkCompact, wkDur, wkEasy, wkShown, WK_FB_HARD, WK_FB_ID, WK_STEPS } from '../js/watchtrainer.js';
import * as WT from '../js/watchtrainer.js';
import { rides, setRides, FREE_RIDE, WK_DONE_S, VERSION, hrOn, TRAINING, CATS, catOf, catName, tCats, tRows } from '../js/watchflow.js';
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
  assert.deepEqual([W.cnt[9], W.cnt[W.dur.length - 2]], ['1/13, SET 1/3', '13/13, SET 3/3'], 'the counter of the first and the last 30 s');
  W.i = 9; assert.equal(wkShown(W), '1/13, SET 1/3'); W.i = 10; assert.equal(wkShown(W), 'FLOAT'); W.i = 0; assert.equal(wkShown(W), 'WARM-UP'); W.i = 3; assert.equal(wkShown(W), 'OPENER');
  assert.deepEqual(W.kd.slice(0, 4), [WT.WK_WARM, WT.WK_WARM, 0, WT.WK_WORK], 'kinds: warm-up, build (a ramp up), spin, opener'); assert.equal(W.kd.at(-1), WT.WK_COOL); assert.equal(W.kd[10], 0, 'a float: recovery');
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
function wkRide(row = 1, o = {}) { const [F, K] = ride({ ...o, ride: false }); if (o.rides) setRides(F, o.rides, o.ftp); ev(F, K, 1005, 'start'); assert.equal(F.scr, SCR.TPICK); pickWk(F, K, 1005, row); ev(F, K, 1005, 'start'); return [F, K]; }
/** 27.11.6: on the chooser (first step): Training, the workout's category, the workout (row = its index in rides + 1) */
function pickWk(F, K, t, row) {
  assert.equal(F.tlev, 0); ev(F, K, t, 'down', 'start'); assert.equal(F.tlev, 1);
  const c = catOf(rides(F)[row - 1]); for (let i = 0; i < tCats(F).indexOf(c); i++) ev(F, K, t, 'down'); ev(F, K, t, 'start'); assert.equal(F.tlev, 2); assert.equal(F.tcat, c);
  for (let i = 0; i < tRows(F).indexOf(row - 1); i++) ev(F, K, t, 'down'); ev(F, K, t, 'start');
}
/** n seconds of riding, one tick per second; the cues */
function secs(F, K, n) { const cues = []; for (let i = 0; i < n; i++) { const t = F.tr.ts + 1; handle(F, 'tick', t); radio(F, K, t); cues.push(...F.cues.splice(0)); } return cues; }
test('choice: Free ride (ERG) or a workout, also while connecting (then START rides it once connected); BACK keeps the link', () => {
  const [F, K] = ride({ ride: false }); ev(F, K, 1005, 'start'); assert.deepEqual(listItems(F), [FREE_RIDE, TRAINING], '27.11.6: Free ride or Training');
  ev(F, K, 1005, ['item', 1]); assert.deepEqual(listItems(F), ['VO2max'], 'no sync yet: the built-in 30 / 15, a VO2max workout');
  ev(F, K, 1005, ['item', 0]); assert.deepEqual(listItems(F), ['30/15, 3 x 13']); ev(F, K, 1005, 'back'); assert.equal(F.tlev, 1); ev(F, K, 1005, 'back'); assert.equal(F.tlev, 0); assert.equal(F.sel, 1, 'BACK: one step up, Training selected');
  ev(F, K, 1005, 'back'); assert.equal(F.scr, SCR.TSCAN); assert.equal(shown(F.link), 'ready', 'still connected');
  ev(F, K, 1005, 'down'); assert.equal(F.scr, SCR.TPICK, 'UP / DOWN open it too'); ev(F, K, 1005, ['item', 1], ['item', 0], ['item', 0], 'start'); assert.equal(F.scr, SCR.TREC); assert.equal(F.wk.n, '30/15, 3 x 13');
  // while connecting: the choice waits, START rides it once connected
  const G = fl(), K2 = fakeKickr(); ev(G, K2, 1000, ['item', homeItems(G).indexOf('trainer')]); K2.hold = true; ev(G, K2, 1000, 'start'); assert.equal(shown(G.link), 'conn');
  ev(G, K2, 1000, 'start'); assert.equal(G.scr, SCR.TPICK); pickWk(G, K2, 1000, 1); assert.equal(G.scr, SCR.TSCAN, 'not connected yet: back to the state'); assert.equal(G.tw, 1);
  for (const e of K2.release()) handle(G, 'ble', 1001, e); K2.hold = false; radio(G, K2, 1001); handle(G, 'tick', 1001 + OP_S + .5); radio(G, K2, 1005); assert.equal(shown(G.link), 'ready');
  ev(G, K2, 1005, 'start', 'start'); assert.equal(G.scr, SCR.TREC); assert.ok(G.wk, 'the workout chosen while connecting'); assert.equal(G.tw, -1);
  // the server's list replaces the built-in one when it has the 30 / 15
  setFtp(260); const srv = [wkFromRide(WORKOUTS[0], 260, isHard), wkFromRide(WO, 260, isHard)]; const H = fl(); setRides(H, srv, 260);
  assert.deepEqual(rides(H).map(w => w.id), ['ss3x10', WK_FB_ID]); setRides(H, [srv[0]], 260); assert.deepEqual(rides(H).map(w => w.id), [WK_FB_ID, 'ss3x10'], 'without it: the built-in first');
  setRides(H, null, 0); assert.equal(rides(H).length, 2, 'an answer without a list keeps them'); assert.equal(H.ftp, 260);
});
test('riding the 30 / 15: steps by the clock, ramps once a second, short efforts jump, 3-2-1 before each hard one and one at its end, the end', () => {
  const [F, K] = wkRide(); const W = F.wk; assert.equal(F.tr.tgt, 100, 'the warm-up ramp starts at 40 % of 250'); assert.equal(K.tgt, 100);
  const w0 = tgtWrites(K).length; let c = secs(F, K, 480 + 180 - 1); const ramp = tgtWrites(K).slice(w0);
  assert.ok(ramp.length <= 660 && ramp.length >= 70, `the ramps 100 -> 188 -> 238 W: ${ramp.length} writes in 660 s`); assert.ok(ramp.every((x, i) => !i || x > ramp[i - 1]), 'rising only');
  assert.ok(Math.abs(ramp.at(-1) - 238) <= 1, `the build ends near 95 % of 250: ${ramp.at(-1)}`);
  c.push(...secs(F, K, 1)); assert.equal(K.tgt, 130, 'then 2 min spin'); c.push(...secs(F, K, 120)); assert.equal(K.tgt, 300, 'the first opener'); c.push(...secs(F, K, 20)); assert.equal(K.tgt, 130);
  c.push(...secs(F, K, 70 + 20 + 70 + 20 + 190 - 3)); assert.equal(F.tr.t, 1167); assert.equal(K.tgt, 130, 'spin before the first 30 s');
  c.push(...secs(F, K, 3)); assert.equal(K.tgt, WK_FB_HARD, 'the first 30 s: the target jumps, no ramp'); assert.equal(wkShown(W), '1/13, SET 1/3');
  assert.deepEqual(c.slice(-3), ['set', 'set', 'set'], '3-2-1 before it');
  c = secs(F, K, 29); assert.equal(K.tgt, WK_FB_HARD); c.push(...secs(F, K, 1)); assert.equal(K.tgt, 125, 'the float: 125 W at once'); assert.deepEqual(c.filter(x => x !== 'set'), ['stop'], 'one cue at its end');
  c = secs(F, K, W.tot - F.tr.t + 2); assert.equal(c.filter(x => x === 'set').length, 38 * 3, 'the other 38 30 s: 3-2-1 each'); assert.equal(c.filter(x => x === 'stop').length, 38);
  assert.equal(F.wk, null, 'over'); assert.ok(c.includes('done')); assert.equal(F.tr.tgt, wkEasy(W)); assert.equal(K.tgt, 88, 'free ERG at the cool-down\'s end (35 % of 250), at most 100 W');
  assert.ok(F.wkDone > F.tr.ts && F.wkDone <= F.tr.ts + WK_DONE_S, '"Workout done" for a while');
  ev(F, K, F.tr.ts, ['item', 1]); assert.equal(F.tr.tgt, 90, 'then + / - as in a free ride (onto the 5 W grid)');
});
test('+ / - in a workout: hard offset in a hard step, easy offset in an easy one, both stay; held = one step; the wheel; sent at once', () => {
  const [F, K] = wkRide(); const W = F.wk; secs(F, K, 1170 + 5); assert.equal(K.tgt, WK_FB_HARD);
  ev(F, K, F.tr.ts, ['item', 1], 'upHold'); assert.equal(W.ha, 10); assert.equal(F.tr.tgt, WK_FB_HARD + 10); assert.equal(K.tgt, WK_FB_HARD + 10, 'sent at once');
  secs(F, K, 30); assert.equal(K.tgt, 125, 'the float unchanged'); ev(F, K, F.tr.ts, 'downHold'); assert.equal(W.ea, -5); assert.equal(K.tgt, 120);
  secs(F, K, 15); assert.equal(K.tgt, WK_FB_HARD + 10, 'the next 30 s keeps +10'); secs(F, K, 30); assert.equal(K.tgt, 120, 'the next float keeps -5');
  secs(F, K, 15 + 45 * 11 + 30); assert.equal(K.tgt, 125, 'the rest between the sets: 130 - 5'); assert.equal(wkShown(W), 'REST');
  ev(F, K, F.tr.ts, ['item', 1]); assert.equal(W.ea, 0, 'the + zone'); ev(F, K, F.tr.ts, 'upHold'); assert.equal(W.ea, 5, 'held: one step'); assert.equal(K.tgt, 135);
  ev(F, K, F.tr.ts, ['item', 2], 'upHold'); assert.equal(F.tr.step, 10); assert.equal(W.ea, 15, 'the step size counts');
  handle(F, 'wheel', F.tr.ts, [0, -2]); radio(F, K, F.tr.ts); assert.equal(W.ea, -5, 'the wheel: 2 steps down'); assert.equal(K.tgt, 125); assert.ok(F.cues.includes('tick'));
  for (let i = 0; i < 40; i++) ev(F, K, F.tr.ts, 'downHold'); assert.equal(W.ea, -150, 'at most -150 W'); assert.equal(K.tgt, 50, 'never below 50 W');
  assert.equal(W.ha, 10, 'the hard offset is its own');
});
test('pause in a workout keeps the place: the clock stands, 30 W while paused, + / - wait; resume goes on where it was', () => {
  const [F, K] = wkRide(); secs(F, K, 1170 + 10); const i = F.wk.i, t = F.tr.t, left = F.wk.s0 + F.wk.dur[i] - t;
  ev(F, K, F.tr.ts, 'start'); assert.equal(F.tr.st, 'pause'); assert.equal(K.tgt, W_PAUSE);
  secs(F, K, 300); assert.equal(F.tr.t, t); assert.equal(F.wk.i, i, 'the same step'); assert.equal(K.tgt, W_PAUSE, 'still easy');
  ev(F, K, F.tr.ts, ['item', 1]); assert.equal(K.tgt, W_PAUSE, 'a change waits for the resume'); assert.equal(F.tr.tgt, WK_FB_HARD + 5);
  ev(F, K, F.tr.ts, 'start'); assert.equal(K.tgt, WK_FB_HARD + 5, 'resume: the hard target again, with the offset'); secs(F, K, left - 1); assert.equal(F.wk.i, i); secs(F, K, 1); assert.equal(F.wk.i, i + 1);
});
test('a long hard step ramps in and out (js/workouts.js rampIn / rampOut), finish and discard end the workout, the upload as before', () => {
  const W = newWk({ id: 'l', n: 'Long', s: [[60, 100, null, 0, 'Easy'], [120, 300, null, 1, 'VO2'], [60, 100, null, 0, 'Easy']] });
  const tr = wkTrack(W); assert.deepEqual(tr.slice(49, 61), [100, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300], 'the last 10 s up to 300');
  assert.deepEqual(tr.slice(180, 186), [300, 260, 220, 180, 140, 100], 'the first 5 s down');
  const [F, K] = wkRide(); secs(F, K, 100); ev(F, K, F.tr.ts, 'back'); assert.equal(F.scr, SCR.TEND); ev(F, K, F.tr.ts, 'down', 'down', 'down', 'start');
  assert.equal(F.scr, SCR.TSUM); assert.equal(F.wk, null); assert.equal(F.tbody.type, 'VirtualRide'); assert.equal(F.tbody.moving, 100);
  const [G, K2] = wkRide(); secs(G, K2, 5); ev(G, K2, G.tr.ts, 'back', 'down', 'down', 'down', 'down', 'start', 'down', 'start'); assert.equal(G.scr, SCR.HOME); assert.equal(G.wk, null);
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
  assert.match(tmc, /"n" => "30\/15, 3 x 13", "c" => "v", "ri" => 3, "ro" => 2/); assert.deepEqual([wkFallback(1).n, wkFallback(1).ri, wkFallback(1).ro], ['30/15, 3 x 13', 3, 2]);
  assert.match(fmc, new RegExp(`RF_VERSION = "${VERSION.replace(/\./g, '\\.')}"`)); assert.equal(VERSION, '27.11.6');
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

/* ---- 28.11. (27.11.3): the ride's pages, the buttons, the menu that never pauses, the cadence of an FTMS trainer, the phone's page config ---- */
import { tPages, tPage, TP_DEF, TEND_RESUME } from '../js/watchflow.js';
import { hasCad, wkRamp, DATA_S } from '../js/watchtrainer.js';
import { validate, compact, defaults, TRAINER_DEF, TRAINER_PAGES } from '../js/watchfields.js';

test('pages: target first, then the config\'s (workout only while a workout runs); UP / DOWN and swipes page and wrap; a tap = the target page', () => {
  const [F, K] = ride(); assert.deepEqual(tPages(F), ['target', 'body', 'stats'], 'a free ride: no workout page'); assert.equal(tPage(F), 'target');
  ev(F, K, 1010, 'down'); assert.equal(tPage(F), 'body'); ev(F, K, 1010, 'down'); assert.equal(tPage(F), 'stats'); ev(F, K, 1010, 'down'); assert.equal(tPage(F), 'target', 'wraps');
  ev(F, K, 1010, 'up'); assert.equal(tPage(F), 'stats', 'UP wraps back'); ev(F, K, 1010, 'swipeDown'); assert.equal(tPage(F), 'body'); ev(F, K, 1010, 'swipeUp'); assert.equal(tPage(F), 'stats');
  assert.equal(F.tr.tgt, 100, 'paging never changes the target'); ev(F, K, 1010, 'tap'); assert.equal(tPage(F), 'target');
  ev(F, K, 1010, 'down', 'upHold'); assert.equal(F.tr.tgt, 105, 'held UP: + on any page'); assert.equal(tPage(F), 'body');
  const [G, K2] = wkRide(); assert.deepEqual(tPages(G), ['target', 'wk', 'body', 'stats']); ev(G, K2, 1005, 'down'); assert.equal(tPage(G), 'wk');
  G.cfg = { ...G.cfg, tp: ['stats', 'wk'] }; assert.deepEqual(tPages(G), ['target', 'stats', 'wk'], 'the config\'s order');
  G.cfg = { ...G.cfg, tp: ['body', 'nope', 'body'] }; assert.deepEqual(tPages(G), ['target', 'body'], 'unknown and doubles left out');
  G.cfg = { ...G.cfg, tp: [] }; assert.deepEqual(tPages(G), ['target']); ev(G, K2, 1005, 'down'); assert.equal(tPage(G), 'target', 'one page: stays');
  const H = { ...G.cfg }; delete H.tp; G.cfg = H; assert.deepEqual(tPages(G), ['target', ...TP_DEF], 'an older config: all pages');
  assert.deepEqual(TP_DEF, TRAINER_DEF);
});
test('START pauses and resumes on every page; BACK and MENU open the menu, which does not pause; START in the menu picks the row', () => {
  const [F, K] = ride(); ev(F, K, 1010, 'down', 'start'); assert.equal(F.tr.st, 'pause'); assert.equal(tPage(F), 'body', 'on the body page'); ev(F, K, 1011, 'start'); assert.equal(F.tr.st, 'run');
  ev(F, K, 1012, 'back'); assert.equal(F.scr, SCR.TEND); assert.equal(F.tr.st, 'run'); assert.equal(K.tgt, 100); assert.equal(listItems(F)[0], 'Back to ride');
  ev(F, K, 1012, 'start'); assert.equal(F.scr, SCR.TREC); assert.equal(F.tr.st, 'run', 'START on the first row: back, still riding');
  ev(F, K, 1013, 'start', 'menu'); assert.equal(listItems(F)[0], TEND_RESUME); ev(F, K, 1013, 'start'); assert.equal(F.tr.st, 'run', 'Resume');
});
test('cadence of an FTMS trainer: Indoor Bike Data without a cadence field (or always 0) takes the crank revolutions of Cycling Power; none = "--"', () => {
  // KICKR-style Indoor Bike Data: flags 0x0044 (speed, cadence, power): 32.50 km/h, 88 rpm (176 half rpm), 215 W
  const L = newLink(); L.mode = 'ftms'; ibd(L, [0x44, 0x00, 0xb2, 0x0c, 0xb0, 0x00, 0xd7, 0x00], 10); assert.deepEqual([L.pw, L.cad, hasCad(L, 10)], [215, 88, true]);
  // flags 0x0040: speed and power only (no cadence field): the crank of 0x2A63 (flags 0x20) gives it, its power is not taken
  const M = newLink(); M.mode = 'ftms'; ibd(M, [0x40, 0x00, 0xb2, 0x0c, 0xd7, 0x00], 10); assert.equal(hasCad(M, 10), false, 'no cadence yet: "--"');
  cpm(M, [0x20, 0x00, 0x2c, 0x01, 0xff, 0xff, 0xe8, 0xfd], 10.2); // 300 W (ignored), revs 65535, event 65000 / 1024 s
  cpm(M, [0x20, 0x00, 0x2c, 0x01, 0x01, 0x00, 0x3d, 0x03], 11.5); // revs 1 (wrapped: +2), event 829 (wrapped: +1365 = 1.333 s) -> 90 rpm
  assert.deepEqual([M.pw, M.cad, hasCad(M, 11.5)], [215, 90, true], 'the crank cadence over the wrap, the power from Indoor Bike Data');
  cpm(M, [0x20, 0x00, 0x2c, 0x01, 0x01, 0x00, 0x3d, 0x03], 14.5); assert.equal(M.cad, 0, 'no new revolution for 3 s: stopped pedalling');
  // the cadence field always 0 (seen on some firmware): the crank wins while it turns
  const Z = newLink(); Z.mode = 'ftms'; cpm(Z, [0x20, 0, 0, 0, 10, 0, 0, 0], 1); cpm(Z, [0x20, 0, 0, 0, 12, 0, 0x00, 0x05], 2.25); assert.equal(Z.cad, 96, '2 revs in 1.25 s');
  ibd(Z, [0x44, 0x00, 0xb2, 0x0c, 0x00, 0x00, 0xd7, 0x00], 2.5); assert.equal(Z.cad, 96, 'a 0 from Indoor Bike Data does not hide the crank');
  ibd(Z, [0x44, 0x00, 0xb2, 0x0c, 0xb4, 0x00, 0xd7, 0x00], 3); assert.equal(Z.cad, 90, 'a real Indoor Bike Data cadence is taken');
  cpm(Z, [0x20, 0, 0, 0, 14, 0, 0x00, 0x0a], 3.5); assert.equal(Z.cad, 90, 'then Indoor Bike Data leads, the crank waits');
  // nothing at all for longer than DATA_S: "--", not 0
  assert.equal(hasCad(Z, 3.5 + DATA_S + .1), false); assert.equal(hasCad(newLink(), 0), false, 'a new link: no cadence');
  // through the flow: the pretend KICKR without the cadence field, crank events every second
  const K = fakeKickr({ ibdCad: 'none' }), [F] = ride({}, K); assert.equal(K.sub.cpm, 1, 'FTMS: Cycling Power subscribed too');
  for (let i = 0; i <= 4; i++) { handle(F, 'ble', 1006 + i, K.data(200, 0)); handle(F, 'ble', 1006 + i, K.crank(999, 100 + (i * 3) / 2 | 0, (i * 1024) & 0xffff)); }
  assert.equal(F.link.pw, 200, 'the power from Indoor Bike Data'); assert.ok(F.link.cad >= 60 && F.link.cad <= 120, `cadence ${F.link.cad}`); assert.ok(hasCad(F.link, 1010));
  const P = fakeKickr({ cps: false, ibdCad: 'none' }), [G] = ride({}, P); assert.equal(P.sub.cpm, undefined, 'no Cycling Power service: not asked for');
  handle(G, 'ble', 1006, P.data(180, 0)); assert.equal(hasCad(G.link, 1006), false, 'no cadence source: the screen shows "--"');
});
test('the workout page\'s data: kinds for the colours, ramps as [from, to], the counter with the set count', () => {
  const W = newWk({ id: 'k', n: 'K', s: [[300, 100, 200, 0, 'Warm-up'], [120, 150, 250, 0, ''], [60, 300, null, 1, 'VO2'], [60, 120, null, 0, 'Easy'], [2, [[2, [[30, 350, null, 1, 'On'], [30, 100, null, 0, 'Off']], 0]], 0], [300, 150, 90, 0, '']] });
  assert.deepEqual(W.kd, [WT.WK_WARM, WT.WK_WARM, WT.WK_WORK, 0, WT.WK_WORK, 0, WT.WK_WORK, 0, WT.WK_WORK, 0, WT.WK_WORK, 0, WT.WK_COOL]);
  W.i = 0; assert.deepEqual(wkRamp(W), [100, 200]); W.i = 2; assert.equal(wkRamp(W), null, 'a flat step'); W.i = W.dur.length - 1; assert.deepEqual(wkRamp(W), [150, 90]);
  W.ea = 10; assert.deepEqual(wkRamp(W), [160, 100], 'with the easy offset');
  assert.equal(W.cnt[4], '1/2, SET 1/2'); assert.equal(W.cnt[10], '2/2, SET 2/2');
});
test('phone config: trainer pages (Target always first, not stored); validated, compact "tp"; a config without them = all', () => {
  assert.deepEqual(Object.keys(TRAINER_PAGES), TRAINER_DEF); assert.deepEqual(defaults().trainer, { pages: ['wk', 'body', 'stats'] });
  const old = defaults(); delete old.trainer; const v = validate(old); assert.ok(v.cfg, v.error); assert.equal(v.cfg.trainer, undefined, 'an older phone\'s config stays as it was');
  assert.deepEqual(compact(old).tp, ['wk', 'body', 'stats']);
  for (const pages of [['stats'], [], ['body', 'wk']]) { const c = { ...defaults(), trainer: { pages } }; assert.deepEqual(validate(c).cfg.trainer.pages, pages); assert.deepEqual(compact(c).tp, pages); }
  for (const [t, re] of [[{ pages: ['target'] }, /not a trainer page/], [{ pages: ['wk', 'wk'] }, /twice/], [{ pages: 'wk' }, /up to 3/], [{ pages: ['wk'], x: 1 }, /unknown key/], [[], /object/], [{ pages: [1] }, /not a trainer page/]])
    assert.match(validate({ ...defaults(), trainer: t }).error || '', re, JSON.stringify(t));
});
test('Monkey C mirrors: the pages, the buttons, the menu rows, the cadence merge, the drawing', () => {
  const rd = f => readFileSync(new URL('../garmin/source/' + f, import.meta.url), 'utf8');
  const fmc = rd('Flow.mc'), tmc = rd('Trainer.mc'), dmc = rd('Draw.mc'), del = rd('FlowDelegate.mc'), fld = rd('Fields.mc'), ble = rd('TrainerBle.mc');
  for (const f of ['function tPages(', 'function tPage(', '"Back to ride"', '"Resume"', 'cfg["tp"]']) assert.ok(fmc.includes(f), 'Flow.mc ' + f);
  for (const f of ['function hasCad(', 'cadAt', 'icAt', 'ccAt', 'function ramp(', 'function kindOf(', 'WK_WARM', '"cps"']) assert.ok(tmc.includes(f), 'Trainer.mc ' + f);
  for (const f of ['function trRing(', 'function trTarget(', 'function trWork(', 'function trBody(', 'function trBtn(', 'hasCad(', '"RIDE MENU"']) assert.ok(dmc.includes(f), 'Draw.mc ' + f);
  assert.ok(del.includes('keyAt'), 'FlowDelegate.mc: the menu behaviour is not taken while a key is held'); assert.ok(fld.includes('"tp" =>'), 'Fields.mc default tp'); assert.ok(ble.includes('"cps"'));
});

/* ---- 27.11.4: the trainer summary's pages (js/watchflow.js tsPages / onTSum) and its numbers, kept second by second
 *      (js/watchtrainer.js rideSec best powers and zones, wkRec / wkClose, rideReport) ---- */
import { tsPages, setHrZones } from '../js/watchflow.js';
import { wkRec, wkClose, rideReport, hrZones, BEST_N, IV_SKIP, HRR_S, REC_NONE } from '../js/watchtrainer.js';
/** the ride's seconds as tSecs runs them: rideSec, wkRec (before the workout moves on), wkAt; pwOf / hrOf (W, into) per second */
function wkRun(W, R, n, pwOf, hrOf) {
  for (let s = 0; s < n; s++) {
    const into = R.t + 1 - W.s0, pw = W.i < W.dur.length ? pwOf(W, into) : 100, hr = hrOf(W, into);
    rideSec(R, pw, 90, hr); wkRec(W, R.t, pw, hr, W.i < W.dur.length ? W.w[W.i] : 0); wkAt(W, R.t);
  }
}
const SETS = { id: 's', n: 'Sets', s: [[60, 100, null, 0, 'Warm-up'], [10, 300, null, 1, 'Opener'], [3, 100, null, 1, 'Kick'], [60, 100, null, 0, 'Easy'],
  [3, [[2, [[30, 400, null, 1, 'Int'], [15, 100, null, 0, 'Float']]], [90, 100, null, 0, 'Rest']]], [60, 100, null, 0, 'Cool-down']] };
// the trainer ramps: the first 5 s of a hard step at 200 W; the heart 170 on the hard steps, 130 on the easy ones
const rampPw = (W, into) => W.hard[W.i] && into <= IV_SKIP ? 200 : W.w[W.i];
const hrHard = (W, into) => W.i < W.dur.length && W.hard[W.i] ? 170 : 130;

test('27.11.4 the best 30 s / 1 min / 5 min from a ring of BEST_N seconds = the best windows over the whole ride; none when too short', () => {
  const R = newRide(1000, 100), p = []; let x = 7;
  for (let s = 0; s < 1500; s++) { x = (x * 1103515245 + 12345) % 2147483648; const w = s > 700 && s < 1000 ? 250 + x % 300 : 80 + x % 200; p.push(w); rideSec(R, w, 90, 0); }
  const best = k => { let b = 0; for (let i = 0; i + k <= p.length; i++) { let a = 0; for (let j = i; j < i + k; j++) a += p[j]; if (a > b) b = a; } return Math.round(b / k); };
  const s = rideSum(R); assert.deepEqual([s.b30, s.b60, s.b300], [best(30), best(60), best(300)]); assert.equal(BEST_N, 300);
  const Q = newRide(1000, 100); for (let i = 0; i < 59; i++) rideSec(Q, 300, 90, 0);
  assert.deepEqual([rideSum(Q).b30, rideSum(Q).b60, rideSum(Q).b300], [300, 0, 0], '59 s: only the 30 s');
});

test('27.11.4 heart rate zones: only the profile\'s 6 rising values 30..250; seconds per zone (zone 1 from its min, above zone 5\'s max still zone 5)', () => {
  assert.deepEqual(hrZones([100, 120, 140, 155, 170, 190]), [100, 120, 140, 155, 170, 190]); assert.deepEqual(hrZones([99.6, 120, 140, 155, 170, 190, 7]), [100, 120, 140, 155, 170, 190]);
  for (const z of [null, [], [100, 120, 140, 155, 170], [100, 120, 120, 155, 170, 190], [20, 120, 140, 155, 170, 190], [100, 120, 140, 155, 170, 260], [100, '120', 140, 155, 170, 190], 'x']) assert.equal(hrZones(z), null, JSON.stringify(z));
  const R = newRide(1000, 100); R.zb = hrZones([100, 120, 140, 155, 170, 190]);
  for (const h of [0, 99, 100, 120, 121, 140, 141, 155, 156, 170, 171, 200]) rideSec(R, 100, 90, h);
  assert.deepEqual(R.zs, [2, 2, 2, 2, 2]); const o = rideReport({}, R, null); assert.deepEqual(o.zs, [2, 2, 2, 2, 2]); assert.equal(o.wn, ''); assert.equal(o.wt, 0);
  assert.equal(rideReport({}, newRide(1000, 100), null).zs, undefined, 'no zones: none on the summary');
  const F = fl(); setHrZones(F, [100, 120, 140, 155, 170, 190]); assert.deepEqual(F.hrZ, [100, 120, 140, 155, 170, 190]); setHrZones(F, null); assert.equal(F.hrZ, null);
});

test('27.11.4 a workout\'s intervals: sets of an outer repeat, warm-up / opener and steps under 5 s are none, the ramp seconds left out, peak, recovery', () => {
  const W = newWk(SETS), R = newRide(1000, 100);
  assert.equal(W.ivN, 6); assert.equal(W.uS, true); assert.deepEqual(W.uCnt, [2, 2, 2]);
  wkRun(W, R, W.tot + 30, rampPw, hrHard); wkClose(W);
  const o = rideReport({ ...rideSum(R), name: 'K' }, R, W);
  assert.deepEqual([o.wn, o.wt, o.wd, o.ivN, o.ivD, o.uS, o.uN, o.uD], ['Sets', W.tot, W.tot, 6, 6, true, 3, 3]);
  assert.deepEqual(o.iw, [400, 400, 400, 400, 400, 400], 'without the first 5 s at 200 W'); assert.deepEqual(o.it, [400, 400, 400, 400, 400, 400]); assert.deepEqual(o.iu, [0, 0, 1, 1, 2, 2]);
  assert.deepEqual(o.uw, [400, 400, 400]); assert.deepEqual(o.ut, [400, 400, 400]); assert.deepEqual(o.uhp, [170, 170, 170]);
  assert.deepEqual(o.urec, [40, 40, 40], 'the drop in the 60 s after each set (the last: the cool-down)'); assert.equal(o.hs.length, R.s.hr.length);
  // one set at a time: no outer repeat (5 x 60 / 60) = each interval its own unit; a hard step right after: no recovery
  const V = newWk({ id: 'v', n: 'V', s: [[5, [[60, 300, null, 1, 'VO2'], [60, 100, null, 0, 'Easy']]], [20, 300, null, 1, 'Sprint']] }), Q = newRide(1000, 100);
  assert.equal(V.uS, false); assert.equal(V.ivN, 6); assert.deepEqual(V.uCnt, [1, 1, 1, 1, 1, 1]);
  wkRun(V, Q, V.tot, rampPw, hrHard); wkClose(V); const p = rideReport({}, Q, V);
  assert.deepEqual(p.urec, [40, 40, 40, 40, 40, REC_NONE], 'the 5th: 60 s easy before the sprint is enough, the 6th: the ride ends');
  const X = newWk({ id: 'x', n: 'X', s: [[2, [[60, 300, null, 1, 'VO2'], [59, 100, null, 0, 'Easy']]]] }), Xr = newRide(1000, 100); wkRun(X, Xr, X.tot, rampPw, hrHard); wkClose(X);
  assert.deepEqual(rideReport({}, Xr, X).urec, [REC_NONE, REC_NONE], 'a hard step within 60 s: no recovery'); assert.deepEqual(p.uw, [300, 300, 300, 300, 300, 300]);
  // an interval of at most 2 x IV_SKIP s counts every second
  const Z = newWk({ id: 'z', n: 'Z', s: [[10, 500, null, 1, 'Burst'], [30, 100, null, 0, 'Easy']] }), Y = newRide(1000, 100);
  wkRun(Z, Y, Z.tot, rampPw, hrHard); wkClose(Z); assert.deepEqual(rideReport({}, Y, Z).iw, [350], '5 s at 200, 5 s at 500'); assert.equal(HRR_S, 60);
});

test('27.11.4 a workout ended early: the interval under way counts in part, a recovery not yet 60 s old is none, sets done', () => {
  const W = newWk(SETS), R = newRide(1000, 100);
  wkRun(W, R, 60 + 10 + 3 + 60 + (2 * 45 + 90) * 2 + 20, rampPw, hrHard); wkClose(W); // 20 s into the third set's first interval
  const o = rideReport({}, R, W);
  assert.deepEqual([o.ivD, o.uD, o.iw.length, o.iu], [4, 2, 5, [0, 0, 1, 1, 2]]); assert.deepEqual(o.uw, [400, 400, 400], 'the part: 15 s without the ramp');
  assert.equal(o.wd, R.t); assert.ok(o.wd < o.wt);
  const V = newWk(SETS), Q = newRide(1000, 100); wkRun(V, Q, 60 + 10 + 3 + 60 + 2 * 45 + 30, rampPw, hrHard); wkClose(V);
  assert.deepEqual(rideReport({}, Q, V).urec, [REC_NONE, REC_NONE, REC_NONE], '30 s after the set: no recovery yet');
});

test('27.11.4 the summary\'s pages: overview, intervals (a workout with one ridden), heart rate, power; UP / DOWN / swipes wrap, a tap = next, START / BACK / DONE done', () => {
  const [F, K] = ride(); secs(F, K, 90); ev(F, K, F.tr.ts, 'back'); ev(F, K, F.tr.ts, ['item', listItems(F).indexOf('Finish & save')]);
  assert.equal(F.scr, SCR.TSUM); assert.deepEqual(tsPages(F), ['ov', 'hr', 'pw'], 'a free ride'); assert.equal(F.tsum.wn, ''); assert.equal(typeof F.tsum.b30, 'number'); assert.equal(F.tsum.b300, 0);
  assert.ok(F.out.some(o => o.k === 'saveAct'), 'saved as before'); assert.equal(F.tbody.type, 'VirtualRide');
  const pg = []; for (const e of ['down', 'down', 'down', 'up', 'swipeUp', 'swipeDown', 'swipeDown', 'tap']) { handle(F, e, F.tr ? 0 : 2000); pg.push(F.sel); }
  assert.deepEqual(pg, [1, 2, 0, 2, 0, 2, 1, 2]); assert.equal(F.scr, SCR.TSUM, 'a tap on the last page is the next page (DONE: the delegate sends done)');
  handle(F, 'done', 2000); assert.equal(F.scr, SCR.HOME); assert.equal(F.sel, 0);
  for (const e of ['start', 'back', 'swipeRight']) { const [G, K2] = ride(); secs(G, K2, 20); ev(G, K2, G.tr.ts, 'back'); ev(G, K2, G.tr.ts, ['item', listItems(G).indexOf('Finish & save')]); handle(G, 'down', 2000); handle(G, e, 2000); assert.equal(G.scr, SCR.HOME, e); }
  // the built-in 30 / 15: after its warm-up a few intervals, then Finish & save: the intervals page
  const [H, K3] = wkRide(); secs(H, K3, 1300); ev(H, K3, H.tr.ts, 'back'); ev(H, K3, H.tr.ts, ['item', listItems(H).indexOf('Finish & save')]);
  const s = H.tsum; assert.deepEqual(tsPages(H), ['ov', 'iv', 'hr', 'pw']); assert.equal(s.wn, '30/15, 3 x 13'); assert.equal(s.ivN, 39); assert.equal(s.uS, true); assert.equal(s.uN, 3);
  assert.ok(s.ivD >= 2 && s.iw.length >= s.ivD && s.iw.length <= s.ivD + 1); assert.equal(H.wkSum, null); assert.equal(H.wk, null);
});

test('27.11.4 Monkey C: the summary\'s numbers, pages and buttons are in Trainer.mc / Flow.mc / Draw.mc / FlowDelegate.mc / Health.mc', () => {
  const rd = f => readFileSync(new URL('../garmin/' + f, import.meta.url), 'utf8');
  const tmc = rd('source/Trainer.mc'), fmc = rd('source/Flow.mc'), dmc = rd('source/Draw.mc'), del = rd('source/FlowDelegate.mc'), hl = rd('source/Health.mc'), app = rd('source/RideframeApp.mc'), sm = rd('tests/ZzSmokeTest.mc');
  for (const [k, v] of [['T_BEST_N', BEST_N], ['IV_SKIP', IV_SKIP], ['HRR_S', HRR_S], ['REC_NONE', REC_NONE]]) assert.match(tmc, new RegExp(`const ${k} = ${v};`), k);
  for (const f of ['hrZones', 'rideReport', 'wkPrep', 'wkUnits', 'wkRec', 'wkFlush', 'wkClose']) assert.match(tmc, new RegExp(`js: ${f}\\(`), `Trainer.mc ports ${f}`);
  for (const f of ['function tsPages(', 'function setHrZones(', 'function onTSum(', 'tReport(su, R, W)', 'W.rec(R.t, p, hr, R.tgt)', 'R.zb = hrZ', 'if (s == S_TSUM) { onTSum(ev); return; }']) assert.ok(fmc.includes(f), 'Flow.mc ' + f);
  for (const f of ['tsOver', 'tsIv', 'tsWhat', 'tsHr', 'tsZones', 'zTime', 'tsCurve', 'tsPw', 'tsTab', 'tsLine']) assert.ok(dmc.includes(`function ${f}(`), 'Draw.mc ' + f);
  for (const f of ['tsBars', 'tsFit', 'tsRow']) assert.ok(!dmc.includes(`function ${f}(`), 'Draw.mc: no ' + f + ' (27.11.5)');
  assert.ok(del.includes('s == S_TSUM') && del.includes('v > 0.78 ? E_DONE : E_TAP'), 'FlowDelegate.mc: the last page\'s DONE');
  assert.ok(hl.includes('UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_BIKING)') && app.includes('f.setHrZones(bikeZones())'), 'the profile\'s zones');
  assert.ok(sm.includes('smokeWalkSum') && sm.includes('E_DONE, un'), 'ZzSmokeTest walks the pages');
});

/* ---- 27.11.5: the summary as Garmin shows it: the intervals as a table under what they were, the heart rate zones as rows Z5 .. Z1 with
 *      their time, one recovery line; the ride menu's + / - 5 W (the fenix 8's held UP / DOWN are system keys) ---- */
import { render } from './watch-layout.mjs';
import { SCENES } from './watch-scenes.mjs';
import { Dc } from '../js/watchdc.js';
import { screen, palette } from '../js/watchscreens.js';
import { TEND_W } from '../js/watchflow.js';
const scText = (id, k = 1) => render(SCENES.find(x => x[0] === id), 'fenix8solar47mm', k).texts;
const has = (tx, t) => tx.some(x => x.t === t);

test('27.11.5 the report: the intervals\' common length and target (else 0), per unit the intervals done / in it', () => {
  const W = newWk(SETS), R = newRide(1000, 100); wkRun(W, R, W.tot + 30, rampPw, hrHard); wkClose(W);
  const o = rideReport({}, R, W); assert.deepEqual([o.ivS, o.ivW, o.udn, o.ucn], [30, 400, [2, 2, 2], [2, 2, 2]], 'the opener and the 3 s kick are no intervals');
  const V = newWk(SETS), Q = newRide(1000, 100); wkRun(V, Q, 60 + 10 + 3 + 60 + (2 * 45 + 90) * 2 + 20, rampPw, hrHard); wkClose(V);
  assert.deepEqual(rideReport({}, Q, V).udn, [2, 2, 0], 'ended inside the third set');
  const X = newWk({ id: 'x', n: 'X', s: [[5, [[60, 300, null, 1, 'VO2'], [60, 100, null, 0, 'Easy']]], [20, 300, null, 1, 'Sprint']] }), Xr = newRide(1000, 100);
  wkRun(X, Xr, X.tot, rampPw, hrHard); wkClose(X); const p = rideReport({}, Xr, X); assert.deepEqual([p.ivS, p.ivW], [0, 300], '60 s and 20 s: no common length');
  const Y = newWk({ id: 'y', n: 'Y', s: [[60, 300, null, 1, 'A'], [60, 100, null, 0, 'Easy'], [60, 320, null, 1, 'B']] }), Yr = newRide(1000, 100);
  wkRun(Y, Yr, Y.tot, rampPw, hrHard); wkClose(Y); const q = rideReport({}, Yr, Y); assert.deepEqual([q.ivS, q.ivW], [60, 0], 'two targets: none shown');
});

test('27.11.5 intervals page: what they were, a table SET / # · AVG W · +/- · HR, a grey row for one cut short, no bars', () => {
  const P = palette(false), t = scText('tsum-iv');
  for (const x of ['INTERVALS', '39 x 0:30 @ 1000 W', 'SET', 'AVG W', '+/-', 'HR', '1', '2', '3', '995', '-5', '-12', '-18', '169', '168']) assert.ok(has(t, x), x);
  assert.equal(t.find(x => x.t === '-5').col, P.good); assert.equal(t.find(x => x.t === '-12').col, P.bad);
  const dc = render(SCENES.find(x => x[0] === 'tsum-iv'), 'fenix8solar47mm', 1); assert.equal(dc.shapes.filter(s => s.k === 'rect').length, 0, 'no bar chart');
  const pt = scText('tsum-iv-part'); assert.equal(pt.find(x => x.t === '989').col, P.dim, 'set 2 cut short: grey'); assert.equal(pt.find(x => x.t === '995').col, P.fg);
  const f = scText('tsum-iv-5'); for (const x of ['5 x 5:00 @ 1000 W', '#', '4-5']) assert.ok(has(f, x), x); assert.ok(!has(f, 'SET'));
  assert.ok(has(scText('tsum-iv-1'), '1 x 20:00 @ 1000 W'));
  const big = scText('tsum-iv', 1.45); for (const x of ['SET', '+/-', 'HR', '995']) assert.ok(has(big, x), 'font scale 1.45: ' + x);
});

test('27.11.5 heart rate page: AVG / MAX, zones Z5 on top .. Z1 with their time, one recovery line (the average drop); free ride: none', () => {
  const t = scText('tsum-hr'), y = z => t.find(x => x.t === z).base;
  for (const x of ['136', '169', 'AVG', 'MAX', 'Z5', 'Z4', 'Z3', 'Z2', 'Z1', '0:00', '3:44', '14:31', '11:23', '20:22', 'RECOVERY 60 S', '-56']) assert.ok(has(t, x), x);
  assert.ok(y('Z5') < y('Z4') && y('Z4') < y('Z1'), 'Z5 on top'); assert.ok(!t.some(x => /%|PEAK|REC$/.test(x.t)), 'no percent, no table');
  const s = render(SCENES.find(x => x[0] === 'tsum-hr'), 'fenix8solar47mm', 1).shapes.filter(x => x.k === 'rect'); assert.equal(s.length, 4, 'a bar per zone with time (Z5: 0:00 none)');
  const fr = scText('tsum-hr-free'); assert.ok(has(fr, 'Z1') && !fr.some(x => x.t.startsWith('REC')), 'a free ride: zones, no recovery');
  const cu = scText('tsum-hr-curve'); assert.ok(!has(cu, 'Z1') && has(cu, 'RECOVERY 60 S'), 'no zones: the curve and the recovery');
  assert.ok(has(scText('tsum-hr', 1.45), 'Z1'), 'font scale 1.45: the zones stay');
  const F = SCENES.find(x => x[0] === 'tsum-hr-free')[2]().F; F.tsum.zs = [3725, 60, 0, 0, 0]; const dc = new Dc({ dev: 'fenix8solar47mm', scale: 1 });
  screen(dc, F, palette(false), 0, null, { hasTouch: true }); assert.ok(has(dc.texts, '1:02') && has(dc.texts, '1:00'), 'an hour and more: h:mm');
});

test('27.11.5 ride menu: +5 W / -5 W change the target (a workout: its offset) like the target page\'s + / -, the menu stays open', () => {
  const [F, K] = ride(); ev(F, K, 1010, 'back'); assert.equal(TEND_W, 5); const w0 = F.tr.tgt;
  ev(F, K, 1010, ['item', 1], ['item', 1]); assert.equal(F.scr, SCR.TEND, 'still the menu'); assert.equal(F.tr.tgt, w0 + 10); assert.equal(K.tgt, w0 + 10, 'sent');
  ev(F, K, 1011, 'down', 'down', 'start'); assert.equal(F.sel, 2); assert.equal(F.tr.tgt, w0 + 5); assert.equal(F.scr, SCR.TEND);
  F.tr.step = 25; ev(F, K, 1011, ['item', 1]); assert.equal(F.tr.tgt, w0 + 10, 'always 5 W, whatever the page\'s step'); assert.equal(F.tr.step, 25);
  const [G, K2] = wkRide(); secs(G, K2, 30); ev(G, K2, G.tr.ts, 'back'); const a0 = G.tr.tgt;
  ev(G, K2, G.tr.ts, ['item', 1], ['item', 1], ['item', 1], ['item', 2]); assert.equal(G.tr.tgt, a0 + 10); assert.equal(G.scr, SCR.TEND);
  assert.equal(G.wk.ea + G.wk.ha, 10, 'the offset of the step now');
  const dc = new Dc({ dev: 'fenix8solar47mm', scale: 1 }); screen(dc, G, palette(false), G.tr.ts, null, { hasTouch: true });
  assert.ok(dc.texts.some(x => x.t.includes(G.tr.tgt + ' W (+10)')), 'the menu shows the target and the offset');
  const [H, K3] = ride(); ev(H, K3, 1010, 'start', 'back', ['item', 1]); assert.equal(H.tr.st, 'pause', 'paused stays paused'); assert.equal(H.scr, SCR.TEND);
  const fmc = readFileSync(new URL('../garmin/source/Flow.mc', import.meta.url), 'utf8'), tmc = readFileSync(new URL('../garmin/source/Trainer.mc', import.meta.url), 'utf8');
  for (const f of ['"+5 W", "-5 W"', 'const TEND_W = 5;', 'function tPlus(', 'tPlus(i == 1 ? TEND_W : -TEND_W, now)', 'tPlus(plus ? R.step : -R.step, now)']) assert.ok(fmc.includes(f), 'Flow.mc ' + f);
  assert.ok(tmc.includes('function nextBy(') && tmc.includes('o["ivS"]') && tmc.includes('o["udn"]'), 'Trainer.mc');
});
