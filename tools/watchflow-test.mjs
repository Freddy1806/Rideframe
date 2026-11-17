// The watch's state machine (js/watchflow.js, mirrored by garmin/source/Flow.mc): transitions, value stepping, undo,
// prefill, record detection, queue and retry. Usage: node --test tools/watchflow-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { newFlow, handle, SCR, MENU, curEx, setNo, restLeft, sent, paired, setSetup, clock } from '../js/watchflow.js';

const SETUP = { v: 1, unit: 'kg', rest: 90, ex: [
  { id: 'bench', n: 'Bench press', t: 'w', s: [[80, 8], [80, 7], [75, 8]], b: 110 },
  { id: 'squat', n: 'Squat', t: 'w', s: [[100, 5]], b: 120 },
  { id: 'pull', n: 'Pull-ups', t: 'bw', s: [[0, 10]], b: 12 },
  { id: 'curl', n: 'Biceps curls', t: 'w' } ] };
let n = 0; const mk = (o = {}) => newFlow(structuredClone(SETUP), { id: () => 'sess' + (++n), ...o });
const go = (F, evs, t = 1000) => { for (const e of evs) Array.isArray(e) ? handle(F, e[0], t, e[1]) : handle(F, e, t); return F; };

test('start -> picker -> set screen, prefilled from last session', () => {
  const F = mk(); assert.equal(F.scr, SCR.START);
  go(F, ['start']); assert.equal(F.scr, SCR.PICK); assert.equal(F.start, 1000);
  go(F, ['start']); assert.equal(F.scr, SCR.SET); assert.equal(curEx(F).id, 'bench');
  assert.deepEqual([F.kg, F.reps, F.focus, setNo(F)], [80, 8, 0, 1]);
});
test('picker wraps with UP / DOWN and swipes, START or a tap selects', () => {
  const F = go(mk(), ['start', 'up']); assert.equal(F.sel, 3);
  go(F, ['down', 'swipeUp']); assert.equal(F.sel, 1);
  go(F, [['item', 2]]); assert.equal(curEx(F).id, 'pull'); assert.equal(F.focus, 1, 'bodyweight starts on reps'); assert.deepEqual([F.kg, F.reps], [0, 10]);
  const G = go(mk(), ['start', 'down', 'down', 'down', 'start']); assert.equal(curEx(G).id, 'curl'); assert.deepEqual([G.kg, G.reps], [20, 8], 'never done: start values');
});
test('value stepping: 2.5 kg, 10 kg held, reps ±1 / ±5, limits', () => {
  const F = go(mk(), ['start', 'start']);
  go(F, ['up']); assert.equal(F.kg, 82.5); go(F, ['upHold', 'upHold']); assert.equal(F.kg, 102.5); go(F, ['down', 'down']); assert.equal(F.kg, 97.5);
  go(F, ['back']); assert.equal(F.focus, 1, 'BACK switches to reps'); go(F, ['up', 'up']); assert.equal(F.reps, 10); go(F, ['downHold']); assert.equal(F.reps, 5);
  go(F, [['focus', 0], 'swipeDown']); assert.equal(F.kg, 95, 'swipe down counts down');
  for (let i = 0; i < 20; i++) handle(F, 'downHold', 1000); assert.equal(F.kg, 0);
  go(F, [['focus', 1]]); for (let i = 0; i < 30; i++) handle(F, 'upHold', 1000); assert.equal(F.reps, 100);
  for (let i = 0; i < 300; i++) handle(F, 'upHold', 1000); go(F, [['focus', 0]]); for (let i = 0; i < 60; i++) handle(F, 'upHold', 1000); assert.equal(F.kg, 500);
});
test('set done -> rest with the rest setting, auto return with a vibration, next set prefilled from the last set', () => {
  const F = go(mk(), ['start', 'start', 'up']); F.cues = [];
  handle(F, 'start', 1010); assert.equal(F.scr, SCR.REST); assert.deepEqual(F.sets, [{ ex: 'bench', kg: 82.5, reps: 8, t: 10 }]); assert.deepEqual(F.cues, ['set']);
  assert.equal(restLeft(F, 1010), 90); assert.equal(restLeft(F, 1050.2), 50);
  handle(F, 'tick', 1099); assert.equal(F.scr, SCR.REST);
  handle(F, 'tick', 1100); assert.equal(F.scr, SCR.SET); assert.deepEqual(F.cues, ['set', 'rest']); assert.equal(setNo(F), 2); assert.deepEqual([F.kg, F.reps], [82.5, 8]);
});
test('rest: START skips without a cue, UP / DOWN ±15 s, BACK goes to the picker', () => {
  const F = go(mk(), ['start', 'start', 'start']); F.cues = [];
  go(F, ['up'], 1000); assert.equal(restLeft(F, 1000), 105); go(F, ['down', 'down'], 1000); assert.equal(restLeft(F, 1000), 75);
  go(F, ['start'], 1001); assert.equal(F.scr, SCR.SET); assert.deepEqual(F.cues, []);
  go(F, ['start', 'back']); assert.equal(F.scr, SCR.PICK); assert.equal(F.sel, 0);
  go(F, ['back']); assert.equal(F.scr, SCR.SET, 'BACK from the picker with sets returns to the set');
});
test('zero reps is not a set', () => { const F = go(mk(), ['start', 'start', 'back', 'downHold', 'downHold']); F.cues = []; go(F, ['start']); assert.equal(F.scr, SCR.SET); assert.equal(F.sets.length, 0); assert.deepEqual(F.cues, ['error']); });
test('record: flashes when a set beats the stored best and the session so far, once per new high', () => {
  const F = go(mk(), ['start', 'start']); // bench best e1RM 110
  F.kg = 100; F.reps = 3; go(F, ['start']); assert.equal(F.flash, null, '110 is not more than 110'); assert.ok(!F.sets[0].pr);
  go(F, ['start']); F.kg = 100; F.reps = 5; F.cues = []; handle(F, 'start', 1000); assert.equal(F.flash.k, 'pr'); assert.ok(F.sets[1].pr); assert.deepEqual(F.cues, ['pr']); // 116.7
  handle(F, 'start', 1001); assert.equal(F.flash, null, 'first key clears the flash'); assert.equal(F.scr, SCR.REST);
  handle(F, 'tick', 1004); go(F, ['start'], 1005); F.kg = 100; F.reps = 5; handle(F, 'start', 1006); assert.equal(F.flash, null, 'same again: no flash');
  handle(F, 'tick', 1009.5); assert.equal(F.flash, null);
  const G = go(mk(), ['start', 'down', 'down', 'down', 'start']); G.kg = 200; G.reps = 1; go(G, ['start']); assert.equal(G.flash, null, 'no stored best: no record');
  const H = go(mk(), ['start', ['item', 2]]); H.reps = 13; go(H, ['start']); assert.equal(H.flash.k, 'pr', 'bodyweight: more reps');
  const K = go(mk(), ['start', 'start']); K.kg = 110; K.reps = 1; handle(K, 'start', 1000); handle(K, 'tick', 1003); assert.equal(K.flash, null, 'equal is no record');
});
test('menu on BACK hold or swipe left: change exercise, undo, finish', () => {
  const F = go(mk(), ['start', 'start', 'start', 'start', 'start']); // two bench sets, resting
  assert.equal(F.sets.length, 2); go(F, ['menu']); assert.equal(F.scr, SCR.MENU); assert.deepEqual(F.menu, [MENU.EX, MENU.UNDO, MENU.FIN]);
  go(F, ['back']); assert.equal(F.scr, SCR.REST, 'BACK closes the menu'); go(F, ['swipeLeft', 'down', 'start']); // undo
  assert.equal(F.sets.length, 1); assert.equal(F.scr, SCR.SET); assert.deepEqual([F.kg, F.reps], [80, 8]); assert.equal(setNo(F), 2);
  go(F, ['menu', 'start']); assert.equal(F.scr, SCR.PICK); go(F, ['down', 'start']); assert.equal(curEx(F).id, 'squat'); assert.deepEqual([F.kg, F.reps], [100, 5]);
  const G = go(mk(), ['start', 'start', 'menu']); assert.deepEqual(G.menu, [MENU.EX, MENU.FIN], 'no undo without sets');
  go(G, ['down', 'start']); assert.equal(G.scr, SCR.START, 'finish without sets saves nothing'); assert.equal(G.queue.length, 0);
  const S = go(mk(), ['menu']); assert.deepEqual(S.menu, [MENU.SYNC, MENU.PAIR]); go(S, ['start']); assert.deepEqual(S.out.map(o => o.k), ['setup', 'send']); assert.equal(S.scr, SCR.START);
});
test('undo of a set of another exercise goes back to that exercise', () => {
  const F = go(mk(), ['start', 'start', 'start', 'back', 'down', 'start']); assert.equal(curEx(F).id, 'squat');
  go(F, ['menu', 'down', 'start']); assert.equal(curEx(F).id, 'bench'); assert.equal(F.sets.length, 0);
});
test('finish: session into the queue with seconds, summary, heart rate; send ok -> saved', () => {
  const F = mk(); handle(F, 'start', 1000); handle(F, 'hr', 1000, 95); handle(F, 'start', 1001); handle(F, 'start', 1060); handle(F, 'hr', 1070, 140);
  handle(F, 'start', 1100); handle(F, 'down', 1100); handle(F, 'start', 1120); handle(F, 'menu', 1200); handle(F, 'down', 1200); handle(F, 'down', 1200); handle(F, 'start', 1300);
  assert.equal(F.scr, SCR.SUM); assert.equal(F.queue.length, 1);
  const q = F.queue[0]; assert.deepEqual(q, { id: q.id, start: 1000, duration: 300, sets: [{ ex: 'bench', kg: 80, reps: 8, t: 60 }, { ex: 'bench', kg: 77.5, reps: 8, t: 120 }], hr: { avg: 118, max: 140 } });
  assert.deepEqual({ ...F.sum, id: 0 }, { id: 0, dur: 300, sets: 2, vol: 1260, exs: 1, prs: 0, st: 'sending' });
  assert.deepEqual(F.out.at(-1), { k: 'send' }); assert.ok(F.cues.includes('done'));
  sent(F, q.id, 'ok'); assert.equal(F.sum.st, 'saved'); assert.equal(F.queue.length, 0);
  handle(F, 'start', 1301); assert.equal(F.scr, SCR.START); assert.equal(F.sets.length, 0);
});
test('queue: no phone -> queued and kept, retried later, refused -> dropped', () => {
  const F = go(mk(), ['start', 'start', 'start', 'menu', 'down', 'down', 'start']); const id = F.queue[0].id;
  sent(F, id, 'retry'); assert.equal(F.sum.st, 'queued'); assert.equal(F.queue.length, 1);
  go(F, ['start', 'start', 'start', 'start', 'menu', 'down', 'down', 'start']); assert.equal(F.queue.length, 2, 'second session queues behind');
  sent(F, id, 'ok'); assert.deepEqual(F.queue.map(s => s.id), [F.sum.id]); sent(F, F.sum.id, 'drop'); assert.equal(F.queue.length, 0); assert.equal(F.sum.st, 'failed');
  const G = newFlow(SETUP, { queue: [{ id: 'old1' }] }); assert.equal(G.queue.length, 1, 'a stored queue survives a restart');
});
test('pairing: 6 digits with UP / DOWN / START, BACK one digit back, wrong code -> retry, ok -> start + setup', () => {
  const F = newFlow(null, { paired: false }); assert.equal(F.scr, SCR.PAIR);
  go(F, ['up', 'up', 'start', 'down', 'start', 'start', 'back', 'up', 'start', 'start', 'start', 'up']);
  assert.deepEqual(F.pair.d, [2, 9, 1, 0, 0, 1]); assert.equal(F.pair.i, 5);
  go(F, [['focus', 0], 'up', ['focus', 5], 'start']); assert.equal(F.pair.st, 'sending'); assert.deepEqual(F.out.at(-1), { k: 'pair', code: '391001' });
  go(F, ['up']); assert.equal(F.pair.d[5], 1, 'no input while sending');
  paired(F, false); assert.equal(F.pair.st, 'fail'); go(F, ['up']); assert.equal(F.pair.st, 'enter'); assert.equal(F.pair.d[5], 2);
  go(F, ['start']); paired(F, true, SETUP); assert.equal(F.scr, SCR.START); assert.ok(F.paired); assert.deepEqual(F.out.slice(-2).map(o => o.k), ['setup', 'send']);
  const G = newFlow(null, { paired: false }); go(G, ['back']); assert.deepEqual(G.out, [{ k: 'exit' }]);
  const H = mk(); go(H, ['start']); assert.equal(H.scr, SCR.PICK); const E = newFlow({ ex: [] }); go(E, ['start']); assert.equal(E.scr, SCR.START, 'empty setup: ask for it'); assert.deepEqual(E.out, [{ k: 'setup' }]);
});
test('glance opens the app; new setup keeps the current exercise; clock', () => {
  const F = mk(); F.scr = SCR.GLANCE; go(F, ['tap']); assert.equal(F.scr, SCR.START);
  go(F, ['start', 'down', 'start']); setSetup(F, { ex: [SETUP.ex[1], SETUP.ex[0]], rest: 60 }); assert.equal(curEx(F).id, 'squat'); assert.equal(F.cur, 0);
  assert.equal(clock(65), '1:05'); assert.equal(clock(3725), '1:02:05');
});
