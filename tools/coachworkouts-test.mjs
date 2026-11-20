// Coach workouts (js/coachworkouts.js): the coach/workouts.json format, every rejection rule, repeat expansion and labels,
// a coach workout replacing a built-in, broken JSON, the example file equal to the built-in 30 / 15, and the check tool.
// Usage: node --test tools/coachworkouts-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCoach, CLIM } from '../js/coachworkouts.js';
import { WORKOUTS, COACH, allWorkouts, workoutById, workoutState, workoutDuration, setFtp, catalog } from '../js/workouts.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EX = JSON.parse(readFileSync(ROOT + 'coach/workouts.example.json', 'utf8'));
const one = (w = {}) => ({ id: 'c_test', name: 'Test', steps: [{ min: 5, pct: 60 }], ...w });
const parse1 = w => parseCoach({ workouts: [one(w)] });
const bad = (w, re, msg) => { const r = parse1(w); assert.equal(r.workouts.length, 0, msg); assert.equal(r.errors.length, 1, msg); if (re) assert.match(r.errors[0], re, msg); };
const flat = w => w.steps.map(s => [s.dur, s.watts ?? s.pct, s.pct2 ?? null, s.label, !!s.free]);

test('a valid file: the shape of the built-ins, coach: true, watts and % steps', () => {
  setFtp(250);
  const r = parseCoach(JSON.stringify({ workouts: [one({ id: 'c_aa', what: 'Hello', rampIn: 3, rampOut: 2, steps: [{ min: 2, pct: 40, pct2: 70, label: 'Warm-up' }, { sec: 30, watts: 300, label: 'Go' }, { min: 20, pct: 100, free: true, label: 'Test' }] })] }));
  assert.deepEqual(r.errors, []); assert.equal(r.workouts.length, 1);
  const w = r.workouts[0];
  assert.equal(w.id, 'c_aa'); assert.equal(w.name, 'Test'); assert.equal(w.what, 'Hello'); assert.equal(w.coach, true); assert.equal(w.rampIn, 3); assert.equal(w.rampOut, 2);
  assert.deepEqual(flat(w), [[120, 40, 70, 'Warm-up', false], [30, 300, null, 'Go', false], [1200, 100, null, 'Test', true]]);
  assert.equal(w.steps[1].pct, 120, 'watt step: pct from the FTP (300 / 250)');
  setFtp(300); assert.equal(w.steps[1].pct, 100, 'the pct getter follows setFtp'); setFtp(250);
  assert.equal(workoutState(w, 130, 200).target, 300, 'workoutState runs it: 300 W whatever the FTP');
  assert.equal(workoutDuration(w), 1350);
  assert.equal(parse1({ what: undefined }).workouts[0].what, '', 'what is optional');
  assert.equal(parseCoach([one()]).workouts.length, 1, 'a bare list is taken as well');
});

