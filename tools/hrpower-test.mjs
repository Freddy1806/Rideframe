// Heart rate vs power (js/hrpower.js): synthetic rides with a modelled heart rate (first-order lag towards a power-dependent steady
// state plus slow drift): 3 × 13 × 30/15, 5 × 3 min / 3 min, a single interval, dropouts, no strap. Every metric is checked against
// values computed here independently from the generated arrays; the index edge cases, renormalised weights, the comparison
// across rides and the analysis of a saved ride (samples + workout definition).
// Usage: node --test tools/hrpower-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, compact, cleanHr, stemOf, stepsOf, hrpForRide, hrpOf, compareHrp, trend, aScale, bScale, cScale, W8 } from '../js/hrpower.js';
import { workoutById, setFtp } from '../js/workouts.js';
import { intervalRecords } from '../js/ivhistory.js';

/** plan: [{ dur, w, label, hard, target }] → { t, power, hr, steps } with t = 1 … N (sample t covers second t − 1 … t) */
function sim(plan, { hr = true, drift = 0.004, tauUp = 22, tauDn = 32, hr0 = 72, base = 52, k = 0.33 } = {}) {
  const t = [], power = [], H = [], steps = [], pw = []; let s = 0, h = hr0; // the heart answers the watts of 6 s ago (plus the lag)
  for (const st of plan) {
    steps.push({ start: s, end: s + st.dur, hard: !!st.hard, label: st.label, target: st.target ?? st.w });
    for (let i = 0; i < st.dur; i++) { s++; pw.push(st.w); const ss = base + k * pw[Math.max(0, pw.length - 7)] + drift * s; h += (ss - h) / (ss > h ? tauUp : tauDn); t.push(s); power.push(st.w); H.push(hr ? Math.round(h) : 0); }
  }
  return { t, power, hr: H, steps };
}
const warm = [{ dur: 600, w: 150, label: 'Warm-up' }], cool = [{ dur: 600, w: 120, label: 'Cool-down' }];
const plan3015 = (w = 340) => [...warm, ...[1, 2, 3].flatMap(k => [...Array.from({ length: 13 }, (_, i) => [{ dur: 30, w, label: `30 / 15 · set ${k} · ${i + 1}/13`, hard: true, target: 340 },
  ...(i < 12 ? [{ dur: 15, w: 125, label: 'Float' }] : [])]).flat(), ...(k < 3 ? [{ dur: 180, w: 130, label: 'Rest' }] : [])]), ...cool];
const plan5x3 = (w = 300) => [...warm, ...Array.from({ length: 5 }, (_, i) => [{ dur: 180, w, label: `VO2max ${i + 1}/5`, hard: true, target: 300 }, ...(i < 4 ? [{ dur: 180, w: 150, label: 'Rest' }] : [])]).flat(), ...cool];
const planSingle = [...warm, { dur: 1200, w: 260, label: 'Test 20 min', hard: true, target: 260 }, ...cool];

