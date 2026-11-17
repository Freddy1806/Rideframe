// ERG workouts on a route (owner 17.11.): the trainer held the watts, the gradient was not ridden, so the Strava file must not
// carry the route's climb for those parts. js/tcx.js: ERG parts (rec.ergSpans, seconds) get a flat altitude and no map
// position (with positions Strava may take the altitude from its own elevation map again); simulated parts stay as they were.
// Usage: node --test tools/erg-export-test.mjs   (no browser, no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { toTCX, inErg } from '../js/tcx.js';

const ele = d => 100 + d * 0.05; // 5 % up the whole way
ele.pos = d => [67.9 + d / 1e5, 13.0 + d / 1e5];
const rec = (x = {}) => ({ id: 't', date: Date.UTC(2026, 10, 17, 18), duration: 60, startD: 0, samples: Array.from({ length: 61 }, (_, t) => [t, t * 8, 250, 28.8, 90, 140]), ...x });
const alts = x => [...x.matchAll(/<AltitudeMeters>([\d.]+)<\/AltitudeMeters>/g)].map(m => +m[1]);
const gain = a => a.reduce((s, v, i) => s + (i && v > a[i - 1] ? v - a[i - 1] : 0), 0);

test('inErg', () => {
  const r = { ergSpans: [[10, 20], [40, 50]] };
  assert.equal(inErg(r, 9), false); assert.equal(inErg(r, 10), true); assert.equal(inErg(r, 20), true); assert.equal(inErg(r, 30), false); assert.equal(inErg(r, 45), true);
  assert.equal(inErg({}, 5), false);
});

test('a simulated ride keeps the route profile and the map', () => {
  const x = toTCX(rec(), 'Rocky Coast', ele), a = alts(x);
  assert.equal(a.length, 61); assert.ok(Math.abs(gain(a) - 24) < 0.2, `climb ${gain(a)}`);
  assert.equal((x.match(/<Position>/g) || []).length, 61);
});

test('a whole ERG workout: flat altitude, no position, 0 m climb', () => {
  const x = toTCX(rec({ erg: true, ergSpans: [[0, 60]] }), 'Rocky Coast', ele), a = alts(x);
  assert.equal(a.length, 61); assert.equal(gain(a), 0); assert.ok(a.every(v => v === a[0]));
  assert.equal((x.match(/<Position>/g) || []).length, 0, 'no positions: Strava cannot correct the elevation from its map');
  assert.match(x, /<Watts>250<\/Watts>/); assert.match(x, /<DistanceMeters>480<\/DistanceMeters>/, 'distance and watts stay');
});

test('mixed: only the simulated parts climb', () => {
  const x = toTCX(rec({ erg: true, ergSpans: [[0, 30]] }), 'Rocky Coast', ele), a = alts(x);
  assert.ok(a.slice(0, 31).every(v => v === a[0]), 'flat while ERG');
  assert.ok(Math.abs(gain(a) - 29 * 8 * 0.05) < 0.2, `climb only from the simulated samples 31-60 (29 steps): ${gain(a)}`);
  assert.ok(Math.abs(a[31] - a[30]) < 0.5, 'no jump back to the route profile: it goes on from the held level');
  assert.equal((x.match(/<Position>/g) || []).length, 30);
});

test('no altitude function: no altitude at all (as before)', () => {
  assert.equal(alts(toTCX(rec({ ergSpans: [[0, 30]] }), 'x')).length, 0);
});
