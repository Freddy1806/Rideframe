// Garmin watch API (tools/watch-api.mjs) against a real serve.mjs on a free port with a temp data folder:
// pairing (expiry, single use, wrong codes, limits), auth, setup size, session validation / idempotency / records, summary, revoke,
// the watch config (phone auth, defaults, strict validation and limits, compact form for the watch, workouts / top 20 in the setup).
// Usage: node --test tools/watch-test.mjs   (no real data is touched)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv, base, DATA, ipN = 0;
const ip = () => `10.9.${ipN >> 8}.${ipN++ & 255}`;
const call = async (method, p, { body, token, bearer, raw, xip } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xip || ip(), ...(token ? { 'X-RF-Token': token } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, size: Buffer.byteLength(text) };
};
const register = async name => { const r = await call('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.token; };
const pairWith = async (token, label = 'Forerunner 265') => { const c = await call('POST', '/api/watch/code', { token }); assert.equal(c.status, 200); const p = await call('POST', '/api/watch/pair', { body: { code: c.j.code, label } }); assert.equal(p.status, 200, JSON.stringify(p.j)); return p.j.token; };
const nowS = () => Math.floor(Date.now() / 1000);
let A, B; // phone tokens of two accounts

before(async () => {
  DATA = await mkdtemp(join(tmpdir(), 'rf-watch-test-'));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  A = await register('Watch Tester'); B = await register('Other Lifter');
});
after(async () => { srv?.kill(); if (DATA) await rm(DATA, { recursive: true, force: true }); });

test('a pairing code needs a signed-in phone, has 6 digits and lives 10 minutes', async () => {
  assert.equal((await call('POST', '/api/watch/code')).status, 401);
  assert.equal((await call('POST', '/api/watch/code', { token: 'nope' })).status, 401);
  const c = await call('POST', '/api/watch/code', { token: A }); assert.equal(c.status, 200); assert.match(c.j.code, /^\d{6}$/); assert.equal(c.j.ttl, 600);
  assert.ok(Math.abs(c.j.exp - Date.now() - 600e3) < 5e3);
  const W = JSON.parse(await readFile(join(DATA, 'watches.json'), 'utf8')); assert.ok(!JSON.stringify(W).includes(c.j.code), 'only a hash of the code is stored');
});
test('pair: wrong code, right code, single use, a new code replaces the old one', async () => {
  const c1 = await call('POST', '/api/watch/code', { token: A }), c2 = await call('POST', '/api/watch/code', { token: A });
  assert.equal((await call('POST', '/api/watch/pair', { body: { code: c1.j.code } })).status, 401, 'the first code died with the second');
  const wrong = String((+c2.j.code + 1) % 1e6).padStart(6, '0');
  assert.equal((await call('POST', '/api/watch/pair', { body: { code: wrong } })).status, 401);
  assert.equal((await call('POST', '/api/watch/pair', { body: { code: '12a' } })).status, 400);
  const p = await call('POST', '/api/watch/pair', { body: { code: c2.j.code, label: 'Forerunner 265 <b>' } }); assert.equal(p.status, 200);
  assert.match(p.j.token, /^rfw_[A-Za-z0-9_-]{43}$/); assert.equal(p.j.name, 'Watch Tester'); assert.equal(p.j.label, 'Forerunner 265 b');
  assert.equal((await call('POST', '/api/watch/pair', { body: { code: c2.j.code } })).status, 401, 'single use');
  const W = await readFile(join(DATA, 'watches.json'), 'utf8'); assert.ok(!W.includes(p.j.token), 'only a hash of the token is stored');
  assert.equal((await call('GET', '/api/watch/me', { bearer: p.j.token })).j.name, 'Watch Tester');
});
test('pair: an expired code is refused', async () => {
  const c = await call('POST', '/api/watch/code', { token: B }), f = join(DATA, 'watches.json'), W = JSON.parse(await readFile(f, 'utf8'));
  for (const k in W.codes) W.codes[k].exp = Date.now() - 1; await writeFile(f, JSON.stringify(W));
  assert.equal((await call('POST', '/api/watch/pair', { body: { code: c.j.code } })).status, 401);
});
test('watch calls need a valid bearer token', async () => {
  for (const p of ['/api/watch/strength/setup', '/api/watch/summary']) {
    assert.equal((await call('GET', p)).status, 401);
    assert.equal((await call('GET', p, { bearer: 'rfw_' + 'x'.repeat(43) })).status, 401);
    assert.equal((await call('GET', p, { token: A })).status, 401, 'a phone login is not a watch token');
  }
  assert.equal((await call('POST', '/api/watch/strength', { body: {} })).status, 401);
  assert.equal((await call('GET', '/api/watch/nothing')).status, 404);
});

test('setup: own exercises, most recent first, last sets and best, short names, under 8 KB', async () => {
  const t = await pairWith(A), day = 864e5, now = Date.now();
  const empty = await call('GET', '/api/watch/strength/setup', { bearer: t });
  assert.equal(empty.status, 200); assert.equal(empty.j.rest, 90); assert.equal(empty.j.unit, 'kg'); assert.equal(empty.j.ex[0].id, 'squat', 'nothing done: the catalogue'); assert.equal(empty.j.last, null);
  assert.equal(empty.j.ex.filter(e => e.t === 'time').map(e => e.id).join(), 'plank', 'timed exercises only as one of the top 20 (plank)');
  assert.equal(empty.j.top.length, 21); assert.ok(empty.j.top.every(id => empty.j.ex.some(e => e.id === id)), 'every top exercise is described in ex'); assert.deepEqual(empty.j.recent, []); assert.deepEqual(empty.j.workouts, []);
  const own = [...Array(45)].map((_, i) => ({ k: 'my_' + i, n: 'Thai kick on the heavy bag variant ' + i, t: 'w', g: 'Custom' }));
  assert.equal((await call('PUT', '/api/account/settings', { token: A, body: { settings: { kraftRest: 120, kraftEx: own }, at: now } })).status, 200);
  const sess = (id, ago, ex) => call('PUT', '/api/account/kraft/' + id, { token: A, body: { id, name: 'Push day', start: now - ago * day, date: now - ago * day + 3600e3, dur: 3600, ex } });
  await sess('k1', 10, [{ k: 'bench', n: 'Bench press', t: 'w', sets: [{ kg: 80, r: 8, done: true }, { kg: 85, r: 5, done: true }] }, { k: 'pull', n: 'Pull-ups', t: 'bw', sets: [{ kg: '', r: 12, done: true }] }]);
  await sess('k2', 2, [{ k: 'bench', n: 'Bench press', t: 'w', sets: [{ kg: 60, r: 10, warm: true, done: true }, { kg: 82.5, r: 8, done: true }, { kg: 82.5, r: 7, done: true }] }, { k: 'my_3', n: own[3].n, t: 'w', sets: [{ kg: 20, r: 15, done: true }] }]);
  for (let i = 0; i < 30; i++) await sess('old' + i, 200 + i, [{ k: 'my_' + (10 + i), n: own[10 + i].n, t: 'w', sets: [{ kg: 100.25, r: 10, done: true }, { kg: 100.25, r: 10, done: true }, { kg: 100.25, r: 10, done: true }, { kg: 100.25, r: 10, done: true }, { kg: 100.25, r: 10, done: true }, { kg: 100.25, r: 10, done: true }, { kg: 100.25, r: 10, done: true }] }]);
  const r = await call('GET', '/api/watch/strength/setup', { bearer: t }), S = r.j;
  assert.equal(r.status, 200); assert.ok(r.size < 8192, `setup is ${r.size} bytes`); console.log(`  setup payload: ${r.size} bytes, ${S.ex.length} exercises`);
  assert.equal(S.rest, 120); assert.equal(S.ex.length, 40 + S.top.filter(id => !S.ex.slice(0, 40).some(e => e.id === id)).length); assert.ok(S.ex.every(e => e.n.length <= 18 && /^[\w-]+$/.test(e.id)));
  assert.deepEqual(S.ex.slice(0, 3).map(e => e.id), ['bench', 'my_3', 'pull'], 'used recently and often first');
  const bench = S.ex[0]; assert.deepEqual(bench.s, [[82.5, 8], [82.5, 7]], 'the last session, without the warm-up'); assert.equal(bench.b, 104.5, 'best e1RM: 82.5 x 8'); assert.equal(bench.n, 'Bench press');
  assert.equal(S.ex[2].t, 'bw'); assert.equal(S.ex[2].b, 12);
  assert.equal(S.ex[1].n, 'Thai kick on the.', 'long own names are cut to 18');
  assert.ok(S.ex.find(e => e.id === 'my_10').s.length <= 6);
  assert.equal(S.last.sets, 3); assert.equal(S.last.n, 'Push day'); assert.ok(Math.abs(S.last.at - (now - 2 * day) / 1000) < 2);
  assert.ok(S.ex.slice(0, 33).every(e => e.s), 'everything done comes first'); assert.deepEqual(S.recent.slice(0, 2), ['bench', 'my_3'], 'recent: newest first'); assert.ok(S.ex.slice(33, 40).every(e => e.id.startsWith('my_') && !e.s), 'then own exercises not done yet, before the catalogue');
});

test('session: validated, stored once as a strength record with records, shows in the account', async () => {
  const t = await pairWith(A), start = nowS() - 3000;
  const good = { id: 'abc123def', start, duration: 2700, sets: [{ ex: 'bench', kg: 85, reps: 8, t: 300 }, { ex: 'pull', kg: 0, reps: 13, t: 600 }, { ex: 'bench', kg: 80, reps: 8, t: 450 }, { ex: 'curl', kg: 12.5, reps: 10, t: 900 }], hr: { avg: 118, max: 162 }, kcal: 310 };
  const bad = [[{ ...good, id: 'x' }, /id/], [{ ...good, id: '../../etc' }, /id/], [{ ...good, start: start - 90 * 86400 }, /start/], [{ ...good, start: start + 86400 }, /start/], [{ ...good, duration: -5 }, /duration/],
    [{ ...good, sets: [] }, /sets/], [{ ...good, sets: Array(121).fill(good.sets[0]) }, /sets/], [{ ...good, sets: [{ ex: 'bench', kg: 80, reps: 0, t: 1 }] }, /reps/], [{ ...good, sets: [{ ex: 'bench', kg: 80, reps: 2.5, t: 1 }] }, /reps/],
    [{ ...good, sets: [{ ex: 'bench', kg: -1, reps: 5, t: 1 }] }, /kg/], [{ ...good, sets: [{ ex: '<x>', kg: 1, reps: 5, t: 1 }] }, /ex/], [{ ...good, sets: [{ ex: 'bench', kg: 1, reps: 5, t: 99999 }] }, /set\.t/]];
  for (const [b, re] of bad) { const r = await call('POST', '/api/watch/strength', { bearer: t, body: b }); assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80)); assert.match(r.j.error, re); }
  assert.equal((await call('POST', '/api/watch/strength', { bearer: t, raw: '{nope' })).status, 400);
  assert.equal((await call('POST', '/api/watch/strength', { bearer: t, raw: JSON.stringify({ ...good, pad: 'x'.repeat(40e3) }) })).status, 413);
  const r = await call('POST', '/api/watch/strength', { bearer: t, body: good }); assert.equal(r.status, 200); assert.equal(r.j.id, 'watch-abc123def'); assert.equal(r.j.prs, 2);
  const again = await call('POST', '/api/watch/strength', { bearer: t, body: { ...good, sets: [good.sets[0]] } }); assert.equal(again.status, 200); assert.equal(again.j.dup, true, 'idempotent by id');
  const ids = (await call('GET', '/api/account/kraft', { token: A })).j.ids; assert.equal(ids.filter(x => x === 'watch-abc123def').length, 1);
  const w = (await call('GET', '/api/account/kraft/watch-abc123def', { token: A })).j;
  assert.equal(w.source, 'watch'); assert.equal(w.start, start * 1000); assert.equal(w.dur, 2700); assert.equal(w.date, start * 1000 + 2700e3); assert.match(w.name, /workout$/);
  assert.deepEqual([w.avgHr, w.maxHr, w.kcal, w.prs], [118, 162, 310, 2]);
  assert.deepEqual(w.ex.map(x => [x.k, x.n, x.t, x.sets.length]), [['bench', 'Bench press', 'w', 2], ['pull', 'Pull-ups', 'bw', 1], ['curl', 'Biceps curls', 'w', 1]], 'one block per exercise, in the order done');
  assert.deepEqual(w.ex[0].sets, [{ kg: 85, r: 8, s: '', done: true, pr: true }, { kg: 80, r: 8, s: '', done: true }], '85 x 8 (e1RM 107.7) beats the best 104.5, 80 x 8 (101.3) does not');
  assert.deepEqual(w.ex[1].sets, [{ kg: '', r: 13, s: '', done: true, pr: true }]); assert.ok(!w.ex[2].sets[0].pr, 'first time is no record');
  const other = await call('GET', '/api/account/kraft', { token: B }); assert.deepEqual(other.j.ids, [], 'nothing lands in another account');
});

