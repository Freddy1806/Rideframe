// The watch's state machine (js/watchflow.js, mirrored by garmin/source/Flow.mc): transitions, value stepping, undo,
// prefill, record detection, queue and retry. Usage: node --test tools/watchflow-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { newFlow, handle, SCR, MENU, END_ROWS, LIST_LAY, DRAG_ROW, curEx, setNo, doneOf, tplOf, saveOffer, pickRows, restLeft, sent, paired, setSetup, clock, homeItems, HOME_FIT, HOME_LAY, homeTop, listItems, recPages, routeInfo, setRoute, setRoutes, routeFace, routeNav, setConfig, order, planItem, LAP_M, HOLD_S, holdPart, pausedTime, lastSet, lastParts, lastTxt, keepLast, loading, stepOf, dragRow, DRAG_MENU, SWIPE_ROWS, WHEEL_STEP, STD_W, workouts, savedW, VERSION, healthBody, HEALTH_KEYS, DEMO_HEALTH } from '../js/watchflow.js';
import { readFileSync } from 'node:fs';
import { FIELDS, defaults, validate, compact, fieldText, zoneOf, MORE, TOP } from '../js/watchfields.js';

const SETUP = { v: 1, unit: 'kg', rest: 90, ex: [
  { id: 'bench', n: 'Bench press', t: 'w', s: [[80, 8], [80, 7], [75, 8]], b: 110 },
  { id: 'squat', n: 'Squat', t: 'w', s: [[100, 5]], b: 120 },
  { id: 'pull', n: 'Pull-ups', t: 'bw', s: [[0, 10]], b: 12 },
  { id: 'curl', n: 'Biceps curls', t: 'w' } ] };
let n = 0; const mk = (o = {}) => newFlow(structuredClone(SETUP), { id: () => 'sess' + (++n), scr: SCR.HOME, last: 'kraft', ...o }); // 24.11.: on the start menu, Strength on top (START = Strength)
const go = (F, evs, t = 1000) => { for (const e of evs) Array.isArray(e) ? handle(F, e[0], t, e[1]) : handle(F, e, t); return F; };

