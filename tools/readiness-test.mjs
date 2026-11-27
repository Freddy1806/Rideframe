// Readiness rules of 27.11. (js/readiness.js header): "hard" needs real hardness, the cold start of the fitness numbers does not
// pull the value to the bottom, training numbers alone never say "Rest and recover" unless they are extreme.
// Usage: node --test tools/readiness-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness, parts, hardness, formTrust } from '../js/readiness.js';
import { pmcLoads } from '../js/fitness.js';
import { fitnessSummary } from '../js/cardlib.js';

const D = 864e5;
const at = (P, k) => P.find(p => p.k === k);

test('the owner\'s case: 1 h zone 2 yesterday, three weeks of data (ctl 14, form -22) is an easy day and good to train', () => {
  // the numbers really come out of the PMC like this: five 50-point days a week for three weeks
  const now = Date.now(), L = []; for (let d = 21; d >= 1; d--) if (d % 7 !== 0 && d % 7 !== 3) L.push([now - d * D, 50]);
  const p = pmcLoads(L, 90).at(-1); assert.ok(p.ctl < 15 && p.tsb < -20, JSON.stringify(p));
  const r = readiness({ form: p.tsb, load: { y: 50, ctl: p.ctl } }); // exactly what today.js inputsOf passes
  assert.equal(at(r.parts, 'load').hard, 'easy'); assert.match(r.why, /easy day/); assert.doesNotMatch(r.why, /hard/);
  assert.ok(r.score >= 55, String(r.score)); assert.ok(['Good to train', 'Ready'].includes(r.word), r.word);
  assert.equal(at(r.parts, 'form').w, 1, 'form counts less on a cold start'); assert.ok(r.notes.some(n => n.k === 'form'), 'and says so');
  // the old rule (y ≥ 1.5 × max(ctl, 20) = hard, form part 60 + 2 × form) gave 16 and 15: "Rest and recover"
});

test('1 h zone 2 with a low, established ctl: not hard, at least good to train', () => {
  for (const ctl of [5, 20, 30, 45]) for (const y of [40, 50, 60]) assert.equal(hardness({ y, ctl }).kind, 'easy', `${y} pts at ctl ${ctl}`);
  const r = readiness({ form: -8, load: { y: 55, ctl: 22 } }); assert.ok(r.score >= 55, String(r.score)); assert.match(r.why, /easy day/);
  // the intensity says it too: 70 points in one hour from a too-low FTP is still IF 0.84, but 3 h at IF 0.7 is no easy day
  assert.equal(hardness({ y: 70, ctl: 20, min: 60, if: 0.72 }).kind, 'easy', 'IF below 0.8: easy');
  assert.notEqual(hardness({ y: 150, ctl: 40, min: 180 }).kind, 'easy', '3 h is not easy');
});

test('a truly hard day is hard; a very big one very hard; for a fit athlete the same points are normal', () => {
  assert.equal(hardness({ y: 130, ctl: 40 }).kind, 'hard'); assert.equal(hardness({ y: 220, ctl: 40 }).kind, 'very hard');
  assert.equal(hardness({ y: 130, ctl: 90 }).kind, 'normal', '130 points at ctl 90 is a normal day');
  assert.equal(hardness({ y: 95, ctl: 30, min: 60, if: 0.97 }).kind, 'hard', 'an hour near threshold counts as hard even below 110 points');
  const r = readiness({ form: -12, load: { y: 160, ctl: 45 }, hist: 200 });
  assert.equal(at(r.parts, 'load').hard, 'hard'); assert.match(r.why, /hard day/); assert.ok(r.score < 55 && r.score >= 35, String(r.score));
  assert.equal(at(parts({ load: { y: 0, ctl: 10 } }), 'load').part, 90); assert.ok(at(parts({ load: { y: 50, ctl: 10 } }), 'load').part >= 80);
  // monotonic: more points never make yesterday look better
  let last = 101; for (let y = 0; y <= 400; y += 10) { const v = at(parts({ load: { y, ctl: 40 } }), 'load').part; assert.ok(v <= last, `${y}`); last = v; }
});

test('cold start: form counts less and cannot hold the value down; an established history counts fully', () => {
  assert.equal(formTrust({ form: -25, hist: 20 }).tier, 'cold'); assert.equal(formTrust({ form: -25, hist: 35, load: { ctl: 35 } }).tier, 'young');
  assert.equal(formTrust({ form: -10, load: { ctl: 10 } }).tier, 'cold', 'tiny ctl without hist'); assert.equal(formTrust({ form: -25, load: { ctl: 35 } }).tier, 'young', 'fatigue 1.7 × fitness: the start shape');
  assert.equal(formTrust({ form: -25, hist: 300, load: { ctl: 60 } }).tier, 'full'); assert.equal(formTrust({ form: -25 }).tier, 'full', 'nothing known: as before');
  const c = readiness({ form: -28, load: { y: 0, ctl: 12 }, hist: 18 });
  assert.equal(at(c.parts, 'form').part, 50); assert.match(c.why, /rest day/); assert.match(c.notes[0].text, /2 weeks of training history/);
  const withBb = readiness({ bb: 70, form: -28, load: { y: 40, ctl: 12 }, hist: 18 }); assert.ok(withBb.score >= 60, String(withBb.score));
  const est = readiness({ form: -28, load: { y: 40, ctl: 60 }, hist: 300 }); assert.equal(at(est.parts, 'form').w, 2); assert.match(est.why, /fatigue/);
  // cardlib passes the history length on
  const now = Date.now(), acts = [{ date: now - 20 * D }, { date: now - 2 * D }], F = fitnessSummary(acts, () => 50, { now });
  assert.equal(F.hist, 20);
});

test('training numbers alone: modest, "Rest and recover" only when really extreme', () => {
  const t = readiness({ form: -24, load: { y: 105, ctl: 30 } }); assert.ok(t.score >= 35, String(t.score)); assert.notEqual(t.word, 'Rest and recover');
  const fresh = readiness({ form: 25, load: { y: 0, ctl: 70 }, hist: 400 }); assert.ok(fresh.score <= 80, String(fresh.score));
  const x = readiness({ form: -40, load: { y: 260, ctl: 70 }, hist: 400 }); assert.equal(x.word, 'Rest and recover', String(x.score));
  const y = readiness({ form: -5, load: { y: 300, ctl: 40 }, hist: 400 }); assert.ok(y.score < 55, 'a 300-point day is felt');
  // with a body signal the floor is gone: a low body battery and a high resting HR can say rest
  const b = readiness({ bb: 12, rhr: { v: 58, avg: 50 }, form: -15, load: { y: 60, ctl: 40 }, hist: 400 }); assert.equal(b.word, 'Rest and recover'); assert.ok(!b.capped);
});
