// Workout, mode and shifting inside the ride (js/ridesetup.js): the choices, which mode is on, and what each tap does to a
// running ride (a stand-in with the ride's fields; the real ride is driven in tools/ridesetup-ui.cjs).
// Usage: node --test tools/ridesetup-test.mjs   (no browser)
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeOf, shiftOf, sourceOf, modeChange, workoutChoices, setMode, setShift, setWorkout, setSource, SOURCE_NOTE } from '../js/ridesetup.js';
import { Trainer } from '../js/trainer.js';
import { WORKOUTS, PERSONAL, workoutById } from '../js/workouts.js';

/** a ride as js/ride.js keeps it, with the trainer and the HUD recorded */
function fakeRide(o = {}) {
  const log = [], els = new Set(['.hud-top']);
  const r = { state: { settings: { erg: true }, trainer: { connected: true, setPower: w => log.push(['power', w]), setGrade: (g, f) => log.push(['grade', g]), pmOnly: false, setPmOnly(on) { log.push(['pmOnly', on]); const was = this.connected; this.connected = false; this.pmOnly = on; return was; } } },
    workout: null, erg: true, flatRide: false, virtual: false, auto: false, berg: false, elapsed: 600, power: 180, ftp: 250, log, els,
    q: s => (els.has(s) ? { remove: () => els.delete(s), insertAdjacentHTML: () => { els.add('#hWork'); els.add('#hWName'); }, classList: { remove() {} }, set textContent(v) { log.push(['name', v]); } } : null),
    el: { classList: { toggle: (c, on) => log.push(['class', c, on]) } },
    _flash: t => log.push(['flash', t]), _ergSpan: on => log.push(['ergSpan', on]), _workout: () => log.push(['workout']), _workoutHUD() {}, _wireWorkoutStop() {}, _workoutBarHTML: () => '<div id="hWork">',
    _trainerGrade() { return this.flatRide ? 0 : 4.2; }, _setShift: m => { r.virtual = m === 'virtual' || m === 'auto'; r.auto = m === 'auto'; r.berg = m === 'berg'; log.push(['shift', m]); }, ...o };
  return r;
}

test('three modes; ERG only with a workout', () => {
  assert.deepEqual(MODES.map(m => m[0]), ['erg', 'sim'], 'two modes: "Just ride" is no longer offered (owner 27.11.)');
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

test('a workout chosen mid-ride: its intervals are cut from the samples after that second (intervalRecords t0)', async () => {
  const { intervalRecords } = await import('../js/ivhistory.js');
  const w = { id: 'x', steps: [{ dur: 60, pct: 50, label: 'Warm' }, { dur: 120, pct: 110, label: 'Hard' }] };
  const samples = []; for (let t = 1; t <= 900; t++) samples.push([t, 0, t < 660 ? 100 : 300]);
  const iv = intervalRecords({ workout: w, samples, elapsed: 900, ftp: 250, t0: 600 });
  assert.equal(iv.length, 1); assert.equal(iv[0].at, 660); assert.equal(iv[0].w, 300, 'the watts of the interval as ridden, not of the ride start');
});

test('power meter only: never with trainer control; ERG, gradient modes and virtual gears off, the workout keeps its targets', () => {
  const r = fakeRide({ virtual: true }); setWorkout(r, workoutById('ss3x10')); r.log.length = 0;
  assert.equal(setSource(r, 'pm'), true); assert.equal(sourceOf(r), 'pm'); assert.equal(r.state.settings.powerSource, 'pm');
  assert.deepEqual(r.log.find(x => x[0] === 'shift'), ['shift', 'real'], 'virtual gears end'); assert.deepEqual(r.log.find(x => x[0] === 'power'), ['power', null], 'ERG released');
  assert.ok(r.log.some(x => x[0] === 'flash' && /connect the power meter/.test(x[1])), 'the trainer was dropped: say what to connect');
  assert.equal(r.erg, false); assert.equal(r.workout.id, 'ss3x10', 'the workout goes on'); assert.equal(modeOf(r), 'pm');
  assert.equal(setMode(r, 'erg'), false); assert.equal(setMode(r, 'flat'), false, 'no gradient modes either'); assert.equal(modeChange('sim', true, true), null);
  r.log.length = 0; setShift(r, 'virtual'); assert.equal(r.log.filter(x => x[0] === 'shift').length, 0, 'virtual gears refused');
  assert.equal(setSource(r, 'pm'), false, 'already');
  assert.equal(setSource(r, 'trainer'), true); assert.equal(r.erg, true, 'back to ERG from the setting'); assert.ok(r.log.some(x => x[0] === 'workout'));
  assert.match(SOURCE_NOTE.pm, /never controls the trainer/);
});

test('Trainer in power meter only mode writes nothing to the trainer; switching drops the connected device', async () => {
  const t = new Trainer(), writes = []; let gone = false;
  t.device = { gatt: { get connected() { return !gone; }, disconnect() { gone = true; } } }; t.cp = { writeValue: b => { writes.push([...b]); return Promise.resolve(); } }; t.mode = 'ftms';
  t.setPower(200); assert.equal(t.erg, 200); await t.queue; assert.equal(writes.length, 1, 'trainer control: the target went out'); assert.equal(t.setPmOnly(true), true, 'the trainer is disconnected'); assert.ok(gone);
  assert.equal(t.erg, null); assert.equal(t.cp, null);
  t.device = { gatt: { connected: true, disconnect() {} } }; t.cp = { writeValue: b => { writes.push([...b]); return Promise.resolve(); } }; const n = writes.length;
  t.setPower(250); t.setGrade(5, true); await t.queue; assert.equal(t.erg, null); assert.equal(writes.length, n, 'no ERG, no grade');
});
