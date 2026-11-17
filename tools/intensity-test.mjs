// Live watt tuning in a workout (js/workouts.js), workoutState (everything the workout display needs, ERG ramps, the
// easy-step offset), ramp steps in own workouts, and the group wire format (nothing about a workout crosses it).
// Live watt tuning: an offset in W on the hard intervals only (pct >= 88, not a free test
// block), ±150 W, never below 50 W, the chart drawn at the tuned target; and the "VO2max 5 × 5" preset.
// Usage: node --test tools/intensity-test.mjs   (no browser, no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKOUTS, workoutById, workoutAt, workoutDuration, workoutSVG, defFrom, buildMy, isHard, tuneAdj, tunedTarget, fmtAdj, WADJ_MAX, workoutState, pctAt, Ramp } from '../js/workouts.js';
import { Group } from '../js/group.js';

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

const V = workoutById('vo2_5x5'), F = 250; // warm-up 0-600 s, VO2max 1/5 600-900 (275 W), Rest 900-1200 (125 W), VO2max 2/5 1200-1500 ...

test('workoutState: step, hard numbering, next, totals, countdown', () => {
  const a = workoutState(V, 605, F, { hardAdj: 10 });
  assert.equal(a.name, 'VO2max 1/5'); assert.equal(a.hard, true); assert.equal(a.hardNo, 1); assert.equal(a.hardCount, 5); assert.equal(a.nextHardNo, 2);
  assert.equal(a.target, 285); assert.equal(a.plateau, 285); assert.equal(a.lo, 271); assert.equal(a.hi, 299);
  assert.equal(a.left, 295); assert.equal(a.nextName, 'Rest'); assert.equal(a.nextTarget, 125); assert.equal(a.nextDur, 300);
  assert.equal(a.totalLeft, 3600 - 605); assert.equal(a.countdown, 0); assert.equal(a.ramp, null);
  const r = workoutState(V, 1000, F, { hardAdj: 10 });
  assert.equal(r.hardNo, 0); assert.equal(r.nextHardNo, 2); assert.equal(r.target, 125); assert.equal(r.nextTarget, 285, 'next interval previewed with the offset');
  assert.equal(workoutState(V, 1197.5, F).countdown, 3); assert.equal(workoutState(V, 1199.2, F).countdown, 1);
  const st = a.steps; assert.equal(st.length, V.steps.length); assert.ok(st.filter(x => x.hard).every(x => Math.abs(x.pct - 114) < 1e-9), 'hard heights carry the offset (285 W = 114 %)');
  assert.ok(st.filter(x => !x.hard).every((x, k) => x.pct === V.steps.filter(y => !isHard(y))[k].pct));
  const d = workoutState(V, 3600, F); assert.equal(d.done, true); assert.equal(d.target, null); assert.equal(d.totalLeft, 0);
});

test('ERG ramps: 10 s up into a hard interval, 5 s down after it; no wall', () => {
  const at = t => workoutState(V, t, F, { ramp: true }).target;
  assert.equal(at(589), 188, 'warm-up 75 % before the ramp');
  assert.equal(at(590), 188); assert.equal(at(595), Math.round(188 + (275 - 188) * 0.5)); assert.equal(at(599.9), Math.round(188 + 87 * 0.99));
  assert.equal(workoutState(V, 595, F, { ramp: true }).ramp, 'in');
  assert.equal(at(600), 275, 'the interval itself is flat');
  assert.equal(at(900), 275); assert.equal(at(902.5), 200); assert.equal(at(905), 125); assert.equal(workoutState(V, 902, F, { ramp: true }).ramp, 'out');
  // the ramp ends on the tuned interval target
  assert.equal(workoutState(V, 599.99, F, { ramp: true, hardAdj: 20 }).target, 295);
  // without ERG (ramp false) the target jumps as defined
  assert.equal(workoutState(V, 595, F).target, 188); assert.equal(workoutState(V, 902, F).target, 125);
  // monotone: never a jump bigger than the ramp slope allows
  let last = at(585); for (let t = 585; t < 610; t += 0.25) { const x = at(t); assert.ok(Math.abs(x - last) <= 3, `step at ${t}: ${last} -> ${x}`); last = x; }
  // no ramp into a free test block
  const ftp20 = workoutById('ftp20'), tFree = ftp20.steps.slice(0, 4).reduce((s, x) => s + x.dur, 0);
  assert.equal(workoutState(ftp20, tFree - 5, F, { ramp: true }).ramp, null);
});

