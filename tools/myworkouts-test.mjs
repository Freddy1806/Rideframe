// Personal workouts: the pure module (js/myworkouts.js: limits, numbers, repeat / collapse, the ride shape that workoutAt runs)
// and the account API (tools/workouts-api.mjs) against a real serve.mjs on a free port with a temp data folder:
// sign-in, privacy between accounts, limits, file modes.
// Usage: node --test tools/myworkouts-test.mjs   (no real data is touched)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import * as MW from '../js/myworkouts.js';
import { WORKOUTS, workoutAt, PERSONAL, workoutById, allWorkouts } from '../js/workouts.js';

const W = (o = {}) => ({ id: 'pw_test1', name: 'My VO2', base: 'vo2_5x3', steps: [{ min: 10, pct: 60, label: 'Warm-up' }, { min: 3, pct: 118, label: 'VO2' }, { min: 3, pct: 50, label: 'Rest' }], ...o });

/* ---------------- pure module ---------------- */
test('validation: a good workout is normalised', () => {
  const v = MW.validateWorkout({ ...W(), name: '  My   VO2 <b> ', steps: [{ min: '3.333', pct: 117.6, label: 'VO2\u0007 max', free: 'yes' }, { min: 1, pct: 100, free: true }], routeId: 'fluss', routeName: 'River Valley', extra: 1 });
  assert.ifError(v.error);
  assert.deepEqual(v.w, { id: 'pw_test1', name: 'My VO2 b', base: 'vo2_5x3', steps: [{ min: 3.33, pct: 118, label: 'VO2 max' }, { min: 1, pct: 100, label: '', free: true }], updated: 0, routeId: 'fluss', routeName: 'River Valley' });
});
test('validation: name 1–40 characters', () => {
  assert.ok(MW.validateWorkout(W({ name: '' })).error);
  assert.ok(MW.validateWorkout(W({ name: '   ' })).error);
  assert.ok(MW.validateWorkout(W({ name: 42 })).error);
  assert.ok(!MW.validateWorkout(W({ name: 'x' })).error);
  assert.ok(!MW.validateWorkout(W({ name: 'x'.repeat(40) })).error);
  assert.ok(MW.validateWorkout(W({ name: 'x'.repeat(41) })).error);
});
test('validation: steps, minutes 0.25–120, % FTP 30–200, at most 60 steps', () => {
  const st = (min, pct) => W({ steps: [{ min, pct }] });
  for (const [min, pct] of [[0.25, 30], [120, 200], [0.5, 150]]) assert.ok(!MW.validateWorkout(st(min, pct)).error, `${min} min ${pct} %`);
  for (const [min, pct] of [[0.24, 50], [120.01, 50], [5, 29], [5, 201], [NaN, 50], [5, 'x'], [Infinity, 50]]) assert.ok(MW.validateWorkout(st(min, pct)).error, `${min} min ${pct} % refused`);
  assert.ok(MW.validateWorkout(W({ steps: [] })).error);
  assert.ok(MW.validateWorkout(W({ steps: 'no' })).error);
  assert.ok(MW.validateWorkout(W({ steps: [null] })).error);
  assert.ok(!MW.validateWorkout(W({ steps: Array(60).fill({ min: 1, pct: 80 }) })).error);
  assert.ok(MW.validateWorkout(W({ steps: Array(61).fill({ min: 1, pct: 80 }) })).error);
});
test('validation: id, base, routeId and the list', () => {
  for (const id of ['', 'abc', 'a b c d', '../../x', 'x'.repeat(41), null]) assert.ok(MW.validateWorkout(W({ id })).error, `id ${id}`);
  assert.ok(MW.validateWorkout(W({ base: 'a/b' })).error); assert.equal(MW.validateWorkout(W({ base: '' })).w.base, null);
  assert.ok(MW.validateWorkout(W({ routeId: '<script>' })).error);
  assert.ok(MW.validateWorkout(null).error); assert.ok(MW.validateWorkout([]).error);
  const many = Array.from({ length: 70 }, (_, i) => W({ id: 'pw_' + String(i).padStart(4, '0') }));
  assert.equal(MW.validateList([...many, W({ name: '' })]).length, MW.LIM.count);
  assert.equal(MW.validateList([W(), W()]).length, 1, 'ids unique');
  assert.deepEqual(MW.validateList('nope'), []);
});
test('numbers: total, average, watts, scaling only the work steps', () => {
  const s = W().steps;
  assert.equal(MW.totalSec(s), 16 * 60);
  assert.equal(MW.avgPct(s), Math.round((10 * 60 + 3 * 118 + 3 * 50) / 16));
  assert.equal(MW.watts(118, 250), 295); assert.equal(MW.watts(100, 0), null);
  const up = MW.scaleWork(s, 10);
  assert.deepEqual(up.map(x => x.pct), [60, 130, 50]);
  assert.deepEqual(MW.scaleWork([{ min: 1, pct: 190 }, { min: 1, pct: 100, free: true }], 20).map(x => x.pct), [200, 100], 'clamped, free steps stay');
  assert.deepEqual(s.map(x => x.pct), [60, 118, 50], 'the input is not changed');
});
test('repeat ×N and collapse are each other\'s inverse', () => {
  const s = W().steps, r = MW.repeatBlock(s, 1, 2, 5);
  assert.equal(r.length, 1 + 2 * 5);
  assert.deepEqual(MW.collapse(r).map(g => [g.n, g.steps.length]), [[1, 1], [5, 2]]);
  assert.deepEqual(MW.expand(MW.collapse(r)), r);
  assert.equal(MW.describe(r), '10 min 60 %, 5 × (3 min 118 % / 3 min 50 %)');
  assert.equal(MW.repeatBlock(s, 0, 0, 100).length, Math.min(MW.LIM.steps, s.length + MW.LIM.rep - 1), 'at most LIM.rep times');
  assert.equal(MW.repeatBlock(Array(50).fill({ min: 1, pct: 80 }), 0, 9, 3).length, MW.LIM.steps, 'never more than 60 steps');
  assert.deepEqual(MW.repeatBlock(s, 2, 1, 3), s, 'from > to: unchanged');
});
test('a built-in becomes a draft and back: the ride runs it through workoutAt unchanged', () => {
  for (const bw of WORKOUTS) {
    const d = MW.fromBuiltin(bw), v = MW.validateWorkout(d); assert.ifError(v.error); assert.equal(d.base, bw.id);
    const r = MW.toRide(v.w); assert.deepEqual(r.steps.map(x => [x.dur, x.pct, x.pct2 ?? null, !!x.free]), bw.steps.map(x => [x.dur, Math.min(MW.LIM.maxPct, x.pct), x.pct2 ?? null, !!x.free]), bw.id); // the ramp test's last steps (> 200 %) are capped
    if (bw.id === 'ramp') continue;
    for (const t of [0, 61, 240, 479, 900, 1e5]) { const a = workoutAt(r, t, 250), b = workoutAt(bw, t, 250); assert.deepEqual([a.i, a.target, a.left, a.done], [b.i, b.target, b.left, b.done]); }
  }
  const mine = MW.toRide(MW.validateWorkout(W({ routeId: 'fluss', routeName: 'River Valley' })).w);
  assert.equal(workoutAt(mine, 0, 250).target, 150); assert.equal(workoutAt(mine, 600, 250).target, 295);
  assert.equal(mine.name, 'My VO2'); assert.ok(mine.personal); assert.equal(mine.routeId, 'fluss'); assert.match(mine.what, /3 min 118 %/);
  PERSONAL.push(mine); assert.equal(workoutById('pw_test1'), mine); assert.ok(allWorkouts().includes(mine)); PERSONAL.length = 0;
  assert.ok(!MW.validateWorkout(MW.freeTemplate()).error);
});
test('order for a route: the ones made for it first, then the newest', () => {
  const l = [W({ id: 'pw_a001', updated: 3 }), W({ id: 'pw_b001', updated: 1, routeId: 'fluss' }), W({ id: 'pw_c001', updated: 5 })];
  assert.deepEqual(MW.orderFor(l, 'fluss').map(x => x.id), ['pw_b001', 'pw_c001', 'pw_a001']);
  assert.match(MW.graphSVG(W().steps), /^<svg[^>]*>.*<rect.*fill="#6b7480"|fill="#2f8fe0"/s);
  assert.equal(MW.zoneOf(118)[1], 'Z5'); assert.equal(MW.zoneOf(50)[1], 'Z1');
});

