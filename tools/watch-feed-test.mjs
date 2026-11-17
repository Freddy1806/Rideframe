// The watch's activities, segments and routes (tools/watch-feed.mjs via tools/watch-api.mjs) against a real serve.mjs on a free
// port with a temp data folder and a fake Strava (STRAVA_BASE): activity validation / idempotency / storage like a manual entry,
// the dedupe with the Strava import in both orders (activities and strength), segments near the watch through the account's
// Strava (size, order, cache, limits), routes sent from the phone and read by the watch.
// Usage: node --test tools/watch-feed-test.mjs   (no real Strava, no real data)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { fromStrava, plan, collapse, mergeAct, sameAct } from '../js/actimport.js';
import { groupOf } from '../js/sports.js';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv, base, DATA, FK, ipN = 0;
const KEY = 'ab'.repeat(24), KEY2 = 'cd'.repeat(24); // Strava keys of two connected browsers (48 hex like the real ones)
const fake = { log: [], usage: '5,50', explore: null };
const call = async (method, p, { body, token, bearer, raw, strava } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.${ipN >> 8}.${ipN++ & 255}`, ...(token ? { 'X-RF-Token': token } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...(strava ? { 'X-Strava-Key': strava } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, size: Buffer.byteLength(text) };
};
const register = async name => { const r = await call('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.token; };
const pairWith = async token => { const c = await call('POST', '/api/watch/code', { token }); const p = await call('POST', '/api/watch/pair', { body: { code: c.j.code, label: 'fr265' } }); assert.equal(p.status, 200); return p.j.token; };
const nowS = () => Math.floor(Date.now() / 1000);
// Google polyline encoding (the format of Strava's explore "points")
const enc = pts => { let out = '', pl = 0, pn = 0; const one = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); out += one(a - pl) + one(b - pn); pl = a; pn = b; } return out; };
const C0 = [52.52, 13.405]; // the watch's position
// ten segments, the i-th starting i * 700 m north-east of the watch, each a 300-point wiggly line of ~3 km, long names
const SEGS = [...Array(10)].map((_, i) => ({ id: 7000 + i, name: `Segment number ${i} with a really long name for a small watch`, distance: 3000 + i,
  points: enc([...Array(300)].map((_, k) => [C0[0] + (9 - i) * .0063 + k * .00009, C0[1] + (9 - i) * .004 + Math.sin(k / 7) * .0004])) }));

before(async () => {
  FK = createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': fake.usage }); res.end(JSON.stringify(o)); };
    fake.log.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), auth: req.headers.authorization });
    if (u.pathname === '/api/v3/segments/explore') return json(200, { segments: fake.explore || SEGS });
    const m = u.pathname.match(/^\/api\/v3\/segments\/(\d+)$/);
    if (m) return json(200, { id: +m[1], name: 'x', distance: 3000, athlete_segment_stats: { pr_elapsed_time: 300 + (+m[1] % 100), effort_count: 3 }, xoms: { kom: '4:10', qom: '5:01' } });
    json(404, {});
  }).listen(0, '127.0.0.1');
  await new Promise(r => FK.once('listening', r));
  DATA = await mkdtemp(join(tmpdir(), 'rf-watchfeed-test-'));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  await writeFile(join(DATA, 'strava.json'), JSON.stringify({ client_id: 'test-client', client_secret: 'test-only-not-a-secret', public_url: base }));
  const tok = a => ({ access_token: a, refresh_token: 'r-' + a, expires_at: nowS() + 3600, athlete: { id: 7, name: 'T' }, at: Date.now(), scope: 'read,activity:write,activity:read_all' });
  await writeFile(join(DATA, 'strava_tokens.json'), JSON.stringify({ [KEY]: tok('tok-watch'), [KEY2]: tok('tok-other') }));
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '', STRAVA_BASE: `http://127.0.0.1:${FK.address().port}` }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
after(async () => { srv?.kill(); FK?.close(); if (DATA) await rm(DATA, { recursive: true, force: true }); });

const ACT = (o = {}) => ({ id: 'run1abcdef', type: 'Run', start: nowS() - 4000, duration: 3720, moving: 3540, dist: 10230, climb: 84, hr: 151, maxHr: 178, kcal: 712, laps: 11, ...o });

/* ---- activity ---- */
test('activity: strict validation, size limit, auth', async () => {
  const A = await register('Act Checker'), t = await pairWith(A), post = b => call('POST', '/api/watch/activity', { bearer: t, body: b });
  assert.equal((await call('POST', '/api/watch/activity', { body: ACT() })).status, 401);
  assert.equal((await call('POST', '/api/watch/activity', { token: A, body: ACT() })).status, 401, 'a phone login is no watch token');
  const bad = [[[], /object/], [{ ...ACT(), x: 1 }, /unknown key "x"/], [{ ...ACT(), id: 'x' }, /id/], [{ ...ACT(), id: '../../etc/x' }, /id/], [{ ...ACT(), type: 'Spacewalk' }, /type/], [{ ...ACT(), type: 5 }, /type/],
    [{ ...ACT(), start: nowS() - 90 * 86400 }, /start/], [{ ...ACT(), start: nowS() + 86400 }, /start/], [{ ...ACT(), start: '1763450000' }, /start/], [{ ...ACT(), duration: 0 }, /duration/], [{ ...ACT(), duration: 90000 }, /duration/],
    [{ ...ACT(), moving: 9999 }, /moving/], [{ ...ACT(), dist: -1 }, /dist/], [{ ...ACT(), dist: '10' }, /dist/], [{ ...ACT(), climb: 1e6 }, /climb/], [{ ...ACT(), hr: 400 }, /hr/], [{ ...ACT(), kcal: -5 }, /kcal/],
    [{ ...ACT(), power: 9999 }, /power/], [{ ...ACT(), laps: 1.5e4 }, /laps/]];
  for (const k of ['id', 'type', 'start', 'duration', 'moving', 'dist', 'climb', 'hr', 'maxHr', 'kcal']) { const b = ACT(); delete b[k]; bad.push([b, new RegExp(k)]); }
  for (const [b, re] of bad) { const r = await post(b); assert.equal(r.status, 400, JSON.stringify(b).slice(0, 90)); assert.match(r.j.error, re); }
  assert.equal((await call('POST', '/api/watch/activity', { bearer: t, raw: '{nope' })).status, 400);
  assert.equal((await call('POST', '/api/watch/activity', { bearer: t, raw: JSON.stringify({ ...ACT(), pad: 'x'.repeat(5000) }) })).status, 413);
  assert.deepEqual((await call('GET', '/api/account/rides', { token: A })).j.ids, [], 'nothing bad was stored');
});
test('activity: stored once as a normal ride record (like + Add activity), source watch, in the list and the week points', async () => {
  const A = await register('Watch Runner'), O = await register('Somebody Else'), t = await pairWith(A), b = ACT();
  const s0 = (await call('GET', '/api/watch/summary', { bearer: t })).j;
  const r = await call('POST', '/api/watch/activity', { bearer: t, body: b }); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.deepEqual(r.j, { ok: true, id: 'watch-run1abcdef' });
  const again = await call('POST', '/api/watch/activity', { bearer: t, body: { ...b, dist: 1 } }); assert.equal(again.status, 200); assert.equal(again.j.dup, true, 'the same id twice is stored once');
  const ids = (await call('GET', '/api/account/rides', { token: A })).j.ids; assert.deepEqual(ids, ['watch-run1abcdef']);
  const w = (await call('GET', '/api/account/rides/watch-run1abcdef', { token: A })).j;
  assert.equal(w.source, 'watch'); assert.equal(w.sportType, 'Run'); assert.equal(w.sport, 'run'); assert.equal(w.routeId, 'ext'); assert.equal(groupOf(w.sportType), 'run');
  assert.equal(w.start, b.start * 1000); assert.equal(w.date, b.start * 1000); assert.equal(w.duration, 3540); assert.equal(w.elapsed, 3720); assert.equal(w.complete, true);
  assert.deepEqual([w.distance, w.gain, w.avgHr, w.maxHr, w.kcal, w.nLaps, w.workout], [10230, 84, 151, 178, 712, 11, 'Run']); assert.ok(!('laps' in w), 'laps is the lap list of a ride, the count goes to nLaps'); assert.ok(!w.samples, 'no track');
  const s1 = (await call('GET', '/api/watch/summary', { bearer: t })).j; assert.ok(s1.pts > s0.pts + 30, `week points count it: ${s0.pts} -> ${s1.pts}`); assert.equal(s1.sessions, s0.sessions + 1);
  const hike = await call('POST', '/api/watch/activity', { bearer: t, body: ACT({ id: 'hike12345', type: 'Hike', start: nowS() - 30000, duration: 5000, moving: 4800, dist: 9000, hr: 0, maxHr: 0, kcal: 400, laps: 0 }) });
  assert.equal(hike.status, 200); const h = (await call('GET', '/api/account/rides/watch-hike12345', { token: A })).j; assert.equal(h.sport, 'walk'); assert.ok(!('avgHr' in h), 'no sensor: no heart rate');
  const ride = await call('POST', '/api/watch/activity', { bearer: t, body: ACT({ id: 'ride12345', type: 'Ride', start: nowS() - 60000, power: 221 }) });
  assert.equal(ride.status, 200); assert.equal((await call('GET', '/api/account/rides/watch-ride12345', { token: A })).j.avgPower, 221);
  assert.deepEqual((await call('GET', '/api/account/rides', { token: O })).j.ids, [], 'nothing lands in another account');
});
test('dedupe, Strava first: the watch fills the imported record, one entry, resend stays one', async () => {
  const A = await register('Strava First'), t = await pairWith(A), start = nowS() - 7200;
  const st = fromStrava({ id: 99001, name: 'Lunch run', sport_type: 'Run', start_date: new Date((start + 40) * 1000).toISOString(), elapsed_time: 3700, moving_time: 3500, distance: 10200, total_elevation_gain: 80, map: { summary_polyline: 'abc' } });
  assert.equal((await call('PUT', '/api/account/rides/' + st.id, { token: A, body: st })).status, 200); // the phone's import pushed it
  const r = await call('POST', '/api/watch/activity', { bearer: t, body: ACT({ id: 'twin123456', start }) }); assert.equal(r.status, 200); assert.deepEqual(r.j, { ok: true, id: 'st99001', merged: true });
  assert.deepEqual((await call('GET', '/api/account/rides', { token: A })).j.ids, ['st99001'], 'one entry');
  const m = (await call('GET', '/api/account/rides/st99001', { token: A })).j;
  assert.deepEqual([m.workout, m.polyline, m.distance, m.avgHr, m.maxHr, m.kcal, m.nLaps, m.watch, m.stravaId], ['Lunch run', 'abc', 10200, 151, 178, 712, 11, 'twin123456', '99001'], 'Strava keeps its data, the watch adds what it lacks');
  const again = await call('POST', '/api/watch/activity', { bearer: t, body: ACT({ id: 'twin123456', start }) }); assert.equal(again.j.dup, true); assert.equal(again.j.id, 'st99001');
  const other = await call('POST', '/api/watch/activity', { bearer: t, body: ACT({ id: 'ride777777', type: 'Ride', start }) }); assert.equal(other.j.id, 'watch-ride777777', 'another sport family is no twin');
  const late = await call('POST', '/api/watch/activity', { bearer: t, body: ACT({ id: 'late777777', start: start + 400 }) }); assert.equal(late.j.id, 'watch-late777777', 'more than 2 minutes apart is no twin');
});
test('dedupe, watch first: the import links the watch record and merges Strava into it; both stored = one entry in the feed', () => {
  const start = Date.now() - 7200e3, w = { id: 'watch-abc', routeId: 'ext', sportType: 'Run', sport: 'run', source: 'watch', start, date: start, duration: 3540, elapsed: 3720, distance: 10230, gain: 84, avgHr: 151, maxHr: 178, kcal: 712, complete: true, avgPower: 0 };
  const s = fromStrava({ id: 99002, name: 'Evening run', sport_type: 'TrailRun', start_date: new Date(start + 50e3).toISOString(), elapsed_time: 3700, moving_time: 3520, distance: 10100, total_elevation_gain: 90, average_heartrate: 149, max_heartrate: 180, map: { summary_polyline: 'xyz' } });
  const P = plan([w], [s]); assert.equal(P.add.length, 0); assert.equal(P.link.length, 1); assert.equal(P.link[0].act, w); assert.equal(P.link[0].rec, s);
  const m = mergeAct(w, s); assert.deepEqual([m.id, m.workout, m.polyline, m.avgHr, m.distance, m.stravaId, m.strava], ['watch-abc', 'Evening run', 'xyz', 151, 10230, '99002', 'https://www.strava.com/activities/99002'], 'the watch keeps its numbers, gets the name, map and link');
  const both = collapse([s, w]); assert.equal(both.length, 1); assert.equal(both[0].id, 'watch-abc'); assert.equal(both[0].stravaId, '99002');
  const k = { id: 'watch-k1', kraft: true, source: 'watch', start, date: start, dur: 2700, name: 'Push day', ex: [] }, wt = fromStrava({ id: 99003, name: 'Weights', sport_type: 'WeightTraining', start_date: new Date(start - 30e3).toISOString(), elapsed_time: 2750, moving_time: 2750, average_heartrate: 120 });
  const P2 = plan([k], [wt]); assert.equal(P2.add.length, 0, 'strength first: the WeightTraining import is not added'); assert.equal(P2.link[0].act, k);
  const c2 = collapse([wt, k, w]); assert.deepEqual(c2.map(x => x.id).sort(), ['watch-abc', 'watch-k1']); assert.equal(c2.find(x => x.id === 'watch-k1').stravaId, '99003');
  assert.ok(!sameAct(k, s), 'strength and a run are never the same'); assert.equal(collapse([s]).length, 1); assert.equal(collapse([w, { ...s, start: start + 400e3, date: start + 400e3 }]).length, 2);
});
test('dedupe, strength: Strava WeightTraining first, then the watch session: linked, the feed and the week points count it once', async () => {
  const A = await register('Lift First'), t = await pairWith(A), start = nowS() - 5000;
  const wt = fromStrava({ id: 99004, name: 'Weights', sport_type: 'WeightTraining', start_date: new Date((start + 30) * 1000).toISOString(), elapsed_time: 2650, moving_time: 2650, average_heartrate: 118 });
  await call('PUT', '/api/account/rides/' + wt.id, { token: A, body: wt });
  const s0 = (await call('GET', '/api/watch/summary', { bearer: t })).j;
  const r = await call('POST', '/api/watch/strength', { bearer: t, body: { id: 'kraft12345', start, duration: 2700, sets: [{ ex: 'bench', kg: 80, reps: 8, t: 300 }] } }); assert.equal(r.status, 200);
  const k = (await call('GET', '/api/account/kraft/watch-kraft12345', { token: A })).j; assert.equal(k.stravaId, '99004'); assert.equal(k.strava, 'https://www.strava.com/activities/99004'); assert.equal(k.avgHr, 118);
  const s1 = (await call('GET', '/api/watch/summary', { bearer: t })).j; assert.equal(s1.sessions, s0.sessions, 'the Strava copy and the session are one'); assert.ok(Math.abs(s1.pts - s0.pts) <= 3, `points: ${s0.pts} -> ${s1.pts}`);
  const local = [{ ...wt }, { ...k, kraft: true, date: k.start }]; assert.equal(collapse(local).length, 1, 'the phone shows one entry');
  assert.equal(plan([{ ...k, kraft: true, date: k.start }], [wt]).skip.length, 1, 'a later import skips it by the Strava id');
});

/* ---- segments ---- */
// a run recorded with the phone (js/outdoor.js record(): routeId 'run', outdoor, the GPS track in samples, date = the end)
const PHONE = (startMs, o = {}) => ({ id: 'ph-' + startMs, routeId: 'run', outdoor: true, sport: 'run', date: startMs + 3700e3, complete: true, duration: 3530, elapsed: 3700, distance: 10180, gain: 80, startD: 0,
  workout: 'Morning run', avgPower: 0, maxPower: 0, kj: 0, samples: Array.from({ length: 5 }, (_, i) => [i, 3.1, 0, 0, 0, 0, 47.37 + i * 1e-4, 8.54]), ...o });
const WATCHREC = (startMs, o = {}) => ({ id: 'watch-run9abcdef', routeId: 'ext', sportType: 'Run', sport: 'run', source: 'watch', start: startMs + 40e3, date: startMs + 40e3, duration: 3540, elapsed: 3690, distance: 10230, gain: 84, avgHr: 151, maxHr: 178, kcal: 712, nLaps: 10, complete: true, avgPower: 0, ...o });
test('dedupe, phone and watch: a run recorded on both is one entry in either order; the phone record stays, hr and kcal from the watch', () => {
  const t0 = Date.now() - 9000e3, p = PHONE(t0), w = WATCHREC(t0);
  for (const list of [[p, w], [w, p]]) {
    const c = collapse(list); assert.equal(c.length, 1, 'one entry'); const m = c[0];
    assert.equal(m.id, p.id, 'the phone record stays'); assert.equal(m.samples, p.samples, 'with its track'); assert.equal(m.routeId, 'run'); assert.equal(m.workout, 'Morning run');
    assert.deepEqual([m.distance, m.gain, m.avgHr, m.maxHr, m.kcal, m.nLaps, m.watch], [10180, 80, 151, 178, 712, 10, 'run9abcdef'], 'its numbers kept, the missing ones from the watch');
  }
  assert.equal(collapse([PHONE(t0, { avgHr: 149 }), w])[0].avgHr, 149, 'a heart rate the phone has (strap) is kept');
  const ride = PHONE(t0, { routeId: 'outdoor', sport: 'ride' }), wr = WATCHREC(t0, { sportType: 'GravelRide', sport: 'ride' });
  assert.equal(collapse([ride, wr]).length, 1, 'a ride: all bikes are one family'); assert.equal(collapse([wr, ride])[0].id, ride.id);
  assert.equal(collapse([p, WATCHREC(t0, { start: t0 + 200e3, date: t0 + 200e3 })]).length, 2, 'starts more than 2 minutes apart: two entries');
  assert.equal(collapse([p, WATCHREC(t0, { duration: 3000, elapsed: 3100 })]).length, 2, 'durations more than 5 % apart: two entries');
  assert.equal(collapse([p, WATCHREC(t0, { sportType: 'Ride', sport: 'ride' })]).length, 2, 'another sport family: two entries');
  assert.equal(collapse([p, PHONE(t0, { id: 'ph-2' })]).length, 2, 'two phone records are left alone (no watch)');
  const s = fromStrava({ id: 99010, name: 'Strava copy', sport_type: 'Run', start_date: new Date(t0 + 20e3).toISOString(), elapsed_time: 3700, moving_time: 3530, distance: 10150, average_heartrate: 150, map: { summary_polyline: 'pp' } });
  for (const list of [[p, w, s], [s, w, p], [w, p, s]]) { const c = collapse(list); assert.equal(c.length, 1, 'phone, watch and Strava: one entry'); assert.equal(c[0].id, p.id); assert.equal(c[0].stravaId, '99010'); assert.equal(c[0].kcal, 712); }
});
test('dedupe, phone and watch on the server: the week summary counts the run once, whichever arrives first', async () => {
  for (const watchFirst of [false, true]) {
    const A = await register(watchFirst ? 'Twin Watch First' : 'Twin Phone First'), t = await pairWith(A), start = nowS() - 6000, p = PHONE(start * 1000 - 40e3);
    const s0 = (await call('GET', '/api/watch/summary', { bearer: t })).j;
    const phone = () => call('PUT', '/api/account/rides/' + p.id, { token: A, body: p }), watch = () => call('POST', '/api/watch/activity', { bearer: t, body: ACT({ id: 'twinph' + (watchFirst ? 'w1' : 'p1') + 'xx', start, duration: 3690, moving: 3540 }) });
    if (watchFirst) { assert.equal((await watch()).status, 200); assert.equal((await phone()).status, 200); } else { assert.equal((await phone()).status, 200); assert.equal((await watch()).status, 200); }
    assert.equal((await call('GET', '/api/account/rides', { token: A })).j.ids.length, 2, 'both stay stored');
    const s1 = (await call('GET', '/api/watch/summary', { bearer: t })).j; assert.equal(s1.sessions, s0.sessions + 1, `one session (${watchFirst ? 'watch' : 'phone'} first)`);
  }
});
test('segments: without the account\'s Strava { segs: [], strava: false }; validation', async () => {
  const A = await register('Seg None'), t = await pairWith(A);
  const r = await call('GET', `/api/watch/segments?lat=${C0[0]}&lon=${C0[1]}&type=run`, { bearer: t }); assert.equal(r.status, 200); assert.deepEqual(r.j, { segs: [], strava: false });
  for (const q of ['lat=1&lon=2', 'lat=91&lon=2&type=run', 'lat=1&lon=200&type=ride', 'lat=x&lon=2&type=run', 'lon=2&type=run', `lat=1&lon=2&type=swim`]) assert.equal((await call('GET', '/api/watch/segments?' + q, { bearer: t })).status, 400, q);
  assert.equal((await call('GET', '/api/watch/segments?lat=1&lon=2&type=run')).status, 401);
  await call('GET', '/api/watch/devices', { token: A, strava: 'ee'.repeat(24) }); // an unknown key is not linked
  assert.equal((await call('GET', `/api/watch/segments?lat=${C0[0] + 1}&lon=${C0[1]}&type=run`, { bearer: t })).j.strava, false);
});
test('segments: the phone links its Strava; nearest first, max 8, short names, 40 points with 5 decimals, PR / KOM, under 8 KB, cached', async () => {
  const A = await register('Seg Rider'), t = await pairWith(A);
  assert.equal((await call('GET', '/api/watch/devices', { token: A, strava: KEY })).status, 200);
  fake.log = [];
  const r = await call('GET', `/api/watch/segments?lat=${C0[0]}&lon=${C0[1]}&type=ride`, { bearer: t }); assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.strava, true); assert.ok(r.size < 8192, `answer is ${r.size} bytes`); console.log(`  segments: ${r.j.segs.length} in ${r.size} bytes`);
  assert.ok(r.j.segs.length >= 6 && r.j.segs.length <= 8, 'max 8: ' + r.j.segs.length);
  assert.deepEqual(r.j.segs.slice(0, 3).map(s => s.id), ['7009', '7008', '7007'], 'nearest start first');
  for (const s of r.j.segs) { assert.ok(s.n.length <= 24, s.n); assert.ok(s.p.length >= 2 && s.p.length <= 40, 'points: ' + s.p.length); assert.ok(s.p.every(q => q.every(v => Math.abs(v * 1e5 - Math.round(v * 1e5)) < 1e-6)), '5 decimals'); assert.ok(s.len >= 3000); }
  assert.equal(r.j.segs[0].n, 'Segment number 9 with a.'); assert.deepEqual([r.j.segs[0].pr, r.j.segs[0].kom], [309, 250], 'PR and KOM (4:10) from the detail');
  const ex = fake.log.filter(x => x.path.endsWith('/explore')); assert.equal(ex.length, 1); assert.equal(ex[0].q.activity_type, 'riding'); assert.equal(ex[0].auth, 'Bearer tok-watch', 'the linked key\'s token');
  const b = ex[0].q.bounds.split(',').map(Number); assert.ok(Math.abs(b[0] - (C0[0] - .06)) < 1e-6 && Math.abs(b[3] - (C0[1] + .12)) < 1e-6, 'the phone\'s box: ' + ex[0].q.bounds);
  assert.equal(fake.log.filter(x => /segments\/\d+$/.test(x.path)).length, 3, 'at most 3 new detail calls per request');
  assert.ok(r.j.segs.slice(3).every(s => s.pr === 0 && s.kom === 0), 'the rest come with the next calls');
  const again = await call('GET', `/api/watch/segments?lat=${C0[0] + .0005}&lon=${C0[1] - .0004}&type=ride`, { bearer: t }); assert.deepEqual(again.j, r.j, 'same ~1 km: from the cache');
  assert.equal(fake.log.length, 4, 'no Strava call for the cached answer');
  const run = await call('GET', `/api/watch/segments?lat=${C0[0]}&lon=${C0[1]}&type=run`, { bearer: t }); assert.equal(fake.log.filter(x => x.path.endsWith('/explore')).at(-1).q.activity_type, 'running');
  assert.equal(run.j.segs.filter(s => s.pr > 0).length, 6, 'details of earlier calls come from the 24 h cache, 3 new');
});
test('segments: near Strava\'s limit nothing is asked; a fat answer is cut to 8 KB', async () => {
  const A = await register('Seg Limit'), t = await pairWith(A); await call('POST', '/api/watch/code', { token: A, strava: KEY2 });
  fake.explore = [...Array(10)].map((_, i) => ({ ...SEGS[i], id: 8000 + i, ...(i === 9 ? { id_str: '9223372036854775807' } : {}), points: enc([...Array(40)].map((_, k) => [C0[0] + i * .01 + (k % 2) * .003, C0[1] + k * .002])) }));
  const big = await call('GET', `/api/watch/segments?lat=${C0[0] + 2}&lon=${C0[1]}&type=run`, { bearer: t }); assert.ok(big.size < 8192 && big.j.segs.length <= 8, `${big.size} bytes, ${big.j.segs.length} segments`);
  assert.ok(big.j.segs.some(s => s.id === '9223372036854775807'), '64-bit segment ids: id_str is used'); assert.ok(big.j.segs.every(s => typeof s.id === 'string'));
  fake.usage = '98,500'; await call('GET', `/api/watch/segments?lat=${C0[0] + 3}&lon=${C0[1]}&type=run`, { bearer: t }); // this answer brings the usage
  fake.log = []; const r = await call('GET', `/api/watch/segments?lat=${C0[0] + 4}&lon=${C0[1]}&type=run`, { bearer: t });
  assert.equal(r.status, 200); assert.deepEqual(r.j.segs, []); assert.equal(r.j.limited, true); assert.equal(fake.log.length, 0, 'no call close to the limit');
  fake.usage = '5,50'; fake.explore = null;
});

