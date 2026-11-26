// Body composition estimated from the scale's impedance (js/bodycomp.js) and where it shows up: the weight card (js/bodycard.js
// renderWeightCard, with a fake element) and "What changed" (js/insights.js). Expectations computed by hand from Sun et al. 2003.
// Usage: node --test tools/bodycomp-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/bodycomp.js';
import { insights } from '../js/insights.js';

const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≈ ${b}`);
const FREDDY = { heightCm: 183, sex: 'm', birthYear: 1993 }, NOW = new Date(2026, 10, 26, 7).getTime(), D = 864e5;

test('Sun 2003, men: 83.4 kg, 518.5 Ω, 183 cm -> FFM 63.36 kg, 24.0 % fat (by hand)', () => {
  // H²/R = 33489 / 518.5 = 64.588235; FFM = −10.68 + 0.65·64.588235 + 0.26·83.4 + 0.02·518.5 = −10.68 + 41.982353 + 21.684 + 10.37 = 63.356353
  close(C.ffmOf({ kg: 83.4, imp: 518.5, cm: 183, sex: 'm' }), 63.356353);
  // fat 83.4 − 63.356353 = 20.043647 kg = 24.03 %; water 0.73 · 63.356353 = 46.250 kg = 55.46 % of 83.4; BMI 83.4 / 1.83² = 24.90
  assert.deepEqual(C.compOf({ t: NOW, kg: 83.4, impedance: 518.5 }, FREDDY), { fatPct: 24, fatKg: 20, leanKg: 63.4, waterKg: 46.3, waterPct: 55.5, bmi: 24.9 });
});
test('Sun 2003, women: 65 kg, 600 Ω, 168 cm -> FFM 45.98 kg, 29.3 % fat (by hand)', () => {
  // H²/R = 28224 / 600 = 47.04; FFM = −9.53 + 0.69·47.04 + 0.17·65 + 0.02·600 = −9.53 + 32.4576 + 11.05 + 12 = 45.9776
  close(C.ffmOf({ kg: 65, imp: 600, cm: 168, sex: 'f' }), 45.9776);
  const c = C.compOf({ t: NOW, kg: 65, impedance: 600 }, { heightCm: 168, sex: 'f', birthYear: 1990 }); assert.equal(c.fatPct, 29.3); assert.equal(c.fatKg, 19); assert.equal(c.leanKg, 46);
});
test('nothing without a profile, an impedance, inside the age bounds, or with an absurd result', () => {
  const m = { t: NOW, kg: 83.4, impedance: 518.5 };
  assert.equal(C.compOf(m, { heightCm: 183, sex: 'm' }), null, 'no birth year'); assert.equal(C.compOf(m, { heightCm: 183, birthYear: 1993 }), null, 'no sex');
  assert.equal(C.compOf(m, { sex: 'm', birthYear: 1993 }), null, 'no height'); assert.equal(C.compOf({ t: NOW, kg: 83.4 }, FREDDY), null, 'no impedance (manual / import)');
  assert.equal(C.compOf(m, { ...FREDDY, birthYear: 2012 }), null, '14 years: not an adult'); assert.equal(C.compOf(m, { ...FREDDY, birthYear: 1925 }), null, '101 years: outside the sample');
  assert.equal(C.compOf({ t: NOW, kg: 83.4, impedance: 150 }, FREDDY), null, 'impedance below 200');
  assert.equal(C.compOf({ t: NOW, kg: 60, impedance: 250 }, FREDDY), null, 'FFM above the weight: below 3 % fat, a bad reading');
  assert.equal(C.compOf({ t: NOW, kg: 150, impedance: 1400 }, { heightCm: 160, sex: 'f', birthYear: 1980 }), null, 'above 60 %');
  assert.equal(C.ready(FREDDY), true); assert.equal(C.ready({ ...FREDDY, sex: 'x' }), false); assert.equal(C.ageAt(1993, NOW), 33);
});
test('series, trend shape, "enough" = 4 readings over 14 days', () => {
  const l = [0, 5, 10, 16].map((d, i) => ({ id: 'm' + i, t: NOW - (16 - d) * D, kg: 84 - i * 0.3, impedance: 515 + i * 2 })).concat([{ id: 'x', t: NOW, kg: 82.9 }]);
  const s = C.compSeries(l, FREDDY); assert.equal(s.length, 4, 'the manual one has no impedance'); assert.ok(s[0].t < s[3].t); assert.equal(C.enough(s), true);
  assert.equal(C.enough(s.slice(1)), false, '3 readings'); assert.equal(C.enough(C.compSeries(l.slice(1, 4).concat([{ id: 'y', t: NOW, kg: 83, impedance: 520 }]), FREDDY)), false, '11 days');
  assert.deepEqual(C.asKg(s, 'fatPct')[0], { id: 'm0', t: s[0].t, kg: s[0].fatPct }); assert.deepEqual(C.compSeries(l, {}), []);
});
test('insights: a body-fat line only with 4+ estimates over 14+ days and a complete profile', () => {
  const now = NOW, mk = (n, every) => [...Array(n)].map((_, i) => ({ id: 'b' + i, t: now - (n - 1 - i) * every * D, kg: 84 - i * 0.2, impedance: 520 + i * 3 }));
  const L = insights({ now, body: { list: mk(8, 5), prefs: FREDDY } }, 9), bf = L.find(x => x.k === 'bodyfat');
  assert.ok(bf, JSON.stringify(L)); assert.match(bf.text, /^Body fat \(est\.\) (down|up) \d+\.\d points in 30 days, about \d+\.\d %\.$/); assert.equal(bf.href, 'body.html');
  assert.deepEqual(L.map(x => x.k), ['weight', 'bodyfat'], 'right after the weight');
  assert.ok(!insights({ now, body: { list: mk(3, 7), prefs: FREDDY } }).some(x => x.k === 'bodyfat'), '3 readings');
  assert.ok(!insights({ now, body: { list: mk(6, 2), prefs: FREDDY } }).some(x => x.k === 'bodyfat'), '10 days');
  assert.ok(!insights({ now, body: { list: mk(8, 5), prefs: { heightCm: 183 } } }).some(x => x.k === 'bodyfat'), 'no sex / birth year');
  assert.ok(!insights({ now, body: { list: mk(8, 5).map(({ impedance, ...m }) => m), prefs: FREDDY } }).some(x => x.k === 'bodyfat'), 'no impedance');
});
test('weight card: body fat as the second value when the newest weigh-in has one, not otherwise', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const { renderWeightCard } = await import('../js/bodycard.js'), el = { innerHTML: '' }, t = Date.now();
  renderWeightCard(el, { list: [{ id: 'a', t: t - 3 * D, kg: 83.9, impedance: 520 }, { id: 'b', t, kg: 83.4, impedance: 518.5 }], prefs: FREDDY });
  assert.match(el.innerHTML, /class="bcfat"[^>]*>24\.0 % fat <small>est\.<\/small>/); assert.match(el.innerHTML, /Body fat about 24\.0 percent, estimated/);
  renderWeightCard(el, { list: [{ id: 'a', t: t - 3 * D, kg: 83.9, impedance: 520 }, { id: 'b', t, kg: 83.4 }], prefs: FREDDY }); assert.doesNotMatch(el.innerHTML, /bcfat/, 'the newest has none: an old estimate is not shown');
  renderWeightCard(el, { list: [{ id: 'b', t, kg: 83.4, impedance: 518.5 }], prefs: { heightCm: 183 } }); assert.doesNotMatch(el.innerHTML, /fat/);
});