test('setup after a watch session: last time is the newest session, also one from earlier the same day', async () => {
  const t = await pairWith(A), ex = async id => (await call('GET', '/api/watch/strength/setup', { bearer: t })).j.ex.find(e => e.id === id);
  assert.deepEqual((await ex('bench')).s, [[85, 8], [80, 8]], 'the watch session above (an hour ago) beats the phone one from 2 days ago, sets in the order done');
  const r = await call('POST', '/api/watch/strength', { bearer: t, body: { id: 'sameday01', start: nowS() - 600, duration: 300, sets: [{ ex: 'bench', kg: 87.5, reps: 5, t: 30 }, { ex: 'bench', kg: 87.5, reps: 4, t: 200 }] } });
  assert.equal(r.status, 200);
  assert.deepEqual((await ex('bench')).s, [[87.5, 5], [87.5, 4]], 'a second session today: the newer one');
  await call('POST', '/api/watch/strength', { bearer: t, body: { id: 'sameday00', start: nowS() - 5000, duration: 300, sets: [{ ex: 'bench', kg: 50, reps: 20, t: 30 }] } });
  assert.deepEqual((await ex('bench')).s, [[87.5, 5], [87.5, 4]], 'an older one uploaded late does not take over');
  const S = (await call('GET', '/api/watch/strength/setup', { bearer: t })).j; assert.equal(S.recent[0], 'bench'); assert.ok(Math.abs(S.last.at - (nowS() - 600)) < 3, 'last: the newest session');
});