test('rejection rules: each skips that workout with an error, the others still load', () => {
  const cases = [
    [{ id: 'x_abc' }, /id/], [{ id: 'c_' }, /id/], [{ id: 'c_' + 'a'.repeat(39) }, /id/], [{ id: 'c_a b' }, /id/], [{ id: 5 }, /id/],
    [{ name: '' }, /name/], [{ name: '<>' }, /name/], [{ name: 'n'.repeat(41) }, /name/], [{ name: 7 }, /name/], [{ what: 'w'.repeat(401) }, /what/],
    [{ rampIn: 11 }, /rampIn/], [{ rampOut: -1 }, /rampOut/], [{ rampIn: '3' }, /rampIn/],
    [{ steps: [] }, /steps/], [{ steps: 'x' }, /steps/], [{ steps: [5] }, /object/],
    [{ steps: [{ pct: 60 }] }, /sec.*min/], [{ steps: [{ sec: 30, min: 1, pct: 60 }] }, /sec.*min/],
    [{ steps: [{ sec: 4, pct: 60 }] }, /sec/], [{ steps: [{ min: 121, pct: 60 }] }, /min/], [{ steps: [{ sec: '30', pct: 60 }] }, /sec/],
    [{ steps: [{ sec: 30 }] }, /watts.*pct/], [{ steps: [{ sec: 30, watts: 300, pct: 60 }] }, /watts.*pct/],
    [{ steps: [{ sec: 30, watts: 49 }] }, /watts/], [{ steps: [{ sec: 30, watts: 2001 }] }, /watts/],
    [{ steps: [{ sec: 30, pct: 29 }] }, /pct/], [{ steps: [{ sec: 30, pct: 201 }] }, /pct/], [{ steps: [{ sec: 30, pct: 60, pct2: 250 }] }, /pct2/],
    [{ steps: [{ sec: 30, watts: 300, pct2: 80 }] }, /pct2/], [{ steps: [{ sec: 30, pct: 60, label: 'l'.repeat(25) }] }, /label/],
    [{ steps: [{ sec: 30, pct: 60, free: 'yes' }] }, /free/],
    [{ steps: [{ repeat: 1, steps: [{ sec: 30, pct: 60 }] }] }, /repeat/], [{ steps: [{ repeat: 51, steps: [{ sec: 30, pct: 60 }] }] }, /repeat/],
    [{ steps: [{ repeat: 2.5, steps: [{ sec: 30, pct: 60 }] }] }, /repeat/], [{ steps: [{ repeat: 3, steps: [] }] }, /steps/],
    [{ steps: [{ repeat: 3, steps: [{ repeat: 2, steps: [{ sec: 30, pct: 60 }] }] }] }, /repeat inside/],
    [{ steps: [{ repeat: 3, label: 'r'.repeat(25), steps: [{ sec: 30, pct: 60 }] }] }, /label/],
    [{ steps: [{ repeat: 3, skipLastRest: true, steps: [{ sec: 30, pct: 60 }] }] }, /skipLastRest/],
    [{ steps: [{ repeat: 50, steps: Array.from({ length: 9 }, () => ({ sec: 10, pct: 60 })) }] }, /400 steps/],
    [{ steps: [{ min: 120, pct: 60 }, { min: 120, pct: 60 }, { min: 120, pct: 60 }, { sec: 5, pct: 60 }] }, /6 hours/],
  ];
  for (const [w, re] of cases) bad(w, re, JSON.stringify(w).slice(0, 120));
  const r = parseCoach({ workouts: [one({ id: 'c_ok1' }), one({ id: 'nope' }), 'x', one({ id: 'c_ok2' }), one({ id: 'c_ok1' })] });
  assert.deepEqual(r.workouts.map(w => w.id), ['c_ok1', 'c_ok2']); assert.equal(r.errors.length, 3);
  assert.match(r.errors[2], /used twice/);
  assert.match(r.errors[0], /^Workout 2 \(nope\)/, 'the error names the workout');
  const many = parseCoach({ workouts: Array.from({ length: 52 }, (_, i) => one({ id: 'c_w' + i })) });
  assert.equal(many.workouts.length, CLIM.workouts); assert.equal(many.errors.length, 2); assert.match(many.errors[0], /at most 50/);
  assert.equal(parse1({ steps: [{ repeat: 50, steps: Array.from({ length: 8 }, () => ({ sec: 5, pct: 60 })) }] }).workouts[0].steps.length, 400, 'exactly 400 is fine');
  assert.equal(parse1({ steps: [{ min: 120, pct: 60 }, { min: 120, pct: 60 }, { min: 120, pct: 60 }] }).workouts.length, 1, 'exactly 6 hours is fine');
});

test('texts lose control characters and < >', () => {
  const w = parse1({ name: ' <b>Hi</b>\u0007 ', what: 'a\nb <script>', steps: [{ sec: 30, pct: 60, label: '<i>On</i>' }] }).workouts[0];
  assert.equal(w.name, 'bHi/b'); assert.equal(w.what, 'ab script'); assert.equal(w.steps[0].label, 'iOn/i');
});

test('repeat: expansion, "<label> · i/n" on the first step, skipLastRest, workoutState counts the series', () => {
  const w = parse1({ steps: [{ repeat: 3, label: 'Set A', steps: [{ sec: 30, watts: 340, label: 'On' }, { sec: 15, watts: 125, label: 'Float' }] }] }).workouts[0];
  assert.deepEqual(w.steps.map(s => s.label), ['Set A · 1/3', 'Float', 'Set A · 2/3', 'Float', 'Set A · 3/3', 'Float']);
  assert.notEqual(w.steps[0], w.steps[2], 'every repetition its own step object');
  const k = parse1({ steps: [{ repeat: 3, label: 'Set A', skipLastRest: true, steps: [{ sec: 30, watts: 340 }, { sec: 15, watts: 125, label: 'Float' }] }] }).workouts[0];
  assert.deepEqual(k.steps.map(s => [s.dur, s.watts, s.label]), [[30, 340, 'Set A · 1/3'], [15, 125, 'Float'], [30, 340, 'Set A · 2/3'], [15, 125, 'Float'], [30, 340, 'Set A · 3/3']]);
  const n = parse1({ steps: [{ repeat: 2, steps: [{ min: 1, pct: 110, label: 'Hard' }, { min: 1, pct: 50 }] }] }).workouts[0];
  assert.deepEqual(n.steps.map(s => s.label), ['Hard', '', 'Hard', ''], 'without a repeat label the steps keep their own');
  const st = workoutState(k, 46, 250);
  assert.equal(st.hardNo, 2); assert.equal(st.hardCount, 3); assert.equal(st.series, 'Set A ·');
});