// ---- the independent reference: plain loops over the arrays (sample index = t − 1) ----
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const sl = (A, a, b) => A.slice(a, b); // seconds a+1 … b
function ref(R) {
  const { power: P, hr: H, steps } = R, N = H.length, hard = steps.filter(s => s.hard);
  const nextHard = b => hard.find(s => s.start >= b)?.start ?? N;
  const reps = hard.map(s => {
    const a = s.start, b = s.end, rEnd = nextHard(b), pe = Math.min(b + 20, rEnd);
    let pk = -1, pkT = 0; for (let x = a + 1; x <= pe; x++) if (H[x - 1] > pk) { pk = H[x - 1]; pkT = x; }
    let lo = Infinity; for (let x = Math.max(b, pkT) + 1; x <= rEnd; x++) lo = Math.min(lo, H[x - 1]);
    return { a, b, label: s.label, rEnd, rest: rEnd - b, w: avg(sl(P, a, b)), hr: avg(sl(H, a, b)), pk, hr0: H[a - 1], rise: pk - H[a - 1], drop: lo === Infinity ? NaN : pk - lo,
      d30: rEnd - b >= 30 ? pk - H[b + 30 - 1] : NaN, d60: rEnd - b >= 60 ? pk - H[b + 60 - 1] : NaN };
  });
  const sets = []; for (const r of reps) { const st = stemOf(r.label), s = sets[sets.length - 1]; if (s && s.stem === st) s.reps.push(r); else sets.push({ stem: st, reps: [r] }); }
  for (const s of sets) {
    const R2 = s.reps, k = Math.floor(R2.length / 3), L = R2[R2.length - 1];
    const all = (g, A) => g.flatMap(r => sl(A, r.a, r.b));
    s.hr0 = R2[0].hr0; s.w = avg(all(R2, P)); s.hr = avg(all(R2, H)); s.pk = Math.max(...R2.map(r => r.pk));
    if (k) { const f = R2.slice(0, k), l = R2.slice(-k), ef = g => avg(all(g, P)) / avg(all(g, H)); s.drift = avg(all(l, H)) - avg(all(f, H)); s.driftEf = (ef(l) - ef(f)) / ef(f) * 100; s.efF = ef(f); s.efL = ef(l); }
    s.hrr60 = L.rest >= 60 ? L.pk - H[L.b + 60 - 1] : NaN; s.hrr120 = L.rest >= 120 ? L.pk - H[L.b + 120 - 1] : NaN;
    s.back = null; for (let x = L.b + 1; x <= L.rEnd; x++) if (H[x - 1] < s.hr0 + 10) { s.back = x - L.b; break; }
    s.efAll = avg(all(R2, P)) / avg(all(R2, H));
  }
  return { reps, sets };
}
const near = (a, b, eps, m) => assert.ok(Math.abs(a - b) <= eps, `${m}: ${a} vs ${b}`);
const clamp = x => Math.max(0, Math.min(1, x));

test('cleaning: zeros and spikes are dropouts, gaps up to 5 s filled, longer gaps stay empty, a lasting jump is a new level', () => {
  const h = cleanHr([150, 0, 0, 153, 154, 220, 155, 0, 0, 0, 0, 0, 0, 160, 120, 120, 120, 120, 120, 120, 120]);
  assert.deepEqual(h.slice(0, 7), [150, 151, 152, 153, 154, 154.5, 155]);
  assert.ok(h.slice(7, 13).every(Number.isNaN), 'a 6 s gap stays empty');
  assert.equal(h[13], 160); assert.equal(h[14], 140, 'a jump of 40 bpm in 1 s is rejected (and filled)'); assert.equal(h[15], 120, '40 bpm in 2 s is allowed');
  const j = cleanHr([150, 150, 90, 90, 90, 90, 90, 90, 90]); assert.ok(Number.isNaN(j[2]) || j[2] > 90, 'a drop of 60 bpm is a dropout'); assert.equal(j[7], 90, 'after 5 s the new level counts'); assert.equal(stemOf('30 / 15 · set 2 · 3/13'), '30 / 15 · set 2'); assert.equal(stemOf('VO2max 1/5'), 'VO2max');
});

