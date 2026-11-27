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
import { WORKOUTS, workoutAt, PERSONAL, workoutById, allWorkouts, workoutState, timelineSVG } from '../js/workouts.js';

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
test('validation: steps, minutes 0.17–120 (10 s), % FTP 30–200, at most 200 steps', () => {
  const st = (min, pct) => W({ steps: [{ min, pct }] });
  for (const [min, pct] of [[0.17, 30], [120, 200], [0.5, 150]]) assert.ok(!MW.validateWorkout(st(min, pct)).error, `${min} min ${pct} %`);
  for (const [min, pct] of [[0.16, 50], [120.01, 50], [5, 29], [5, 201], [NaN, 50], [5, 'x'], [Infinity, 50]]) assert.ok(MW.validateWorkout(st(min, pct)).error, `${min} min ${pct} % refused`);
  assert.ok(MW.validateWorkout(W({ steps: [] })).error);
  assert.ok(MW.validateWorkout(W({ steps: 'no' })).error);
  assert.ok(MW.validateWorkout(W({ steps: [null] })).error);
  assert.ok(!MW.validateWorkout(W({ steps: Array(200).fill({ min: 1, pct: 80 }) })).error);
  assert.ok(MW.validateWorkout(W({ steps: Array(201).fill({ min: 1, pct: 80 }) })).error);
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
  assert.equal(MW.repeatBlock(Array(190).fill({ min: 1, pct: 80 }), 0, 9, 3).length, MW.LIM.steps, 'never more than LIM.steps');
  assert.deepEqual(MW.repeatBlock(s, 2, 1, 3), s, 'from > to: unchanged');
});
test('a built-in becomes a draft and back: the ride runs it through workoutAt unchanged', () => {
  for (const bw of WORKOUTS.filter(w => !w.coach)) { // coach workouts are in absolute watts and seconds, not a draft in % FTP and minutes
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
  for (const b of [W({ name: '' }), W({ name: 'x'.repeat(41) }), W({ steps: [{ min: 0.1, pct: 80 }] }), W({ steps: [{ min: 5, pct: 250 }] }), W({ steps: Array(201).fill({ min: 1, pct: 80 }) }), [], 'x'])
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

test('interval bar (main 17.11.): a personal workout with ramps runs and draws like a built-in, offsets on the ramp end too', () => {
  const p = MW.validateWorkout({ id: 'pwramp1', name: 'Ramps', steps: [{ min: 10, pct: 40, pct2: 75 }, { min: 4, pct: 110, pct2: 130 }, { min: 3, pct: 55 }, { min: 2, pct: 90, free: true }] }).w, w = MW.toRide(p);
  const a = workoutState(w, 300, 250), b = workoutState(w, 600 + 120, 250, { hardAdj: 10, ramp: true }), c = workoutState(w, 600 + 239, 250, { hardAdj: 10 });
  assert.equal(a.target, Math.round((40 + 35 / 2) / 100 * 250), 'warm-up ramp: half way 57.5 %'); assert.equal(a.ramp, 'step'); assert.equal(a.rampTo, Math.round(0.75 * 250));
  assert.equal(b.target, Math.round(1.2 * 250) + 10, 'hard ramp half way 120 % + the rider\'s 10 W'); assert.equal(b.hard, true); assert.equal(c.rampTo, Math.round(1.3 * 250) + 10);
  assert.ok(c.target <= c.rampTo && c.target >= Math.round(1.29 * 250) + 10, 'the end of the hard ramp');
  const svg = timelineSVG(b, 720, w), polys = svg.match(/<polygon [^>]+>/g) || [], rects = svg.match(/<rect x=[^>]+rx="3"[^>]*>/g) || [];
  assert.equal(polys.length, 2, 'both ramps drawn sloped'); assert.equal(rects.length, 2, 'the flat and the free step as blocks');
  const ys = poly => poly.match(/points="([^"]+)"/)[1].split(' ').map(q => +q.split(',')[1]);
  const [, y0, y1] = ys(polys[1]), [, z0, z1] = ys(polys[0]); assert.ok(y1 < y0, 'the hard ramp rises'); assert.ok(z1 < z0, 'the warm-up rises');
  const st = b.steps[1]; assert.ok(Math.abs((st.pct2 - st.pct) - 20) < 0.01, `the 10 W offset lifts both ends of the hard ramp (${st.pct.toFixed(1)} -> ${st.pct2.toFixed(1)} %)`);
});

test('fast editor: templates are valid workouts, − / + steps sensibly within the limits, a set goes before the cool-down', () => {
  assert.ok(MW.TEMPLATES.length >= 5);
  for (const t of MW.TEMPLATES) { const r = MW.validateWorkout({ id: 'tpl_' + t.id, name: t.name, steps: t.steps() }); assert.ok(r.w, t.id + ': ' + r.error);
    assert.equal(r.w.steps[0].label, 'Warm-up'); assert.equal(r.w.steps.at(-1).label, 'Cool-down'); assert.notEqual(t.steps(), t.steps(), 'a fresh copy each time'); }
  const b = (min, f, d, pct = 90) => MW.bump({ min, pct }, f, d)[f];
  assert.deepEqual([b(4, 'min', 1), b(5, 'min', 1), b(5, 'min', -1), b(12, 'min', 1), b(20, 'min', 1), b(25, 'min', -1), b(0.25, 'min', -1), b(120, 'min', 1)], [4.5, 6, 4.5, 13, 25, 20, 0.17, 120]);
  assert.deepEqual([b(4, 'pct', 1, 93), b(4, 'pct', -1, 93), b(4, 'pct', 1, 200), b(4, 'pct', -1, 30)], [95, 90, 200, 30]);
  assert.equal(MW.bump({ min: 3, pct: 100, pct2: 105 }, 'pct2', -1).pct2, undefined, 'a ramp to the same % turns flat');
  const s = MW.addSet([{ min: 10, pct: 45, pct2: 70, label: 'Warm-up' }, { min: 8, pct: 60, pct2: 40, label: 'Cool-down' }]);
  assert.equal(s.length, 10); assert.equal(s.at(-1).label, 'Cool-down'); assert.deepEqual(s.slice(1, 3).map(x => [x.min, x.pct, x.label]), [[4, 105, 'Interval 1/4'], [3, 55, 'Rest']]);
  assert.equal(MW.insertAt([{ min: 5, pct: 50, label: 'Easy' }]), 1, 'no cool-down: at the end');
  assert.deepEqual(MW.nextBlock([{ min: 4, pct: 110, label: 'Interval' }]), { min: 2, pct: 55, label: 'Rest' }, 'after a hard block its rest');
  assert.equal(MW.nextBlock([{ min: 5, pct: 55, label: 'Rest' }]).pct, 105, 'after an easy one an interval');
  assert.equal((MW.graphSVG(s).match(/data-i="\d+"/g) || []).length, s.length, 'every block in the chart can be tapped');
});

test('customising the long coach workout keeps every step (Freddy 20.11.: the last interval block was cut off at 60 steps)', () => {
  const bw = workoutById('c_30_15_3x13'), d = MW.fromBuiltin(bw), v = MW.validateWorkout(d);
  assert.ifError(v.error); assert.equal(v.w.steps.length, bw.steps.length);
  assert.equal(v.w.steps.filter(s => /set 3/.test(s.label)).length, 13, 'the third set is complete');
  assert.deepEqual(MW.toRide(v.w).steps.map(s => s.dur), bw.steps.map(s => s.dur), 'every step keeps its length, the 10 s sprints too');
  const cut = { ...v.w, steps: v.w.steps.slice(8) }, v2 = MW.validateWorkout(cut); assert.ifError(v2.error); // the start deleted
  assert.equal(MW.toRide(v2.w).steps.filter(s => /· \d+\/13$/.test(s.label)).length, 39, '3 × 13 efforts are still there');
});

/* ---------------- v2: the builder's step model (owner 24.11.: like a bike-computer workout builder) ---------------- */
import { runInit, runTick, runNext, runView, endInfo, tgtInfo, setFtp, KCAL_PER_KJ, HOLD_S } from '../js/workouts.js';
const S2 = (type, dur, target = { kind: 'none' }, o = {}) => ({ type, dur, target, ...o });
const T = sec => ({ kind: 'time', sec });
const V2 = (steps, o = {}) => ({ v: 2, id: 'pw_v2test', name: 'Bike Workout', notes: '', steps, ...o });

test('v2 validation: every duration and target kind is accepted and normalised', () => {
  const v = MW.validateWorkout(V2([
    S2('warmup', { kind: 'lap' }), S2('work', T('600'), { kind: 'powerZone', zone: '4' }, { note: ' hold\u0007 it ', target2: { kind: 'cadence', lo: 95, hi: 85 } }),
    S2('work', { kind: 'distance', m: 5000.4 }, { kind: 'power', lo: 260, hi: 240 }), S2('work', { kind: 'calories', kcal: 99.6 }, { kind: 'ftp', pct: 90.4 }),
    S2('recover', { kind: 'hr', op: 'lt', bpm: 120 }, { kind: 'hrZone', zone: 2 }), S2('work', { kind: 'power', op: 'gt', w: 300 }, { kind: 'hr', lo: 150, hi: 165 }),
    S2('other', T(90), { kind: 'speed', lo: 30.04, hi: 33 }), S2('rest', T(60), { kind: 'ftp', pct: 40, pct2: 60 }),
    { repeat: 3, steps: [S2('work', T(300), { kind: 'ftp', pct: 110 }), S2('recover', T(120), { kind: 'ftp', pct: 50 })], skipLast: true },
    S2('cooldown', { kind: 'lap' }, { kind: 'none', pct: 45 })], { name: '  My  build ', notes: 'line 1\n\n\n\nline 2 <b>' }));
  assert.ifError(v.error); const w = v.w;
  assert.equal(w.v, 2); assert.equal(w.name, 'My build'); assert.equal(w.notes, 'line 1\n\nline 2 b'); assert.equal(w.sport, 'bike');
  assert.deepEqual(w.steps[1], { type: 'work', dur: { kind: 'time', sec: 600 }, target: { kind: 'powerZone', zone: 4 }, target2: { kind: 'cadence', lo: 85, hi: 95 }, note: 'hold it' }, 'lo / hi in order, note cleaned');
  assert.deepEqual(w.steps[2].dur, { kind: 'distance', m: 5000 }); assert.deepEqual(w.steps[2].target, { kind: 'power', lo: 240, hi: 260 });
  assert.deepEqual(w.steps[3].dur, { kind: 'calories', kcal: 100 }); assert.deepEqual(w.steps[3].target, { kind: 'ftp', pct: 90 });
  assert.deepEqual(w.steps[6].target, { kind: 'speed', lo: 30, hi: 33 });
  assert.deepEqual(w.steps[7].target, { kind: 'ftp', pct: 40, pct2: 60 }, 'a ramp on a timed step');
  assert.equal(w.steps[8].skipLast, true); assert.equal(MW.countSteps(w.steps), 9 + 5);
});
test('v2 validation: out of range, unknown kinds, nested repeats and too many steps are refused', () => {
  const bad = [
    [S2('sprint', T(60))], [S2('work', T(4))], [S2('work', T(21601))], [S2('work', { kind: 'distance', m: 10 })], [S2('work', { kind: 'calories', kcal: 0 })],
    [S2('work', { kind: 'hr', op: 'eq', bpm: 150 })], [S2('work', { kind: 'hr', op: 'gt', bpm: 250 })], [S2('work', { kind: 'power', op: 'lt', w: 5 })], [S2('work', { kind: 'swim' })],
    [S2('work', T(60), { kind: 'powerZone', zone: 8 })], [S2('work', T(60), { kind: 'hrZone', zone: 6 })], [S2('work', T(60), { kind: 'ftp', pct: 250 })], [S2('work', T(60), { kind: 'ftp', pct: 90, pct2: 20 })],
    [S2('work', T(60), { kind: 'power', lo: 10, hi: 200 })], [S2('work', T(60), { kind: 'cadence', lo: 80, hi: 300 })], [S2('work', T(60), { kind: 'zap' })],
    [S2('work', T(60), { kind: 'none' }, { target2: { kind: 'power', lo: 200, hi: 220 } })],
    [{ repeat: 0, steps: [S2('work', T(60))] }], [{ repeat: 100, steps: [S2('work', T(60))] }], [{ repeat: 2, steps: [] }],
    [{ repeat: 2, steps: [{ repeat: 2, steps: [S2('work', T(60))] }] }], [{ repeat: 99, steps: [S2('work', T(60)), S2('recover', T(60)), S2('work', T(60))] }], [],
  ];
  for (const st of bad) assert.ok(MW.validateWorkout(V2(st)).error, JSON.stringify(st).slice(0, 90));
  assert.ok(!MW.validateWorkout(V2([{ repeat: 99, steps: [S2('work', T(60)), S2('recover', T(60))] }])).error, '99 × 2 = 198 steps is fine');
  assert.ok(MW.validateWorkout(V2([S2('work', T(60)), S2('work', T(60)), S2('work', T(60)), { repeat: 99, steps: [S2('work', T(60)), S2('recover', T(60))] }])).error, '201 with the repeats counted');
  assert.equal(MW.validateWorkout(V2([S2('work', { kind: 'distance', m: 1000 }, { kind: 'ftp', pct: 80, pct2: 90 })])).w.steps[0].target.pct2, undefined, 'a ramp needs a time: dropped on a distance step');
  assert.equal(MW.validateWorkout(V2([{ repeat: 2, steps: [S2('work', T(60)), S2('work', T(60))], skipLast: true }])).w.steps[0].skipLast, undefined, 'skip last only for a recovery / rest at the end');
});
test('v2: old workouts convert to steps without loss, the ride sees the same workout', () => {
  const olds = [W(), W({ steps: [RAMP, { min: 3.33, pct: 118, label: 'VO2' }, { min: 20, pct: 100, label: 'Test', free: true }] }), ...WORKOUTS.filter(b => !b.coach).map(b => MW.validateWorkout(MW.fromBuiltin(b)).w)];
  for (const o of olds) {
    const n = MW.toV2(o), v = MW.validateWorkout(n); assert.ifError(v.error);
    const a = MW.toRide(o).steps, b = MW.toRide(v.w).steps;
    assert.deepEqual(b.map(x => [x.dur, x.pct, x.pct2 ?? null, !!x.free, x.label]), a.map(x => [x.dur, x.pct, x.pct2 ?? null, !!x.free, x.label]), o.name);
    for (const t of [0, 100, 700, 1500]) assert.deepEqual(workoutAt(MW.toRide(v.w), t, 250).target, workoutAt(MW.toRide(o), t, 250).target);
  }
  assert.equal(MW.toV2(W()).steps[0].type, 'warmup'); assert.equal(MW.toV2(W()).steps[2].type, 'recover'); assert.equal(MW.toV2(W()).base, 'vo2_5x3');
  assert.deepEqual(MW.toV2(W({ steps: [{ min: 20, pct: 100, free: true }] })).steps[0].target, { kind: 'none', pct: 100 }, 'a free step keeps its % as the hint');
});
test('v2: a built-in becomes steps with its interval sets as repeat blocks, the ride is the same', () => {
  for (const bw of WORKOUTS) {
    const d = MW.fromBuiltin2(bw), v = MW.validateWorkout(d); assert.ifError(v.error, bw.id); setFtp(250);
    const r = MW.toRide(v.w).steps;
    assert.deepEqual(r.map(x => [x.dur, Math.round(x.pct), x.pct2 ?? null, !!x.free]), bw.steps.map(x => [x.dur, Math.round(Math.min(MW.LIM.maxPct, x.pct)), x.pct2 ?? null, !!x.free]), bw.id);
  }
  const v = MW.fromBuiltin2(WORKOUTS.find(b => b.id === 'vo2_5x3')), rep = v.steps.find(x => x.repeat);
  assert.equal(rep.repeat, 5); assert.equal(rep.skipLast, true); assert.deepEqual(rep.steps.map(s => [s.type, s.label, s.dur.sec, s.target.pct]), [['work', 'VO2max', 180, 120], ['recover', 'Rest', 180, 50]]);
  assert.deepEqual(MW.toRide(v).steps.filter(s => /^VO2max/.test(s.label)).map(s => s.label), ['VO2max 1/5', 'VO2max 2/5', 'VO2max 3/5', 'VO2max 4/5', 'VO2max 5/5'], 'the sets are numbered like before');
  const c = MW.fromBuiltin2(workoutById('c_30_15_3x13')); assert.equal(c.steps.filter(x => x.repeat === 13 && x.skipLast).length, 3, 'three sets of 13 (30 s on, 15 s off, no float after the 13th)'); assert.equal(MW.countSteps(c.steps), workoutById('c_30_15_3x13').steps.length);
  assert.deepEqual(c.steps.find(x => x.repeat === 13).steps[0].target, { kind: 'power', lo: 340, hi: 340 }, 'steps in watts stay watts');
});
test('v2: expansion, estimates and the summary', () => {
  const st = [S2('warmup', { kind: 'lap' }), { repeat: 3, steps: [S2('work', T(300), { kind: 'ftp', pct: 110 }), S2('recover', T(120), { kind: 'ftp', pct: 50 })], skipLast: true }, S2('cooldown', T(300), { kind: 'ftp', pct: 50 })];
  const f = MW.flatSteps(st); assert.equal(f.length, 1 + 5 + 1); assert.deepEqual(f.map(x => x.path), ['0', '1.0', '1.1', '1.0', '1.1', '1.0', '2']);
  assert.deepEqual(f[3].rep, { at: 1, k: 2, n: 3 });
  const sm = MW.summary2(st, 250); assert.equal(sm.sec, MW.EST.lap + 3 * 300 + 2 * 120 + 300); assert.equal(sm.exact, false); assert.equal(sm.steps, 7);
  assert.equal(sm.avg, Math.round((3 * 300 * 110 + 2 * 120 * 50 + 300 * 50) / (900 + 240 + 300)), 'the open warm-up has no power target');
  assert.equal(MW.estSec(S2('work', { kind: 'distance', m: 10000 }, { kind: 'speed', lo: 35, hi: 45 })), Math.round(10000 / (40 / 3.6)), 'distance at the speed target');
  assert.equal(MW.estSec(S2('work', { kind: 'distance', m: 30000 }, { kind: 'ftp', pct: 70 }), 250), 3600, '30 km/h at 70 % FTP');
  assert.equal(MW.estSec(S2('work', { kind: 'calories', kcal: 300 }, { kind: 'ftp', pct: 100 }), 250), 1200, '300 kcal ≈ 300 kJ at 250 W = 20 min');
  assert.equal(MW.estSec(S2('work', { kind: 'hr', op: 'gt', bpm: 160 })), MW.EST.hr); assert.equal(MW.estSec(S2('work', { kind: 'power', op: 'lt', w: 100 })), MW.EST.power);
  assert.equal(MW.summary2([S2('work', { kind: 'distance', m: 4000 })]).mExact, true);
  assert.match(MW.chartSVG(st), /wbHatch.*data-p="0"[^>]*url\(#wbHatch\)/s, 'the open step hatched'); assert.equal((MW.chartSVG(st).match(/data-p=/g) || []).length, 7);
  assert.equal(MW.describe2(st), 'Warm up lap, 3 × (Bike 5:00 110 % FTP / Recover 2:00 50 % FTP), Cool down 5:00 50 % FTP');
});
test('v2: time entry mm:ss and h:mm:ss', () => {
  for (const [t, s] of [['10:00', 600], ['1:30', 90], ['1:02:03', 3723], ['90', 5400], ['45s', 45], ['1h5m', 3900], ['0:05', 5]]) assert.equal(MW.parseDur(t), s, t);
  for (const t of ['', 'x', '1:75', '1:2:3:4']) assert.ok(Number.isNaN(MW.parseDur(t)), t);
  assert.equal(MW.fmtDur(3723), '1:02:03'); assert.equal(MW.fmtDur(90), '1:30');
});

/* ---------------- the ride engine for every duration and target kind (js/workouts.js runTick / runView) ---------------- */
const ride2 = steps => MW.toRide(MW.validateWorkout(V2(steps)).w);
/** rides w for `sec` seconds in 1 s ticks with sample(t) -> { d, kj, hr, power }; returns the run and the states */
const rideFor = (w, sec, sample = () => ({}), run = runInit(), t0 = 0, ftp = 250) => { const out = [];
  for (let t = t0; t <= t0 + sec; t++) { const s = sample(t); runTick(w, run, t, s); out.push(workoutState(runView(w, run, t), t, ftp)); } return { run, out, last: out.at(-1) }; };
test('ride: time steps end on the clock, exactly as before', () => {
  const w = ride2([S2('work', T(60), { kind: 'ftp', pct: 100 }), S2('recover', T(30), { kind: 'ftp', pct: 50 })]);
  const { run, out } = rideFor(w, 100); assert.equal(out[59].i, 0); assert.equal(out[60].i, 1); assert.equal(out[90].done, true); assert.deepEqual(run.durs, [60, 30]); assert.equal(run.same, true);
  assert.equal(out[57].countdown, 3, 'a timed step counts down');
});
test('ride: a lap-button step stays open until Next (lap), the clock of the steps after it moves with it', () => {
  const w = ride2([S2('warmup', { kind: 'lap' }, { kind: 'ftp', pct: 55 }), S2('work', T(60), { kind: 'ftp', pct: 100 })]);
  const run = runInit(); let st;
  for (let t = 0; t <= 900; t++) { runTick(w, run, t); st = workoutState(runView(w, run, t), t, 250); }
  assert.equal(st.i, 0, 'still on the lap step after 15 min (its estimate is 5)'); assert.equal(st.open, true); assert.equal(st.countdown, 0); assert.equal(st.target, Math.round(0.55 * 250));
  assert.deepEqual(endInfo(st.step, run), { kind: 'lap', text: 'Lap', sub: 'press Next', frac: null });
  assert.ok(runNext(w, run, 900.4)); const a = workoutState(runView(w, run, 901), 901, 250); assert.equal(a.i, 1); assert.equal(a.target, 250); assert.ok(Math.abs(a.left - 59.4) < 0.01);
  runTick(w, run, 960.4); assert.equal(workoutState(runView(w, run, 960.4), 960.4, 250).done, true, 'then the timed step runs its 60 s');
  assert.deepEqual(run.durs.map(Math.round), [900, 60]);
});
test('ride: a distance step ends by the metres ridden, calories by the work done (kcal ≈ kJ)', () => {
  const w = ride2([S2('work', { kind: 'distance', m: 2000 }, { kind: 'ftp', pct: 80 }), S2('work', { kind: 'calories', kcal: 50 }, { kind: 'ftp', pct: 100 }), S2('cooldown', T(60))]);
  const r = rideFor(w, 400, t => ({ d: t * 10, kj: t * 0.25 })); // 10 m/s, 250 W
  const at = k => r.out.findIndex(s => s.i === k);
  assert.equal(at(1), 200, 'the 2 km are done after 200 s at 36 km/h'); assert.equal(at(2), 200 + Math.ceil(50 / KCAL_PER_KJ / 0.25), '50 kcal at 250 W: 200 s more');
  const mid = workoutState(runView(w, rideFor(w, 100, t => ({ d: t * 10 })).run, 100), 100, 250);
  assert.equal(mid.open, true); assert.deepEqual([endInfo(mid.step, runInit(), { d: 1500 }).text, endInfo(mid.step, runInit(), { d: 1500 }).sub, endInfo(mid.step, runInit(), { d: 1500 }).frac], ['500', 'm to go', 0.75]); assert.deepEqual([endInfo(mid.step, runInit(), { d: 500 }).text, endInfo(mid.step, runInit(), { d: 500 }).sub], ['1.50', 'km to go']);
});
test('ride: heart-rate and power durations end once the value stays across the limit', () => {
  const w = ride2([S2('work', { kind: 'hr', op: 'gt', bpm: 160 }, { kind: 'ftp', pct: 105 }), S2('recover', { kind: 'hr', op: 'lt', bpm: 120 }), S2('work', { kind: 'power', op: 'lt', w: 100 }), S2('cooldown', T(30))]);
  const hr = t => t < 100 ? 140 : t < 102 ? 165 : t < 103 ? 150 : t < 200 ? 170 : t < 300 ? 130 : 110;
  const r = rideFor(w, 600, t => ({ hr: hr(t), power: t < 400 ? 200 : 80 }));
  const first = k => r.out.findIndex(s => s.i === k);
  assert.equal(first(1), 103 + HOLD_S, 'a 2 s spike over 160 does not count, the next rise held for 2 s does');
  assert.equal(first(2), 300 + HOLD_S, 'recovery ends when HR stays below 120'); assert.equal(first(3), 400 + HOLD_S, 'power below 100 W'); assert.equal(r.last.done, true);
  assert.equal(endInfo(w.steps[0], runInit()).text, '>160');
  assert.equal(rideFor(w, 300, () => ({ hr: 0 })).last.i, 0, 'no heart-rate signal: the step stays open (Next ends it)');
});
test('ride: power zone, custom power and % FTP drive ERG (range: the middle, the band shown); the others are free', () => {
  const w = ride2([S2('work', T(60), { kind: 'powerZone', zone: 4 }), S2('work', T(60), { kind: 'power', lo: 240, hi: 260 }), S2('work', T(60), { kind: 'ftp', pct: 60, pct2: 80 }),
    S2('work', T(60)), S2('work', T(60), { kind: 'hrZone', zone: 3 }), S2('work', T(60), { kind: 'hr', lo: 140, hi: 150 }), S2('work', T(60), { kind: 'cadence', lo: 85, hi: 95 }, { target2: { kind: 'hr', lo: 130, hi: 160 } }), S2('work', T(60), { kind: 'speed', lo: 30, hi: 35 })]);
  const at = t => workoutState(w, t, 300);
  const z = at(10); assert.equal(z.target, Math.round(98 / 100 * 300)); assert.deepEqual([z.lo, z.hi, z.range], [Math.round(0.91 * 300), Math.round(1.05 * 300), true]); assert.ok(!z.step.free);
  setFtp(300); const p = at(70); assert.equal(p.target, 250, 'custom 240–260 W: ERG at 250 W, whatever the FTP'); assert.deepEqual([p.lo, p.hi], [240, 260]);
  setFtp(200); assert.equal(workoutState(w, 70, 200).target, 250, 'still 250 W at another FTP');
  const r = at(150); assert.equal(r.target, Math.round(0.7 * 300), '% FTP ramp halfway'); assert.equal(r.ramp, 'step');
  for (const t of [190, 250, 310, 370, 430]) assert.ok(at(t).step.free, `step at ${t} s: no ERG`);
  assert.equal(at(190).step.tgt, undefined, 'no target: nothing to show');
  assert.deepEqual(tgtInfo(at(250).step.tgt, { hr: 150 }, { hrMax: 200 }), { kind: 'hrZone', name: 'Heart rate', lo: 140, hi: 160, unit: 'bpm', val: 150, state: 'ok', text: 'Heart rate zone 3 · 140–160 bpm' });
  assert.equal(tgtInfo(at(250).step.tgt, { hr: 150 }).state, null, 'zone without a max HR: no verdict');
  assert.equal(tgtInfo(at(310).step.tgt, { hr: 155 }).state, 'hi'); assert.equal(tgtInfo(at(370).step.tgt, { cad: 80 }).state, 'lo'); assert.equal(tgtInfo(at(370).step.tgt2, { hr: 140 }).state, 'ok');
  assert.equal(tgtInfo(at(430).step.tgt, { kmh: 32.44 }).val, 32.4); assert.equal(tgtInfo(at(430).step.tgt, {}).state, null, 'no signal: no verdict');
});
test('ride: Next on a timed step ends it early, the view keeps the real times for the saved ride', () => {
  const w = ride2([S2('work', T(300), { kind: 'ftp', pct: 100 }), S2('recover', T(60), { kind: 'ftp', pct: 50 })]), run = runInit();
  runTick(w, run, 100); runNext(w, run, 100); const v = runView(w, run, 120);
  assert.deepEqual(v.steps.map(s => s.dur), [100, 60]); assert.equal(run.same, false); assert.equal(workoutState(v, 120, 250).i, 1);
  assert.equal(runNext(w, run, 130), true); assert.equal(runNext(w, run, 140), false, 'nothing after the last step');
});
test('ride: Next pressed twice within a second moves two steps on, the clock and the steps stay together', () => {
  const w = ride2([S2('warmup', { kind: 'lap' }, { kind: 'ftp', pct: 50 }), S2('work', T(40), { kind: 'ftp', pct: 100 }), S2('recover', T(20), { kind: 'ftp', pct: 50 }), S2('work', T(40), { kind: 'ftp', pct: 100 })]), run = runInit();
  runNext(w, run, 2.57); runNext(w, run, 2.98); runNext(w, run, 2.98);
  assert.equal(run.i, 3); assert.equal(workoutState(runView(w, run, 3.1), 3.1, 250).i, 3, 'the HUD shows the step the run is on');
});
test('ride: a repeat block runs expanded, skipping its last recovery', () => {
  const w = ride2([{ repeat: 3, steps: [S2('work', T(60), { kind: 'ftp', pct: 120 }), S2('recover', { kind: 'lap' }, { kind: 'ftp', pct: 50 })], skipLast: true }]);
  assert.deepEqual(w.steps.map(s => s.label), ['Bike 1/3', 'Recover', 'Bike 2/3', 'Recover', 'Bike 3/3']);
  const run = runInit(); let t = 0; const seen = [];
  for (; t < 1000; t++) { runTick(w, run, t); const s = workoutState(runView(w, run, t), t, 250); if (seen.at(-1) !== s.i) seen.push(s.i); if (s.done) break; if (s.open && t % 100 === 99) runNext(w, run, t); }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]); assert.equal(workoutState(w, 0, 250).hardCount, 3, 'counted as 3 intervals');
});
test('API: a v2 workout with repeats is stored and read back, a bad one refused', async () => {
  const body = V2([S2('warmup', { kind: 'lap' }), { repeat: 4, steps: [S2('work', T(240), { kind: 'powerZone', zone: 5 }), S2('recover', T(120))] }, S2('cooldown', { kind: 'lap' })], { notes: 'Tuesday' });
  const p = await call('PUT', '/api/account/workouts/pw_v2api', { token: A, body }); assert.equal(p.status, 200, JSON.stringify(p.j));
  const g = (await call('GET', '/api/account/workouts/pw_v2api', { token: A })).j.workout; assert.equal(g.v, 2); assert.equal(g.steps[1].repeat, 4); assert.equal(g.notes, 'Tuesday');
  assert.equal((await call('PUT', '/api/account/workouts/pw_v2bad', { token: A, body: V2([{ repeat: 2, steps: [{ repeat: 2, steps: [S2('work', T(60))] }] }]) })).status, 400);
  assert.equal((await call('DELETE', '/api/account/workouts/pw_v2api', { token: A })).status, 200);
});
/* ---- builder audit 27.11. (the owner's 3 × 13 × 30/15 at 370 W, FTP-independent watts) ---- */
const P370 = w => ({ kind: 'power', lo: w, hi: w });
const SET3015 = () => ({ repeat: 13, skipLast: true, steps: [S2('work', T(30), P370(370)), S2('recover', T(15), P370(125))] });
const OWNER = () => V2([S2('warmup', T(600), { kind: 'ftp', pct: 40, pct2: 72 }), { repeat: 3, steps: [S2('work', T(10), P370(420)), S2('recover', T(50), P370(130))] },
  SET3015(), S2('rest', T(180), P370(130)), SET3015(), S2('rest', T(180), P370(130)), SET3015(), S2('cooldown', T(600), { kind: 'ftp', pct: 55, pct2: 35 })]);
test('audit: the owner workout round-trips, runs in the built order, absolute watts at any FTP', () => {
  const v = MW.validateWorkout(OWNER()); assert.ifError(v.error);
  assert.deepEqual(v.w.steps, OWNER().steps, 'nothing changed on save');
  assert.deepEqual(MW.summary2(v.w.steps, 287), { ...MW.summary2(v.w.steps, 287), sec: 3450, exact: true, steps: 85 });
  for (const ftp of [180, 250, 287, 400]) {
    const w = MW.toRide(v.w); let t = 0; const got = [];
    for (const s of w.steps) { const a = workoutAt(w, t + 0.5, ftp); got.push(`${a.step.label}@${a.target}`); t += s.dur; }
    const want = ['Warm up@' + Math.round(0.4 * ftp + (0.32 * ftp) * 0.5 / 600), ...[1, 2, 3].flatMap(i => [`Bike ${i}/3@420`, 'Recover@130']),
      ...[0, 1, 2].flatMap(k => [...Array.from({ length: 13 }, (_, i) => [`Bike ${i + 1}/13@370`, ...(i < 12 ? ['Recover@125'] : [])]).flat(), ...(k < 2 ? ['Rest@130'] : [])]), `Cool down@${Math.round(0.55 * ftp - 0.2 * ftp * 0.5 / 600)}`];
    assert.deepEqual(got, want, `FTP ${ftp}`);
  }
});
test('audit: each repeat block is its own interval series (3 × 13, not 1 of 42 with the sprints)', () => {
  const w = MW.toRide(MW.validateWorkout(OWNER()).w);
  const t2 = 600 + 180 + 13 * 45 - 15 + 180; // set 2, first interval
  const a = workoutState(w, 600 + 180 + 3 * 45 + 2, 287), b = workoutState(w, t2 + 2, 287), sp = workoutState(w, 600 + 60 + 2, 287);
  assert.deepEqual([a.step.label, a.hardNo, a.hardCount], ['Bike 4/13', 4, 13]);
  assert.deepEqual([b.step.label, b.hardNo, b.hardCount], ['Bike 1/13', 1, 13]);
  assert.deepEqual([sp.step.label, sp.hardNo, sp.hardCount], ['Bike 2/3', 2, 3]);
  assert.equal(workoutState(w, 10, 287).hardCount, 13, 'before the first interval: the main series counts 13');
});
test('audit: "skip the last recovery" counts only where it applies, the tick survives a step passing through', () => {
  const r = { repeat: 3, skipLast: true, steps: [S2('work', T(30)), S2('recover', T(15))] };
  assert.equal(MW.skips(r), true); assert.equal(MW.countSteps([r]), 5);
  const r2 = { ...r, steps: [...r.steps, S2('work', T(60))] }; // a step dropped in at the end for a moment
  assert.equal(MW.skips(r2), false); assert.equal(MW.countSteps([r2]), 9, 'nothing skipped while the last step is a bike step');
  assert.equal(MW.validateWorkout(V2([r2])).w.steps[0].skipLast, undefined, 'and not saved so');
  assert.equal(MW.countSteps([{ ...r, repeat: 1 }]), 2, '× 1: nothing skipped (as saved)');
  assert.equal(MW.validateWorkout(V2([{ ...r, repeat: 1 }])).w.steps[0].skipLast, undefined);
});
test('audit: the list stats use the rider\'s FTP (custom watts, distance and calories estimates)', () => {
  const w = MW.validateWorkout(V2([S2('work', { kind: 'distance', m: 2000 }, P370(260)), S2('recover', { kind: 'calories', kcal: 50 }, { kind: 'ftp', pct: 55 })])).w;
  assert.deepEqual(MW.statsOf(w, 280), MW.summary2(w.steps, 280)); assert.notDeepEqual(MW.statsOf(w, 280).avg, MW.statsOf(w, 200).avg);
});
