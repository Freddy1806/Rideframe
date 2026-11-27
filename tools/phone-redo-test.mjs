// The phone redo of 27.11.: the Updates history (js/updates.js), the VO2max levels and ring (js/vo2lvl.js), the run workouts (js/runworkouts.js).
// Usage: node --test tools/phone-redo-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, unseen, KEEP } from '../js/updates.js';
import { levelOf, bounds, ageOf, ringSVG } from '../js/vo2lvl.js';
import { validateRun, runSteps, runMinutes, runLine, runSVG } from '../js/runworkouts.js';

const D = 864e5, T0 = Date.UTC(2026, 10, 27, 8);
test('updates: new lines are new, the same line again is not, a changed number updates in place, days later it is a new line', () => {
  let s = merge(null, [{ k: 'record', text: 'New best yesterday: best 5 min power 262 W.', href: 'statistik.html' }, { k: 'fitness', text: 'Fitness up 12 in 4 weeks, now 34.' }, { k: 'last', text: 'Last session today: x.' }], 'fd', T0);
  assert.equal(s.list.length, 2, '"Last session" is not news'); assert.equal(unseen(s), 2);
  s.seen = T0 + 1; assert.equal(unseen(s), 0);
  s = merge(s, [{ k: 'fitness', text: 'Fitness up 13 in 4 weeks, now 35.' }, { k: 'record', text: 'New best on Monday: best 5 min power 262 W.' }], 'fd', T0 + D);
  assert.equal(s.list.length, 2, 'same lines with new numbers or day words: no new entries'); assert.equal(unseen(s), 0); assert.match(s.list.find(x => x.k === 'fitness').text, /13/);
  s = merge(s, [{ k: 'fitness', text: 'Fitness up 15 in 4 weeks, now 37.' }], 'fd', T0 + 5 * D);
  assert.equal(s.list.filter(x => x.k === 'fitness').length, 2, 'days later: a new line, the old one stays as history'); assert.equal(unseen(s), 1);
  assert.equal(merge(s, [], 'other', T0).list.length, 0, 'another account starts empty');
  let big = null; for (let i = 0; i < 50; i++) big = merge(big, [{ k: 'x' + i, text: 'Line ' + 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'[i] }], 'fd', T0 + i);
  assert.equal(big.list.length, KEEP); assert.equal(big.list[0].k, 'x49', 'newest first');
});
test('VO2max levels: by age and sex (Cooper Institute), plain bands without them; the ring', () => {
  assert.equal(levelOf(57, { age: 38, sex: 'm' }).name, 'Superior'); assert.equal(levelOf(46, { age: 38, sex: 'm' }).name, 'Good');
  assert.equal(levelOf(46, { age: 38, sex: 'f' }).name, 'Excellent'); assert.equal(levelOf(30, { age: 25, sex: 'm' }).name, 'Poor');
  assert.equal(bounds({}).by, 'plain'); assert.equal(bounds({ age: 40, sex: 'm' }).by, 'age'); assert.equal(levelOf(52, {}).name, 'Excellent');
  assert.equal(ageOf(1988, Date.UTC(2026, 5, 1)), 38); assert.equal(ageOf(null), null);
  const r = ringSVG(52, { age: 38, sex: 'm' }, { label: 'Run' }); assert.match(r, />52</); assert.match(r, /Excellent/); assert.equal((r.match(/<path/g) || []).length, 5);
});
test('run workouts: checks, steps, minutes, the line and the shape', () => {
  assert.ok(validateRun({ name: '', rows: [{ t: 'b', min: 10 }] }).error); assert.ok(validateRun({ name: 'x', rows: [] }).error);
  const { w } = validateRun({ name: 'Intervals 6 × 3', warm: 12, cool: 8, rows: [{ t: 'i', n: 6, on: 3, off: 2, tgt: 'hard' }, { t: 'b', min: 999, tgt: 'nope' }] });
  assert.match(w.id, /^rw_/); assert.equal(w.rows[1].min, 180, 'clamped'); assert.equal(w.rows[1].tgt, 'steady', 'unknown effort -> steady');
  const st = runSteps(w); assert.equal(st.filter(s => s.tgt === 'hard').length, 6); assert.equal(st.filter(s => s.label === 'Jog').length, 5, 'no jog after the last rep');
  assert.equal(runMinutes(w), 12 + 6 * 3 + 5 * 2 + 180 + 8);
  assert.match(runLine(w), /^12 min easy · 6 × 3 min hard \/ 2 min jog/);
  assert.equal((runSVG(w).match(/<rect/g) || []).length, st.length);
});