test('easy-step offset only moves a non-hard step', () => {
  const r = workoutState(V, 1000, F, { hardAdj: 10, stepAdj: 15 }); assert.equal(r.target, 140); assert.equal(r.plateau, 140);
  const h = workoutState(V, 605, F, { hardAdj: 10, stepAdj: 15 }); assert.equal(h.target, 285, 'a hard step ignores it');
  assert.equal(workoutState(V, 1000, F, { stepAdj: -150 }).target, 50, 'floor 50 W');
  // ramp-in starts from the adjusted easy step
  assert.equal(workoutState(V, 1195, F, { ramp: true, stepAdj: 15, hardAdj: 10 }).target, Math.round(140 + (285 - 140) * 0.5));
});

test('ramp steps: opt-in, linear, in the builder and the chart', () => {
  const r = Ramp(10, 45, 75, 'Warm-up'); assert.deepEqual(r, { dur: 600, pct: 45, label: 'Warm-up', to: 75 });
  assert.equal(pctAt(r, 0), 45); assert.equal(pctAt(r, .5), 60); assert.equal(pctAt(r, 1), 75); assert.equal(pctAt({ pct: 80 }, .5), 80);
  const w = { steps: [r, { dur: 300, pct: 110, label: 'Go' }] };
  assert.equal(workoutAt(w, 300, 200).target, 120); assert.equal(workoutState(w, 300, 200).target, 120); assert.equal(workoutState(w, 300, 200).ramp, 'step');
  assert.equal(workoutState(w, 595, 200, { ramp: true }).target, 185, 'ERG ramp-in starts from the ramp step\'s end (150 W) to 220 W');
  assert.match(workoutSVG(w), /<polygon /, 'a ramp step is drawn as a slope');
  const my = buildMy({ id: 'my_r', name: 'R', warm: false, cool: false, rows: [{ t: 'b', min: 10, pct: 45, toPct: 75, label: 'Warm-up' }, { t: 'b', min: 5, pct: 90, label: 'SS' }] });
  assert.equal(my.steps[0].to, 75); assert.equal(my.steps[1].to, undefined); assert.match(my.what, /10 min 45–75 %/);
  assert.equal(defFrom(my).rows[0].toPct, 75, 'round trip keeps the ramp');
  // existing workouts stay flat
  assert.ok(WORKOUTS.every(x => x.steps.every(s => s.to == null)));
  assert.ok(buildMy({ id: 'x', rows: [{ t: 'b', min: 5, pct: 70 }] }).steps.every(s => s.to == null));
});

test('group wire: nothing about a workout, ERG target, offset, intensity or pause control crosses it', () => {
  const g = Object.assign(Object.create(Group.prototype), { me: { id: 'me' }, riders: new Map(), host: false, lastD: new Map(), onChange() {} });
  g._recv({ t: 'state', r: { id: 'friend', name: 'F', d: 100, v: 8, w: 250, riding: true, erg: 400, target: 400, wAdj: 150, sAdj: 50, intensity: 150, workout: 'x', paused: true, setPower: 999, grade: 20 } }, {});
  const r = g.riders.get('friend');
  assert.deepEqual(Object.keys(r).sort(), ['cr', 'd', 'done', 'hr', 'id', 'look', 'name', 'pid', 'riding', 'seen', 'sg', 'v', 'vo', 'w'].sort());
  for (const t of ['erg', 'power', 'workout', 'pause', 'target', 'cmd']) { const before = JSON.stringify([...g.riders]); g._recv({ t, r: { id: 'friend' }, watts: 999 }, {}); assert.equal(JSON.stringify([...g.riders]), before, `message "${t}" is ignored`); }
  assert.equal(g._recv({ t: 'state', r: { id: 'me', d: 5 } }, {}), undefined); assert.equal(g.me.d, undefined, 'our own state is never set from the wire');
});
