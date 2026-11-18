// Does the workout fit the route (js/routefit.js): the app's physics at the workout's watts, laps, where the workout ends,
// the three verdicts and the routes that fit, closest first.
// Usage: node --test tools/routefit-test.mjs   (no browser)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRoute, fittingRoutes, powerAt, workoutSec, AFTER_PCT, TOL, LONG } from '../js/routefit.js';
import { defaultParams, step } from '../js/physics.js';
import { STEP } from '../js/track.js';
import { WORKOUTS, workoutAt } from '../js/workouts.js';
import { toRide, validateWorkout } from '../js/myworkouts.js';
import { makeDemoTrack } from '../js/demo.js';

/** a track of L metres; grade(d) in % (the shape js/track.js builds: one sample every STEP m) */
const T = (L, grade = () => 0) => ({ length: L, grade: Array.from({ length: Math.floor(L / STEP) + 1 }, (_, i) => grade(i * STEP)) });
const W = (...steps) => ({ id: 't', name: 'Test', steps: steps.map(([min, pct, o]) => ({ dur: min * 60, pct, ...o })) });
const S = { ftp: 250, riderKg: 75, bikeKg: 8.5 };
/** steady speed at P on the flat with the app's physics */
const vAt = P => { const p = defaultParams(S); let v = 0; for (let i = 0; i < 3000; i++) v = step(v, P, 0, 1, p); return v; };

test('flat route at a steady 100 %: the lap time is the distance at the physics\' steady speed (plus the start)', () => {
  const v = vAt(250), L = 20000, f = fitRoute(T(L), W([90, 100]), S);
  const ideal = L / v; assert.ok(f.lapSec > ideal && f.lapSec < ideal + 30, `${f.lapSec} s vs ${Math.round(ideal)} s at ${(v * 3.6).toFixed(1)} km/h`);
  assert.equal(f.workoutSec, 5400); assert.equal(f.verdict, 'short'); assert.equal(f.lapsNeeded, Math.ceil(5400 * v / L));
});

test('target watts per second: ramps via pctAt, free blocks at 100 %, after the end the easy ride-on', () => {
  const w = W([10, 50, { pct2: 150 }], [5, 60, { free: true }], [5, 200]);
  assert.equal(powerAt(w, 0, 200), 100); assert.equal(powerAt(w, 300, 200), 200, 'half way up the ramp 50 -> 150: 100 %');
  for (const t of [0, 150, 300, 450]) assert.equal(Math.round(powerAt(w, t, 200)), workoutAt(w, t, 200).target, 'the same target as the ride (workoutAt) at ' + t + ' s');
  assert.equal(powerAt(w, 700, 200), 200, 'free block: 100 % FTP'); assert.equal(powerAt(w, 1000, 200), 400);
  assert.equal(powerAt(w, 1200, 200), AFTER_PCT * 2); assert.equal(workoutSec(w), 1200);
});

test('three verdicts: short (more than a minute short), fits, long (more than 15 min of route left) with where it ends', () => {
  const v = vAt(250), lap = s => T(Math.round(v * s));
  const short = fitRoute(lap(1500), W([30, 100]), S); assert.equal(short.verdict, 'short'); assert.ok(short.spare < -TOL); assert.equal(short.lapsNeeded, 2);
  assert.equal(short.endLap, 2); assert.ok(short.endD > 0 && short.endD < short.routeSec * v, 'ends early in lap 2: ' + short.endD);
  const fits = fitRoute(lap(1900), W([30, 100]), S); assert.equal(fits.verdict, 'fits'); assert.ok(fits.spare >= 0 && fits.spare < LONG, 'spare ' + fits.spare);
  const long = fitRoute(lap(4000), W([30, 100]), S); assert.equal(long.verdict, 'long'); assert.equal(long.endLap, 1);
  assert.ok(Math.abs(long.endD - v * 1800) < v * 15, `the workout ends after ~30 min at ${long.endD} m (${Math.round(v * 1800)} m)`);
  assert.ok(long.routeSec > 1800 + (4000 * v - long.endD) / v, 'after the workout the ride-on is easier (slower) than 100 %');
  assert.equal(fitRoute(lap(1830), W([30, 100]), S).verdict, 'fits', 'half a minute short still fits');
});

