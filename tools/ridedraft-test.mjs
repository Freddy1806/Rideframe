// The checkpoint of a running ride (js/ridedraft.js): what goes in, what comes back, which drafts are offered.
import test from 'node:test'; import assert from 'node:assert/strict';
import { draftOf, restoreDraft, draftUsable, draftRidden, draftOn, DRAFT_MAX_AGE } from '../js/ridedraft.js';
import { workoutById } from '../js/workouts.js';

const ride = () => ({ route: { id: 'demo', name: 'Passo Demo' }, group: null, workout: workoutById('c_30_15_3x13'), _wDef: workoutById('c_30_15_3x13'),
  d: 4210.5, elapsed: 812.4, lap: 2, laps: 3, lapOff: 9000, _lapBase: 0, _lapT0: 600, lapList: [{ t: 600, d: 9000 }], startD: 0, lastSample: 812, gainAcc: 311.2,
  samples: Array.from({ length: 812 }, (_, i) => [i + 1, i * 5, 200 + (i % 7), 30.1, 90, 140]), powerHist: [], segDone: [{ id: 's1', name: 'Climb', kind: 'climb', t: 300, w: 260 }],
  lapMarks: [600], manLaps: [{ t: 100, d: 900, w: 230 }], _ml: { t: 700, d: 12000, j: 1e5 }, _mlJ: 162000, _wT0: 20, wAdj: 5, wAdjE: -5, _adjAcc: 900, _adjT: 180,
  _stepAdj: [, [25, 5]], _ergSpans: [[20, 400], [410, null]], wDone: false, erg: true, flatRide: false, berg: false, virtual: true, auto: false, gi: 7, ftp: 250, keyPower: true, _secret: 1 });

test('a draft holds position, clocks, samples, workout (the definition itself) and the records, nothing else', () => {
  const r = ride(), d = draftOf(r, 1000);
  assert.equal(d.routeId, 'demo'); assert.equal(d.savedAt, 1000); assert.equal(d.samples.length, 812); assert.equal(d.workout.id, 'c_30_15_3x13');
  assert.equal(d.workout.steps.length, r.workout.steps.length, 'the steps go along: a personal or coach workout continues without its store');
  for (const k of ['d', 'elapsed', 'lap', 'laps', 'lapOff', '_wT0', 'wAdj', 'wAdjE', 'manLaps', '_ergSpans', 'gi', 'ftp']) assert.deepEqual(d[k], r[k], k);
  assert.equal(d._secret, undefined); assert.equal(d.keyPower, undefined, 'a ride with typed watts keeps no draft at all (ride.js), the flag is not carried');
  assert.ok(structuredClone(d), 'plain data: IndexedDB can store it');
  assert.ok(JSON.stringify(d).length < 60000, 'compact: 13 minutes are well under 60 kB');
});
test('restore: a fresh ride goes on where the draft stopped; open ERG spans end at the draft time; the power average counts', () => {
  const d = structuredClone(draftOf(ride(), 1000)), r = { route: { id: 'demo' }, d: 0, elapsed: 0, samples: [], powerHist: [], laps: 1, gi: 3 };
  restoreDraft(r, d);
  assert.equal(r.d, 4210.5); assert.equal(r.elapsed, 812.4); assert.equal(r.lap, 2); assert.equal(r.laps, 3); assert.equal(r.samples.length, 812);
  assert.equal(r.powerHist.length, 812); assert.equal(r.powerHist[3], 203); assert.equal(r.workout.id, 'c_30_15_3x13'); assert.equal(r._wDef.id, 'c_30_15_3x13');
  assert.deepEqual(r._ergSpans, [[20, 400], [410, 812]]); assert.equal(r._ergOn, false); assert.equal(r.resumed, 1); assert.equal(r._draftT, 812.4);
  r.samples.push([813, 0, 0, 0, 0, 0]); assert.equal(d.samples.length, 812, 'the ride does not write into the stored draft');
  assert.equal(draftRidden(d), 13210.5);
});
test('a workout ended early: the ride goes on without it, the definition stays for the intervals', () => {
  const r0 = ride(); r0.workout = null; r0._wName = '30/15 (ended early)';
  const r = restoreDraft({ route: {} }, draftOf(r0)); assert.equal(r.workout, null); assert.equal(r._wDef.id, 'c_30_15_3x13'); assert.equal(r._wName, '30/15 (ended early)');
});
test('offered only with samples and younger than 12 h', () => {
  const d = draftOf(ride(), 1e9);
  assert.equal(draftUsable(d, 1e9 + 1000), true); assert.equal(draftUsable(d, 1e9 + DRAFT_MAX_AGE + 1), false);
  assert.equal(draftUsable({ ...d, samples: [] }, 1e9), false); assert.equal(draftUsable(null), false);
  assert.equal(draftOn(), !globalThis.navigator?.webdriver, 'a normal browser (and node) keeps drafts');
});