test('start -> picker -> set screen, prefilled from last session', () => {
  const F = mk(); assert.equal(F.scr, SCR.HOME);
  go(F, ['start']); assert.equal(F.scr, SCR.SMODE, '23.11.7: Free and the workouts (the standard ones at least)'); assert.equal(F.start, 1000);
  go(F, ['start']); assert.equal(F.scr, SCR.PICK);
  go(F, ['start']); assert.equal(F.scr, SCR.SET); assert.equal(curEx(F).id, 'bench');
  assert.deepEqual([F.kg, F.reps, F.focus, setNo(F)], [80, 8, 0, 1]);
});
test('picker wraps with UP / DOWN and swipes, START or a tap selects', () => {
  const F = go(mk(), ['start', 'start', 'up']); assert.equal(F.sel, 3);
  go(F, ['down', 'swipeUp']); assert.equal(F.sel, 3, '23.11.7: a swipe (no drag events) moves 3 rows, no wrap'); go(F, ['swipeDown']); assert.equal(F.sel, 0);
  go(F, [['item', 2]]); assert.equal(curEx(F).id, 'pull'); assert.equal(F.focus, 1, 'bodyweight starts on reps'); assert.deepEqual([F.kg, F.reps], [0, 10]);
  const G = go(mk(), ['start', 'start', 'down', 'down', 'down', 'start']); assert.equal(curEx(G).id, 'curl'); assert.deepEqual([G.kg, G.reps], [20, 8], 'never done: start values');
});
test('value stepping: 2.5 kg, 10 kg held, reps ±1 / ±5, limits', () => {
  const F = go(mk(), ['start', 'start', 'start']);
  go(F, ['up']); assert.equal(F.kg, 82.5); go(F, ['upHold', 'upHold']); assert.equal(F.kg, 102.5); go(F, ['down', 'down']); assert.equal(F.kg, 97.5);
  go(F, ['start']); assert.equal(F.focus, 1, 'START on the weight: on to the reps'); assert.equal(F.sets.length, 0, 'nothing logged yet');
  go(F, ['up', 'up']); assert.equal(F.reps, 10); go(F, ['downHold']); assert.equal(F.reps, 5);
  go(F, [['focus', 0], 'swipeDown']); assert.equal(F.kg, 95, 'swipe down counts down');
  for (let i = 0; i < 20; i++) handle(F, 'downHold', 1000); assert.equal(F.kg, 0);
  go(F, [['focus', 1]]); for (let i = 0; i < 30; i++) handle(F, 'upHold', 1000); assert.equal(F.reps, 100);
  for (let i = 0; i < 300; i++) handle(F, 'upHold', 1000); go(F, [['focus', 0]]); for (let i = 0; i < 60; i++) handle(F, 'upHold', 1000); assert.equal(F.kg, 500);
});
test('23.11. set screen: touch picks the field, START weight -> reps -> logged, START held switches, DONE logs at once', () => {
  const F = go(mk(), ['start', 'start', 'start']); assert.equal(F.focus, 0);
  go(F, [['focus', 1]]); assert.equal(F.focus, 1, 'tap on the reps'); go(F, [['focus', 0]]); assert.equal(F.focus, 0, 'tap on the weight');
  go(F, ['startHold']); assert.equal(F.focus, 1, 'START held: reps'); go(F, ['startHold']); assert.equal(F.focus, 0, 'and back'); assert.equal(F.scr, SCR.SET);
  go(F, ['start']); assert.equal(F.focus, 1); assert.equal(F.scr, SCR.SET); go(F, ['start']); assert.equal(F.scr, SCR.REST, 'second START logs'); assert.equal(F.sets.length, 1);
  go(F, ['start']); assert.equal(F.focus, 0, 'next set: weight first again');
  go(F, ['done']); assert.equal(F.scr, SCR.REST, 'the DONE pill logs from the weight too'); assert.equal(F.sets.length, 2);
  const B = go(mk(), ['start', 'start', ['item', 2]]); assert.equal(B.focus, 1); go(B, ['start']); assert.equal(B.scr, SCR.REST, 'bodyweight: one START logs');
  const T = newFlow({ ex: [{ id: 'plank', n: 'Plank', t: 'time' }] }, { scr: SCR.HOME, last: 'kraft' }); go(T, ['start', 'start', 'start', 'startHold']); assert.equal(T.focus, 1, 'timed: only seconds');
});
test('23.11. BACK goes back: set -> exercise list -> another exercise; rest -> list; the list with sets asks before anything is lost', () => {
  const F = go(mk(), ['start', 'start', ['item', 2]]); assert.equal(curEx(F).id, 'pull'); go(F, ['done']); assert.equal(F.scr, SCR.REST);
  go(F, ['back']); assert.equal(F.scr, SCR.PICK, 'BACK in the rest: the exercise list'); assert.equal(listItems(F)[F.sel], 'Pull-ups', 'on the exercise just done');
  go(F, [['item', 0]]); assert.equal(curEx(F).id, 'bench', 'Pull-ups -> Bench press'); go(F, ['back']); assert.equal(F.scr, SCR.PICK, 'BACK on a set: the exercise list'); assert.equal(listItems(F)[F.sel], 'Bench press');
  assert.equal(F.sets.length, 1, 'nothing lost on the way'); go(F, ['back']); assert.equal(F.scr, SCR.END, 'BACK on the list with sets: the end question'); assert.deepEqual(listItems(F), ['Keep training', 'Finish & save', 'Discard']);
  go(F, ['back']); assert.equal(F.scr, SCR.PICK, 'BACK = keep training'); go(F, ['back', 'down', 'down', 'start']); assert.equal(F.scr, SCR.END); assert.deepEqual(listItems(F), ['Keep', 'Discard 1 set'], 'Discard asks once more');
  go(F, ['back']); assert.equal(F.scr, SCR.END); assert.ok(!F.endConf); assert.equal(F.sel, 2); go(F, ['start', 'down', 'start']); assert.equal(F.scr, SCR.HOME, 'discarded'); assert.equal(F.queue.length, 0); assert.equal(F.start, 0);
  const G = go(mk(), ['start', 'start', 'start', 'done', 'back', 'back']); go(G, [['item', 1]]); assert.equal(G.scr, SCR.SUM, 'Finish & save'); assert.equal(G.queue.length, 1);
  const H = go(mk(), ['start', 'start', 'start', 'back']); assert.equal(H.scr, SCR.PICK); go(H, ['back']); assert.equal(H.scr, SCR.SMODE, 'no sets: straight back to the strength list, nothing to ask'); assert.equal(H.start, 0);
  go(H, ['back']); assert.equal(H.scr, SCR.HOME);
  const K = go(mk(), ['start', 'start', 'start', 'done', 'swipeRight']); assert.equal(K.scr, SCR.PICK, 'swipe right = BACK');
});
test('23.11. lists follow a dragged finger (scroll) without wrapping; swipes step; the summary pages too', () => {
  const F = go(mk(), ['start', 'start']); go(F, [['scroll', 2]]); assert.equal(F.sel, 2); go(F, [['scroll', 9]]); assert.equal(F.sel, 3, 'stops at the end'); go(F, [['scroll', -9]]); assert.equal(F.sel, 0, 'and at the top');
  go(F, ['swipeUp']); assert.equal(F.sel, 3, 'a swipe: 3 rows'); go(F, ['swipeUp']); assert.equal(F.sel, 3, 'clamped'); go(F, ['swipeDown']); assert.equal(F.sel, 0);
  const H = newFlow(structuredClone(SETUP), {}); go(H, [['scroll', 3]]); assert.equal(H.sel, 3, 'the start menu too');
  const S = go(mk(), ['start', 'start', 'start', 'done', 'back', ['item', 1], 'done', 'menu']); go(S, [['item', S.menu.indexOf(MENU.FIN)]]); assert.equal(S.scr, SCR.SUM); assert.equal(S.sel, 0);
  go(S, ['swipeUp']); assert.equal(S.sel, 1, 'swipe up: the next page'); go(S, [['scroll', 5]]); assert.equal(S.sel, 2, 'two exercises: three pages'); go(S, ['down']); assert.equal(S.sel, 0, 'buttons wrap');
});
test('set done -> rest with the rest setting, auto return with a vibration, next set prefilled from the last set', () => {
  const F = go(mk(), ['start', 'start', 'start', 'up']); F.cues = [];
  handle(F, 'done', 1010); assert.equal(F.scr, SCR.REST); assert.deepEqual(F.sets, [{ ex: 'bench', kg: 82.5, reps: 8, t: 10 }]); assert.deepEqual(F.cues, ['set']);
  assert.equal(restLeft(F, 1010), 90); assert.equal(restLeft(F, 1050.2), 50);
  handle(F, 'tick', 1099); assert.equal(F.scr, SCR.REST);
  handle(F, 'tick', 1100); assert.equal(F.scr, SCR.SET); assert.deepEqual(F.cues, ['set', 'rest']); assert.equal(setNo(F), 2); assert.deepEqual([F.kg, F.reps], [82.5, 8]);
});
test('rest: START skips without a cue, UP / DOWN ±15 s, BACK goes to the exercise list', () => {
  const F = go(mk(), ['start', 'start', 'start', 'done']); F.cues = [];
  go(F, ['up'], 1000); assert.equal(restLeft(F, 1000), 105); go(F, ['down', 'down'], 1000); assert.equal(restLeft(F, 1000), 75);
  go(F, ['start'], 1001); assert.equal(F.scr, SCR.SET); assert.deepEqual(F.cues, []);
  go(F, ['done', 'back']); assert.equal(F.scr, SCR.PICK); assert.equal(F.sel, 0); assert.equal(F.restEnd, 0, 'the rest is over');
  go(F, ['start']); assert.equal(F.scr, SCR.SET, 'START on the list: the exercise again'); assert.equal(setNo(F), 3);
});
test('zero reps is not a set', () => { const F = go(mk(), ['start', 'start', 'start', 'start', 'downHold', 'downHold']); F.cues = []; go(F, ['start']); assert.equal(F.scr, SCR.SET); assert.equal(F.sets.length, 0); assert.deepEqual(F.cues, ['error']); });
test('record: flashes when a set beats the stored best and the session so far, once per new high', () => {
  const F = go(mk(), ['start', 'start', 'start']); // bench best e1RM 110
  F.kg = 100; F.reps = 3; go(F, ['done']); assert.equal(F.flash, null, '110 is not more than 110'); assert.ok(!F.sets[0].pr);
  go(F, ['start']); F.kg = 100; F.reps = 5; F.cues = []; handle(F, 'done', 1000); assert.equal(F.flash.k, 'pr'); assert.ok(F.sets[1].pr); assert.deepEqual(F.cues, ['pr']); // 116.7
  handle(F, 'start', 1001); assert.equal(F.flash, null, 'first key clears the flash'); assert.equal(F.scr, SCR.REST);
  handle(F, 'tick', 1004); go(F, ['start'], 1005); F.kg = 100; F.reps = 5; handle(F, 'done', 1006); assert.equal(F.flash, null, 'same again: no flash');
  handle(F, 'tick', 1009.5); assert.equal(F.flash, null);
  const G = go(mk(), ['start', 'start', 'down', 'down', 'down', 'start']); G.kg = 200; G.reps = 1; go(G, ['done']); assert.equal(G.flash, null, 'no stored best: no record');
  const H = go(mk(), ['start', 'start', ['item', 2]]); H.reps = 13; go(H, ['start']); assert.equal(H.flash.k, 'pr', 'bodyweight: more reps');
  const K = go(mk(), ['start', 'start', 'start']); K.kg = 110; K.reps = 1; handle(K, 'done', 1000); handle(K, 'tick', 1003); assert.equal(K.flash, null, 'equal is no record');
});
test('menu on BACK hold or swipe left: change exercise, undo, finish', () => {
  const F = go(mk(), ['start', 'start', 'start', 'done', 'start', 'done']); // two bench sets, resting
  assert.equal(F.sets.length, 2); go(F, ['menu']); assert.equal(F.scr, SCR.MENU); assert.deepEqual(F.menu, [MENU.EX, MENU.UNDO, MENU.FIN, MENU.PAUSE]);
  go(F, ['back']); assert.equal(F.scr, SCR.REST, 'BACK closes the menu'); go(F, ['swipeLeft', 'down', 'start']); // undo
  assert.equal(F.sets.length, 1); assert.equal(F.scr, SCR.SET); assert.deepEqual([F.kg, F.reps], [80, 8]); assert.equal(setNo(F), 2);
  go(F, ['menu', 'start']); assert.equal(F.scr, SCR.PICK); go(F, ['down', 'start']); assert.equal(curEx(F).id, 'squat'); assert.deepEqual([F.kg, F.reps], [100, 5]);
  const G = go(mk(), ['start', 'start', 'start', 'menu']); assert.deepEqual(G.menu, [MENU.EX, MENU.FIN, MENU.PAUSE], 'no undo without sets');
  go(G, ['down', 'start']); assert.equal(G.scr, SCR.HOME, 'finish without sets saves nothing'); assert.equal(G.queue.length, 0);
  const S = go(mk(), ['menu']); assert.deepEqual(S.menu, [MENU.SYNC, MENU.PAIR]); go(S, ['start']); assert.deepEqual(S.out.map(o => o.k), ['setup', 'send']); assert.equal(S.scr, SCR.HOME);
});
test('undo of a set of another exercise goes back to that exercise', () => {
  const F = go(mk(), ['start', 'start', 'start', 'done', 'back', 'down', 'start']); assert.equal(curEx(F).id, 'squat');
  go(F, ['menu', 'down', 'start']); assert.equal(curEx(F).id, 'bench'); assert.equal(F.sets.length, 0);
});
test('finish: session into the queue with seconds, summary with heart rate and every set; send ok -> saved', () => {
  const F = mk(); handle(F, 'start', 1000); handle(F, 'start', 1000); handle(F, 'hr', 1000, 95); handle(F, 'start', 1001); handle(F, 'done', 1060); handle(F, 'hr', 1070, 140);
  handle(F, 'start', 1100); handle(F, 'down', 1100); handle(F, 'done', 1120); handle(F, 'menu', 1200); handle(F, 'down', 1200); handle(F, 'down', 1200); handle(F, 'start', 1300);
  assert.equal(F.scr, SCR.SUM); assert.equal(F.queue.length, 1);
  const q = F.queue[0]; assert.deepEqual(q, { id: q.id, start: 1000, duration: 300, sets: [{ ex: 'bench', kg: 80, reps: 8, t: 60 }, { ex: 'bench', kg: 77.5, reps: 8, t: 120 }], hr: { avg: 118, max: 140 } });
  assert.deepEqual({ ...F.sum, id: 0 }, { id: 0, dur: 300, sets: 2, vol: 1260, exs: 1, prs: 0, st: 'sending', hr: { avg: 118, max: 140 }, ex: [{ id: 'bench', n: 'Bench press', t: 'w', s: [[80, 8, 0], [77.5, 8, 0]] }] });
  assert.deepEqual(F.out.at(-1), { k: 'send' }); assert.ok(F.cues.includes('done'));
  sent(F, q.id, 'ok'); assert.equal(F.sum.st, 'saved'); assert.equal(F.queue.length, 0);
  handle(F, 'start', 1301); assert.equal(F.scr, SCR.SAVEQ, 'done: save it as a workout?'); assert.deepEqual(listItems(F), ['Save as workout', 'No']);
  handle(F, 'start', 1302); assert.equal(F.scr, SCR.HOME); assert.equal(F.sets.length, 0);
  const N = mk(); go(N, ['start', 'start', 'start', 'done', 'menu']); go(N, [['item', N.menu.indexOf(MENU.FIN)]]); assert.equal(N.sum.hr, null, 'no heart rate: none in the summary');
});
test('queue: no phone -> queued and kept, retried later, refused -> dropped', () => {
  const F = go(mk(), ['start', 'start', 'start', 'done', 'menu', 'down', 'down', 'start']); const id = F.queue[0].id;
  sent(F, id, 'retry'); assert.equal(F.sum.st, 'queued'); assert.equal(F.queue.length, 1);
  go(F, ['start', 'down', 'start', 'start', 'start', 'start', 'done', 'menu', 'down', 'down', 'start']); assert.equal(F.queue.length, 2, 'second session queues behind');
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
  const H = mk(); go(H, ['start']); assert.equal(H.scr, SCR.SMODE); const E = newFlow({ ex: [] }, { scr: SCR.HOME, last: 'kraft' }); go(E, ['start']); assert.equal(E.scr, SCR.SMODE, 'empty setup: the standard workouts are there'); go(E, ['start']); assert.equal(E.scr, SCR.PICK, 'Free: the list (loading)'); assert.ok(loading(E)); assert.deepEqual(E.out, [{ k: 'setup' }]); setSetup(E, structuredClone(SETUP)); assert.ok(!loading(E)); assert.equal(listItems(E)[0], 'Bench press', 'it fills when the setup comes');
});
test('glance opens the app; new setup keeps the current exercise; clock', () => {
  const F = mk(); F.scr = SCR.GLANCE; go(F, ['tap']); assert.equal(F.scr, SCR.HOME); F.sel = 0;
  go(F, ['start', 'start', 'down', 'start']); setSetup(F, { ex: [SETUP.ex[1], SETUP.ex[0]], rest: 60 }); assert.equal(curEx(F).id, 'squat'); assert.equal(F.cur, 0);
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
test('start menu: run, ride, indoor trainer, strength, more with the last used on top; BACK leaves the app', () => {
  const F = fl(); assert.equal(F.scr, SCR.HOME); assert.deepEqual(listItems(F), ['Run', 'Ride', 'Indoor trainer', 'Strength', 'More']);
  const G = fl({ last: 'kraft' }); assert.deepEqual(homeItems(G), ['kraft', 'run', 'ride', 'trainer', 'more']); go(G, ['start']); assert.equal(G.scr, SCR.SMODE, '24.11.: Strength opens the choice at once (no ready screen)'); assert.ok(G.start > 0, 'the session clock runs');
  go(G, ['back']); assert.equal(G.scr, SCR.HOME); go(G, ['up']); assert.equal(G.sel, 4, 'wraps'); assert.equal(homeTop(G.sel, 5), 1, 'five entries: the list scrolls to the last'); go(G, ['swipeDown']); assert.equal(G.sel, 1, 'a swipe: 3 rows'); go(G, ['up']); assert.equal(G.sel, 0);
  go(G, ['back']); assert.deepEqual(G.out.at(-1), { k: 'exit' });
  assert.deepEqual(homeItems(fl({ last: 'trainer' })).slice(0, 2), ['trainer', 'run'], 'the trainer used last is on top');
  go(F, [['item', 4]]); assert.equal(F.scr, SCR.MORE); assert.deepEqual(listItems(F), ['Basketball', 'Yoga']); go(F, ['back']); assert.equal(F.scr, SCR.HOME);
  go(F, ['menu']); assert.equal(F.scr, SCR.MENU); assert.deepEqual(F.menu, [MENU.SYNC, MENU.PAIR]); go(F, ['back']); assert.equal(F.scr, SCR.HOME);
});
test('run: ready, data pages from the config, values tick, UP / DOWN switch pages, auto lap banner', () => {
  const F = fl(); go(F, ['start']); assert.equal(F.scr, SCR.READY); assert.equal(F.sp, 'run');
  go(F, ['back']); assert.equal(F.scr, SCR.HOME); go(F, ['start']); handle(F, 'start', 2000); assert.equal(F.scr, SCR.REC); assert.deepEqual(F.cues, ['start']); assert.equal(F.last, 'run');
  assert.deepEqual(recPages(F), [['pace', 'dist', 'time', 'hr'], ['lapPace', 'lapDist', 'avgPace', 'hrZone']], 'no route loaded: no route page');
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
  strength: () => { const F = fl({ last: 'kraft' }); go(F, ['start', 'start', 'start']); assert.equal(F.scr, SCR.SET); go(F, ['done']); assert.equal(F.scr, SCR.REST); return [F, SCR.REST]; },
  workout: () => { const F = fl({ last: 'kraft' }); go(F, ['start', 'down', 'start']); assert.ok(F.plan); go(F, ['done']); assert.equal(F.scr, SCR.REST); return [F, SCR.REST]; },
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
  assert.equal(F.scr, strength ? SCR.HOME : SCR.HOME, 'discarded'); assert.equal(F.rec, null); assert.equal(F.queue.length, 0); assert.ok(!F.out.some(o => o.k === 'saveAct'));
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
  const F = fl(); setRoute(F, { len: 1000, pts: [[0, 0], [1, 1]] }); go(F, [['item', 4], 'down', 'start']); assert.equal(F.scr, SCR.READY); assert.deepEqual([F.sp, F.type], ['other', 'Yoga']);
  go(F, ['back']); assert.equal(F.scr, SCR.MORE); go(F, ['start', 'start']); assert.equal(F.scr, SCR.REC); assert.deepEqual(recPages(F), [['hr', 'time', 'clock', 'kcal']]);
  move(F, 600, 0); assert.equal(F.rec.t, 600, 'no auto pause for other sports'); assert.equal(fieldText('time', F.rec, 0), '10:00'); assert.ok(F.rec.kcal > 50);
  assert.equal(F.last, 'more'); go(F, ['start', 'down', 'start', 'start']); assert.deepEqual(homeItems(F)[0], 'more');
  const E = newFlow(null, { cfg: { ...CFG(), more: [] } }); go(E, [['item', 4]]); assert.equal(E.scr, SCR.MORE); go(E, ['start']); assert.equal(E.scr, SCR.MORE, 'empty list: nothing to start'); go(E, ['back']); assert.equal(E.scr, SCR.HOME);
});
test('strength: Exercises or a saved workout in one list; free = recent, then top 20, then the rest', () => {
  const F = fl({ last: 'kraft' }); go(F, ['start']); assert.equal(F.scr, SCR.SMODE); assert.deepEqual(listItems(F), ['Free', 'Push day', 'Pull day', 'Leg day', 'Upper body', 'Lower body', 'Full body', 'One-arm pull-up', 'One-arm push-up'], '23.11.7: the saved Push day hides the standard one');
  go(F, ['start']); assert.equal(F.scr, SCR.PICK); assert.deepEqual(listItems(F), ['Pull-ups', 'Squat', 'Biceps curls', 'Bench press', 'Plank']);
  go(F, ['start']); assert.equal(curEx(F).id, 'pull'); go(F, ['done', 'back']); assert.equal(F.scr, SCR.PICK); assert.equal(F.sel, 0, 'the list opens on the current exercise');
  const G = mk(); go(G, ['start']); assert.equal(G.scr, SCR.SMODE, '23.11.7: no saved workouts: still the list (Free + the standard ones)'); assert.equal(listItems(G).length, 9);
  assert.deepEqual(order({ ex: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], top: ['c', 'zz'], recent: ['b'] }), [1, 2, 0]);
  const S = fl({ last: 'kraft' }); go(S, ['start', 'back']); assert.equal(S.scr, SCR.HOME, 'BACK on the choice: the start menu, Strength on top'); assert.equal(S.start, 0); assert.equal(listItems(S)[S.sel], 'Strength');
  const T = fl({ last: 'kraft' }); go(T, ['start', 'start', 'back']); assert.equal(T.scr, SCR.SMODE, 'BACK on the exercises without sets: the choice again (workouts or exercises)'); assert.equal(T.start, 0);
  handle(T, 'item', 2000, 1); assert.equal(T.start, 2000, 'a new start'); assert.ok(T.plan);
});
test('workout: guided set by set with its kg, reps and rest, next exercise, timed plank, done at the end', () => {
  const F = fl({ last: 'kraft' }); go(F, ['start']); assert.equal(F.scr, SCR.SMODE);
  handle(F, 'item', 5000, 1); assert.equal(F.scr, SCR.SET); assert.equal(curEx(F).id, 'bench'); assert.deepEqual([F.kg, F.reps, setNo(F)], [85, 6, 1]); assert.equal(F.start, 1000, 'the session started on the strength screen');
  handle(F, 'done', 5060); assert.equal(F.scr, SCR.REST); assert.equal(F.restLen, 120, 'rest from the workout'); assert.deepEqual(F.plan, { w: 0, i: 0, on: true, skip: [] }); assert.equal(F.sets[0].pi, 0);
  handle(F, 'tick', 5180); assert.equal(F.scr, SCR.SET); assert.deepEqual([curEx(F).id, F.kg, F.reps, setNo(F)], ['bench', 85, 6, 2]);
  go(F, ['down']); handle(F, 'done', 5200); assert.equal(F.sets.at(-1).kg, 82.5); handle(F, 'start', 5201); assert.equal(curEx(F).id, 'curl', 'next exercise after its sets');
  assert.deepEqual([F.kg, F.reps, setNo(F)], [20, 12, 1], 'no kg in the plan: from history, else a start value'); assert.deepEqual(planItem(F), ['curl', 1, 12, 0, 45]);
  go(F, ['menu']); assert.deepEqual(F.menu, [MENU.EX, MENU.SKIP, MENU.UNDO, MENU.FIN, MENU.PAUSE]); go(F, ['down', 'down', 'start']); assert.equal(curEx(F).id, 'bench', 'undo goes back into the plan');
  assert.deepEqual([setNo(F), F.kg], [2, 82.5]); handle(F, 'done', 5300); handle(F, 'start', 5301);
  handle(F, 'done', 5350); assert.equal(F.restLen, 45); handle(F, 'start', 5351);
  assert.equal(curEx(F).id, 'plank'); assert.equal(curEx(F).t, 'time'); assert.equal(F.focus, 1); assert.equal(F.reps, 60); go(F, ['up']); assert.equal(F.reps, 65, 'seconds in 5 s steps');
  handle(F, 'start', 5420); assert.equal(F.scr, SCR.SUM, 'the last planned set ends the workout'); assert.equal(F.queue.at(-1).sets.length, 4); assert.deepEqual(F.queue.at(-1).sets.at(-1), { ex: 'plank', kg: 0, reps: 65, t: 4420 });
  assert.equal(F.saveq, null, 'done as planned: no question'); go(F, ['start']); assert.equal(F.scr, SCR.HOME);
  const G = fl({ last: 'kraft' }); go(G, ['start', 'down', 'start', 'menu']); go(G, ['down', 'start']); assert.equal(curEx(G).id, 'curl', 'skip exercise');
  go(G, ['menu', 'start']); assert.equal(G.scr, SCR.PICK); assert.ok(G.plan, 'change exercise keeps the workout'); assert.deepEqual(listItems(G).slice(0, 3), ['Bench press', 'Biceps curls', 'Plank'], 'its exercises first');
  const H = newFlow({ ex: [{ id: 'bench', n: 'Bench press', t: 'w' }], workouts: [{ id: 'q', n: 'Q', it: [['my_new', 1, 5, 40, 60, 'Thai kick']] }] }, { scr: SCR.HOME, last: 'kraft' });
  go(H, ['start', 'down', 'start']); assert.equal(curEx(H).id, 'my_new'); assert.equal(curEx(H).n, 'Thai kick', 'unknown exercise: added with its name'); assert.deepEqual([H.kg, H.reps], [40, 5]);
});
test('23.11. inside a workout: BACK -> its exercise list (not the workouts), jump to another item, a free exercise in between, back into the plan', () => {
  const F = fl({ last: 'kraft' }); go(F, ['start', 'down', 'start']); assert.equal(curEx(F).id, 'bench');
  go(F, ['back']); assert.equal(F.scr, SCR.PICK, 'BACK: the exercise list'); assert.deepEqual(pickRows(F).slice(0, 3).map(r => r[1]), [0, 1, 2], 'the workout items first');
  assert.deepEqual(listItems(F), ['Bench press', 'Biceps curls', 'Plank', 'Pull-ups', 'Squat'], 'then the other exercises');
  go(F, [['item', 1]]); assert.equal(curEx(F).id, 'curl'); assert.deepEqual([F.kg, F.reps], [20, 12]); go(F, ['done']); assert.equal(F.sets[0].pi, 1);
  assert.equal(F.scr, SCR.REST); assert.equal(planItem(F)[0], 'plank', 'curl done (1 set): on to the next open item');
  go(F, ['back', ['item', 3]]); assert.equal(curEx(F).id, 'pull'); assert.equal(planItem(F), null, 'a free exercise in between'); go(F, ['done']); assert.equal(F.sets.at(-1).pi, undefined); assert.equal(F.restLen, 90);
  go(F, ['start']); assert.equal(curEx(F).id, 'pull', 'the rest returns to the free exercise');
  go(F, ['back', ['item', 0]]); assert.equal(curEx(F).id, 'bench'); assert.deepEqual([F.kg, F.reps, setNo(F)], [85, 6, 1], 'back into the plan');
  go(F, ['done', 'start', 'done']); assert.equal(F.scr, SCR.REST); assert.equal(planItem(F)[0], 'plank'); go(F, ['start', 'done']);
  assert.equal(F.scr, SCR.SUM, 'every planned set done: finished'); assert.ok(F.saveq, 'a free exercise was added: ask'); assert.deepEqual(F.saveq.rows, ['Update Push day', 'Save as new', 'No']);
  assert.deepEqual(F.saveq.it, [['curl', 1, 12, 20, 45], ['pull', 1, 10, 0, 90], ['bench', 2, 6, 85, 120], ['plank', 1, 60, 0, 90]], 'the session in the order done');
  const D = fl({ last: 'kraft' }); go(D, ['start', 'down', 'start', 'done', 'back']); go(D, [['item', 0]]); assert.equal(setNo(D), 2, 'a done set counts when the item is picked again');
});
test('23.11. save as workout: free session -> asked, saved on the watch and queued for the account; unchanged saved workout -> not asked; update and new', () => {
  const F = fl({ last: 'kraft' }); n = 0; go(F, ['start', 'start', 'start', 'done', 'start', 'done', 'back', ['item', 1], 'done', 'menu']); go(F, [['item', F.menu.indexOf(MENU.FIN)]]);
  assert.equal(F.scr, SCR.SUM); assert.deepEqual(F.saveq.rows, ['Save as workout', 'No']); assert.equal(F.saveq.n, 'Pull-ups + Squat');
  assert.deepEqual(F.saveq.it, [['pull', 2, 10, 0, 90], ['squat', 1, 5, 100, 90]]);
  go(F, ['start']); assert.equal(F.scr, SCR.SAVEQ); const q0 = F.queue.length; go(F, ['start']); assert.equal(F.scr, SCR.HOME);
  assert.equal(F.queue.length, q0 + 1); const t = F.queue.at(-1); assert.ok(t.tpl && /^w/.test(t.tpl.id)); assert.deepEqual({ ...t.tpl, id: 0 }, { id: 0, n: 'Pull-ups + Squat', it: [['pull', 2, 10, 0, 90], ['squat', 1, 5, 100, 90]] });
  assert.deepEqual(F.out.slice(-2), [{ k: 'tpl' }, { k: 'send' }]); assert.deepEqual(listItems({ ...F, scr: SCR.SMODE }).slice(0, 3), ['Free', 'Push day', 'Pull-ups + Squat'], 'on the watch at once, before the standard ones');
  go(F, ['start']); handle(F, 'item', 3000, 2); assert.equal(curEx(F).id, 'pull'); go(F, ['done', 'start', 'done']); assert.equal(F.scr, SCR.REST); go(F, ['start', 'start']); assert.equal(curEx(F).id, 'squat'); go(F, ['done']);
  assert.equal(F.scr, SCR.SUM); assert.equal(F.saveq, null, 'the saved workout done as saved: no question'); go(F, ['start']); assert.equal(F.scr, SCR.HOME);
  const U = fl({ last: 'kraft' }); go(U, ['start', 'down', 'start', 'done', 'menu']); go(U, [['item', U.menu.indexOf(MENU.FIN)]]); assert.deepEqual(U.saveq.rows, ['Update Push day', 'Save as new', 'No'], 'workout ended early: changed');
  go(U, ['start', 'start']); assert.equal(U.queue.at(-1).tpl.id, 'w1', 'Update keeps the id'); assert.equal(U.queue.at(-1).tpl.n, 'Push day'); assert.deepEqual(U.cfg.w[0].it, [['bench', 1, 6, 85, 120]]);
  const V = fl({ last: 'kraft' }); go(V, ['start', 'down', 'start', 'done', 'menu']); go(V, [['item', V.menu.indexOf(MENU.FIN)], 'start', 'down', 'start']); assert.notEqual(V.queue.at(-1).tpl.id, 'w1', 'Save as new: a new id'); assert.equal(V.cfg.w.length, 2);
  const X = fl({ last: 'kraft' }); go(X, ['start', 'start', 'start', 'done', 'menu']); go(X, [['item', X.menu.indexOf(MENU.FIN)], 'start', 'down', 'start']); assert.equal(X.scr, SCR.HOME); assert.ok(!X.queue.some(s => s.tpl), 'No: nothing saved');
  const Y = fl({ last: 'kraft' }); go(Y, ['start', 'start', 'start', 'done', 'menu']); go(Y, [['item', Y.menu.indexOf(MENU.FIN)], 'start', 'back']); assert.equal(Y.scr, SCR.HOME, 'BACK on the question = No'); assert.ok(!Y.queue.some(s => s.tpl));
  const Z = mk(); Z.cfg.w = Array.from({ length: 30 }, (_, i) => ({ id: 'z' + i, n: 'Z' + i, it: [['bench', 1, 5, 50, 60]] })); go(Z, ['start', 'start', 'start', 'done', 'menu']); go(Z, [['item', Z.menu.indexOf(MENU.FIN)]]); assert.equal(Z.saveq, null, '30 workouts: full, not asked');
  const T = tplOf({ ...mk(), sets: [{ ex: 'pull', kg: 0, reps: 140, t: 1 }, { ex: 'bench', kg: 81.3, reps: 5, t: 2 }] }); assert.deepEqual(T, [['pull', 1, 100, 0, 90], ['bench', 1, 5, 81.25, 90]], 'inside the editor limits');
});
test('23.11. front squat is one of the standard exercises; the list layout keeps 44 px touch rows on the 260 px fenix 8', () => {
  assert.ok(TOP.some(e => e.id === 'frontsquat' && e.n === 'Front squat' && e.t === 'w'));
  const rows = LIST_LAY.rows.map(r => r[1]); for (let k = 0; k < 3; k++) { const lo = k ? (rows[k - 1] + rows[k]) / 2 : LIST_LAY.count + .04, hi = (rows[k] + rows[k + 1]) / 2; assert.ok((hi - lo) * 260 >= 43.9, `row ${LIST_LAY.rows[k][0]}: ${((hi - lo) * 260).toFixed(1)} px`); }
  const m = LIST_LAY.menu.map(r => r[1]); assert.ok((m[1] - m[0]) * 260 >= 44); assert.ok(DRAG_ROW * 260 >= 20);
});
test('watchfields: defaults pass the check, compact form, field texts, top 20, more sports', () => {
  assert.deepEqual(validate(defaults()).cfg, defaults()); assert.equal(TOP.length, 21); assert.equal(new Set(TOP.map(e => e.id)).size, 21);
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

// 24.11. (Freddy on his fenix 8): last time's sets on the set screen and in the exercise list, kept fresh without a phone
test('last time: the set with the same number, past the count its final set, first time nothing', () => {
  const F = go(mk(), ['start', 'start', 'start']); assert.equal(curEx(F).id, 'bench');
  assert.deepEqual(lastSet(F), [80, 8], 'set 1'); go(F, ['start', 'start', 'start']); assert.equal(setNo(F), 2); assert.deepEqual(lastSet(F), [80, 7], 'set 2');
  go(F, ['start', 'start', 'start']); assert.deepEqual(lastSet(F), [75, 8], 'set 3'); go(F, ['start', 'start', 'start']); assert.equal(setNo(F), 4); assert.deepEqual(lastSet(F), [75, 8], 'set 4: last time had 3, its final one');
  assert.equal(lastSet(F, F.setup.ex.find(e => e.id === 'curl')), null, 'never done: nothing');
  assert.deepEqual(lastSet(F, F.setup.ex.find(e => e.id === 'pull')), [0, 10]);
});
test('last time, short: a weight only when it changes, bodyweight reps, timed clock, cut at whole sets', () => {
  assert.deepEqual(lastParts('w', [[80, 8], [80, 8], [75, 10], [75, 9]]), ['80×8', '8', '75×10', '9']);
  assert.deepEqual(lastParts('w', [[82.5, 8], [102.25, 3]]), ['82.5×8', '102.3×3']);
  assert.deepEqual(lastParts('bw', [[0, 10], [5, 8], [5, 6]]), ['10', '+5×8', '+5×6']);
  assert.deepEqual(lastParts('time', [[0, 60], [0, 45]]), ['1:00', '0:45']);
  assert.deepEqual(lastParts('w', undefined), []);
  assert.equal(lastTxt('w', [[80, 8], [80, 8], [80, 6]]), 'Last 80×8 · 8 · 6');
  assert.equal(lastTxt('bw', [[0, 10], [0, 9]]), 'Last 10 · 9 reps');
  assert.equal(lastTxt('bw', [[0, 10], [5, 9]]), 'Last 10 · +5×9');
  assert.equal(lastTxt('time', [[0, 60]]), 'Last 1:00');
  assert.equal(lastTxt('w', [[80, 8], [75, 10], [70, 12]], 2), 'Last 80×8 · 75×10 …', 'fewer than all: the dots');
  assert.equal(lastTxt('w', [[80, 8], [75, 10]], 0), 'Last 80×8 …', 'at least one set');
  assert.equal(lastTxt('w', []), '');
});
test('a finished session is last time at once: setup updated, kept (out keep), best raised, recent and last', () => {
  const F = go(mk(), ['start', 'start', 'start']); F.kg = 85; F.reps = 6; go(F, ['start', 'start'], 1100); go(F, ['start'], 1200); F.kg = 85; F.reps = 5; go(F, ['start', 'start'], 1300);
  go(F, ['back', ['item', 2]], 1400); assert.equal(curEx(F).id, 'pull'); F.reps = 13; go(F, ['start'], 1500);
  go(F, ['menu'], 1600); go(F, [['item', F.menu.indexOf(MENU.FIN)]], 1600); assert.equal(F.scr, SCR.SUM);
  assert.ok(F.out.some(o => o.k === 'keep'), 'the app stores the setup');
  const ex = id => F.setup.ex.find(e => e.id === id);
  assert.deepEqual(ex('bench').s, [[85, 6], [85, 5]], "today's sets replace last time's"); assert.equal(ex('bench').b, 110, 'best kept (85 × 6 = 102 < 110)');
  assert.deepEqual(ex('pull').s, [[0, 13]]); assert.equal(ex('pull').b, 13, 'best raised (13 reps)');
  assert.deepEqual(ex('squat').s, [[100, 5]], 'not done: unchanged'); assert.deepEqual(F.setup.recent.slice(0, 2), ['bench', 'pull']); assert.deepEqual(F.setup.last, { at: 1000, sets: 3, n: '' });
  assert.equal(F.list[0], F.setup.ex.findIndex(e => e.id === 'bench'), 'the free list: done just now first');
  // the next session, no phone: set 1 shows today's first set
  go(F, ['back']); if (F.scr === SCR.SAVEQ) go(F, ['back']); assert.equal(F.scr, SCR.HOME); go(F, ['start', 'start', 'start'], 2000); assert.equal(curEx(F).id, 'bench'); assert.deepEqual(lastSet(F), [85, 6]); assert.deepEqual([F.kg, F.reps], [85, 6], 'prefilled from it');
});
test('a setup from the server that does not have a queued session yet: the queued sets stay last time', () => {
  const sess = { id: 'q1', start: 5000, duration: 600, sets: [{ ex: 'squat', kg: 110, reps: 4, t: 10 }, { ex: 'squat', kg: 110, reps: 3, t: 200 }] };
  const F = mk({ queue: [sess, { id: 't1', tpl: { id: 'w1', n: 'X', it: [['squat', 1, 1, 0, 60]] } }] });
  assert.deepEqual(F.setup.ex.find(e => e.id === 'squat').s, [[110, 4], [110, 3]], 'at start (the cached setup)');
  setSetup(F, structuredClone(SETUP)); assert.deepEqual(F.setup.ex.find(e => e.id === 'squat').s, [[110, 4], [110, 3]], 'a fresh server setup: still the queued session');
  sent(F, 'q1', 'ok'); setSetup(F, structuredClone(SETUP)); assert.deepEqual(F.setup.ex.find(e => e.id === 'squat').s, [[100, 5]], 'once sent, the server is the truth');
  const st = { ex: [{ id: 'plank', n: 'Plank', t: 'time', s: [[0, 30]], b: 30 }] }; keepLast(st, { start: 1, sets: [{ ex: 'plank', kg: 0, reps: 75 }, { ex: 'nope', kg: 1, reps: 1 }] });
  assert.deepEqual(st.ex[0].s, [[0, 75]]); assert.equal(st.ex[0].b, 75); assert.deepEqual(st.recent, ['plank', 'nope']);
});

/* ---- 23.11.7: the wheel (a finger over kg / reps), lists 1:1 with the finger, the standard workouts ---- */
test('wheel: reps from 9 step 10, 11, 12 one by one (finger up = more), down again, the column takes the focus, a tick per step', () => {
  const F = go(mk(), ['start', 'start', 'start']); F.reps = 9; F.cues = []; assert.equal(F.focus, 0);
  const seen = []; for (let i = 0; i < 3; i++) { handle(F, 'wheel', 1000, [1, 1]); seen.push(F.reps); }
  assert.deepEqual(seen, [10, 11, 12]); assert.equal(F.focus, 1, 'the dragged column is focused'); assert.deepEqual(F.cues, ['tick', 'tick', 'tick']);
  go(F, [['wheel', [1, -4]]]); assert.equal(F.reps, 8, 'a faster finger: several steps in one event'); assert.equal(F.kg, 80, 'kg untouched');
  assert.equal(F.scr, SCR.SET); assert.equal(F.sets.length, 0, 'a wheel never logs a set');
  go(F, [['wheel', [1, -50]]]); assert.equal(F.reps, 0, 'the buttons\' lower limit'); F.cues = []; go(F, [['wheel', [1, -1]]]); assert.deepEqual(F.cues, [], 'at a limit: no tick');
  go(F, [['wheel', [1, 200]]]); assert.equal(F.reps, 100, 'REPS_MAX');
});
test('wheel: kg by the kg step (2.5) with its limits, focus moves to kg; bodyweight +kg from BW; timed: the hold seconds', () => {
  const F = go(mk(), ['start', 'start', 'start', ['focus', 1]]); go(F, [['wheel', [0, 1]]]); assert.equal(F.kg, 82.5); assert.equal(F.focus, 0);
  go(F, [['wheel', [0, -3]]]); assert.equal(F.kg, 75); go(F, [['wheel', [0, -100]]]); assert.equal(F.kg, 0); go(F, [['wheel', [0, 400]]]); assert.equal(F.kg, 500, 'KG_MAX');
  assert.equal(stepOf(F, 0, 1, false), 500, 'the neighbour above the limit is the value itself (not drawn)'); assert.equal(stepOf(F, 0, -1, false), 497.5); assert.equal(F.kg, 500, 'stepOf changes nothing');
  const B = go(mk(), ['start', 'start', ['item', 2]]); assert.equal(curEx(B).id, 'pull'); assert.equal(B.kg, 0);
  go(B, [['wheel', [0, 2]]]); assert.deepEqual([B.kg, B.focus], [5, 0], 'bodyweight: +5 kg'); go(B, [['wheel', [0, -9]]]); assert.equal(B.kg, 0, 'back to BW');
  go(B, [['wheel', [1, 1]]]); assert.deepEqual([B.reps, B.focus], [11, 1]);
  const T = newFlow({ ex: [{ id: 'plank', n: 'Plank', t: 'time', s: [[0, 60]] }] }, { scr: SCR.HOME, last: 'kraft' }); go(T, ['start', 'start', 'start']); assert.equal(T.reps, 60);
  go(T, [['wheel', [0, 2]]]); assert.deepEqual([T.reps, T.kg, T.focus], [70, 0, 1], 'timed: any column turns the seconds by 5'); go(T, [['wheel', [1, -20]]]); assert.equal(T.reps, 0);
});
test('wheel: only on the set screen (lists, rest, summary ignore it); a flash only clears', () => {
  const F = go(mk(), ['start', 'start']); assert.equal(F.scr, SCR.PICK); go(F, [['wheel', [1, 3]]]); assert.equal(F.sel, 0); assert.equal(F.scr, SCR.PICK);
  go(F, ['start', 'done']); assert.equal(F.scr, SCR.REST); const r = F.restEnd; go(F, [['wheel', [1, 3]]]); assert.equal(F.restEnd, r); assert.equal(F.scr, SCR.REST);
});
test('lists: one row per row distance as drawn (1:1 with the finger), a swipe without drag events moves 3 rows', () => {
  assert.equal(dragRow(SCR.PICK), .2); assert.equal(dragRow(SCR.SUM), .2); assert.equal(dragRow(SCR.MENU), DRAG_MENU); assert.equal(dragRow(SCR.END), DRAG_MENU); assert.equal(dragRow(SCR.HOME), HOME_LAY.dy);
  const rows = LIST_LAY.rows.map(r => r[1]), menu = LIST_LAY.menu.map(r => r[1]);
  assert.ok(Math.abs(dragRow(SCR.PICK) - (rows[2] - rows[0]) / 2) < .02, 'a list row step = the mean distance of the rows around the selected one');
  assert.ok(Math.abs(DRAG_MENU - (menu[1] - menu[0])) < .001, 'a menu row step = the menu row distance');
  assert.ok(WHEEL_STEP * 260 >= 18 && WHEEL_STEP * 260 <= 21, `wheel step ${WHEEL_STEP * 260} px on the fenix 8`); assert.equal(SWIPE_ROWS, 3);
  const F = fl({ last: 'kraft' }); go(F, ['start', 'swipeUp']); assert.equal(F.sel, 3, 'strength list: a swipe 3 rows'); go(F, ['swipeUp', 'swipeUp', 'swipeUp']); assert.equal(F.sel, 8, 'clamped at the end, no wrap');
  go(F, ['swipeDown', 'swipeDown', 'swipeDown']); assert.equal(F.sel, 0);
});
test('standard workouts: built in, sensible sets, reps and rest; kg 0; the same in Flow.mc', () => {
  assert.deepEqual(STD_W.map(w => w.n), ['Push day', 'Pull day', 'Leg day', 'Upper body', 'Lower body', 'Full body', 'One-arm pull-up', 'One-arm push-up']);
  const top = new Map(TOP.map(e => [e.id, e]));
  for (const w of STD_W) { assert.ok(w.std && /^std-/.test(w.id)); assert.ok(w.it.length >= 4 && w.it.length <= 7, w.n);
    for (const [ex, k, r, kg, rest, nm, t] of w.it) { const e = top.get(ex); if (e) { assert.equal(nm, e.n); assert.equal(t, e.t); } else { assert.match(w.id, /^std-oap/); assert.ok(nm.length <= 18 && ['bw', 'time'].includes(t), `${w.n}: ${ex}`); }
      assert.ok(k >= 2 && k <= 4 && kg === 0 && rest >= 60 && rest <= 120 && (t === 'time' ? r >= 5 && r <= 60 : r >= 3 && r <= 15), `${w.n}: ${ex} ${k}×${r} ${rest}s`); } }
  // the same six in garmin/source/Flow.mc stdWorkouts, item by item
  const mc = readFileSync(new URL('../garmin/source/Flow.mc', import.meta.url), 'utf8');
  for (const w of STD_W) { assert.ok(mc.includes(`stdW("${w.id}", "${w.n}", [`), `Flow.mc has ${w.n}`);
    for (const x of w.it) assert.ok(mc.includes(JSON.stringify(x).replace(/,/g, ', ')), `Flow.mc: ${w.n} ${JSON.stringify(x)}`); }
  assert.match(mc, new RegExp(`RF_VERSION = "${VERSION.replace(/\./g, '\\.')}"`), 'the version is the same on the watch');
});
test('standard workouts: no account, no phone: Strength lists Free + the six; Push day walks through its plan with last time\'s or start values', () => {
  const F = newFlow({ ex: [] }, { scr: SCR.HOME, last: 'kraft', paired: false }); F.scr = SCR.HOME; go(F, ['start']); assert.equal(F.scr, SCR.SMODE);
  assert.deepEqual(listItems(F), ['Free', 'Push day', 'Pull day', 'Leg day', 'Upper body', 'Lower body', 'Full body', 'One-arm pull-up', 'One-arm push-up']);
  go(F, ['down', 'start']); assert.equal(F.scr, SCR.SET); assert.deepEqual([curEx(F).id, curEx(F).n, F.kg, F.reps, setNo(F)], ['bench', 'Bench press', 20, 6, 1], 'kg 0: the start value; the plan\'s reps');
  assert.deepEqual(listItems({ ...F, scr: SCR.PICK }).slice(0, 6), ['Bench press', 'Overhead press', 'Incline bench press', 'Dips', 'Lateral raise', 'Triceps pushdown'], 'its exercises are added to the empty setup');
  assert.equal(F.setup.ex.find(e => e.id === 'dip').t, 'bw', 'with their type');
  let t = 1000; for (let i = 0; i < 4; i++) { handle(F, 'done', t += 10); assert.equal(F.restLen, 120); handle(F, 'start', t += 1); }
  assert.equal(curEx(F).id, 'ohp', 'four sets of bench, then the overhead press'); assert.equal(F.reps, 8);
  const G = fl({ last: 'kraft' }); go(G, ['start']); const i = listItems(G).indexOf('Leg day'); go(G, [['item', i]]); assert.equal(curEx(G).id, 'squat'); assert.deepEqual([G.kg, G.reps], [100, 6], 'kg 0: last time\'s weight');
});
test('standard workouts: unchanged = not asked; changed = saved under its name, then it replaces the standard one; not counted in the 30', () => {
  const F = fl({ last: 'kraft' }); go(F, ['start']); go(F, [['item', listItems(F).indexOf('Full body')]]);
  for (let k = 0; k < 15; k++) { assert.equal(F.scr, SCR.SET, 'set ' + k); handle(F, 'done', 2000 + k); for (let j = 0; j < 3 && F.scr === SCR.REST; j++) handle(F, 'start', 2000 + k); } // a record flash takes one touch first
  assert.equal(F.scr, SCR.SUM); assert.equal(F.saveq, null, 'a standard workout done as planned: not asked');
  const G = fl({ last: 'kraft' }); go(G, ['start']); go(G, [['item', listItems(G).indexOf('Pull day')], 'done', 'menu']); go(G, [['item', G.menu.indexOf(MENU.FIN)]]);
  assert.deepEqual(G.saveq.rows, ['Save as workout', 'No'], 'changed (ended early)'); assert.equal(G.saveq.n, 'Pull day'); assert.equal(G.saveq.w, null);
  go(G, ['start', 'start']); assert.equal(G.queue.at(-1).tpl.n, 'Pull day'); assert.ok(!/^std-/.test(G.queue.at(-1).tpl.id), 'a new id in the account');
  const W = workouts(G); assert.equal(W.filter(w => w.n === 'Pull day').length, 1, 'only once'); assert.ok(!W.find(w => w.n === 'Pull day').std, 'the saved one');
  assert.equal(savedW(G).length, 2); assert.ok(!G.queue.some(q => q.tpl && /^std-/.test(q.tpl.id)), 'standard ones are never uploaded by themselves');
  const Z = mk(); Z.cfg.w = Array.from({ length: 29 }, (_, i) => ({ id: 'z' + i, n: 'Z' + i, it: [['bench', 1, 5, 50, 60]] })); go(Z, ['start']); assert.equal(workouts(Z).length, 37);
  go(Z, ['start', 'start', 'done', 'menu']); go(Z, [['item', Z.menu.indexOf(MENU.FIN)]]); assert.deepEqual(Z.saveq.rows, ['Save as workout', 'No'], '29 saved + 6 standard: room for one more');
});
test('standard workouts: the server knows every exercise by name and type (a hold stays seconds)', async () => {
  const { catalog, toRecord } = await import('./watch-api.mjs');
  const info = new Map((await catalog()).map(e => [e.k, e]));
  for (const w of STD_W) for (const it of w.it) {
    const r = toRecord({ start: 1, sets: [{ ex: it[0], kg: 0, reps: it[2], t: 1 }] }, info, []), x = r.ex[0];
    assert.equal(x.t, it[6], `${w.n}: ${it[0]} type`); assert.notEqual(x.n, it[0], `${w.n}: ${it[0]} has a name`);
    if (it[6] === 'time') assert.equal(x.sets[0].s, it[2], 'seconds'); else assert.equal(x.sets[0].r, it[2], 'reps');
  }
});

test('25.11.: the recovery snapshot (healthBody = garmin/source/Health.mc healthSnapshot): only real values, rounded, the local day', () => {
  const t = Math.round(new Date(2026, 10, 25, 7, 12).getTime() / 1000), h = healthBody(DEMO_HEALTH, t);
  assert.deepEqual(h, { day: '2026-11-25', t, ss: 84, bb: 78, rt: 540, st: 22, rhr: 47, v2r: 53, v2b: 55, rr: 13.4, spo2: 97, steps: 2310, ts: 'Productive' });
  assert.deepEqual(healthBody({ sleepScore: null, bodyBattery: 101, restingHr: 52.6, stress: NaN, vo2Run: '50', trainingStatus: '  ', respiration: 14.26 }, t), { day: '2026-11-25', t, rhr: 53, rr: 14.3 },
    'null, out of range, NaN, text numbers and an empty status are left out');
  assert.equal(healthBody({}, t), null, 'nothing to send'); assert.equal(healthBody(null, t), null);
  assert.equal(healthBody({ steps: 5 }, Math.round(new Date(2026, 0, 1, 0, 5).getTime() / 1000)).day, '2026-01-01', 'the watch\'s local day');
  // the watch sends the same keys with the same ranges
  const mc = readFileSync(new URL('../garmin/source/Health.mc', import.meta.url), 'utf8');
  for (const [k, , lo, hi] of HEALTH_KEYS) { if (k === 'ss') continue; // the sleep score cannot be read by a watch-app (Complications are for watch faces); it comes another way
    if (k === 'rt') { assert.match(mc, /"rt"\] = \(h as Number\) \* 60/); continue; }
    if (k === 'rhr') { assert.match(mc, /restingHeartRate, 25, 150, false/); continue; }
    assert.match(mc, new RegExp(`(hPut\\(d, "${k}", hNum\\([^;]*, ${lo}, ${hi}, (true|false)\\)|"${k}"\\] = )`), k + ' with the same range on the watch'); }
  assert.doesNotMatch(mc, /Complications\./); assert.match(mc, /d\["day"\]/); assert.match(mc, /d\["t"\] = now\.value\(\)/);
  const app = readFileSync(new URL('../garmin/source/RideframeApp.mc', import.meta.url), 'utf8'); assert.match(app, /sendHealth\(\); refresh\(\);/, 'sent at every start');
  const man = readFileSync(new URL('../garmin/manifest.xml', import.meta.url), 'utf8'); for (const p of ['UserProfile', 'SensorHistory']) assert.match(man, new RegExp(`uses-permission id="${p}"`)); assert.doesNotMatch(man, /ComplicationSubscriber/);
});
