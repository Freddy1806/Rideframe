// Live watt tuning in a workout (js/workouts.js), workoutState (everything the workout display needs, ERG ramps, the
// easy-step offset), ramp steps in own workouts, and the group wire format (nothing about a workout crosses it).
// Live watt tuning: an offset in W on the hard intervals only (pct >= 88, not a free test
// block), ±150 W, never below 50 W, the chart drawn at the tuned target; and the "VO2max 5 × 5" preset.
// Usage: node --test tools/intensity-test.mjs   (no browser, no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKOUTS, workoutById, workoutAt, workoutDuration, workoutSVG, defFrom, buildMy, isHard, tuneAdj, tunedTarget, fmtAdj, WADJ_MAX, workoutState, pctAt, Ramp, timelineSVG, zoneColor } from '../js/workouts.js';
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
  const flat = w.steps.filter(s => s.pct2 == null), iHard = flat.findIndex(isHard), iRest = flat.findIndex(s => s.label === 'Rest'); // rects only: ramps are polygons
  assert.ok(up[iHard] < plain[iHard], 'hard bar taller (smaller y)');
  assert.notEqual(up[iRest], undefined); assert.ok(hgt(workoutSVG(w, null, 46, 50, 250)) <= 46);
});

const V = workoutById('vo2_5x5'), F = 250, A = V.steps.slice(0, V.steps.findIndex(x => x.label === 'VO2max 1/5')).reduce((t, x) => t + x.dur, 0); // A: start of VO2max 1/5
const RS = A + 300, B2 = RS + 240; // rest 1, VO2max 2/5

test('VO2max 5 × 5: ramp warm-up with openers, 5 × (5 min 110 %, 4 min 50 %), ramp cool-down', () => {
  const w = V;
  assert.ok(w && WORKOUTS.includes(w));
  assert.equal(w.name, 'VO2max 5 × 5');
  assert.match(w.what, /^5 × 5 min at 110 % FTP/);
  const on = w.steps.filter(s => /^VO2max/.test(s.label)), rest = w.steps.filter(s => s.label === 'Rest');
  assert.equal(on.length, 5); assert.ok(on.every(s => s.dur === 300 && s.pct === 110 && isHard(s)));
  assert.deepEqual(on.map(s => s.label), [1, 2, 3, 4, 5].map(i => `VO2max ${i}/5`));
  assert.equal(rest.length, 4); assert.ok(rest.every(s => !isHard(s)));
  assert.equal(w.steps[0].label, 'Warm-up'); assert.equal(w.steps[0].pct2, 75, 'the warm-up is a ramp'); assert.equal(w.steps.at(-1).label, 'Cool-down');
  const a = workoutAt(w, A + 1, 250);
  assert.equal(a.step.label, 'VO2max 1/5'); assert.equal(a.target, 275);
  assert.equal(tunedTarget(a.step, a.target, 10), 285);
  const d = defFrom(w);
  assert.equal(d.rows.length, 1); assert.equal(d.rows[0].n, 5); assert.equal(d.rows[0].onPct, 110);
});

test('workoutState: step, numbering within the series (openers apart), next, totals, countdown', () => {
  const a = workoutState(V, A + 5, F, { hardAdj: 10 }), R0 = Math.round(V.steps.find(x => x.label === 'Rest').pct / 100 * F);
  assert.equal(a.name, 'VO2max 1/5'); assert.equal(a.hard, true); assert.equal(a.hardNo, 1); assert.equal(a.hardCount, 5); assert.equal(a.nextHardNo, 2); assert.equal(a.series, 'VO2max');
  assert.equal(a.target, 285); assert.equal(a.plateau, 285); assert.equal(a.lo, 271); assert.equal(a.hi, 299);
  assert.equal(a.left, 295); assert.equal(a.nextName, 'Rest'); assert.equal(a.nextTarget, R0); assert.equal(a.nextDur, 240);
  assert.equal(a.totalLeft, workoutDuration(V) - A - 5); assert.equal(a.countdown, 0); assert.equal(a.ramp, null);
  const o = workoutState(V, V.steps.slice(0, V.steps.findIndex(x => x.label === 'Opener 2/3')).reduce((t, x) => t + x.dur, 0) + 5, F);
  assert.equal(o.hardNo, 2); assert.equal(o.hardCount, 3); assert.equal(o.series, 'Opener');
  const r = workoutState(V, RS + 100, F, { hardAdj: 10 });
  assert.equal(r.hardNo, 0); assert.equal(r.nextHardNo, 2); assert.equal(r.target, R0); assert.equal(r.nextTarget, 285, 'next interval previewed with the offset');
  assert.equal(workoutState(V, B2 - 2.5, F).countdown, 3); assert.equal(workoutState(V, B2 - 0.8, F).countdown, 1);
  const st = a.steps; assert.equal(st.length, V.steps.length); assert.ok(st.filter(x => x.hard && x.label.startsWith('VO2')).every(x => Math.abs(x.pct - 114) < 1e-9), 'hard heights carry the offset (285 W = 114 %)');
  assert.ok(st.filter(x => !x.hard).every((x, k) => x.pct === V.steps.filter(y => !isHard(y))[k].pct));
  const d = workoutState(V, workoutDuration(V), F); assert.equal(d.done, true); assert.equal(d.target, null); assert.equal(d.totalLeft, 0);
});