test('summary: week points, change, sessions, streak', async () => {
  const t = await pairWith(A), r = await call('GET', '/api/watch/summary', { bearer: t });
  assert.equal(r.status, 200); assert.equal(typeof r.j.pts, 'number'); assert.ok(r.j.pts >= 30, 'the 45 min watch session counts (45 points per hour)'); assert.equal(r.j.delta, r.j.pts - r.j.prev);
  assert.ok(r.j.strength >= 1); assert.equal(typeof r.j.streak, 'number');
});

test('list and revoke watches; a revoked or deleted account token stops working', async () => {
  const t1 = await pairWith(B, 'fenix 7X Pro'), t2 = await pairWith(B, 'Forerunner 265');
  const l = await call('GET', '/api/watch/devices', { token: B }); assert.deepEqual(l.j.watches.map(w => w.label).sort(), ['Forerunner 265', 'fenix 7X Pro']);
  assert.ok(l.j.watches.every(w => /^[0-9a-f]{12}$/.test(w.id) && w.created > 0 && !('key' in w) && !('uid' in w)));
  assert.equal((await call('GET', '/api/watch/devices')).status, 401);
  const fx = l.j.watches.find(w => w.label === 'fenix 7X Pro');
  assert.equal((await call('DELETE', '/api/watch/devices/' + fx.id, { token: A })).status, 404, 'not your watch');
  assert.equal((await call('DELETE', '/api/watch/devices/' + fx.id, { token: B })).status, 200);
  assert.equal((await call('GET', '/api/watch/strength/setup', { bearer: t1 })).status, 401);
  assert.equal((await call('GET', '/api/watch/strength/setup', { bearer: t2 })).status, 200);
  assert.equal((await call('POST', '/api/account/delete', { token: B, body: { password: 'secret-pw-1' } })).status, 200);
  const B2 = await register('Other Lifter'); // same name again: must not inherit the old watch
  assert.equal((await call('GET', '/api/watch/strength/setup', { bearer: t2 })).status, 401);
  assert.deepEqual((await call('GET', '/api/watch/devices', { token: B2 })).j.watches, []);
});

