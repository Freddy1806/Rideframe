// Workout, mode and shifting inside the ride (js/ridesetup.js): the choices, which mode is on, and what each tap does to a
// running ride (a stand-in with the ride's fields; the real ride is driven in tools/ridesetup-ui.cjs).
// Usage: node --test tools/ridesetup-test.mjs   (no browser)
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeOf, shiftOf, modeChange, workoutChoices, setMode, setShift, setWorkout } from '../js/ridesetup.js';
import { WORKOUTS, PERSONAL, workoutById } from '../js/workouts.js';

/** a ride as js/ride.js keeps it, with the trainer and the HUD recorded */
function fakeRide(o = {}) {
  const log = [], els = new Set(['.hud-top']);
  const r = { state: { settings: { erg: true }, trainer: { connected: true, setPower: w => log.push(['power', w]), setGrade: (g, f) => log.push(['grade', g]) } },
    workout: null, erg: true, flatRide: false, virtual: false, auto: false, berg: false, elapsed: 600, power: 180, ftp: 250, log, els,
    q: s => (els.has(s) ? { remove: () => els.delete(s), insertAdjacentHTML: () => { els.add('#hWork'); els.add('#hWName'); }, classList: { remove() {} }, set textContent(v) { log.push(['name', v]); } } : null),
    el: { classList: { toggle: (c, on) => log.push(['class', c, on]) } },
    _flash: t => log.push(['flash', t]), _ergSpan: on => log.push(['ergSpan', on]), _workout: () => log.push(['workout']), _workoutHUD() {}, _wireWorkoutStop() {}, _workoutBarHTML: () => '<div id="hWork">',
    _trainerGrade() { return this.flatRide ? 0 : 4.2; }, _setShift: m => { r.virtual = m === 'virtual' || m === 'auto'; r.auto = m === 'auto'; r.berg = m === 'berg'; log.push(['shift', m]); }, ...o };
  return r;
}

test('three modes; ERG only with a workout', () => {
  assert.deepEqual(MODES.map(m => m[0]), ['erg', 'sim', 'flat']);
  assert.equal(modeChange('erg', false), null); assert.deepEqual(modeChange('erg', true), { erg: true, flat: false });
  assert.deepEqual(modeChange('sim', true), { erg: false, flat: false }); assert.deepEqual(modeChange('flat', false), { erg: false, flat: true });
  assert.equal(modeOf({ workout: null, erg: true }), 'sim', 'ERG setting without a workout: the road');
  assert.equal(modeOf({ workout: {}, erg: true }), 'erg'); assert.equal(modeOf({ workout: {}, erg: false, flatRide: true }), 'flat');
  assert.equal(shiftOf({ virtual: true }), 'virtual'); assert.equal(shiftOf({ virtual: false }), 'real');
});

test('workout list: personal first, then the Training tab ones, then the standard ones; every one listed once', () => {
  PERSONAL.push({ id: 'pw_x1', name: 'Mine', personal: true, steps: [{ dur: 600, pct: 60 }] });
  try {
    const c = workoutChoices(); assert.equal(c[0].id, 'pw_x1'); assert.equal(c[0].own, true); assert.equal(c[0].min, 10);
    assert.equal(c.length, new Set(c.map(x => x.id)).size); assert.ok(WORKOUTS.every(w => c.some(x => x.id === w.id)));
  } finally { PERSONAL.length = 0; }
});

test('a workout chosen mid-ride starts from step 1 at that second, offsets reset, the bar comes; none removes it and frees ERG', () => {
  const r = fakeRide({ wAdj: 10, wAdjE: -5 }), w = workoutById('vo2_5x3');
  setWorkout(r, w);
  assert.equal(r.workout, w); assert.equal(r._wT0, 600, 'its clock starts now'); assert.equal(r._wId, 'vo2_5x3'); assert.equal(r._wDef, w);
  assert.deepEqual([r.wAdj, r.wAdjE, r.wDone], [0, 0, false]); assert.ok(r.els.has('#hWork'), 'the interval bar is built'); assert.ok(r.log.some(x => x[0] === 'workout'), 'the first target at once');
  r.elapsed = 900; r.log.length = 0; setWorkout(r, null);
  assert.equal(r.workout, null); assert.ok(!r.els.has('#hWork'), 'the bar is gone'); assert.deepEqual(r.log.find(x => x[0] === 'power'), ['power', null], 'ERG off: the trainer back on the grade');
  assert.equal(r._wName, 'VO2max 5 × 3 (ended early)'.replace('VO2max 5 × 3', w.name)); assert.equal(r._wDef, w, 'its intervals still go to the record');
  r.log.length = 0; setWorkout(r, w); setWorkout(r, w); assert.equal(r.log.filter(x => x[0] === 'workout').length, 1, 'the same one again: no restart');
});

test('modes on a running ride: ERG -> gradient frees the trainer, just ride sends 0 %, ERG again sends the target', () => {
  const r = fakeRide(); setWorkout(r, workoutById('ss3x10')); r.log.length = 0;
  assert.equal(setMode(r, 'sim'), true); assert.deepEqual(r.log.filter(x => x[0] === 'power'), [['power', null]]); assert.deepEqual(r.log.find(x => x[0] === 'grade'), ['grade', 4.2]);
  assert.equal(r.state.settings.erg, false, 'kept like the route page switch'); r.log.length = 0;
  setMode(r, 'flat'); assert.equal(r.flatRide, true); assert.deepEqual(r.log.find(x => x[0] === 'grade'), ['grade', 0], 'no gradient'); r.log.length = 0;
  setMode(r, 'erg'); assert.equal(r.erg, true); assert.equal(r.flatRide, false); assert.ok(r.log.some(x => x[0] === 'workout')); assert.ok(r.log.some(x => x[0] === 'name' && /ERG$/.test(x[1])));
  const n = fakeRide(); assert.equal(setMode(n, 'erg'), false, 'ERG without a workout is refused'); assert.equal(n.erg, true); assert.equal(n.flatRide, false);
});

test('shifting: virtual (keeps auto when it was on) or on the bike; climb watts left for on the bike', () => {
  const r = fakeRide(); setShift(r, 'virtual'); assert.deepEqual(r.log.at(-1), ['shift', 'virtual']);
  r.state.settings.autoShift = true; r.virtual = false; setShift(r, 'virtual'); assert.deepEqual(r.log.at(-1), ['shift', 'auto']);
  setShift(r, 'real'); assert.deepEqual(r.log.at(-1), ['shift', 'real']); const n = r.log.length; setShift(r, 'real'); assert.equal(r.log.length, n, 'already: nothing');
  r.berg = true; setShift(r, 'real'); assert.deepEqual(r.log.at(-1), ['shift', 'real'], 'from climb watts back to plain');
});