/* ---- routes ---- */
const loop = (n, r = .01) => [...Array(n)].map((_, i) => { const a = i / (n - 1) * Math.PI * 2; return [+(C0[0] + Math.sin(a) * r).toFixed(6), +(C0[1] + Math.cos(a) * r * 1.6 + (i % 2) * 1e-5).toFixed(6), 30 + Math.sin(a * 3) * 20]; });
// x east, y north: north, then east, then south (clockwise: two right turns)
const square = () => { const C = [[0, 0], [0, 1], [1, 1], [1, 0]], out = []; for (let s = 0; s < 3; s++) for (let k = 0; k <= 50; k++) { const [x0, y0] = C[s], [x1, y1] = C[s + 1];
  out.push([+(C0[0] + (y0 + (y1 - y0) * k / 50) * .01).toFixed(6), +(C0[1] + (x0 + (x1 - x0) * k / 50) * .016).toFixed(6), null]); } return out; };
test('routes: the phone sends a simplified copy (signed in, strict, max 20), the watch lists and loads one under 12 KB', async () => {
  const A = await register('Route Sender'), O = await register('Route Other'), t = await pairWith(A), put = (id, b, tk = A) => call('PUT', '/api/watch/routes/' + id, { token: tk, body: b });
  assert.equal((await call('PUT', '/api/watch/routes/r1', { body: { name: 'x', pts: loop(10) } })).status, 401); assert.equal((await call('GET', '/api/watch/routes')).status, 401);
  const bad = [['r1', null, /object/], ['r1', { name: '', pts: loop(10) }, /name/], ['r1', { name: 'x', pts: [[1, 2]] }, /2 to 5000/], ['r1', { name: 'x', pts: loop(5001) }, /2 to 5000/], ['r1', { name: 'x', pts: [[1, 2], [91, 2]] }, /lat/],
    ['r1', { name: 'x', pts: [[1, 2], ['1', 2]] }, /lat/], ['r1', { name: 'x', pts: [[1, 2, 'a'], [1.1, 2]] }, /ele/], ['r1', { name: 'x', pts: [[1, 2], [1, 2.0001]] }, /50 m/], ['a.b', { name: 'x', pts: loop(10) }, /id/]];
  for (const [id, b, re] of bad) { const r = await put(id, b); assert.equal(r.status, 400, id + ' ' + JSON.stringify(b)?.slice(0, 60)); assert.match(r.j.error, re); }
  assert.equal((await call('PUT', '/api/watch/routes/r1', { token: A, raw: JSON.stringify({ name: 'x', pts: loop(10), pad: 'x'.repeat(300e3) }) })).status, 413);
  const big = loop(4000); const p = await put('rt_loop1', { name: '  Lake   loop around the whole city <b>  ', pts: big }); assert.equal(p.status, 200, JSON.stringify(p.j)); assert.ok(p.j.dist > 6000 && p.j.climb > 0, JSON.stringify(p.j));
  const files = []; for (const u of await readdir(join(DATA, 'users'))) if ((await readdir(join(DATA, 'users', u))).includes('watch-routes.json')) files.push(JSON.parse(await readFile(join(DATA, 'users', u, 'watch-routes.json'), 'utf8')));
  assert.equal(files.length, 1); assert.ok(files[0].routes[0].pts.length <= 500, 'a simplified copy is kept: ' + files[0].routes[0].pts.length);
  assert.equal((await put('rt_sq', { name: 'Square', pts: square() })).status, 200);
  const l = await call('GET', '/api/watch/routes', { token: A }); assert.deepEqual(l.j.routes.map(r => r.id), ['rt_sq', 'rt_loop1'], 'the phone list, newest first'); assert.equal(l.j.routes[1].name, 'Lake loop around the whole city b');
  assert.deepEqual((await call('GET', '/api/watch/routes', { token: O })).j.routes, [], 'another account has none');
  const w = await call('GET', '/api/watch/routes', { bearer: t }); assert.equal(w.status, 200); assert.deepEqual(Object.keys(w.j.routes[0]).sort(), ['climb', 'dist', 'id', 'name']); assert.equal(w.j.routes[1].name, 'Lake loop around the wh.');
  const one = await call('GET', '/api/watch/route?id=rt_loop1', { bearer: t }); assert.equal(one.status, 200); assert.ok(one.size < 12288, one.size + ' bytes');
  assert.ok(one.j.p.length >= 20 && one.j.p.length <= 200, 'points: ' + one.j.p.length); assert.ok(one.j.p.every(q => q.length === 2 && q.every(v => Math.abs(v * 1e5 - Math.round(v * 1e5)) < 1e-6)), '[lat, lon] with 5 decimals');
  assert.ok(Math.abs(one.j.dist - p.j.dist) < p.j.dist * .02, `length kept: ${one.j.dist} vs ${p.j.dist}`); console.log(`  route: ${one.j.p.length} points, ${one.j.turns.length} turns, ${one.size} bytes`);
  const sq = (await call('GET', '/api/watch/route?id=rt_sq', { bearer: t })).j; assert.equal(sq.turns.length, 2, 'three sides of a square: two corners: ' + JSON.stringify(sq.turns));
  assert.ok(sq.turns.every(([at, d]) => at > 0 && at < sq.dist && d === 'R'), 'clockwise square: right turns ' + JSON.stringify(sq.turns));
  assert.equal((await call('GET', '/api/watch/route?id=nope', { bearer: t })).status, 404); assert.equal((await call('GET', '/api/watch/route?id=rt_sq', { token: A })).status, 200, 'the preview signed in on the phone');
  for (let i = 0; i < 18; i++) assert.equal((await put('rt' + i, { name: 'R ' + i, pts: loop(20) })).status, 200);
  const over = await put('rt_21', { name: 'One more', pts: loop(20) }); assert.equal(over.status, 409); assert.match(over.j.error, /20 routes/);
  assert.equal((await put('rt_sq', { name: 'Square renamed', pts: square() })).status, 200, 'replacing one is fine at 20');
  assert.equal((await call('DELETE', '/api/watch/routes/rt_sq', { token: A })).j.removed, true); assert.equal((await call('DELETE', '/api/watch/routes/rt_sq', { token: A })).j.removed, false);
  assert.equal((await call('GET', '/api/watch/routes', { bearer: t })).j.routes.length, 19); assert.equal((await call('GET', '/api/watch/route?id=rt_sq', { bearer: t })).status, 404);
  assert.equal((await call('DELETE', '/api/watch/routes/rt_loop1', { token: O })).j.removed, false, 'not yours');
});