test('3 sets × 13 × 30/15: every rep, set and the index against the reference', () => {
  const R = sim(plan3015()), x = analyse(R), e = ref(R);
  assert.equal(x.reps.length, 39); assert.equal(x.sets.length, 3); assert.equal(x.ok, true);
  x.reps.forEach((r, i) => { const q = e.reps[i];
    near(r.w, q.w, 1e-9, `rep ${i} W`); near(r.hr, q.hr, 1e-9, `rep ${i} HR`); assert.equal(r.pk, q.pk, `rep ${i} peak`); assert.equal(r.rise, q.rise, `rep ${i} rise`);
    near(r.ef, q.w / q.hr, 1e-9, `rep ${i} EF`); assert.ok(Object.is(r.drop, q.drop) || r.drop === q.drop, `rep ${i} drop ${r.drop} vs ${q.drop}`);
    if (i % 13 === 12 && i < 38) { assert.equal(r.rest, 180); assert.equal(r.d60, q.d60); } else if (i < 38) { assert.equal(r.rest, 15); assert.ok(Number.isNaN(r.d30)); } });
  // the peak may come after the rep's end (heart rate lags), but never in the next rep
  assert.ok(x.reps.some(r => r.pkS > r.b), 'some peaks after the end'); assert.ok(x.reps.every(r => r.pkS <= r.rEnd));
  x.sets.forEach((s, i) => { const q = e.sets[i];
    assert.equal(s.label, `30 / 15 · set ${i + 1}`); assert.equal(s.n, 13); assert.equal(s.target, 340);
    near(s.w, q.w, 1e-9, 'set W'); near(s.hr, q.hr, 1e-9, 'set HR'); assert.equal(s.pk, q.pk);
    near(s.drift, q.drift, 1e-9, 'drift bpm'); near(s.driftEf, q.driftEf, 1e-9, 'drift EF %'); assert.ok(s.drift > 0, 'HR rises through the set');
    if (i < 2) { assert.equal(s.hrr60, q.hrr60); assert.equal(s.hrr120, q.hrr120); } else { assert.equal(s.hrr60, q.hrr60); assert.equal(s.hrr120, q.hrr120); }
    assert.equal(s.back ?? null, q.back); });
  // index by hand
  const h60 = e.sets.map(s => s.hrr60), a = clamp((avg(h60) - 10) / 30);
  const f = e.sets[0], l = e.sets[2], loss = (f.efAll - l.efAll) / f.efAll * 100, b = clamp(1 - loss / 12);
  const cs = e.sets.flatMap(s => s.reps.slice(0, -1).map(r => clamp(r.drop / (r.pk - s.hr0) / 0.5))), c = avg(cs);
  near(x.parts.a.v, a, 1e-9, 'a'); near(x.parts.b.v, b, 1e-9, 'b'); near(x.parts.c.v, c, 1e-9, 'c');
  assert.equal(x.parts.b.by, 'sets'); assert.equal(x.parts.c.kind, 'float');
  assert.equal(x.index, Math.round(100 * (0.5 * a + 0.3 * b + 0.2 * c)));
  assert.ok(x.index > 0 && x.index < 100, 'index ' + x.index);
  assert.equal(x.main.tg, 340); assert.equal(x.main.n, 39); assert.equal(x.main.hr, Math.round(avg(e.sets.flatMap(s => s.reps.flatMap(r => R.hr.slice(r.a, r.b))))));
  // the stored form: small, plain numbers
  const c0 = compact(x), js = JSON.stringify(c0);
  assert.ok(js.length < 3000, 'compact ' + js.length + ' bytes'); assert.equal(c0.index, x.index); assert.equal(c0.reps.length, 39); assert.equal(c0.sets[1].r60, Math.round(e.sets[1].hrr60));
  assert.deepEqual(c0.reps[0], [0, 340, Math.round(e.reps[0].hr), e.reps[0].pk, e.reps[0].rise, e.reps[0].drop, null]);
});

test('5 × 3 min / 3 min: one set, drift by thirds of reps, recovery in the long rests on the HRR60 scale', () => {
  const R = sim(plan5x3()), x = analyse(R), e = ref(R);
  assert.equal(x.sets.length, 1); assert.equal(x.sets[0].n, 5); assert.equal(x.sets[0].label, 'VO2max');
  const s = e.sets[0];
  near(x.sets[0].drift, avg(R.hr.slice(e.reps[4].a, e.reps[4].b)) - avg(R.hr.slice(e.reps[0].a, e.reps[0].b)), 1e-9, 'drift: rep 5 − rep 1');
  x.reps.forEach((r, i) => { assert.equal(r.d60, e.reps[i].d60); assert.equal(r.d30, e.reps[i].d30); assert.equal(r.drop, e.reps[i].drop); });
  const a = clamp((s.hrr60 - 10) / 30), loss = (s.efF - s.efL) / s.efF * 100, b = clamp(1 - loss / 12), c = avg(e.reps.slice(0, 4).map(r => clamp((r.d60 - 10) / 30)));
  assert.equal(x.parts.b.by, 'reps'); assert.equal(x.parts.c.kind, 'hrr60');
  near(x.parts.a.v, a, 1e-9, 'a'); near(x.parts.b.v, b, 1e-9, 'b'); near(x.parts.c.v, c, 1e-9, 'c');
  assert.equal(x.index, Math.round(100 * (0.5 * a + 0.3 * b + 0.2 * c)));
  assert.equal(x.sets[0].hrr120, s.hrr120); assert.equal(x.sets[0].back ?? null, s.back);
});