/* ---------------- the API ---------------- */
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv, base, DATA, ipN = 0, A, B;
const ip = () => `10.8.${ipN >> 8}.${ipN++ & 255}`;
const call = async (method, p, { body, token, raw } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip(), ...(token ? { 'X-RF-Token': token } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, j };
};
const register = async name => { const r = await call('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1' } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.token; };
const uidOf = async name => JSON.parse(await readFile(join(DATA, 'accounts.json'), 'utf8')).users[name.toLowerCase()].id;
before(async () => {
  DATA = await mkdtemp(join(tmpdir(), 'rf-myworkouts-test-'));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  A = await register('Rider Anna'); B = await register('Rider Ben');
});
after(async () => { srv?.kill(); if (DATA) await rm(DATA, { recursive: true, force: true }); });

test('API: without a valid login every route answers 401', async () => {
  for (const [m, p] of [['GET', '/api/account/workouts'], ['GET', '/api/account/workouts/pw_test1'], ['PUT', '/api/account/workouts/pw_test1'], ['DELETE', '/api/account/workouts/pw_test1']]) {
    assert.equal((await call(m, p, { body: m === 'PUT' ? W() : undefined })).status, 401, `${m} ${p}`);
    assert.equal((await call(m, p, { token: 'not-a-token', body: m === 'PUT' ? W() : undefined })).status, 401, `${m} ${p} wrong token`);
  }
});
test('API: create, read, list, replace, delete', async () => {
  assert.deepEqual((await call('GET', '/api/account/workouts', { token: A })).j, { workouts: [], at: 0 });
  const p = await call('PUT', '/api/account/workouts/pw_test1', { token: A, body: W({ id: 'ignored-the-path-wins', routeId: 'fluss', routeName: 'River Valley' }) });
  assert.equal(p.status, 200, JSON.stringify(p.j)); assert.equal(p.j.workout.id, 'pw_test1'); assert.ok(p.j.workout.updated > Date.now() - 60e3);
  assert.equal((await call('GET', '/api/account/workouts/pw_test1', { token: A })).j.workout.name, 'My VO2');
  await call('PUT', '/api/account/workouts/pw_test2', { token: A, body: W({ name: 'Second' }) });
  const l = (await call('GET', '/api/account/workouts', { token: A })).j; assert.deepEqual(l.workouts.map(x => x.id), ['pw_test2', 'pw_test1']);
  const r = await call('PUT', '/api/account/workouts/pw_test1', { token: A, body: W({ name: 'My VO2 harder', steps: [{ min: 3, pct: 125 }] }) });
  assert.equal(r.status, 200); assert.equal(r.j.workout.steps[0].pct, 125);
  assert.deepEqual((await call('GET', '/api/account/workouts', { token: A })).j.workouts.map(x => x.name), ['Second', 'My VO2 harder'], 'replaced in place');
  assert.equal((await call('DELETE', '/api/account/workouts/pw_test2', { token: A })).status, 200);
  assert.equal((await call('DELETE', '/api/account/workouts/pw_test2', { token: A })).status, 404);
  assert.equal((await call('GET', '/api/account/workouts/pw_test2', { token: A })).status, 404);
  assert.equal((await call('POST', '/api/account/workouts/pw_test1', { token: A, body: W() })).status, 405);
  assert.equal((await call('PUT', '/api/account/workouts', { token: A, body: W() })).status, 405);
});
test('API: bad input is refused with 400 / 413, nothing stored', async () => {
  for (const b of [W({ name: '' }), W({ name: 'x'.repeat(41) }), W({ steps: [{ min: 0.1, pct: 80 }] }), W({ steps: [{ min: 5, pct: 250 }] }), W({ steps: Array(61).fill({ min: 1, pct: 80 }) }), [], 'x'])
    assert.equal((await call('PUT', '/api/account/workouts/pw_bad01', { token: A, body: b })).status, 400, JSON.stringify(b).slice(0, 60));
  assert.equal((await call('PUT', '/api/account/workouts/pw_bad01', { token: A, raw: '{nope' })).status, 400);
  assert.equal((await call('PUT', '/api/account/workouts/a%2F..%2Fx', { token: A, body: W() })).status, 400, 'id from the path is checked');
  assert.equal((await call('PUT', '/api/account/workouts/pw_bad01', { token: A, raw: JSON.stringify({ ...W(), pad: 'x'.repeat(20e3) }) })).status, 413);
  assert.equal((await call('GET', '/api/account/workouts/pw_bad01', { token: A })).status, 404);
});
test('API: private: B never sees or changes A\'s workouts', async () => {
  assert.deepEqual((await call('GET', '/api/account/workouts', { token: B })).j.workouts, []);
  assert.equal((await call('GET', '/api/account/workouts/pw_test1', { token: B })).status, 404);
  assert.equal((await call('DELETE', '/api/account/workouts/pw_test1', { token: B })).status, 404);
  // the same id written by B lands in B's own list, A's stays as it was
  assert.equal((await call('PUT', '/api/account/workouts/pw_test1', { token: B, body: W({ name: 'Ben overwrites?' }) })).status, 200);
  assert.equal((await call('GET', '/api/account/workouts/pw_test1', { token: A })).j.workout.name, 'My VO2 harder');
  assert.equal((await call('GET', '/api/account/workouts/pw_test1', { token: B })).j.workout.name, 'Ben overwrites?');
  const pa = await readFile(join(DATA, 'users', await uidOf('Rider Anna'), 'workouts.json'), 'utf8'), pb = await readFile(join(DATA, 'users', await uidOf('Rider Ben'), 'workouts.json'), 'utf8');
  assert.ok(!pa.includes('Ben overwrites') && !pb.includes('harder'));
  // nothing of it in the shared views (leaderboard, profile)
  const prof = await call('GET', '/api/account/profile/' + encodeURIComponent('Rider Anna'), { token: B }); assert.equal(prof.status, 200); assert.ok(!JSON.stringify(prof.j).includes('VO2'));
  const board = await call('GET', '/api/account/board', { token: B }); assert.ok(!JSON.stringify(board.j).includes('VO2'));
});
test('API: file and folder modes 0600 / 0700', async () => {
  const d = join(DATA, 'users', await uidOf('Rider Anna')), f = join(d, 'workouts.json');
  assert.equal((await stat(f)).mode & 0o777, 0o600); assert.equal((await stat(d)).mode & 0o777, 0o700);
  assert.ok(!(await readdir(d)).some(x => x.endsWith('.tmp')), 'no temp files left');
});
test('API: at most 50 workouts per account', async () => {
  const C = await register('Rider Cleo');
  for (let i = 0; i < MW.LIM.count; i++) assert.equal((await call('PUT', `/api/account/workouts/pw_n${String(i).padStart(3, '0')}`, { token: C, body: W({ name: 'N' + i }) })).status, 200);
  assert.equal((await call('PUT', '/api/account/workouts/pw_n999', { token: C, body: W() })).status, 409);
  assert.equal((await call('PUT', '/api/account/workouts/pw_n000', { token: C, body: W({ name: 'replace still works' }) })).status, 200);
  assert.equal((await call('GET', '/api/account/workouts', { token: C })).j.workouts.length, MW.LIM.count);
});

