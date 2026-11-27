// tools/garmin-export.mjs: which rides go to Garmin, and that the TCX of one is written with its samples
import test from 'node:test';
import assert from 'node:assert/strict';
import { pick, fileName } from './garmin-export.mjs';
import { toTCX } from '../js/tcx.js';

const T = Date.UTC(2026, 10, 27, 10), smp = n => Array.from({ length: n }, (_, i) => [i, i * 8, 200, 29, 90, 140]);
const ride = (id, o = {}) => ({ id, date: T + 3600e3, duration: 3600, samples: smp(3600), routeId: 'kueste60', ...o });

test('only rides recorded here go out: nothing from Strava, files, the watch, by hand, strength, the demo, or already sent', () => {
  const rides = [ride('a'), ride('st1', { source: 'strava', stravaId: '1' }), ride('f', { source: 'file' }), ride('m', { source: 'manual', samples: [] }), ride('k', { kraft: true }),
    ride('d', { routeId: 'demo' }), ride('short', { samples: smp(30) }), ride('old', { date: T - 30 * 864e5 }), ride('sent'), ride('b', { date: T + 5 * 3600e3 })];
  assert.deepEqual(pick(rides, { since: T - 864e5, done: ['sent'] }).map(r => r.id), ['a', 'b']);
});
test('a ride the watch recorded too stays here: Garmin has it from the watch', () => {
  const rides = [ride('a'), { id: 'watch-1', source: 'watch', start: T + 120e3, date: T + 3600e3, dur: 3500 }, ride('b', { date: T + 6 * 3600e3 })];
  assert.deepEqual(pick(rides, { since: 0 }).map(r => r.id), ['b']);
});
test('file name and TCX', () => {
  const r = ride('r_1'); assert.match(fileName(r), /^RIDEFRAME_2026-11-27_\d{4}_r_1\.tcx$/);
  const x = toTCX(r, 'VO2max 5 × 3'); assert.match(x, /<Activity Sport="Biking">/); assert.equal((x.match(/<Trackpoint>/g) || []).length, 3600); assert.match(x, /<Watts>200<\/Watts>/);
});
