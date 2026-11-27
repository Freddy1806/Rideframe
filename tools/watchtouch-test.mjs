// 27.11.6: lists follow the finger (js/watchflow.js lDrag / lRelease / lStep, mirrored by garmin/source/Flow.mc): a drag moves the list
// by its pixels, a lift coasts and snaps onto a row, UP / DOWN still step exactly one row (the list slides there), a tap flashes a row or
// a button before (rows) or while (the trainer's - / +) its action runs; the wheel's geometry (js/watchscreens.js wheelRows / wheelBand).
// Usage: node --test tools/watchtouch-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newFlow, handle, SCR, listItems, listPos, prRow, prOn, animating, stepDue, prWait, pxList, needsFrame, dragRow, DRAG_ROW, DRAG_MENU, HOME_LAY, PRESS_MS, ANIM_MS, L_OVER, VERSION } from '../js/watchflow.js';
import { wheelRows, wheelBand } from '../js/watchscreens.js';

const SETUP = { v: 1, unit: 'kg', rest: 90, ex: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => ({ id, n: 'Ex ' + id, t: 'w', s: [[50, 8]] })) };
const mk = () => newFlow(structuredClone(SETUP), { id: () => 'x', scr: SCR.HOME, last: 'kraft' });
const go = (F, evs, t = 1000) => { for (const e of evs) Array.isArray(e) ? handle(F, e[0], t, e[1]) : handle(F, e, t); return F; };
const pick = () => go(mk(), ['start', 'start']); // the exercise list (8 rows)
/** steps the animation every ANIM_MS from ms until it ends (at most k steps); returns the ms it ended */
function run(F, ms, k = 60) { for (let i = 0; i < k && animating(F); i++) { ms += ANIM_MS; handle(F, 'anim', 1000, ms); } return ms; }