test('laps: two laps take twice one, the workout that was too short fits; group of 20 laps at most', () => {
  const v = vAt(250), t = T(Math.round(v * 1500)), w = W([40, 100]);
  const one = fitRoute(t, w, S), two = fitRoute(t, w, S, { laps: 2 });
  assert.equal(one.verdict, 'short'); assert.equal(one.lapsNeeded, 2); assert.equal(two.verdict, 'fits'); assert.equal(two.laps, 2);
  assert.equal(two.lapSec, one.lapSec); assert.ok(two.routeSec > 2 * one.routeSec, `${two.routeSec} s > 2 × ${one.routeSec} s: lap 2 ends after the workout, ridden easier`);
  const w90 = W([90, 100]), l3 = fitRoute(t, w90, S, { laps: 3 }); assert.ok(Math.abs(l3.routeSec - 3 * l3.lapSec) < 20, `inside the workout every lap takes the same: ${l3.routeSec} ≈ 3 × ${l3.lapSec}`);
  assert.equal(fitRoute(t, w, S, { laps: 99 }).laps, 20);
  assert.equal(fitRoute(T(200), W([600, 100]), S).lapsNeeded, null, 'more than 20 laps: no laps offer');
});

test('physics from the settings: climbs, weight and FTP change the time', () => {
  const flat = T(10000), hill = T(10000, d => (d > 3000 && d < 7000 ? 6 : 0)), w = W([60, 90]);
  const a = fitRoute(flat, w, S), b = fitRoute(hill, w, S), c = fitRoute(hill, w, { ...S, riderKg: 95 }), d = fitRoute(hill, w, { ...S, ftp: 320 });
  assert.ok(b.lapSec > a.lapSec * 1.3, `the 6 % climb is slower: ${a.lapSec} -> ${b.lapSec} s`);
  assert.ok(c.lapSec > b.lapSec, `20 kg heavier is slower uphill: ${b.lapSec} -> ${c.lapSec} s`);
  assert.ok(d.lapSec < b.lapSec, `a higher FTP rides faster: ${b.lapSec} -> ${d.lapSec} s`);
  assert.ok(fitRoute(hill, W([60, 150, { pct2: 50 }]), S).lapSec !== fitRoute(hill, W([60, 50, { pct2: 150 }]), S).lapSec, 'ramp direction matters on a climb');
});

test('nothing to say: no workout, no track, no grade', () => {
  assert.equal(fitRoute(T(5000), null, S), null); assert.equal(fitRoute(null, W([5, 100]), S), null); assert.equal(fitRoute({ length: 5000 }, W([5, 100]), S), null);
  assert.equal(fitRoute(T(5000), { steps: [] }, S), null);
});

test('routes that fit, closest first; the current one and the too short ones left out', () => {
  const v = vAt(250), w = W([30, 100]), r = (id, s) => ({ id, name: id, track: T(Math.round(v * s)) });
  const routes = [r('here', 1000), r('tiny', 900), r('huge', 6000), r('snug', 1950), r('roomy', 2600)];
  assert.deepEqual(fittingRoutes(routes, w, S, { not: 'here' }).map(x => x.id), ['snug', 'roomy', 'huge']);
  assert.deepEqual(fittingRoutes(routes, w, S, { not: 'here', max: 1 }).map(x => x.id), ['snug']);
});

test('built-in and personal workouts alike, on the real Passo Demo profile; fast enough for a whole library', () => {
  const t = makeDemoTrack(), t0 = performance.now();
  for (const w of WORKOUTS) { const f = fitRoute(t, w, S); assert.ok(f && ['fits', 'short', 'long'].includes(f.verdict), w.id); assert.equal(f.workoutSec, w.steps.reduce((a, s) => a + s.dur, 0)); }
  const ms = performance.now() - t0; assert.ok(ms < 1000, `${WORKOUTS.length} workouts in ${Math.round(ms)} ms`);
  const p = validateWorkout({ id: 'mine1', name: 'Mine', steps: [{ min: 10, pct: 55, pct2: 75 }, { min: 20, pct: 95 }, { min: 5, pct: 60, free: true }] });
  const f = fitRoute(t, toRide(p.w), S); assert.equal(f.workoutSec, 35 * 60); assert.ok(f.routeSec > 0);
});