test('a coach workout with a built-in id replaces it; COACH is listed after own ones and before the built-ins', () => {
  const r = parseCoach({ workouts: [one({ id: 'c_30_15_3x13', name: 'Replaced' }), one({ id: 'c_new', name: 'New' })] });
  COACH.length = 0; COACH.push(...r.workouts);
  try {
    assert.equal(workoutById('c_30_15_3x13').name, 'Replaced');
    const all = allWorkouts();
    assert.equal(all.filter(w => w.id === 'c_30_15_3x13').length, 1, 'only once in the list');
    assert.deepEqual(all.slice(0, 2).map(w => w.id), ['c_30_15_3x13', 'c_new']);
    assert.equal(catalog().length, WORKOUTS.length + 1);
    assert.equal(workoutById('c_new').coach, true);
    assert.equal(WORKOUTS.find(w => w.id === 'c_30_15_3x13').name, '30 / 15 · 3 × 13', 'the built-in itself is untouched');
  } finally { COACH.length = 0; }
  assert.equal(workoutById('c_30_15_3x13').name, '30 / 15 · 3 × 13', 'without the coach file the built-in is back');
  assert.equal(allWorkouts().length, WORKOUTS.length);
});

test('broken JSON or a wrong root: no workouts, one error, no throw', () => {
  for (const x of ['{ "workouts": [', '', 'null', '"text"', '{"workouts": 5}', '{}', 42, null, undefined]) {
    const r = parseCoach(x); assert.equal(r.workouts.length, 0, String(x)); assert.equal(r.errors.length, 1, String(x));
  }
  assert.match(parseCoach('{ nope').errors[0], /not valid JSON/);
  assert.deepEqual(parseCoach({ workouts: [] }), { workouts: [], errors: [] });
});

test('the example file: its first workout is exactly the built-in c_30_15_3x13, the second loads in % FTP', () => {
  const r = parseCoach(EX); assert.deepEqual(r.errors, []); assert.equal(r.workouts.length, 2);
  const b = WORKOUTS.find(w => w.id === 'c_30_15_3x13'), e = r.workouts[0];
  const sig = w => w.steps.map(s => [s.dur, s.watts ?? s.pct, s.pct2 ?? null, s.label]);
  assert.deepEqual(sig(e), sig(b));
  assert.equal(e.id, b.id); assert.equal(e.name, b.name); assert.equal(e.what, b.what); assert.equal(e.rampIn, b.rampIn); assert.equal(e.rampOut, b.rampOut);
  assert.equal(workoutDuration(e), workoutDuration(b)); assert.equal(Math.round(workoutDuration(e) / 60), 63);
  assert.ok(r.workouts[1].steps.every(s => s.watts == null && s.pct >= 30));
  assert.ok(r.workouts[1].steps.some(s => s.label === 'Sweet Spot · 4/4'));
});

test('the check tool: prints the workouts, exit 0; exit 1 on errors', () => {
  const ok = spawnSync(process.execPath, [ROOT + 'tools/coach-workout.mjs', 'check', ROOT + 'coach/workouts.example.json'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /c_30_15_3x13.*63 min · 86 steps · max 420 W/); assert.match(ok.stdout, /2 workouts OK, 0 errors/);
  const tmp = fileURLToPath(new URL('./coach-check-bad.tmp.json', import.meta.url));
  const fs = { w: (p, s) => import('node:fs').then(m => m.writeFileSync(p, s)) };
  return fs.w(tmp, JSON.stringify({ workouts: [one(), one({ id: 'bad' })] })).then(async () => {
    const r = spawnSync(process.execPath, [ROOT + 'tools/coach-workout.mjs', 'check', tmp], { encoding: 'utf8' });
    (await import('node:fs')).unlinkSync(tmp);
    assert.equal(r.status, 1); assert.match(r.stdout, /✓ c_test/); assert.match(r.stdout, /✗ Workout 2 \(bad\): id/);
    const none = spawnSync(process.execPath, [ROOT + 'tools/coach-workout.mjs', 'check', ROOT + 'coach/does-not-exist.json'], { encoding: 'utf8' });
    assert.equal(none.status, 1);
  });
});
