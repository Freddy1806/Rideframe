// The watch's state machine (js/watchflow.js, mirrored by garmin/source/Flow.mc): transitions, value stepping, undo,
// prefill, record detection, queue and retry. Usage: node --test tools/watchflow-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { newFlow, handle, SCR, MENU, curEx, setNo, restLeft, sent, paired, setSetup, clock, homeItems, HOME_FIT, HOME_LAY, homeTop, listItems, recPages, routeInfo, setRoute, setRoutes, routeFace, routeNav, setConfig, order, planItem, LAP_M, HOLD_S, holdPart, pausedTime } from '../js/watchflow.js';
import { FIELDS, defaults, validate, compact, fieldText, zoneOf, MORE, TOP } from '../js/watchfields.js';

const SETUP = { v: 1, unit: 'kg', rest: 90, ex: [
  { id: 'bench', n: 'Bench press', t: 'w', s: [[80, 8], [80, 7], [75, 8]], b: 110 },
  { id: 'squat', n: 'Squat', t: 'w', s: [[100, 5]], b: 120 },
  { id: 'pull', n: 'Pull-ups', t: 'bw', s: [[0, 10]], b: 12 },
  { id: 'curl', n: 'Biceps curls', t: 'w' } ] };
let n = 0; const mk = (o = {}) => newFlow(structuredClone(SETUP), { id: () => 'sess' + (++n), scr: SCR.START, ...o }); // on the strength screen (HOME -> Strength)
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
  assert.equal(F.sets.length, 2); go(F, ['menu']); assert.equal(F.scr, SCR.MENU); assert.deepEqual(F.menu, [MENU.EX, MENU.UNDO, MENU.FIN, MENU.PAUSE]);
  go(F, ['back']); assert.equal(F.scr, SCR.REST, 'BACK closes the menu'); go(F, ['swipeLeft', 'down', 'start']); // undo
  assert.equal(F.sets.length, 1); assert.equal(F.scr, SCR.SET); assert.deepEqual([F.kg, F.reps], [80, 8]); assert.equal(setNo(F), 2);
  go(F, ['menu', 'start']); assert.equal(F.scr, SCR.PICK); go(F, ['down', 'start']); assert.equal(curEx(F).id, 'squat'); assert.deepEqual([F.kg, F.reps], [100, 5]);
  const G = go(mk(), ['start', 'start', 'menu']); assert.deepEqual(G.menu, [MENU.EX, MENU.FIN, MENU.PAUSE], 'no undo without sets');
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
  go(F, ['start']); paired(F, true, SETUP); assert.equal(F.scr, SCR.HOME, 'paired: the start menu'); assert.ok(F.paired); assert.deepEqual(F.out.slice(-2).map(o => o.k), ['setup', 'send']);
  const G = newFlow(null, { paired: false }); go(G, ['back']); assert.deepEqual(G.out, [{ k: 'exit' }]);
  const H = mk(); go(H, ['start']); assert.equal(H.scr, SCR.PICK); const E = newFlow({ ex: [] }, { scr: SCR.START }); go(E, ['start']); assert.equal(E.scr, SCR.START, 'empty setup: ask for it'); assert.deepEqual(E.out, [{ k: 'setup' }]);
});
test('glance opens the app; new setup keeps the current exercise; clock', () => {
  const F = mk(); F.scr = SCR.GLANCE; go(F, ['tap']); assert.equal(F.scr, SCR.HOME); F.scr = SCR.START;
  go(F, ['start', 'down', 'start']); setSetup(F, { ex: [SETUP.ex[1], SETUP.ex[0]], rest: 60 }); assert.equal(curEx(F).id, 'squat'); assert.equal(F.cur, 0);
  assert.equal(clock(65), '1:05'); assert.equal(clock(3725), '1:02:05');
});