test('ERG ramps: 10 s up into a hard interval, 5 s down after it; no wall; none inside a ramp step', () => {
  const at = t => workoutState(V, t, F, { ramp: true }).target, R0 = Math.round(50 / 100 * F);
  assert.equal(at(A - 11), R0, 'spin before the ramp');
  assert.equal(at(A - 5), Math.round(R0 + (275 - R0) * 0.5)); assert.equal(workoutState(V, A - 5, F, { ramp: true }).ramp, 'in');
  assert.equal(at(A), 275, 'the interval itself is flat');
  assert.equal(at(RS), 275); assert.equal(at(RS + 2.5), Math.round(275 + (R0 - 275) * 0.5)); assert.equal(at(RS + 5), R0); assert.equal(workoutState(V, RS + 2, F, { ramp: true }).ramp, 'out');
  assert.equal(workoutState(V, A - 0.01, F, { ramp: true, hardAdj: 20 }).target, 295, 'the ramp ends on the tuned interval target');
  assert.equal(workoutState(V, A - 5, F).target, R0, 'without ERG the target jumps as defined');
  let last = at(A - 15); for (let t = A - 15; t < A + 10; t += 0.25) { const x = at(t); assert.ok(Math.abs(x - last) <= 6, `step at ${t}: ${last} -> ${x}`); last = x; }
  // the cool-down ramp after the last interval: the ramp step itself, no extra 5 s ramp-out on top
  const cd = workoutDuration(V) - V.steps.at(-1).dur, c = workoutState(V, cd + 2, F, { ramp: true });
  assert.equal(c.ramp, 'step'); assert.equal(c.target, Math.round((55 + (35 - 55) * 2 / V.steps.at(-1).dur) / 100 * F)); assert.equal(c.rampTo, Math.round(35 / 100 * F));
  const ftp20 = workoutById('ftp20'), fi = ftp20.steps.findIndex(x => x.free), tFree = ftp20.steps.slice(0, fi).reduce((t, x) => t + x.dur, 0);
  assert.equal(workoutState(ftp20, tFree - 5, F, { ramp: true }).ramp, null, 'no ramp into a free test block');
});

test('easy-parts offset (owner 17.11.): every non-hard step, kept the whole workout; hard steps have their own', () => {
  const r = workoutState(V, RS + 100, F, { hardAdj: 10, easyAdj: 15 }); assert.equal(r.target, 140); assert.equal(r.plateau, 140);
  const h = workoutState(V, A + 5, F, { hardAdj: 10, easyAdj: 15 }); assert.equal(h.target, 285, 'a hard step takes the interval offset only');
  assert.equal(workoutState(V, 100, F, { easyAdj: 15 }).target, workoutState(V, 100, F).target + 15, 'the warm-up ramp too');
  assert.equal(workoutState(V, RS + 3 * 540 + 100, F, { easyAdj: 15 }).target, workoutState(V, RS + 3 * 540 + 100, F).target + 15, 'a later rest too (not reset)');
  assert.equal(workoutState(V, RS + 100, F, { easyAdj: -150 }).target, 50, 'floor 50 W');
  assert.equal(workoutState(V, RS + 100, F, { easyAdj: 15 }).nextTarget, 275, 'the next interval preview is not moved by it');
  assert.equal(workoutState(V, A + 5, F, { easyAdj: 15 }).nextTarget, 140, 'the next rest preview is');
  assert.equal(workoutState(V, B2 - 5, F, { ramp: true, easyAdj: 15, hardAdj: 10 }).target, Math.round(140 + (285 - 140) * 0.5), 'ramp-in starts from the adjusted easy step');
  const st = workoutState(V, RS + 100, F, { hardAdj: 10, easyAdj: 15 }), rest = st.steps.findIndex(x => !x.hard && /Rest/.test(x.label)), hard = st.steps.findIndex(x => x.hard && x.label.startsWith('VO2'));
  assert.equal(Math.round(st.steps[rest].pct / 100 * F), 140); assert.equal(Math.round(st.steps[hard].pct / 100 * F), 285);
  const free = workoutById('ftp20'), fi = free.steps.findIndex(x => x.free);
  assert.equal(workoutState(free, 0, F, { easyAdj: 20 }).steps[fi].pct, free.steps[fi].pct, 'free blocks have no offset');
});