test('a single interval: only the recovery after it counts, weights renormalised', () => {
  const R = sim(planSingle), x = analyse(R), e = ref(R);
  assert.equal(x.ok, true); assert.deepEqual(Object.keys(x.parts), ['a']); assert.equal(x.parts.a.w, 1);
  assert.equal(x.index, Math.round(100 * clamp((e.sets[0].hrr60 - 10) / 30)));
  assert.equal(x.sets[0].drift, undefined, 'no drift with one rep');
});

test('renormalised weights: a and c without b (two sets of different kinds)', () => {
  const plan = [...warm, { dur: 120, w: 320, label: 'A 1/2', hard: true }, { dur: 120, w: 140, label: 'Rest' }, { dur: 120, w: 320, label: 'A 2/2', hard: true }, { dur: 240, w: 140, label: 'Rest' },
    { dur: 240, w: 280, label: 'B', hard: true }, ...cool];
  const x = analyse(sim(plan));
  // the main kind is B (240 s) vs A (2 × 120 s): equal time, A first; one set of 2 reps → no thirds → no b
  assert.ok(!x.parts.b, 'no drift part'); assert.ok(x.parts.a && x.parts.c);
  near(x.parts.a.w, W8.a / (W8.a + W8.c), 1e-12, 'weight a'); near(x.parts.c.w, W8.c / (W8.a + W8.c), 1e-12, 'weight c');
  assert.equal(x.index, Math.round(100 * (x.parts.a.w * x.parts.a.v + x.parts.c.w * x.parts.c.v)));
});

test('edge cases: under 3 min hard, no strap, HR missing > 20 %, no rest after the work, the scales', () => {
  const short = analyse(sim([...warm, { dur: 120, w: 300, label: 'X', hard: true }, ...cool]));
  assert.equal(short.ok, false); assert.match(short.reason, /3 minutes/); assert.equal(short.index, undefined);
  const none = analyse(sim(plan5x3(), { hr: false })); assert.equal(none.ok, false); assert.match(none.reason, /No heart rate/);
  const R = sim(plan5x3()); for (let i = 600; i < R.hr.length; i += 10) for (let k = 0; k < 4 && i + k < R.hr.length; k++) R.hr[i + k] = 0; // 4 s gaps: filled
  const f = analyse(R); assert.equal(f.ok, true); assert.equal(f.miss, 0);
  const M = sim(plan5x3()); for (let i = 600; i < M.hr.length; i += 20) for (let k = 0; k < 7; k++) M.hr[i + k] = 0; // 7 s gaps every 20 s: 35 % missing
  const m = analyse(M); assert.equal(m.ok, false); assert.match(m.reason, /missing for 3\d %/);
  const end = analyse(sim([...warm, { dur: 600, w: 280, label: 'End', hard: true }])); assert.equal(end.ok, false); assert.match(end.reason, /No rest/);
  assert.equal(aScale(10), 0); assert.equal(aScale(40), 1); assert.equal(aScale(25), 0.5); assert.equal(aScale(60), 1);
  assert.equal(bScale(0), 1); assert.equal(bScale(12), 0); assert.equal(bScale(-3), 1); assert.equal(bScale(6), 0.5);
  assert.equal(cScale(0), 0); assert.equal(cScale(0.5), 1); assert.equal(cScale(0.25), 0.5);
});

test('dropouts: zeros and spikes during a 30/15 ride change nothing that matters', () => {
  const clean = analyse(sim(plan3015())), R = sim(plan3015());
  for (const i of [700, 701, 702, 1000, 1500, 1501, 1502, 1503, 1504]) R.hr[i] = 0;
  for (const i of [800, 1200, 1700]) R.hr[i] = 240;
  const x = analyse(R);
  assert.equal(x.ok, true); assert.ok(Math.abs(x.index - clean.index) <= 1, `${x.index} vs ${clean.index}`);
  assert.ok(x.reps.every(r => r.pk < 200), 'no spike as a peak');
  x.sets.forEach((s, i) => near(s.hr, clean.sets[i].hr, 0.6, 'set HR'));
});

