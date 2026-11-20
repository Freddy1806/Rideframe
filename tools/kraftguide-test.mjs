// Guided strength workouts (js/kraftguide.js): plan lengths, step order, the level-up rule and the saved workout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, planOf, buildSteps, planSeconds, efforts, standing, targetsFor, toWorkout, bestsOf, GUIDE_EX } from '../js/kraftguide.js';

const run = (plan, lvl, tg, secs, t) => { // a finished session where every hold / negative reached `secs`
  const steps = buildSteps(plan, lvl, tg), res = {}; for (const e of efforts(steps)) res[e.n] = e.kind === 'reps' ? e.reps : secs;
  return toWorkout(plan, { wid: 'w' + t, lvl, tg, start: t, dur: 1200 }, steps, res, t + 1200e3);
};

test('every plan lands between 18 and 22 minutes at every level and target', () => {
  for (const p of PLANS) for (const tg of [p.base, { hold: 10, neg: 10 }]) {
    const m = planSeconds(buildSteps(p, 1, tg)) / 60; assert.ok(m >= 18 && m <= 22, `${p.id} ${JSON.stringify(tg)}: ${m.toFixed(1)} min`);
  }
});

test('step order: get ready before every effort, rest after every effort but the last; left before right', () => {
  const p = planOf('oapull'), s = buildSteps(p, 1);
  assert.equal(efforts(s).length, 2 + 6 + 6);
  assert.equal(s[0].kind, 'ready'); assert.equal(s[1].kind, 'reps'); assert.equal(s[2].kind, 'rest'); assert.equal(s[2].sec, 75);
  assert.equal(s.at(-1).kind, 'neg'); assert.equal(s.length, 14 * 3 - 1);
  const holds = s.filter(x => x.kind === 'hold'); assert.deepEqual(holds.map(x => x.side).join(''), 'LRLRLR'); assert.ok(holds.every(x => x.target === 6));
  assert.ok(s.filter(x => x.kind === 'neg').every(x => x.target === 5 && /aim for 5 s/.test(x.what)));
  const push = buildSteps(planOf('oapush'), 2); assert.equal(efforts(push).length, 2 + 6 + 8);
  assert.equal(push.find(x => x.kind === 'reps').reps, 10);
});

test('saved workout: one exercise per arm, seconds as time sets, reps as bodyweight sets', () => {
  const p = planOf('oapull'), w = run(p, 2, p.base, 7, 1e12);
  assert.deepEqual(w.ex.map(x => x.k), ['pull', 'oap_hold_l', 'oap_hold_r', 'oap_neg_l', 'oap_neg_r']);
  assert.equal(w.ex[0].t, 'bw'); assert.deepEqual(w.ex[0].sets[0], { kg: '', r: 5, s: '', done: true });
  assert.equal(w.ex[1].t, 'time'); assert.equal(w.ex[1].sets.length, 3); assert.deepEqual(w.ex[1].sets[0], { kg: '', r: '', s: 7, done: true, lvl: 2 });
  assert.equal(w.ex[1].n, 'One-arm lock-off hold (left)');
  assert.deepEqual(w.guide, { id: 'oapull', lvl: 2, hold: 6, neg: 5 });
  assert.deepEqual(bestsOf(p, w), { hold: { L: 7, R: 7 }, neg: { L: 7, R: 7 } });
  assert.ok(GUIDE_EX.some(e => e.k === 'oapu_neg_r' && e.t === 'time' && e.g === 'Chest'));
});

test('level up after two sessions in a row with every hold and negative >= 8 s', () => {
  const p = planOf('oapull');
  assert.deepEqual(standing(p, []), { lvl: 1, tg: p.base, up: false, real: false });
  const a = run(p, 1, p.base, 8, 2e12), b = run(p, 1, p.base, 9, 1e12), weak = run(p, 1, p.base, 7, 1e12);
  assert.equal(standing(p, [a]).up, false, 'one session is not enough');
  assert.equal(standing(p, [a, weak]).up, false, 'the session before was too short');
  const s = standing(p, [a, b]); assert.equal(s.up, true); assert.equal(s.lvl, 2);
  const lvl2 = run(p, 2, p.base, 9, 3e12); assert.equal(standing(p, [lvl2, a]).up, false, 'two in a row at the same level');
  const partial = { ...a, ex: a.ex.map(x => x.k === 'oap_neg_r' ? { ...x, sets: x.sets.slice(1) } : x) };
  assert.equal(standing(p, [partial, b]).up, false, 'a skipped effort does not count');
});

test('level 3: targets rise up to 10 s, then a real one-arm rep is suggested', () => {
  const p = planOf('oapush');
  assert.deepEqual(targetsFor(p, [], 3), { hold: 6, neg: 5 });
  const s1 = run(p, 3, { hold: 6, neg: 5 }, 6, 1e12); assert.deepEqual(targetsFor(p, [s1], 3), { hold: 7, neg: 6 });
  const s2 = run(p, 3, { hold: 7, neg: 6 }, 6, 2e12); assert.deepEqual(targetsFor(p, [s2, s1], 3), { hold: 7, neg: 7 }, 'hold missed, negative reached');
  const top = run(p, 3, { hold: 10, neg: 10 }, 10, 3e12); const st = standing(p, [top]);
  assert.deepEqual(st.tg, { hold: 10, neg: 10 }); assert.equal(st.real, true); assert.equal(st.lvl, 3);
  assert.equal(standing(p, [run(p, 3, { hold: 10, neg: 10 }, 9, 3e12)]).real, false);
});
