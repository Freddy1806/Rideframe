// The server's background Strava import (tools/strava-auto.mjs) against a fake Strava, in this process: the link key -> account
// from a signed-in browser call, new activities into the linked account (once), no duplicates with what a browser imported or
// RIDEFRAME uploaded, deleted ones stay away, nothing without read permission / link / with the setting off, the rate limit,
// Strava errors. runStravaAuto() is called directly; no timer runs. Usage: node --test tools/strava-auto-test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nowS = () => Math.floor(Date.now() / 1000), H = 3600;
const fake = { acts: [], usage: '1,10', status: 200, down: false, gets: [], writes: 0, refresh: 0 };
let F, S, base, DATA, M, A, U3;

before(async () => {
  F = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); for await (const _ of req);
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': fake.usage }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/oauth/token') { fake.refresh++; return json(200, { access_token: 'fresh', refresh_token: 'r2', expires_at: nowS() + 21600 }); }
    if (req.method !== 'GET') { fake.writes++; return json(405, {}); } // read only: nothing may ever be sent to Strava
    if (u.pathname === '/api/v3/athlete/activities') {
      if (fake.down) { req.socket.destroy(); return; }
      fake.gets.push({ auth: req.headers.authorization, after: +u.searchParams.get('after'), page: +u.searchParams.get('page'), per: +u.searchParams.get('per_page') });
      if (fake.status !== 200) return json(fake.status, { message: 'Strava is having a bad day' });
      return json(200, fake.acts.filter(a => Date.parse(a.start_date) / 1000 > +u.searchParams.get('after')).sort((x, y) => Date.parse(x.start_date) - Date.parse(y.start_date)).slice(0, 100));
    }
    json(404, {});
  }).listen(0, '127.0.0.1');
  await new Promise(r => F.once('listening', r));
  DATA = await mkdtemp(join(tmpdir(), 'rf-strava-auto-test-'));
  Object.assign(process.env, { RIDEFRAME_DATA: DATA, STRAVA_BASE: `http://127.0.0.1:${F.address().port}`, RIDEFRAME_INVITE: '' });
  await writeFile(join(DATA, 'strava.json'), JSON.stringify({ client_id: 'test-client', client_secret: 'test-only-not-a-secret' }));
  const tok = (a, scope = 'read,activity:write,activity:read_all', exp = nowS() + 3600) => ({ access_token: a, refresh_token: 'r-' + a, expires_at: exp, athlete: { id: 7, name: 'T' }, at: Date.now(), scope });
  const k = c => c.repeat(48);
  await writeFile(join(DATA, 'strava_tokens.json'), JSON.stringify({ [k('a')]: tok('tok-a'), [k('b')]: tok('tok-b', 'activity:write,read'), [k('c')]: tok('tok-c'), [k('d')]: tok('tok-d', undefined, nowS() - 10), [k('e')]: tok('tok-e'), [k('f')]: tok('tok-f') }));
  M = await import('./strava-auto.mjs'); A = await import('./accounts-api.mjs');
  const { stravaApi } = await import('./strava-api.mjs');
  S = createServer(async (req, res) => { const p = new URL(req.url, 'http://x').pathname; await M.stravaLink(req, p).catch(() => {}); if (!(await A.accountsApi(req, res, p) || await stravaApi(req, res, p))) { res.writeHead(404); res.end(); } }).listen(0, '127.0.0.1');
  await new Promise(r => S.once('listening', r)); base = `http://127.0.0.1:${S.address().port}`;
});
after(async () => { S?.close(); F?.close(); if (DATA) await rm(DATA, { recursive: true, force: true }); });