test('27.11.6 a drag moves the list by its pixels: listPos follows every drag event, the selection is the row nearest the centre', () => {
  const F = pick(); assert.equal(F.scr, SCR.PICK); assert.ok(pxList(F)); assert.equal(dragRow(F.scr), DRAG_ROW);
  go(F, [['drag', [.08, 0]]]); assert.ok(Math.abs(listPos(F) - .4) < 1e-9, 'a 0.08 S drag = 0.4 rows'); assert.equal(F.sel, 0);
  go(F, [['drag', [.04, 60]]]); assert.ok(Math.abs(listPos(F) - .6) < 1e-9); assert.equal(F.sel, 1, 'past half a row: the next row is the selection');
  go(F, [['drag', [-.1, 120]]]); assert.ok(Math.abs(listPos(F) - .1) < 1e-9, 'and back'); assert.equal(F.sel, 0);
  go(F, [['drag', [-1, 180]]]); assert.equal(listPos(F), -L_OVER, 'pulled past the top: at most L_OVER rows'); assert.equal(F.sel, 0);
  assert.ok(!animating(F), 'while the finger is down no timer runs (the drag events redraw)');
});
test('27.11.6 a slow lift snaps onto the nearest row in a few frames', () => {
  const F = pick(); go(F, [['drag', [.05, 0]], ['drag', [.05, 100]], ['drag', [.02, 200]]]); // 0.6 rows, slow
  go(F, [['dragEnd', 400]]); assert.equal(F.lmode, 3, 'no coast after the finger rested'); assert.ok(animating(F));
  const end = run(F, 400); assert.equal(listPos(F), 1); assert.equal(F.sel, 1); assert.ok(!animating(F)); assert.ok(end - 400 <= 5 * ANIM_MS, 'about four frames');
  const G = pick(); go(G, [['drag', [-.06, 0]], ['dragEnd', 300]]); run(G, 300); assert.equal(listPos(G), 0, 'pulled past the top: back to the first row'); assert.equal(G.sel, 0);
});
test('27.11.6 a flick coasts with decaying speed, then snaps onto a row (deterministic: the time comes in)', () => {
  const F = pick(); for (let i = 0; i < 4; i++) go(F, [['drag', [.06, i * 60]]]); // 0.3 rows per 60 ms = 5 rows/s
  const p0 = listPos(F); go(F, [['dragEnd', 190]]); assert.equal(F.lmode, 2, 'coasting');
  handle(F, 'anim', 1000, 240); const p1 = listPos(F); handle(F, 'anim', 1000, 290); const p2 = listPos(F);
  assert.ok(p1 > p0 && p2 > p1, 'it keeps moving the same way'); assert.ok(p2 - p1 < p1 - p0, 'slower each frame');
  const end = run(F, 290); assert.ok(Number.isInteger(listPos(F)) && listPos(F) > p0, 'ends on a row further on'); assert.equal(F.sel, listPos(F)); assert.ok(end - 190 <= 1000, 'within a second');
  const H = pick(); for (let i = 0; i < 4; i++) go(H, [['drag', [.06, i * 60]]]); go(H, [['dragEnd', 190]]);
  const K = pick(); for (let i = 0; i < 4; i++) go(K, [['drag', [.06, i * 60]]]); go(K, [['dragEnd', 190]]);
  run(H, 190); run(K, 190); assert.equal(H.sel, K.sel, 'the same input, the same row');
  const E = pick(); for (let i = 0; i < 6; i++) go(E, [['drag', [.3, i * 30]]]); go(E, [['dragEnd', 160]]); run(E, 160); assert.equal(E.sel, 7, 'a hard flick stops at the last row');
});
test('27.11.6 UP / DOWN still step exactly one row; the list slides there in a few frames', () => {
  const F = pick(); go(F, ['down']); assert.equal(F.sel, 1, 'one row'); assert.equal(listPos(F), 0, 'drawn from where it was'); assert.ok(animating(F));
  const end = run(F, 0); assert.equal(listPos(F), 1); assert.equal(F.sel, 1, 'the selection stays the new row while it slides'); assert.ok(end <= 5 * ANIM_MS);
  go(F, ['down', 'down']); assert.equal(F.sel, 3, 'a second press during the slide: one more row'); go(F, ['up']); assert.equal(F.sel, 2);
  const W = pick(); go(W, ['up']); assert.equal(W.sel, 7, 'wraps as before'); assert.equal(listPos(W), 8, 'slides in from past the end, one row'); run(W, 0); assert.equal(listPos(W), 7);
  const H = mk(); go(H, ['down']); assert.equal(H.sel, 1); assert.equal(dragRow(H.scr), HOME_LAY.dy, 'the start menu too');
  const M = go(mk(), ['menu']); assert.equal(dragRow(M.scr), DRAG_MENU);
});
test('27.11.6 a tapped row flashes PRESS_MS, then its action runs; other input runs it first; taps on a moving list only stop it', () => {
  const F = mk(); go(F, [['press', ['row', 1, 'item', 1, 5000, true]]]); assert.equal(F.scr, SCR.HOME, 'not yet'); assert.equal(prRow(F), 1, 'the row flashes');
  assert.ok(prWait(F)); assert.deepEqual(F.cues, ['tap'], 'a short vibration');
  handle(F, 'anim', 1000, 5000 + PRESS_MS - 1); assert.equal(F.scr, SCR.HOME); handle(F, 'anim', 1000, 5000 + PRESS_MS); assert.notEqual(F.scr, SCR.HOME, 'the row\'s action: the second entry');
  assert.equal(prRow(F), -1); assert.ok(!animating(F));
  const G = pick(); go(G, [['press', ['row', 2, 'item', 2, 0, true]], 'back']); assert.equal(G.cur, 2, 'BACK during the flash: the tap runs first (the third exercise)'); assert.equal(G.scr, SCR.PICK, 'then BACK on the set screen it opened: the list');
  const C = pick(); for (let i = 0; i < 4; i++) go(C, [['drag', [.06, i * 60]]]); go(C, [['dragEnd', 190], ['press', ['row', 2, 'item', 2, 200, true]]]);
  assert.equal(C.scr, SCR.PICK); assert.ok(!animating(C), 'stopped'); assert.ok(Number.isInteger(listPos(C)));
});
test('27.11.6 a drag whose end never comes is let go after a while; the pause hold needs frames', () => {
  const F = pick(); go(F, [['drag', [.05, 0]]]); assert.ok(!stepDue(F, 1000)); assert.ok(stepDue(F, 1600)); handle(F, 'anim', 1000, 1600); run(F, 1600); assert.equal(listPos(F), 0);
  assert.ok(!needsFrame(F));
});
test('27.11.6 the wheel: the next row one finger pitch away, closer towards the edge, bands 0 / 1 / 2', () => {
  const S = 260, r = wheelRows(S, 2, 8, .2, 0), y = i => r.find(x => x[0] === i)[2];
  assert.deepEqual(r.map(x => x[0]), [0, 1, 2, 3, 4], 'up to 2 rows each side'); assert.ok(Math.abs(y(2) - S / 2) < 1e-9); assert.ok(Math.abs(y(3) - y(2) - .2 * S) < 1e-9);
  assert.ok(y(4) - y(3) < y(3) - y(2), 'closer towards the edge'); assert.ok(Math.abs(y(2) - y(1) - (y(3) - y(2))) < 1e-9, 'symmetric');
  const g = wheelRows(S, 2, 8, .2, 10); assert.ok(Math.abs(g[3][2] - y(3) - 10) < 1e-9, 'the sub line\'s room below the centre');
  assert.deepEqual([0, .49, -.49, .5, 1.49, -1.5, 2.4].map(wheelBand), [0, 0, 0, 1, 1, 2, 2]);
  const m = wheelRows(S, 2.4, 8, .2, 0); assert.ok(m.every((x, i) => i === 0 || x[2] > m[i - 1][2]), 'mid-drag: in order'); assert.ok(Math.abs(m.find(x => x[0] === 2)[2] - S / 2 + .42 * S * Math.sin(Math.asin(.2 / .42) * .4)) < 1e-9);
});
test('27.11.6 version 27.11.6 on the watch and in the preview', () => {
  assert.equal(VERSION, '27.11.6');
  assert.match(readFileSync(new URL('../garmin/source/Flow.mc', import.meta.url), 'utf8'), /RF_VERSION = "27\.11\.6"/);
});
test('27.11.6 the trainer chooser: Free ride / Training, the categories with workouts, a category\'s workouts; BACK one step up; the category from the data', async () => {
  const { setRides, rides, catOf, tCats, tRows, catName, FREE_RIDE, TRAINING } = await import('../js/watchflow.js');
  const { WORKOUTS, rideCat, setFtp, isHard } = await import('../js/workouts.js');
  const { wkFromRide, WK_FB_ID } = await import('../js/watchtrainer.js');
  const F = mk(), w = (id, c) => ({ id, n: 'W ' + id, s: [[600, 200]], ...(c ? { c } : {}) });
  setRides(F, [w('a1', 't'), w(WK_FB_ID, 'v'), w('b1', 'e'), w('c1'), w('a2', 't'), w('d1', 'x')], 250);
  assert.deepEqual(tCats(F), ['e', 't', 'v', 'o'], 'CATS order, only the ones with workouts; none or an unknown letter: Other');
  F.scr = SCR.TPICK; F.tlev = 0; F.sel = 0; assert.deepEqual(listItems(F), [FREE_RIDE, TRAINING]);
  go(F, [['item', 1]]); assert.equal(F.tlev, 1); assert.deepEqual(listItems(F), ['Endurance', 'Threshold', 'VO2max', 'Other']);
  go(F, ['down', 'start']); assert.equal(F.tlev, 2); assert.equal(F.tcat, 't'); assert.deepEqual(listItems(F), ['W a1', 'W a2']); assert.deepEqual(tRows(F), [0, 4]);
  go(F, ['back']); assert.equal(F.tlev, 1); assert.equal(F.sel, 1, 'BACK: the category selected'); go(F, ['back']); assert.equal(F.tlev, 0); assert.equal(F.sel, 1);
  go(F, [['item', 1], ['item', 3]]); assert.deepEqual(listItems(F), ['W c1', 'W d1']); go(F, ['down', 'start']); assert.equal(F.tw, 6, 'the workout chosen (rides index + 1)'); assert.equal(F.scr, SCR.TSCAN, 'not connected: the trainer\'s state');
  assert.equal(catName('x'), 'Other'); assert.equal(catOf({ c: 'f' }), 'f'); assert.equal(rides(F).length, 6);
  // the data: every built-in has its category, ids unchanged; others by their hardest step; the watch gets the letter
  for (const x of WORKOUTS) assert.ok(x.cat, x.id + ' has a category');
  const st = (m, p, p2) => ({ dur: m * 60, pct: p, ...(p2 ? { pct2: p2 } : {}) });
  assert.equal(rideCat({ steps: [st(10, 50, 70), st(40, 70)] }), 'endurance'); assert.equal(rideCat({ steps: [st(10, 50), st(10, 92)] }), 'threshold');
  assert.equal(rideCat({ steps: [st(3, 118), st(3, 50)] }), 'vo2max'); assert.equal(rideCat({ steps: [{ dur: 30, pct: 170 }, st(4, 50)] }), 'anaerobic');
  assert.equal(rideCat({ name: 'My 8 min test', steps: [st(8, 105)] }), 'ftp'); assert.equal(rideCat({ cat: 'vo2max', steps: [] }), 'vo2max');
  setFtp(250); const c = wkFromRide({ ...WORKOUTS[0], cat: rideCat(WORKOUTS[0]) }, 250, isHard); assert.equal(c.c, 't'); assert.equal(c.id, 'ss3x10');
  assert.equal(wkFromRide(WORKOUTS[0], 250, isHard).c, 't', 'the built-in carries its own'); assert.equal(wkFromRide({ ...WORKOUTS[0], cat: undefined }, 250, isHard).c, undefined);
});
test('27.11.6 the chooser is mirrored in garmin/source (Flow.mc CAT_K / CAT_N / TRAINING, Trainer.mc wkFallback "c", Draw.mc drawTPick)', async () => {
  const { CATS, TRAINING } = await import('../js/watchflow.js');
  const fmc = readFileSync(new URL('../garmin/source/Flow.mc', import.meta.url), 'utf8'), tmc = readFileSync(new URL('../garmin/source/Trainer.mc', import.meta.url), 'utf8'), dmc = readFileSync(new URL('../garmin/source/Draw.mc', import.meta.url), 'utf8');
  assert.ok(fmc.includes(`const CAT_K = [${CATS.map(c => `"${c[0]}"`).join(', ')}];`)); assert.ok(fmc.includes(`const CAT_N = [${CATS.map(c => `"${c[1]}"`).join(', ')}];`));
  assert.ok(fmc.includes(`const TRAINING = "${TRAINING}";`)); assert.match(tmc, /"n" => "30\/15, 3 x 13", "c" => "v"/);
  for (const f of ['tPick', 'tSel', 'tUp', 'tCats', 'tRows', 'catOf', 'catName']) assert.match(fmc, new RegExp(`function ${f}\\(`), f);
  assert.match(dmc, /F\.tlev == 2/); assert.match(fmc, /else if \(s == S_TPICK\) \{ tUp\(\); \}/);
});