/* ---------------- ramps (pct -> pct2, like the built-ins' warm-up) ---------------- */
const RAMP = { min: 8, pct: 40, pct2: 75, label: 'Warm-up' };
test('ramps: pct2 is validated like pct, a ramp to the same % is flat', () => {
  assert.deepEqual(MW.validateWorkout(W({ steps: [RAMP] })).w.steps, [{ min: 8, pct: 40, pct2: 75, label: 'Warm-up' }]);
  assert.deepEqual(MW.validateWorkout(W({ steps: [{ min: 6, pct: 55, pct2: '35' }] })).w.steps[0].pct2, 35, 'down ramps too, strings as numbers');
  assert.equal(MW.validateWorkout(W({ steps: [{ min: 5, pct: 80, pct2: 80 }] })).w.steps[0].pct2, undefined);
  assert.equal(MW.validateWorkout(W({ steps: [{ min: 5, pct: 80, pct2: '' }] })).w.steps[0].pct2, undefined, 'empty = flat');
  assert.equal(MW.validateWorkout(W({ steps: [{ min: 5, pct: 80, pct2: null }] })).w.steps[0].pct2, undefined);
  for (const p2 of [29, 201, 'x', NaN, Infinity]) assert.ok(MW.validateWorkout(W({ steps: [{ min: 5, pct: 80, pct2: p2 }] })).error, `pct2 ${p2} refused`);
  assert.ok(!MW.validateWorkout(W({ steps: [{ min: 5, pct: 30, pct2: 200 }] })).error);
});
test('ramps: numbers, scaling, describe, repeat / collapse keep the slope', () => {
  const st = [RAMP, { min: 4, pct: 100, pct2: 120 }, { min: 4, pct: 50 }];
  assert.equal(MW.avgPct([RAMP]), 58, 'a ramp counts halfway (57.5)');
  assert.equal(MW.avgPct(st), Math.round((8 * 57.5 + 4 * 110 + 4 * 50) / 16));
  assert.deepEqual(MW.scaleWork(st, 10).map(x => [x.pct, x.pct2]), [[40, 75], [110, 132], [50, undefined]], 'the warm-up ramp is no work step and stays, a work ramp scales both ends');
  assert.equal(MW.describe(st), '8 min 40→75 %, 4 min 100→120 %, 4 min 50 %');
  const r = MW.repeatBlock(st, 1, 2, 3); assert.equal(r.length, 7); assert.deepEqual(r[3], st[1]);
  assert.deepEqual(MW.collapse(r).map(g => g.n), [1, 3]);
  assert.deepEqual(MW.collapse([{ min: 4, pct: 100, pct2: 120 }, { min: 4, pct: 100 }]).map(g => g.n), [1, 1], 'a ramp and a flat step with the same start are not the same');
  const svg = MW.graphSVG(st); assert.equal((svg.match(/<polygon /g) || []).length, 2, 'ramps drawn sloped'); assert.equal((svg.match(/<rect /g) || []).length, 1);
});
test('ramps: the ride follows them second by second through workoutAt (pctAt)', () => {
  const r = MW.toRide(MW.validateWorkout(W({ steps: [RAMP, { min: 2, pct: 100 }] })).w);
  assert.deepEqual(r.steps[0], { dur: 480, pct: 40, pct2: 75, label: 'Warm-up' });
  assert.equal(workoutAt(r, 0, 200).target, 80); assert.equal(workoutAt(r, 240, 200).target, Math.round(57.5 * 2)); assert.equal(workoutAt(r, 479, 200).target, Math.round((40 + 35 * 479 / 480) * 2));
  assert.equal(workoutAt(r, 480, 200).target, 200);
  const d = MW.fromBuiltin(WORKOUTS.find(w => w.id === 'vo2_5x3')); assert.deepEqual(d.steps[0], { min: 8, pct: 40, pct2: 75, label: 'Warm-up' }, 'the built-in warm-up stays a ramp in the editor');
});
test('names without a keyboard: default "River Valley VO2 1", the next free number, suggestions', () => {
  assert.equal(MW.kindOf('VO2max 5 × 3'), 'VO2'); assert.equal(MW.kindOf('Sweet Spot 3 × 10'), 'Sweet Spot'); assert.equal(MW.kindOf('Ramp test (FTP)'), 'Ramp test'); assert.equal(MW.kindOf(''), 'Intervals');
  assert.equal(MW.defaultName('River Valley', 'VO2'), 'River Valley VO2 1');
  assert.equal(MW.defaultName('River Valley', 'VO2', ['river valley vo2 1', 'River Valley VO2 2']), 'River Valley VO2 3');
  assert.equal(MW.defaultName('', 'Intervals'), 'Intervals 1');
  const long = MW.defaultName('A very long route name that goes on and on', 'Sweet Spot'); assert.ok(long.length <= MW.LIM.name && long.endsWith(' 1'), long);
  const sg = MW.nameSuggestions('River Valley', 'VO2', ['My VO2'], { minutes: 43, day: 2 });
  assert.deepEqual(sg, ['River Valley VO2 1', 'My VO2 1', 'VO2 Tuesday', 'VO2 43 min']);
  for (const n of sg) assert.ok(!MW.validateWorkout(W({ name: n })).error);
});
test('API: ramps are stored, a bad ramp is refused', async () => {
  const p = await call('PUT', '/api/account/workouts/pw_ramp1', { token: A, body: W({ steps: [RAMP, { min: 3, pct: 120 }] }) }); assert.equal(p.status, 200);
  assert.deepEqual((await call('GET', '/api/account/workouts/pw_ramp1', { token: A })).j.workout.steps[0], { min: 8, pct: 40, pct2: 75, label: 'Warm-up' });
  assert.equal((await call('PUT', '/api/account/workouts/pw_ramp2', { token: A, body: W({ steps: [{ min: 3, pct: 120, pct2: 250 }] }) })).status, 400);
  assert.equal((await call('DELETE', '/api/account/workouts/pw_ramp1', { token: A })).status, 200);
});