const call = async (method, path, { token, key, body, ip } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}), ...(token ? { 'X-RF-Token': token } : {}), ...(key ? { 'X-Strava-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => null) }; };
let nUser = 0;
const register = async () => { const name = 'Rider ' + ++nUser, r = await call('POST', '/api/account/register', { body: { name, email: `r${nUser}@example.test`, password: 'secret123' }, ip: '10.0.0.' + nUser }); assert.equal(r.status, 200, JSON.stringify(r.j));
  const acc = JSON.parse(await readFile(join(DATA, 'accounts.json'), 'utf8')), u = acc.users[name.toLowerCase()]; return { token: r.j.token, id: u.id, dir: join(DATA, 'users', u.id) }; };
const KEY = c => c.repeat(48);
const ready = U => call('PUT', '/api/account/stravagone', { token: U.token, body: { ids: [] } }); // what a browser's import sends first (its "deleted here" ids)
const act = (id, hoursAgo, o = {}) => ({ id, name: 'Act ' + id, sport_type: 'Run', type: 'Run', start_date: new Date((nowS() - hoursAgo * H) * 1000).toISOString(), elapsed_time: 3000, moving_time: 2900, distance: 8000, total_elevation_gain: 40, ...o });
const ids = async d => (await readdir(join(d, 'rides')).catch(() => [])).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();

test('a signed-in browser links its Strava key to the account; the background then imports a new activity once', async () => {
  const U = await register();
  await call('GET', '/api/strava/status', { key: KEY('a') }); // not signed in: no link
  await assert.rejects(readFile(join(U.dir, 'strava-link.json')));
  await call('GET', '/api/strava/status', { token: U.token, key: 'f'.repeat(10) }); // unknown key: no link
  await assert.rejects(readFile(join(U.dir, 'strava-link.json')));
  assert.equal((await call('GET', '/api/strava/status', { token: U.token, key: KEY('a') })).j.canImport, true);
  assert.equal(JSON.parse(await readFile(join(U.dir, 'strava-link.json'), 'utf8')).key, KEY('a'), 'status with login + key = link');
  fake.acts = [act(1001, 5, { name: 'Morning Run' })];
  const old = { id: 999, name: 'Old', sport_type: 'Run', type: 'Run', start_date: '2026-11-22T08:00:00Z', elapsed_time: 3000, moving_time: 2900, distance: 8000, total_elevation_gain: 40 };
  if (Date.now() - Date.parse(old.start_date) < 9 * 86400e3) fake.acts.push(old); // inside the first run's window only for a few days after the rollout
  const r1 = await M.runStravaAuto(); // 27.11.: no device has sent its deleted ids yet = import all the same, only nothing from before 23.11.
  fake.acts = fake.acts.filter(a => a.id !== 999);
  assert.equal(r1.added, 1); assert.deepEqual(await ids(U.dir), ['st1001']);
  const rec = JSON.parse(await readFile(join(U.dir, 'rides', 'st1001.json'), 'utf8'));
  assert.equal(rec.source, 'strava'); assert.equal(rec.stravaId, '1001'); assert.equal(rec.workout, 'Morning Run'); assert.equal(rec.distance, 8000); assert.equal(rec.ext, undefined);
  const { fromStrava, plan } = await import('../js/actimport.js'); assert.deepEqual(rec, plan([], [fromStrava(fake.acts[0])]).add[0], 'the same record the browser makes (shared mapping)');
  const g = fake.gets.at(-1); assert.equal(g.page, 1); assert.equal(g.per, 100); assert.ok(Math.abs(g.after - (nowS() - 10 * 86400)) < 5, 'first run looks one week back at most (+3 days overlap)');
  const n0 = fake.gets.length, r2 = await M.runStravaAuto();
  assert.equal(r2.added, 0, 'second run adds nothing'); assert.equal(fake.gets.length, n0 + 1, 'one page per connection per run');
  assert.deepEqual(await ids(U.dir), ['st1001']);
  assert.ok(fake.gets.at(-1).after >= Date.parse(fake.acts[0].start_date) / 1000 - 3 * 86400 - 1, 'next run reads from the newest start (minus the overlap)');
  assert.deepEqual((await call('GET', '/api/account/rides', { token: U.token })).j.ids, ['st1001'], 'the account list every device syncs from has it');
  assert.equal(fake.writes, 0, 'nothing was sent to Strava');
});

test('no duplicates: an activity the browser already imported, a ride uploaded from RIDEFRAME, the same session from the watch', async () => {
  const U = await register(); await call('GET', '/api/strava/status', { token: U.token, key: KEY('c') }); await ready(U);
  const t0 = Date.now() - 30 * H * 1e3;
  // the phone imported 2001 and pushed it; RIDEFRAME recorded r-777 and uploaded it (external_id); the watch sent the 2003 session
  await call('PUT', '/api/account/rides/st2001', { token: U.token, body: { id: 'st2001', source: 'strava', stravaId: '2001', strava: 'https://www.strava.com/activities/2001', sportType: 'Run', start: t0, date: t0, duration: 2900, elapsed: 3000, routeId: 'ext', distance: 8000, gain: 0, avgPower: 0, complete: true } });
  await call('PUT', '/api/account/rides/r-777', { token: U.token, body: { id: 'r-777', routeId: 'outdoor', outdoor: true, date: t0 + 10 * H * 1e3, duration: 3600, elapsed: 3600, distance: 30000, gain: 200, avgPower: 180, samples: [] } });
  const tw = t0 + 20 * H * 1e3; await call('PUT', '/api/account/rides/watch-xyz123', { token: U.token, body: { id: 'watch-xyz123', source: 'watch', sportType: 'Run', start: tw, date: tw, duration: 2900, elapsed: 3000, routeId: 'ext', distance: 7990, gain: 0, avgPower: 0, complete: true } });
  const iso = t => new Date(t).toISOString();
  fake.acts = [act(2001, 30), { ...act(2002, 20), sport_type: 'Ride', start_date: iso(t0 + 10 * H * 1e3 - 3600e3), elapsed_time: 3600, moving_time: 3600, external_id: 'rideframe-r-777.tcx' }, { ...act(2003, 0), start_date: iso(tw + 30e3) }, act(2004, 2, { name: 'Gravel' })];
  const r = await M.runStravaAuto();
  assert.deepEqual(await ids(U.dir), ['r-777', 'st2001', 'st2004', 'watch-xyz123'], 'only the really new one (2004) is added');
  assert.ok(r.added >= 1);
});

test('the same Strava id from phone, laptop and the server stays ONE activity', async () => {
  const U = U3 = await register(); await call('GET', '/api/strava/activities', { token: U.token, key: KEY('e') }); await ready(U);
  assert.equal(JSON.parse(await readFile(join(U.dir, 'strava-link.json'), 'utf8')).key, KEY('e'), 'activities with login + key = link too');
  fake.acts = [act(3001, 3)];
  const { fromStrava, plan } = await import('../js/actimport.js'), rec = plan([], [fromStrava(fake.acts[0])]).add[0];
  await call('PUT', '/api/account/rides/' + rec.id, { token: U.token, body: rec }); // phone
  await call('PUT', '/api/account/rides/' + rec.id, { token: U.token, body: rec }); // laptop, before it synced
  await M.runStravaAuto();
  assert.deepEqual(await ids(U.dir), ['st3001']);
  // a device that synced afterwards: its import plans against what it pulled, so it skips the id too
  assert.equal(plan([rec], [fromStrava(fake.acts[0])]).add.length, 0);
});

test('a deleted ("forgotten") Strava activity stays away: deleted through the account, or only remembered on a device', async () => {
  const U = await register(); await call('GET', '/api/strava/status', { token: U.token, key: KEY('e') }); await ready(U); // the key moves to this newer account
  fake.acts = [act(4001, 4), act(4002, 3), act(4003, 2)];
  await M.runStravaAuto(); assert.deepEqual(await ids(U.dir), ['st4001', 'st4002', 'st4003']);
  assert.deepEqual(await ids(U3.dir), ['st3001'], 'key e was used by two accounts: it belongs to the newer one only');
  assert.equal((await call('DELETE', '/api/account/rides/st4002', { token: U.token })).status, 200);
  assert.deepEqual((await call('GET', '/api/account/stravagone', { token: U.token })).j.ids, ['4002'], 'deleting on any device records the Strava id');
  await rm(join(U.dir, 'strava-auto.json')); // even a fresh start (no cursor, no seen list) must not bring it back
  await M.runStravaAuto(); assert.deepEqual(await ids(U.dir), ['st4001', 'st4003']);
  // forgotten on a phone (kv stravaGone) and pushed by its next import: a not yet imported 4004 stays away
  fake.acts.push(act(4004, 1));
  assert.deepEqual((await call('PUT', '/api/account/stravagone', { token: U.token, body: { ids: ['4004', 'nope', 4004] } })).j.ids, ['4002', '4004']);
  await M.runStravaAuto(); assert.deepEqual(await ids(U.dir), ['st4001', 'st4003']);
});

test('nothing without read permission, without a link, with the setting off', async () => {
  const before = fake.gets.length;
  const B = await register(); await call('GET', '/api/strava/status', { token: B.token, key: KEY('b') }); await ready(B); // upload-only connection
  const N = await register(); // never linked
  fake.acts = [act(5001, 2)];
  await M.runStravaAuto();
  assert.deepEqual(await ids(B.dir), [], 'no activity:read'); assert.deepEqual(await ids(N.dir), [], 'no link');
  assert.ok(fake.gets.every(g => g.auth !== 'Bearer tok-b'), 'no call with the upload-only key');
  const O = await register(); await call('GET', '/api/strava/status', { token: O.token, key: KEY('f') }); await ready(O);
  await call('PUT', '/api/account/settings', { token: O.token, body: { settings: { stravaImport: false }, at: Date.now() } });
  await M.runStravaAuto(); assert.deepEqual(await ids(O.dir), [], 'stravaImport === false (synced setting) = off');
  assert.ok(fake.gets.slice(before).every(g => g.auth !== 'Bearer tok-f'));
  assert.ok(!(await ids(U3.dir)).includes('st5001'), 'the older account of key e stays out');
});

test('an expired token is refreshed; Strava errors and a dead connection never throw and keep the cursor', async () => {
  const U = await register(); await call('GET', '/api/strava/status', { token: U.token, key: KEY('d') }); await ready(U);
  fake.acts = [act(6001, 1)]; const r0 = fake.refresh;
  await M.runStravaAuto(); assert.ok(fake.refresh > r0, 'refreshed like the browser path'); assert.deepEqual(await ids(U.dir), ['st6001']);
  const cur = JSON.parse(await readFile(join(U.dir, 'strava-auto.json'), 'utf8')).cursor;
  fake.acts.push(act(6002, 0.5)); fake.status = 500;
  const r1 = await M.runStravaAuto(); assert.equal(r1.added, 0); assert.ok(!r1.error);
  const st = JSON.parse(await readFile(join(U.dir, 'strava-auto.json'), 'utf8')); assert.equal(st.cursor, cur, 'cursor kept'); assert.match(st.last.error, /bad day|500/);
  fake.status = 200; fake.down = true;
  const r2 = await M.runStravaAuto(); assert.equal(r2.added, 0);
  fake.down = false;
  await M.runStravaAuto(); assert.ok((await ids(U.dir)).includes('st6002'), 'the next good run catches up');
});

test('near Strava\'s rate limit the run stops early (last: the limit stays noted for 15 minutes in this process)', async () => {
  fake.acts = [act(7001, 0.2)]; fake.usage = '75,100'; // 75 of 100 in this quarter hour: the first answer sets it, the rest wait
  const n0 = fake.gets.length, r = await M.runStravaAuto();
  assert.equal(r.stopped, 'limit'); assert.equal(fake.gets.length, n0 + 1, 'one call, then stop');
  const n1 = fake.gets.length, r2 = await M.runStravaAuto();
  assert.equal(r2.stopped, 'limit'); assert.equal(fake.gets.length, n1, 'no call at all while near the limit');
  assert.equal(fake.writes, 0);
});

test('the timer: unref\'d, off with RIDEFRAME_STRAVA_AUTO=0 and against a fake Strava unless asked', () => {
  assert.equal(M.startStravaAuto({ RIDEFRAME_STRAVA_AUTO: '0' }), false);
  assert.equal(M.startStravaAuto({ STRAVA_BASE: 'http://x' }), false);
});
