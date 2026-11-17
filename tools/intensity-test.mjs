// Live watt tuning in a workout (js/workouts.js): an offset in W on the hard intervals only (pct >= 88, not a free test
// block), ±150 W, never below 50 W, the chart drawn at the tuned target; and the "VO2max 5 × 5" preset.
// Usage: node --test tools/intensity-test.mjs   (no browser, no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKOUTS, workoutById, workoutAt, workoutDuration, workoutSVG, defFrom, buildMy, isHard, tuneAdj, tunedTarget, fmtAdj, WADJ_MAX } from '../js/workouts.js';

test('isHard: pct >= 88 and not a free test block', () => {
  assert.equal(isHard({ pct: 110 }), true);
  assert.equal(isHard({ pct: 88 }), true);
  assert.equal(isHard({ pct: 87 }), false);
  assert.equal(isHard({ pct: 100, free: true }), false);
  assert.equal(isHard(null), false);
});

test('tuneAdj: steps of 5 or 1 W, clamped to ±150', () => {
  assert.equal(WADJ_MAX, 150);
  assert.equal(tuneAdj(0, 5), 5);
  assert.equal(tuneAdj(5, 5), 10);
  assert.equal(tuneAdj(10, -5), 5);
  assert.equal(tuneAdj(0, -1), -1);
  assert.equal(tuneAdj(undefined, 5), 5, 'no offset yet counts as 0');
  let a = 0; for (let i = 0; i < 40; i++) a = tuneAdj(a, 5); assert.equal(a, 150);
  a = 0; for (let i = 0; i < 40; i++) a = tuneAdj(a, -5); assert.equal(a, -150);
  assert.equal(tuneAdj(148, 5), 150); assert.equal(tuneAdj(-148, -5), -150);
  assert.equal(tuneAdj(0, 'x'), 0);
});

test('tunedTarget: only hard steps move, never below 50 W', () => {
  const hard = { pct: 110 }, rest = { pct: 50 }, free = { pct: 100, free: true };
  assert.equal(tunedTarget(hard, 275, 10), 285);
  assert.equal(tunedTarget(hard, 275, -5), 270);
  assert.equal(tunedTarget(hard, 275, 0), 275);
  assert.equal(tunedTarget(rest, 125, 10), 125, 'rest stays');
  assert.equal(tunedTarget(free, 250, 10), 250, 'a free test block stays');
  assert.equal(tunedTarget(hard, 120, -150), 50, 'floor 50 W');
  assert.equal(tunedTarget(hard, null, 10), null, 'no target stays no target');
  assert.equal(tunedTarget(null, 100, 10), 100);
});

test('fmtAdj', () => {
  assert.equal(fmtAdj(10), '+10 W'); assert.equal(fmtAdj(-5), '−5 W'); assert.equal(fmtAdj(0), '±0 W'); assert.equal(fmtAdj(undefined), '±0 W');
});

test('workoutSVG draws the hard bars at the tuned target, unchanged without an offset', () => {
  const w = workoutById('vo2_5x5');
  assert.equal(workoutSVG(w, 0), workoutSVG(w, 0, 46, 0, 250));
  const hgt = svg => Math.max(...[...svg.matchAll(/height="([\d.]+)"/g)].slice(1).map(m => +m[1])); // tallest bar (first match is the svg)
  const ys = svg => [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)"/g)].map(m => +m[1]);
  const plain = ys(workoutSVG(w, null, 46)), up = ys(workoutSVG(w, null, 46, 50, 250)); // 275 -> 325 W = 130 % FTP
  const iHard = w.steps.findIndex(isHard), iRest = w.steps.findIndex(s => s.label === 'Rest');
  assert.ok(up[iHard] < plain[iHard], 'hard bar taller (smaller y)');
  assert.notEqual(up[iRest], undefined); assert.ok(hgt(workoutSVG(w, null, 46, 50, 250)) <= 46);
});

test('VO2max 5 × 5: warm-up, 5 × (5 min 110 %, 5 min 50 %), cool-down', () => {
  const w = workoutById('vo2_5x5');
  assert.ok(w && WORKOUTS.includes(w));
  assert.equal(w.name, 'VO2max 5 × 5');
  assert.match(w.what, /^5 × 5 min at 110 % FTP, 5 min easy\./);
  const on = w.steps.filter(s => s.pct === 110), rest = w.steps.filter(s => s.label === 'Rest');
  assert.equal(on.length, 5); assert.ok(on.every(s => s.dur === 300 && isHard(s)));
  assert.deepEqual(on.map(s => s.label), [1, 2, 3, 4, 5].map(i => `VO2max ${i}/5`));
  assert.equal(rest.length, 4); assert.ok(rest.every(s => s.dur === 300 && s.pct === 50 && !isHard(s)));
  assert.equal(w.steps[0].label, 'Warm-up'); assert.equal(w.steps.at(-1).label, 'Cool-down');
  assert.equal(workoutDuration(w), (10 + 25 + 20 + 5) * 60);
  // first interval after the 10 min warm-up: FTP 250 -> 275 W, +10 W -> 285 W; the rest after it stays 125 W
  const a = workoutAt(w, 10 * 60 + 1, 250);
  assert.equal(a.step.label, 'VO2max 1/5'); assert.equal(a.target, 275);
  assert.equal(tunedTarget(a.step, a.target, 10), 285);
  assert.equal(tunedTarget(a.next, a.nextTarget, 10), 125);
  const r = workoutAt(w, 15 * 60 + 1, 250); // in the rest: the "then" preview is the next interval, tuned
  assert.equal(tunedTarget(r.next, r.nextTarget, 10), 285);
  // editable in the builder: one interval row
  const d = defFrom(w);
  assert.deepEqual(d.rows, [{ t: 'i', n: 5, onMin: 5, onPct: 110, offMin: 5, offPct: 50, label: 'VO2max' }]);
  assert.equal(workoutDuration(buildMy(d)), workoutDuration(w));
});