/* ---- 18.11.: start menu, run / ride / other recording, route page, segment popup, workouts ---- */
const CFG = () => compact({ ...defaults(), more: ['Basketball', 'Yoga'], workouts: [{ id: 'w1', name: 'Push day', items: [{ ex: 'bench', sets: 2, reps: 6, kg: 85, rest: 120 }, { ex: 'curl', sets: 1, reps: 12, kg: 0, rest: 45 }, { ex: 'plank', sets: 1, reps: 60, kg: 0, rest: 0 }] }] });
const fl = (o = {}) => newFlow({ ...structuredClone(SETUP), ex: [...structuredClone(SETUP.ex), { id: 'plank', n: 'Plank', t: 'time' }], top: ['squat', 'curl'], recent: ['pull'] }, { id: () => 'x' + (++n), cfg: CFG(), ...o });
const move = (F, secs, v, x = {}, t0 = 2000) => { for (let i = 0; i < secs; i++) handle(F, 'sample', t0 + i, { v, hr: 150, cad: 170, pw: 240, up: .1, ...x }); return F; };
test('start menu layout: all four rows at once, 64 px touch rows on 416 px, nothing outside the round screen', () => {
  assert.equal(HOME_FIT, 4); for (let sel = 0; sel < 4; sel++) assert.equal(homeTop(sel, 4), 0, 'four entries never scroll');
  assert.equal(homeTop(5, 7), 2, 'a longer list keeps the selection on the last row'); assert.equal(homeTop(6, 7), 3);
  const L = HOME_LAY, r = L.h / 2, half = L.w / 2 - r; assert.ok(L.dy * 416 >= 64, `row step ${L.dy * 416} px`); assert.ok(L.h * 280 >= 32);
  for (let i = 0; i < HOME_FIT; i++) { const y = L.y0 + i * L.dy - .5; // the pill: a rect with half-circle ends; its farthest point from the centre
    assert.ok(Math.hypot(half, Math.abs(y)) + r <= .5 - .02, `row ${i} pill inside the circle`);
    const yt = Math.abs(y) + r, hw = Math.sqrt(.25 - yt * yt); assert.ok(.25 - .045 >= .5 - hw && .33 + .45 <= .5 + hw, `row ${i}: icon and text inside the circle at the pill edge`); }
  assert.ok(L.y0 - L.dy / 2 > L.logo + .02 && L.y0 + (HOME_FIT - .5) * L.dy < L.pts - .02, 'logo and week points clear of the rows');
  const hp = Math.sqrt(.25 - (L.pts - .5 + .03) ** 2); assert.ok(hp * 2 > .5, 'the points line has room at its y');
});
test('start menu: run, ride, strength, more with the last used on top; BACK leaves the app', () => {
  const F = fl(); assert.equal(F.scr, SCR.HOME); assert.deepEqual(listItems(F), ['Run', 'Ride', 'Strength', 'More']);
  const G = fl({ last: 'kraft' }); assert.deepEqual(homeItems(G), ['kraft', 'run', 'ride', 'more']); go(G, ['start']); assert.equal(G.scr, SCR.START, 'Strength: its ready screen');
  go(G, ['back']); assert.equal(G.scr, SCR.HOME); go(G, ['up']); assert.equal(G.sel, 3, 'wraps'); go(G, ['swipeDown', 'down', 'down']); assert.equal(G.sel, 0);
  go(G, ['back']); assert.deepEqual(G.out.at(-1), { k: 'exit' });
  go(F, [['item', 3]]); assert.equal(F.scr, SCR.MORE); assert.deepEqual(listItems(F), ['Basketball', 'Yoga']); go(F, ['back']); assert.equal(F.scr, SCR.HOME);
  go(F, ['menu']); assert.equal(F.scr, SCR.MENU); assert.deepEqual(F.menu, [MENU.SYNC, MENU.PAIR]); go(F, ['back']); assert.equal(F.scr, SCR.HOME);
});
test('run: ready, data pages from the config, values tick, UP / DOWN switch pages, auto lap banner', () => {
  const F = fl(); go(F, ['start']); assert.equal(F.scr, SCR.READY); assert.equal(F.sp, 'run');
  go(F, ['back']); assert.equal(F.scr, SCR.HOME); go(F, ['start']); handle(F, 'start', 2000); assert.equal(F.scr, SCR.REC); assert.deepEqual(F.cues, ['start']); assert.equal(F.last, 'run');
  assert.deepEqual(recPages(F), [['pace', 'dist', 'time', 'hr'], ['lapPace', 'lapDist', 'cadence', 'hrZone']], 'no route loaded: no route page');
  move(F, 300, 3.125); const R = F.rec; assert.equal(R.t, 300); assert.equal(R.d, 937.5);
  assert.deepEqual(['pace', 'dist', 'time', 'hr', 'avgPace', 'hrZone', 'cadence', 'climb'].map(k => fieldText(k, R, 0)), ['5:20', '0.94', '5:00', '150', '5:20', 'Z3', '170', '30']);
  F.cues = []; move(F, 20, 3.125, {}, 2300); assert.equal(F.rec.laps.length, 1, 'auto lap at 1 km'); assert.equal(F.flash.k, 'lap'); assert.equal(F.flash.n, 1); assert.deepEqual(F.cues, ['lap']);
  assert.equal(fieldText('lapDist', F.rec, 0), '0.00', 'lap distance starts again'); assert.equal(fieldText('lapTime', F.rec, 0), '0:00');
  handle(F, 'tick', 2319 + 5); assert.equal(F.flash, null, 'the banner goes after 5 s');
  go(F, ['down']); assert.equal(F.rec.pg, 1); go(F, ['down']); assert.equal(F.rec.pg, 0, 'wraps'); go(F, ['swipeUp']); assert.equal(F.rec.pg, 1, 'swipe up = next page');
  go(F, ['back']); assert.equal(F.rec.laps.length, 2, 'BACK = manual lap'); assert.ok(F.flash);
});
test('pause, resume, save by holding BACK, discard; auto pause stops the clock on the bike', () => {
  const F = fl(); go(F, ['start', 'start']); move(F, 60, 3); F.cues = [];
  go(F, ['start']); assert.equal(F.scr, SCR.PAUSE); assert.equal(F.rec.st, 'pause'); assert.deepEqual(F.cues, ['stop']); assert.equal(pausedTime(F), 60);
  move(F, 30, 3); assert.equal(F.rec.t, 60, 'paused: nothing counts'); go(F, ['back']); assert.equal(F.scr, SCR.PAUSE, 'a short BACK resumes nothing, exits nothing'); assert.ok(F.pz.hint > 1000, 'it shows the hint');
  go(F, ['start']); assert.equal(F.scr, SCR.REC, 'START resumes'); assert.equal(F.rec.st, 'run');
  go(F, ['start']); handle(F, 'holdStart', 3000); handle(F, 'tick', 3001.5); assert.equal(F.scr, SCR.PAUSE); assert.deepEqual(holdPart(F, 3001.5), { p: .5, n: 2 }, 'half full, count 2');
  handle(F, 'tick', 3000 + HOLD_S); assert.equal(F.scr, SCR.RSUM, 'held 3 s: saved'); assert.equal(F.rsum.t, 60); assert.equal(Math.round(F.rsum.d), 180); assert.equal(F.out.at(-1).k, 'saveAct'); assert.equal(F.rec, null); assert.equal(F.cues.at(-1), 'done');
  handle(F, 'holdEnd', 3003.2); assert.equal(F.scr, SCR.RSUM, 'the release after the save changes nothing');
  go(F, ['start']); assert.equal(F.scr, SCR.HOME);
  const G = fl({ last: 'ride' }); go(G, ['start', 'start']); assert.equal(G.sp, 'ride'); assert.deepEqual(recPages(G)[0], ['power3s', 'speed', 'hr', 'time']);
  move(G, 40, 9); move(G, 20, .3, {}, 2040); assert.equal(G.rec.t, 40, 'auto pause below 0.7 m/s'); assert.ok(G.rec.auto); assert.equal(G.scr, SCR.REC, 'auto pause is not the pause screen'); move(G, 1, 9, {}, 2060); assert.equal(G.rec.t, 41);
  assert.equal(fieldText('speed', G.rec, 0), '32.4'); assert.equal(fieldText('power3s', G.rec, 0), '240'); assert.equal(fieldText('np', G.rec, 0), '240'); assert.equal(fieldText('avgPower', G.rec, 0), '240');
  go(G, ['start', 'down', 'start']); assert.equal(G.scr, SCR.PAUSE, 'Discard asks first'); assert.ok(G.pz.conf); go(G, ['back']); assert.ok(!G.pz.conf, 'BACK: no'); assert.ok(G.rec);
  go(G, ['start']); assert.ok(G.pz.conf, 'Discard still selected: START asks again'); go(G, ['start']); assert.equal(G.scr, SCR.HOME, 'START: yes, discarded'); assert.equal(G.rec, null); assert.ok(!G.out.some(o => o.k === 'saveAct'));
});
/** the four recording modes on the watch, each brought to its recording state; returns [flow, what resumes] */
const MODES4 = {
  run: () => { const F = fl(); go(F, ['start', 'start']); move(F, 30, 3); return [F, SCR.REC]; },
  ride: () => { const F = fl({ last: 'ride' }); go(F, ['start', 'start']); move(F, 30, 9); return [F, SCR.REC]; },
  more: () => { const F = fl({ last: 'more' }); go(F, ['start', 'start', 'start']); assert.equal(F.sp, 'other'); move(F, 30, 0); return [F, SCR.REC]; },
  strength: () => { const F = fl({ last: 'kraft' }); go(F, ['start', 'start', 'down', 'start', 'start']); assert.equal(F.scr, SCR.SET); go(F, ['start']); assert.equal(F.scr, SCR.REST); return [F, SCR.REST]; },
  workout: () => { const F = fl({ last: 'kraft' }); go(F, ['start', 'start', 'start', 'start']); assert.ok(F.plan); go(F, ['start']); assert.equal(F.scr, SCR.REST); return [F, SCR.REST]; },
};
const doPause = (F, t = 1000) => { if (F.rec) handle(F, 'start', t); else { handle(F, 'menu', t); handle(F, 'item', t, F.menu.indexOf(MENU.PAUSE)); } };
for (const [k, mk4] of Object.entries(MODES4)) test(`pause in every mode (${k}): resume, early release, hold to finish, discard with confirm`, () => {
  let [F, back] = mk4(); const strength = !F.rec;
  doPause(F, 1000); assert.equal(F.scr, SCR.PAUSE); assert.equal(F.cues.at(-1), 'stop');
  if (strength) { const left = F.restEnd - 1000; handle(F, 'tick', 1000 + 500); assert.equal(F.scr, SCR.PAUSE, 'the rest does not run out while paused');
    handle(F, 'start', 1500); assert.equal(F.scr, back, 'resumed where it was'); assert.equal(F.restEnd - 1500, left, 'the rest goes on from where it stopped'); assert.equal(F.pauseT, 500, 'the session clock stopped'); }
  else { move(F, 20, 3, {}, 1100); const t = F.rec.t; handle(F, 'start', 1200); assert.equal(F.scr, back); assert.equal(F.rec.t, t, 'nothing counted while paused'); }
  doPause(F, 2000); handle(F, 'holdStart', 2000); handle(F, 'tick', 2002); assert.equal(holdPart(F, 2002).n, 1); handle(F, 'holdEnd', 2002.5);
  assert.equal(F.scr, SCR.PAUSE, 'released early: nothing'); assert.equal(holdPart(F, 2003), null, 'the ring is empty again'); assert.ok(F.pz.hint > 2002.5, 'the hint shows');
  handle(F, 'tick', 2010); assert.equal(F.scr, SCR.PAUSE, 'no late finish after the release');
  handle(F, 'down', 2010); handle(F, 'start', 2010); assert.ok(F.pz.conf, 'Discard: confirm'); handle(F, 'holdStart', 2010); handle(F, 'tick', 2014); assert.equal(F.scr, SCR.PAUSE, 'no finish while the confirm shows');
  handle(F, 'back', 2014); handle(F, 'up', 2014); assert.equal(F.pz.sel, 0);
  handle(F, 'holdStart', 2020); handle(F, 'tick', 2020 + HOLD_S);
  if (strength) { assert.equal(F.scr, SCR.SUM, 'held 3 s: the session is saved'); assert.equal(F.queue.length, 1); assert.equal(F.queue[0].duration, 500, 'its time without the pauses (1000 to 2000, 500 s of it paused)'); }
  else { assert.equal(F.scr, SCR.RSUM, 'held 3 s: saved'); assert.equal(F.out.at(-1).k, 'saveAct'); }
  [F] = mk4(); doPause(F, 3000); handle(F, 'item', 3000, 1); assert.ok(F.pz.conf, 'a tap on Discard asks'); handle(F, 'start', 3000);
  assert.equal(F.scr, strength ? SCR.START : SCR.HOME, 'discarded'); assert.equal(F.rec, null); assert.equal(F.queue.length, 0); assert.ok(!F.out.some(o => o.k === 'saveAct'));
});
test('route page: only with a route and the switch on; position, distance left, next turn', () => {
  const F = fl(); go(F, ['start', 'start']); assert.equal(routeInfo(F), null);
  setRoute(F, { name: 'Loop', len: 5000, pts: [[0, 0], [1, 1]], turns: [{ at: 800, dir: 'L', txt: 'Main St' }, { at: 2600, dir: 'R' }] });
  assert.equal(recPages(F).length, 3); assert.equal(recPages(F)[2], 'route'); move(F, 250, 3.2);
  const ri = routeInfo(F); assert.ok(Math.abs(ri.pos - .16) < 1e-9 && Math.abs(ri.left - 4200) < 1e-6 && ri.turn.dir === 'R' && Math.abs(ri.turn.in - 1800) < 1e-6, JSON.stringify(ri));
  move(F, 200, 3.2, {}, 2250); move(F, 2000, 3.2, {}, 2450); assert.equal(routeInfo(F).turn, null); assert.equal(routeInfo(F).pos, 1); assert.equal(routeInfo(F).left, 0);
  const G = fl(); setConfig(G, compact({ ...defaults(), sports: { ...defaults().sports, run: { ...defaults().sports.run, map: false } } })); setRoute(G, F.route); go(G, ['start', 'start']); assert.equal(recPages(G).length, 2, 'switched off');
});
test('segment popup: warning, live delta, result for 5 s; BACK closes it first; switched off = nothing', () => {
  const F = fl({ last: 'ride' }); go(F, ['start', 'start']); F.cues = [];
  handle(F, 'seg', 3000, { k: 'warn', name: 'Col climb', len: 2400, eta: 30 }); assert.equal(F.seg.k, 'warn'); assert.deepEqual(F.cues, ['seg']);
  handle(F, 'seg', 3005, { k: 'warn', name: 'Col climb', len: 2400, eta: 25 }); assert.equal(F.seg.eta, 25); assert.deepEqual(F.cues, ['seg'], 'one cue per stage');
  handle(F, 'seg', 3030, { k: 'live', name: 'Col climb', len: 2400, done: 300, delta: -4, need: 10.6 }); assert.equal(F.seg.k, 'live'); assert.equal(F.cues.length, 2);
  go(F, ['back']); assert.ok(F.seg.hide); assert.equal(F.rec.laps.length, 0, 'BACK closed the popup, no lap');
  handle(F, 'seg', 3031, { k: 'live', name: 'Col climb', len: 2400, done: 310, delta: -3, need: 10.6 }); assert.ok(F.seg.hide, 'stays closed while live');
  handle(F, 'seg', 3200, { k: 'end', name: 'Col climb', len: 2400, time: 241, delta: -5, pr: true }); assert.ok(!F.seg.hide); assert.equal(F.cues.at(-1), 'pr');
  handle(F, 'tick', 3204); assert.ok(F.seg); handle(F, 'tick', 3205); assert.equal(F.seg, null, 'result for 5 s');
  const G = fl(); setConfig(G, compact({ ...defaults(), sports: { ...defaults().sports, run: { ...defaults().sports.run, segWarn: false, vibrate: false } } })); go(G, ['start', 'start']);
  handle(G, 'seg', 3000, { k: 'warn', name: 'x', len: 1, eta: 30 }); assert.equal(G.seg, null); assert.deepEqual(G.cues, [], 'vibration off: no cues while recording');
  const H = fl(); handle(H, 'seg', 3000, { k: 'warn', name: 'x', len: 1, eta: 30 }); assert.equal(H.seg, null, 'not recording: nothing');
});
test('more: the sports from the phone, one fixed page, no route', () => {
  const F = fl(); setRoute(F, { len: 1000, pts: [[0, 0], [1, 1]] }); go(F, [['item', 3], 'down', 'start']); assert.equal(F.scr, SCR.READY); assert.deepEqual([F.sp, F.type], ['other', 'Yoga']);
  go(F, ['back']); assert.equal(F.scr, SCR.MORE); go(F, ['start', 'start']); assert.equal(F.scr, SCR.REC); assert.deepEqual(recPages(F), [['hr', 'time', 'clock', 'kcal']]);
  move(F, 600, 0); assert.equal(F.rec.t, 600, 'no auto pause for other sports'); assert.equal(fieldText('time', F.rec, 0), '10:00'); assert.ok(F.rec.kcal > 50);
  assert.equal(F.last, 'more'); go(F, ['start', 'down', 'start', 'start']); assert.deepEqual(homeItems(F)[0], 'more');
  const E = newFlow(null, { cfg: { ...CFG(), more: [] } }); go(E, [['item', 3]]); assert.equal(E.scr, SCR.MORE); go(E, ['start']); assert.equal(E.scr, SCR.MORE, 'empty list: nothing to start'); go(E, ['back']); assert.equal(E.scr, SCR.HOME);
});
test('strength: workout or free; free = recent, then top 20, then the rest', () => {
  const F = fl({ last: 'kraft' }); go(F, ['start', 'start']); assert.equal(F.scr, SCR.SMODE); assert.deepEqual(listItems(F), ['Workout', 'Free']);
  go(F, ['down', 'start']); assert.equal(F.scr, SCR.PICK); assert.deepEqual(listItems(F), ['Pull-ups', 'Squat', 'Biceps curls', 'Bench press', 'Plank']);
  go(F, ['start']); assert.equal(curEx(F).id, 'pull'); go(F, ['start', 'back']); assert.equal(F.scr, SCR.PICK); assert.equal(F.sel, 0, 'the picker opens on the current exercise');
  const G = mk(); go(G, ['start']); assert.equal(G.scr, SCR.PICK, 'no workouts: straight to the picker');
  assert.deepEqual(order({ ex: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], top: ['c', 'zz'], recent: ['b'] }), [1, 2, 0]);
  const S = fl({ last: 'kraft' }); go(S, ['start', 'start', 'back']); assert.equal(S.scr, SCR.START, 'BACK without sets: the strength screen');
});
test('workout: guided set by set with its kg, reps and rest, next exercise, timed plank, done at the end', () => {
  const F = fl({ last: 'kraft' }); go(F, ['start', 'start', 'start']); assert.equal(F.scr, SCR.WPICK); assert.deepEqual(listItems(F), ['Push day']);
  handle(F, 'start', 5000); assert.equal(F.scr, SCR.SET); assert.equal(curEx(F).id, 'bench'); assert.deepEqual([F.kg, F.reps, setNo(F)], [85, 6, 1]); assert.equal(F.start, 1000, 'the session started on the strength screen');
  handle(F, 'start', 5060); assert.equal(F.scr, SCR.REST); assert.equal(F.restLen, 120, 'rest from the workout'); assert.deepEqual(F.plan, { w: 0, i: 0, n: 1 });
  handle(F, 'tick', 5180); assert.equal(F.scr, SCR.SET); assert.deepEqual([curEx(F).id, F.kg, F.reps, setNo(F)], ['bench', 85, 6, 2]);
  go(F, ['down']); handle(F, 'start', 5200); assert.equal(F.sets.at(-1).kg, 82.5); handle(F, 'start', 5201); assert.equal(curEx(F).id, 'curl', 'next exercise after its sets');
  assert.deepEqual([F.kg, F.reps, setNo(F)], [20, 12, 1], 'no kg in the plan: from history, else a start value'); assert.deepEqual(planItem(F), ['curl', 1, 12, 0, 45]);
  go(F, ['menu']); assert.deepEqual(F.menu, [MENU.EX, MENU.SKIP, MENU.UNDO, MENU.FIN, MENU.PAUSE]); go(F, ['down', 'down', 'start']); assert.equal(curEx(F).id, 'bench', 'undo goes back into the plan');
  assert.deepEqual([setNo(F), F.kg], [2, 82.5]); handle(F, 'start', 5300); handle(F, 'start', 5301);
  handle(F, 'start', 5350); assert.equal(F.restLen, 45); handle(F, 'start', 5351);
  assert.equal(curEx(F).id, 'plank'); assert.equal(curEx(F).t, 'time'); assert.equal(F.focus, 1); assert.equal(F.reps, 60); go(F, ['up']); assert.equal(F.reps, 65, 'seconds in 5 s steps');
  handle(F, 'start', 5420); assert.equal(F.scr, SCR.SUM, 'the last planned set ends the workout'); assert.equal(F.queue.at(-1).sets.length, 4); assert.deepEqual(F.queue.at(-1).sets.at(-1), { ex: 'plank', kg: 0, reps: 65, t: 4420 });
  const G = fl({ last: 'kraft' }); go(G, ['start', 'start', 'start', 'start', 'menu']); go(G, ['down', 'start']); assert.equal(curEx(G).id, 'curl', 'skip exercise');
  go(G, ['menu', 'start']); assert.equal(G.scr, SCR.PICK); assert.equal(G.plan, null, 'change exercise leaves the workout');
  const H = newFlow({ ex: [{ id: 'bench', n: 'Bench press', t: 'w' }], workouts: [{ id: 'q', n: 'Q', it: [['my_new', 1, 5, 40, 60, 'Thai kick']] }] }, { scr: SCR.START });
  go(H, ['start', 'start', 'start']); assert.equal(curEx(H).id, 'my_new'); assert.equal(curEx(H).n, 'Thai kick', 'unknown exercise: added with its name'); assert.deepEqual([H.kg, H.reps], [40, 5]);
});
test('watchfields: defaults pass the check, compact form, field texts, top 20, more sports', () => {
  assert.deepEqual(validate(defaults()).cfg, defaults()); assert.equal(TOP.length, 20); assert.equal(new Set(TOP.map(e => e.id)).size, 20);
  assert.ok(MORE.includes('Basketball') && MORE.includes('IceSkate') && !MORE.includes('Run') && !MORE.includes('Swim') && !MORE.includes('WeightTraining') && !MORE.includes('VirtualRide'));
  for (const sp of ['run', 'ride', 'other']) for (const p of defaults().sports[sp].pages) assert.ok(p.fields.every(f => FIELDS[sp][f]?.demo));
  const c = compact(defaults()); assert.deepEqual(Object.keys(c), ['v', 'run', 'ride', 'other', 'more', 'w']); assert.deepEqual(c.more[0], ['Walk', 'Walk']);
  assert.deepEqual([zoneOf(100), zoneOf(120), zoneOf(140), zoneOf(160), zoneOf(180), zoneOf(0)], [1, 2, 3, 4, 5, 0]);
  const R = { t: 3725, d: 12345, v: 0, hr: 0, cad: 0, pw: 0, p3: [], pwSum: 0, np4: 0, npN: 0, gain: 0, kcal: 1234.4, lapT0: 3600, lapD0: 12000 };
  assert.deepEqual(['time', 'lapTime', 'pace', 'dist', 'lapPace', 'kcal', 'hr', 'np', 'avgSpeed'].map(k => fieldText(k, R, 0)), ['1:02:05', '2:05', '--:--', '12.35', '6:02', '1,234', '--', '--', '11.9']);
  assert.match(fieldText('clock', R, Date.UTC(2026, 0, 1, 9, 5) / 1000), /^\d{1,2}:05$/);
});