test('timeline: neon zone scale, current step glows, past dimmed', () => {
  assert.equal(zoneColor(50), '#3aa8ff'); assert.equal(zoneColor(65), '#2ee59d'); assert.equal(zoneColor(85), '#ffd23f'); assert.equal(zoneColor(100), '#ff5a1f'); assert.equal(zoneColor(110), '#ff3d1f'); assert.equal(zoneColor(150), '#ff1f3d');
  const st = workoutState(V, RS + 100, F), svg = timelineSVG(st, RS + 100, V);
  assert.equal((svg.match(/<rect [^>]*rx="3"/g) || []).length + (svg.match(/<polygon/g) || []).length, V.steps.length, 'one block per step');
  assert.equal((svg.match(/filter="url\(#wglow\)"/g) || []).length, 1, 'only the current step glows');
  assert.ok(svg.includes('opacity="0.3"') && svg.includes('opacity="0.72"'), 'past dimmed, future softer');
  assert.equal((svg.match(/<polygon/g) || []).length, V.steps.filter(x => x.pct2 != null).length, 'ramp steps (warm-up, cool-down) as slopes');
  assert.ok(!/#ff4fa3|pink|magenta/i.test(svg), 'no pink');
});

test('ramp steps (pct -> pct2): linear, in the builder and the charts', () => {
  const r = Ramp(10, 45, 75, 'Warm-up'); assert.deepEqual(r, { dur: 600, pct: 45, pct2: 75, label: 'Warm-up' });
  assert.equal(pctAt(r, 0), 45); assert.equal(pctAt(r, 300), 60); assert.equal(pctAt(r, 600), 75); assert.equal(pctAt({ pct: 80, dur: 60 }, 30), 80);
  const w = { steps: [r, { dur: 300, pct: 110, label: 'Go' }] };
  assert.equal(workoutAt(w, 300, 200).target, 120); assert.equal(workoutState(w, 300, 200).target, 120); assert.equal(workoutState(w, 300, 200).ramp, 'step');
  assert.equal(workoutState(w, 300, 200).rampTo, 150); assert.equal(workoutState({ steps: [{ dur: 60, pct: 50 }, r] }, 10, 200).nextRampTo, 150);
  assert.equal(workoutState(w, 595, 200, { ramp: true }).target, Math.round(pctAt(r, 595) / 100 * 200), 'no extra ERG smoothing inside a ramp step: it rises on its own');
  assert.match(workoutSVG(w), /<polygon /, 'a ramp step is drawn as a slope');
  const my = buildMy({ id: 'my_r', name: 'R', warm: false, cool: false, rows: [{ t: 'b', min: 10, pct: 45, toPct: 75, label: 'Ramp' }, { t: 'b', min: 5, pct: 90, label: 'SS' }] });
  assert.equal(my.steps[0].pct2, 75); assert.equal(my.steps[1].pct2, undefined); assert.match(my.what, /10 min 45–75 %/);
  assert.equal(defFrom(my).rows[0].toPct, 75, 'round trip keeps the ramp');
});

test('group wire: nothing about a workout, ERG target, offset, intensity or pause control crosses it', () => {
  const g = Object.assign(Object.create(Group.prototype), { me: { id: 'me' }, riders: new Map(), host: false, lastD: new Map(), onChange() {} });
  g._recv({ t: 'state', r: { id: 'friend', name: 'F', d: 100, v: 8, w: 250, riding: true, erg: 400, target: 400, wAdj: 150, sAdj: 50, intensity: 150, workout: 'x', paused: true, setPower: 999, grade: 20 } }, {});
  const r = g.riders.get('friend');
  assert.deepEqual(Object.keys(r).sort(), ['cr', 'd', 'done', 'hr', 'id', 'look', 'name', 'riding', 'seen', 'sg', 'v', 'w'].sort());
  for (const t of ['erg', 'power', 'workout', 'pause', 'target', 'cmd']) { const before = JSON.stringify([...g.riders]); g._recv({ t, r: { id: 'friend' }, watts: 999 }, {}); assert.equal(JSON.stringify([...g.riders]), before, `message "${t}" is ignored`); }
  assert.equal(g._recv({ t: 'state', r: { id: 'me', d: 5 } }, {}), undefined); assert.equal(g.me.d, undefined, 'our own state is never set from the wire');
});