test('comparison: same workout and target, previous ride and the mean of the last 5; lower HR and faster drop are better', () => {
  const day = 864e5, now = Date.now();
  const mk = (i, k, drift) => ({ id: 'r' + i, date: now - i * day, workoutId: 'c_30_15_3x13', hrp: compact(analyse(sim(plan3015(), { k, drift }))) });
  const list = [mk(0, 0.31, 0.003), mk(3, 0.33, 0.004), mk(6, 0.34, 0.005), mk(9, 0.35, 0.006)];
  list.push({ id: 'other', date: now - 2 * day, workoutId: 'vo2_5x5', hrp: list[1].hrp }); // another workout: never compared
  const c = compareHrp(list[0], list);
  assert.equal(c.n, 3); assert.equal(c.prev.date, list[1].date);
  const hr = c.lines.find(l => l.k === 'hr'), d = list[0].hrp.main.hr - list[1].hrp.main.hr;
  assert.ok(d < 0); assert.equal(hr.d, d); assert.equal(hr.good, true);
  assert.equal(hr.text, `HR at 340 W: ${list[0].hrp.main.hr} bpm (−${-d} vs last time)`);
  assert.equal(hr.avg5, Math.round(avg(list.slice(1, 4).map(r => r.hrp.main.hr))));
  const ef = c.lines.find(l => l.k === 'ef'); assert.equal(ef.good, true); assert.match(ef.text, /^EF \d\.\d\d W\/beat \(\+\d+ %\)$/);
  const idx = c.lines.find(l => l.k === 'idx'); assert.equal(idx.text, `Recovery index ${list[0].hrp.index} (last ${list[1].hrp.index})`);
  assert.equal(compareHrp(list[3], list), null, 'the first ride has nothing to compare with');
  const other = { ...list[0], id: 'x', hrp: compact(analyse(sim(plan3015(360)))) }; other.hrp.main.tg = 360;
  assert.equal(compareHrp(other, list), null, 'another target (360 W) is another thing');
  const tr = trend(list, 'c_30_15_3x13'); assert.equal(tr.length, 4); assert.ok(tr[0].date < tr[3].date); assert.equal(tr[3].index, list[0].hrp.index);
});

test('a saved ride: the coach workout from its samples and saved intervals, also afterwards (no hrp stored)', () => {
  setFtp(280); const w = workoutById('c_30_15_3x13'), FTP = 280, t0 = 95; // the workout was picked 95 s into the ride
  const plan = [{ dur: t0, w: 120, label: 'Before' }, ...w.steps.map(st => ({ dur: st.dur, w: st.watts || Math.round((st.pct2 != null ? (st.pct + st.pct2) / 2 : st.pct) / 100 * FTP), label: st.label, hard: (st.watts ? st.watts / FTP * 100 : st.pct) >= 88 }))];
  const R = sim(plan), samples = R.t.map((t, i) => [t, t * 8, R.power[i], 30, 90, R.hr[i]]);
  const ivs = intervalRecords({ workout: w, t0, samples, elapsed: R.t.length, ftp: FTP });
  const rec = { id: 'x', date: Date.now(), workoutId: w.id, duration: R.t.length, samples, ivs };
  const live = hrpForRide(rec, w, { t0, ftp: FTP }), later = hrpForRide(rec, w);
  assert.deepEqual(later, live, 't0 found again from the saved intervals');
  assert.equal(live.ok, true); assert.equal(live.sets.length, 3); assert.equal(live.reps.length, 39, 'the 10 s warm-up sprints are no reps');
  assert.equal(live.main.tg, 370); assert.deepEqual(live.sets.map(s => s.l), ['30 / 15 · set 1', '30 / 15 · set 2', '30 / 15 · set 3']);
  const st = stepsOf(w, { t0, ftp: FTP }); assert.equal(st[0].start, t0); assert.equal(st.filter(s => s.hard && s.end - s.start === 30).length, 39);
  assert.deepEqual(hrpOf(rec, id => id === w.id ? w : null), live, 'hrpOf computes it for an old ride');
  assert.equal(hrpOf({ ...rec, hrp: { v: 1, ok: false, reason: 'stored' } }, () => w).reason, 'stored', 'a stored analysis wins');
  assert.equal(hrpOf({ ...rec, workoutId: undefined }, () => w), null, 'no workout: nothing');
});