test('route choice (19.11.): READY asks for the list, UP / DOWN opens it, None or a route, the route page follows the watch', () => {
  const F = newFlow(structuredClone(SETUP), { id: () => 'x' }); F.out = [];
  go(F, ['start']); assert.equal(F.scr, SCR.READY); assert.deepEqual(F.out, [{ k: 'routes' }]); F.out = [];
  go(F, ['down']); assert.equal(F.scr, SCR.RPICK); assert.deepEqual(listItems(F), ['None']); assert.deepEqual(F.out, [{ k: 'routes' }], 'still unknown: asked again'); F.out = [];
  setRoutes(F, [{ id: 'a', name: 'Lake', dist: 4200, climb: 30 }, { id: '', name: 'bad' }, { id: 'b', name: 'Hill', dist: 9000 }]);
  assert.deepEqual(listItems(F), ['None', 'Lake', 'Hill']);
  go(F, ['down', 'down', 'start']); assert.equal(F.scr, SCR.READY); assert.equal(F.routeId, 'b'); assert.deepEqual(F.out, [{ k: 'route', id: 'b' }]); F.out = [];
  // the answer of GET /api/watch/route: a 1 km line north, then 1 km east, one right turn
  const p = []; for (let i = 0; i <= 10; i++) p.push([47 + i * .0009, 8]); for (let i = 1; i <= 10; i++) p.push([47.009, 8 + i * .00132]);
  const r = routeFace({ id: 'b', name: 'Hill', dist: 2000, p, turns: [[1000, 'R'], [-5, 'L']] }); setRoute(F, r);
  assert.equal(r.pts.length, 21); assert.ok(r.pts.every(([u, v]) => u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9), 'inside the box');
  assert.deepEqual(r.turns, [{ at: 1000, dir: 'R', txt: 'Turn right' }]); assert.ok(r.pts[0][1] > r.pts[10][1], 'north up');
  go(F, ['up']); assert.equal(F.scr, SCR.RPICK); assert.equal(F.sel, 2, 'the chosen route is selected'); go(F, ['back']); assert.equal(F.scr, SCR.READY);
  go(F, ['start']); assert.equal(F.scr, SCR.REC); assert.ok(recPages(F).includes('route'));
  assert.deepEqual(routeInfo(F), { pos: 0, left: 2000, turn: { dir: 'R', in: 1000, txt: 'Turn right' }, off: 0 });
  routeNav(F, 600, 0); assert.equal(routeInfo(F).turn.in, 400);
  routeNav(F, 600, 87.4); const ri = routeInfo(F); assert.equal(ri.off, 87); assert.equal(ri.turn, null, 'off the route: no turn');
  // None: no route page next time
  const G = newFlow(structuredClone(SETUP), { id: () => 'y' }); go(G, ['start']); setRoutes(G, [{ id: 'a', name: 'Lake' }]); setRoute(G, r); G.routeId = 'a';
  go(G, ['down', 'up', 'start']); assert.equal(G.routeId, null); assert.equal(G.route, null); go(G, ['start']); assert.ok(!recPages(G).includes('route'));
  // other sports have no route choice
  const H = newFlow(structuredClone(SETUP), { id: () => 'z' }); H.scr = SCR.READY; H.sp = 'other'; go(H, ['down']); assert.equal(H.scr, SCR.READY);
});
