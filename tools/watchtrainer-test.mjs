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
/** HOME -> Indoor trainer -> the list -> START: connected; then START: riding at the start target */
function ride(o = {}, K = fakeKickr(o.k)) {
  const F = fl(o.f); ev(F, K, 1000, ['item', homeItems(F).indexOf('trainer')]);
  if (shown(F.link) === 'scan') ev(F, K, 1000, 'start');
  handle(F, 'tick', 1000 + OP_S + .5); radio(F, K, 1000 + OP_S + .5);
  if (o.ride !== false) ev(F, K, 1005, 'start');
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
  ev(F, K, 1003, 'start'); assert.equal(F.scr, SCR.TREC); assert.equal(F.tr.tgt, 100, 'default 100 W'); assert.deepEqual(tgtWrites(K), [100]); assert.equal(K.tgt, 100);
  assert.equal(F.last, 'trainer');
});
test('the trainer used last connects by itself; a cancel goes back to the list without connecting again', () => {
  const K = fakeKickr(), F = fl({ trainer: 'KICKR CORE 2 5A1F', tgt: 185 });
  ev(F, K, 1000, ['item', homeItems(F).indexOf('trainer')]); assert.equal(shown(F.link), 'ready', 'seen in the scan: connected at once');
  ev(F, K, 1001, 'back'); assert.equal(shown(F.link), 'scan'); assert.ok(!K.paired, 'let go'); assert.equal(F.link.want, '');
  assert.deepEqual(listItems(F), ['KICKR CORE 2 5A1F'], 'listed, not connected'); ev(F, K, 1002, 'start', 'start'); assert.equal(F.tr.tgt, 185, 'the last target');
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
  ev(F, K, 1006, 'start'); assert.equal(F.scr, SCR.TREC, 'riding anyway (the power is still recorded)'); assert.deepEqual(tgtWrites(K), [], 'no target without control');
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