/* ---- watch config (18.11.): phone edits, server checks and keeps it per account, the watch gets the compact form ---- */
const CFG = () => ({ v: 1, sports: { run: { pages: [{ fields: ['pace', 'hr'] }, { fields: ['lapTime'] }], map: false, segWarn: true, autoLap: true, autoPause: true, vibrate: false },
  ride: { pages: [{ fields: ['power3s', 'speed', 'hr', 'np'] }], map: true, segWarn: false, autoLap: false, autoPause: true, vibrate: true }, other: { pages: [{ fields: ['hr', 'time', 'clock', 'kcal'] }] } },
  more: ['Basketball', 'Yoga'], workouts: [{ id: 'w1', name: 'Push day', items: [{ ex: 'bench', sets: 3, reps: 8, kg: 80, rest: 120 }, { ex: 'plank', sets: 2, reps: 60, kg: 0, rest: 60 }, { ex: 'my_9', sets: 3, reps: 12, kg: 22.5, rest: 90 }] }] });
test('config: phone needs a login, defaults until saved, saved per account with mode 600', async () => {
  const C = await register('Config Carla'), O = await register('Config Other');
  assert.equal((await call('GET', '/api/watch/config')).status, 401); assert.equal((await call('PUT', '/api/watch/config', { body: CFG() })).status, 401);
  assert.equal((await call('GET', '/api/watch/config', { token: 'nope' })).status, 401);
  const d = await call('GET', '/api/watch/config', { token: C }); assert.equal(d.status, 200); assert.equal(d.j.stored, false);
  assert.deepEqual(d.j.config.sports.run.pages.map(p => p.fields), [['pace', 'dist', 'time', 'hr'], ['lapPace', 'lapDist', 'avgPace', 'hrZone']]);
  assert.deepEqual(d.j.config.sports.ride.pages.map(p => p.fields), [['power3s', 'speed', 'hr', 'time'], ['dist', 'climb', 'avgPower', 'cadence']]);
  assert.deepEqual(d.j.config.sports.other.pages[0].fields, ['hr', 'time', 'clock', 'kcal']); assert.deepEqual(d.j.config.workouts, []);
  const p = await call('PUT', '/api/watch/config', { token: C, body: CFG() }); assert.equal(p.status, 200, JSON.stringify(p.j)); assert.ok(p.j.at > 0);
  const g = await call('GET', '/api/watch/config', { token: C }); assert.equal(g.j.stored, true); assert.deepEqual(g.j.config, CFG()); assert.equal(g.j.at, p.j.at);
  assert.equal((await call('GET', '/api/watch/config', { token: O })).j.stored, false, 'another account keeps its own');
  const dir = join(DATA, 'users'), files = []; for (const u of await readdir(dir)) if ((await readdir(join(dir, u))).includes('watch.json')) files.push(join(dir, u, 'watch.json'));
  assert.equal(files.length, 1); const { stat } = await import('node:fs/promises'); assert.equal((await stat(files[0])).mode & 0o777, 0o600);
});
test('config: strict validation, limits, unknown keys, size', async () => {
  const C = await register('Config Checker'), put = b => call('PUT', '/api/watch/config', { token: C, body: b }), page = f => ({ fields: f });
  const run = x => { const c = CFG(); Object.assign(c.sports.run, x); return c; }, W = (n, items = 1) => [...Array(n)].map((_, i) => ({ id: 'w' + i, name: 'W ' + i, items: [...Array(items)].map(() => ({ ex: 'bench', sets: 3, reps: 8, kg: 60, rest: 90 })) }));
  const bad = [[null, /object/], [{ ...CFG(), v: 2 }, /v: 1/], [{ ...CFG(), extra: 1 }, /unknown key "extra"/], [{ ...CFG(), sports: { ...CFG().sports, swim: {} } }, /unknown key "swim"/],
    [run({ pages: [] }), /1 to 4 pages/], [run({ pages: [page(['hr']), page(['hr']), page(['hr']), page(['hr']), page(['hr'])] }), /1 to 4 pages/], [run({ pages: [page([])] }), /1 to 4 fields/],
    [run({ pages: [page(['pace', 'hr', 'dist', 'time', 'clock'])] }), /1 to 4 fields/], [run({ pages: [page(['power'])] }), /not a run field/], [run({ pages: [page(['hr', 'hr'])] }), /twice/],
    [run({ pages: [{ fields: ['hr'], big: 1 }] }), /unknown key "big"/], [run({ autoLap: 'yes' }), /true or false/], [run({ color: 'red' }), /unknown key/],
    [{ ...CFG(), sports: { other: { pages: [page(['hr'])], map: true } } }, /unknown key "map"/], [{ ...CFG(), more: ['Run'] }, /not a sport/], [{ ...CFG(), more: Array(41).fill('Yoga') }, /up to 40/],
    [{ ...CFG(), workouts: W(31) }, /up to 30/], [{ ...CFG(), workouts: W(1, 21) }, /up to 20 exercises/], [{ ...CFG(), workouts: [...W(1), ...W(1)] }, /unique/], [{ ...CFG(), workouts: [{ ...W(1)[0], name: ' ' }] }, /name: 1 to 40/],
    [{ ...CFG(), workouts: [{ ...W(1)[0], name: 'x'.repeat(41) }] }, /name: 1 to 40/], [{ ...CFG(), workouts: [{ ...W(1)[0], id: '../x' }] }, /id/]];
  for (const [field, val, re] of [['sets', 0, /sets/], ['sets', 11, /sets/], ['reps', 101, /reps/], ['reps', 2.5, /reps/], ['kg', -1, /kg/], ['kg', 501, /kg/], ['kg', 80.1, /kg/], ['kg', '80', /kg/], ['rest', 601, /rest/], ['rest', 7, /rest/], ['ex', '<b>', /ex/], ['note', 'x', /unknown key "note"/]])
    bad.push([{ ...CFG(), workouts: [{ id: 'w', name: 'W', items: [{ ex: 'bench', sets: 3, reps: 8, kg: 60, rest: 90, [field]: val }] }] }, re]);
  for (const [b, re] of bad) { const r = await put(b); assert.equal(r.status, 400, JSON.stringify(b)?.slice(0, 120)); assert.match(r.j.error, re); }
  assert.equal((await call('PUT', '/api/watch/config', { token: C, raw: '{nope' })).status, 400);
  assert.equal((await call('PUT', '/api/watch/config', { token: C, raw: JSON.stringify({ ...CFG(), pad: 'x'.repeat(70e3) }) })).status, 413);
  assert.equal((await call('GET', '/api/watch/config', { token: C })).j.stored, false, 'nothing bad was stored');
  const full = { ...CFG(), more: (await import('../js/watchfields.js')).MORE.slice(0, 40), workouts: W(30, 20).map(w => ({ ...w, name: 'Upper body heavy and long name x' })) };
  const r = await put(full); assert.equal(r.status, 200, r.j.error); assert.equal(r.j.config.workouts.length, 30);
  const tidy = await put({ ...CFG(), sports: { run: CFG().sports.run }, more: ['Yoga', 'Yoga'], workouts: [{ id: 'a', name: '  Leg   day <3 ', items: [] }] });
  assert.equal(tidy.status, 200); assert.deepEqual(tidy.j.config.more, ['Yoga']); assert.equal(tidy.j.config.workouts[0].name, 'Leg day 3'); assert.deepEqual(tidy.j.config.sports.ride.pages[0].fields, ['power3s', 'speed', 'hr', 'time'], 'a missing sport gets the defaults');
});
test('config: the watch gets the compact form with its token, the strength setup brings workouts, top 20 and recent', async () => {
  const C = await register('Config Watch'), t = await pairWith(C);
  assert.equal((await call('GET', '/api/watch/config', { bearer: 'rfw_' + 'y'.repeat(43) })).status, 401, 'a wrong watch token is not taken for the phone');
  const d = await call('GET', '/api/watch/config', { bearer: t }); assert.equal(d.status, 200);
  assert.deepEqual(d.j.run, { p: [['pace', 'dist', 'time', 'hr'], ['lapPace', 'lapDist', 'avgPace', 'hrZone']], map: 1, seg: 1, lap: 1, pause: 0, vib: 1 }); assert.deepEqual(d.j.w, []); assert.equal(d.j.at, 0);
  await call('PUT', '/api/account/settings', { token: C, body: { settings: { kraftEx: [{ k: 'my_9', n: 'Thai kick heavy bag combo', t: 'w', g: 'Custom' }] }, at: Date.now() } });
  await call('PUT', '/api/watch/config', { token: C, body: CFG() });
  const c = await call('GET', '/api/watch/config', { bearer: t }); assert.ok(c.size < 4096, `compact config is ${c.size} bytes`);
  assert.deepEqual(c.j.run, { p: [['pace', 'hr'], ['lapTime']], map: 0, seg: 1, lap: 1, pause: 1, vib: 0 }); assert.deepEqual(c.j.ride.p, [['power3s', 'speed', 'hr', 'np']]); assert.equal(c.j.ride.seg, 0);
  assert.deepEqual(c.j.other, { p: [['hr', 'time', 'clock', 'kcal']] }); assert.deepEqual(c.j.more, [['Basketball', 'Basketball'], ['Yoga', 'Yoga']]);
  assert.deepEqual(c.j.w, [{ id: 'w1', n: 'Push day', it: [['bench', 3, 8, 80, 120], ['plank', 2, 60, 0, 60], ['my_9', 3, 12, 22.5, 90]] }]); assert.ok(c.j.at > 1e9);
  assert.equal((await call('GET', '/api/watch/config', { token: C })).j.config.v, 1, 'the phone still gets the full form');
  const now = Date.now(); await call('PUT', '/api/account/kraft/r1', { token: C, body: { id: 'r1', name: 'Legs', start: now - 864e5, date: now - 864e5 + 3600e3, dur: 3600, ex: [{ k: 'squat', n: 'Squat (barbell)', t: 'w', sets: [{ kg: 100, r: 5, done: true }] }, { k: 'plank', n: 'Plank', t: 'time', sets: [{ s: 90, done: true }] }] } });
  const s = (await call('GET', '/api/watch/strength/setup', { bearer: t })); assert.ok(s.size < 8192, `setup is ${s.size} bytes`); const S = s.j;
  assert.deepEqual(S.workouts, c.j.w); assert.deepEqual(S.top, ['bench', 'incline', 'ohp', 'dip', 'push', 'pull', 'lat', 'row', 'cable', 'squat', 'frontsquat', 'legpress', 'dead', 'rdl', 'lunge', 'legcurl', 'calf', 'curl', 'tri', 'lateral', 'plank']);
  assert.deepEqual(S.recent, ['squat', 'plank'], 'recent: what was done lately');
  for (const id of [...S.top, 'my_9']) assert.ok(S.ex.some(e => e.id === id), id + ' is described in ex');
  assert.equal(S.ex.find(e => e.id === 'my_9').n, 'Thai kick heavy b.'); assert.equal(S.ex.find(e => e.id === 'cable').n, 'Cable row', 'the short top-20 names');
  assert.deepEqual(S.ex.find(e => e.id === 'plank'), { id: 'plank', n: 'Plank', t: 'time', s: [[0, 90]], b: 90 });
  const r = await call('POST', '/api/watch/strength', { bearer: t, body: { id: 'plank12345', start: nowS() - 600, duration: 500, sets: [{ ex: 'plank', kg: 0, reps: 75, t: 100 }, { ex: 'bench', kg: 80, reps: 8, t: 300 }] } });
  assert.equal(r.status, 200); const w = (await call('GET', '/api/account/kraft/watch-plank12345', { token: C })).j;
  assert.deepEqual(w.ex[0], { k: 'plank', n: 'Plank', t: 'time', sets: [{ kg: '', r: '', s: 75, done: true }] }, 'a timed set keeps its seconds');
});
test('23.11. workout saved on the watch: into the account config (phone and watch see it), same id replaces, bad ones refused', async () => {
  const C = await register('Template Saver'), w = await pairWith(C);
  const post = b => call('POST', '/api/watch/workout', { bearer: w, body: b });
  assert.equal((await call('POST', '/api/watch/workout', { body: { id: 'wx' } })).status, 401, 'needs the watch token');
  const r = await post({ id: 'wab12', n: 'Pull-ups + Front squat', it: [['pull', 3, 10, 0, 90], ['frontsquat', 4, 5, 72.5, 120]] }); assert.equal(r.status, 200); assert.deepEqual(r.j, { ok: true, id: 'wab12', new: true });
  let ph = await call('GET', '/api/watch/config', { token: C }); assert.deepEqual(ph.j.config.workouts, [{ id: 'wab12', name: 'Pull-ups + Front squat', items: [{ ex: 'pull', sets: 3, reps: 10, kg: 0, rest: 90 }, { ex: 'frontsquat', sets: 4, reps: 5, kg: 72.5, rest: 120 }] }], 'the phone sees it');
  const st = await call('GET', '/api/watch/strength/setup', { bearer: w }); assert.deepEqual(st.j.workouts, [{ id: 'wab12', n: 'Pull-ups + Front squat', it: [['pull', 3, 10, 0, 90], ['frontsquat', 4, 5, 72.5, 120]] }], 'back to the watch');
  assert.ok(st.j.ex.some(e => e.id === 'frontsquat' && e.n === 'Front squat'), 'front squat is a standard exercise');
  ph.j.config.workouts[0].name = 'Leg + pull'; assert.equal((await call('PUT', '/api/watch/config', { token: C, body: ph.j.config })).status, 200);
  assert.equal((await post({ id: 'wab12', n: 'whatever', it: [['frontsquat', 5, 5, 75, 120]] })).j.new, false);
  ph = await call('GET', '/api/watch/config', { token: C }); assert.deepEqual(ph.j.config.workouts, [{ id: 'wab12', name: 'Leg + pull', items: [{ ex: 'frontsquat', sets: 5, reps: 5, kg: 75, rest: 120 }] }], 'update: new items, the phone name kept');
  for (const [b, why] of [[{ id: 'bad id!', n: 'x', it: [['pull', 1, 1, 0, 0]] }, 'id'], [{ id: 'w2', n: 'x', it: [] }, 'no items'], [{ id: 'w2', n: 'x', it: [['pull', 11, 1, 0, 0]] }, 'sets over 10'], [{ id: 'w2', n: 'x', it: [['pull', 1, 1, 0.3, 0]] }, 'kg not in 0.25']])
    assert.equal((await post(b)).status, 400, why);
  for (let i = 0; i < 29; i++) assert.equal((await post({ id: 'f' + i, n: 'F' + i, it: [['pull', 1, 5, 0, 60]] })).status, 200);
  const full = await post({ id: 'f99', n: 'one too many', it: [['pull', 1, 5, 0, 60]] }); assert.equal(full.status, 400, 'full: refused for good (the watch drops it)'); assert.match(full.j.error, /30/);
});
test('limits: codes per account, pair tries per address, wrong codes for everyone', async () => {
  const C = await register('Code Spammer');
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/watch/code', { token: C })).status, 200);
  assert.equal((await call('POST', '/api/watch/code', { token: C })).status, 429);
  const one = '10.200.0.1';
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/watch/pair', { xip: one, body: { code: '000000' } })).status, 401);
  assert.equal((await call('POST', '/api/watch/pair', { xip: one, body: { code: '000000' } })).status, 429, '11th try from one address');
  const D = await register('Late Pairer'), c = await call('POST', '/api/watch/code', { token: D });
  for (let i = 0; i < 60; i++) await call('POST', '/api/watch/pair', { body: { code: '000001' } }); // spread over many addresses
  const r = await call('POST', '/api/watch/pair', { body: { code: c.j.code } }); assert.equal(r.status, 429, 'after 60 wrong codes pairing pauses for everyone');
  const files = await readdir(DATA); assert.ok(files.includes('watches.json'));
});

