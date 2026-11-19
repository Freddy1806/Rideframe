// Strava import on the server (tools/strava-api.mjs) against a fake Strava: scope on connect, paging, "after", the page cap,
// 429, Strava's rate-limit headers, token refresh, missing permission. Starts serve.mjs on free ports with a temp data folder.
// Usage: node --test tools/strava-import-test.mjs   (no real Strava, no real data)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const now = () => Math.floor(Date.now() / 1000);
const fake = { log: [], tokenCalls: [], n: 250, fail429: 0, usage: '5,50', status: 200, big: false, put: [] };
const BIG = '9223372036854775807'; // 2^63 - 1: JSON.parse turns it into 9223372036854775808
const acts = () => [...Array(fake.n)].map((_, i) => ({ id: 5000 + i, name: 'Act ' + i, sport_type: i % 3 ? 'Run' : 'IceSkate', type: 'Run', start_date: new Date((now() - 300 * 86400 + i * 3600) * 1000).toISOString(),
  elapsed_time: 1800, moving_time: 1700, distance: 5000, total_elevation_gain: 10, athlete: { id: 1 }, start_latlng: [52.5, 13.4], map: { id: 'a', summary_polyline: 'abc', polyline: 'full' }, external_id: 'x' + i }));
let F, srv, base, DATA;

before(async () => {
  F = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), chunks = []; for await (const c of req) chunks.push(c);
    const raw = (code, t) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(t); };
    const json = (code, o, h = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/oauth/token') {
      const b = JSON.parse(Buffer.concat(chunks).toString() || '{}'); fake.tokenCalls.push({ grant: b.grant_type, refresh: b.refresh_token, code: b.code });
      if (b.grant_type === 'refresh_token') return json(200, { access_token: 'fresh-' + fake.tokenCalls.length, refresh_token: 'r-new', expires_at: now() + 21600 });
      if (b.code === 'cbig') return raw(200, `{"access_token":"acc-big","refresh_token":"r","expires_at":${now() + 21600},"athlete":{"id":${BIG},"id_str":"${BIG}","firstname":"Big","lastname":"Id"}}`);
      return json(200, { access_token: 'acc-' + b.code, refresh_token: 'r', expires_at: now() + 21600, athlete: { id: 7, firstname: 'Test', lastname: 'Rider' } });
    }
    // 64-bit ids (Strava, from 1 June 2027): raw JSON text, so the number really arrives too large for a double, next to its id_str
    if (u.pathname === '/api/v3/athlete/activities' && fake.big) return raw(200, `[{"id":${BIG},"id_str":"${BIG}","name":"Big","sport_type":"Ride","start_date":"${new Date().toISOString()}","elapsed_time":60},{"id":5001,"name":"Old","sport_type":"Ride","start_date":"${new Date().toISOString()}","elapsed_time":60}]`);
    const up = u.pathname.match(/^\/api\/v3\/uploads\/(\d+)$/);
    if (up) return raw(200, up[1] === '1' ? `{"id":1,"status":"Your activity is ready.","activity_id":${BIG},"activity_id_str":"${BIG}"}` : `{"id":2,"status":"Your activity is ready.","activity_id":4242}`);
    if (u.pathname === '/api/v3/activities' && req.method === 'POST') return raw(201, `{"id":${BIG},"id_str":"${BIG}"}`);
    if (u.pathname.startsWith('/api/v3/activities/') && req.method === 'PUT') { fake.put.push(u.pathname); return json(200, {}); }
    if (u.pathname === '/api/v3/athlete/activities') {
      const q = Object.fromEntries(u.searchParams), auth = req.headers.authorization; fake.log.push({ ...q, auth });
      const h = { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': fake.usage };
      if (fake.status !== 200) return json(fake.status, { message: 'Authorization Error' }, h);
      if (fake.fail429 && +q.page === fake.fail429) return json(429, { message: 'Rate Limit Exceeded' }, h);
      const list = acts().filter(a => Date.parse(a.start_date) / 1000 > +q.after), pp = +q.per_page, pg = +q.page;
      return json(200, list.slice((pg - 1) * pp, pg * pp), h);
    }
    json(404, {});
  }).listen(0, '127.0.0.1');
  await new Promise(r => F.once('listening', r));
  DATA = await mkdtemp(join(tmpdir(), 'rf-strava-test-'));
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  await writeFile(join(DATA, 'strava.json'), JSON.stringify({ client_id: 'test-client', client_secret: 'test-only-not-a-secret', public_url: base }));
  const tok = (access, scope, exp = now() + 3600) => ({ access_token: access, refresh_token: 'r-' + access, expires_at: exp, athlete: { id: 7, name: 'T' }, at: Date.now(), ...(scope ? { scope } : {}) });
  await writeFile(join(DATA, 'strava_tokens.json'), JSON.stringify({ kOld: tok('tok-old', null), kRead: tok('tok-read', 'read,activity:write,activity:read_all'), kExp: tok('tok-exp', 'read,activity:write,activity:read_all', now() - 10) }));
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, STRAVA_BASE: `http://127.0.0.1:${F.address().port}` }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/strava/status'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
after(async () => { srv?.kill(); F?.close(); if (DATA) await rm(DATA, { recursive: true, force: true }); });
const get = (p, key) => fetch(base + p, { headers: { 'X-Strava-Key': key }, redirect: 'manual' });

test('connected before the read permission: status says so, the import asks to reconnect and never calls Strava', async () => {
  const st = await (await get('/api/strava/status', 'kOld')).json();
  assert.deepEqual([st.configured, st.connected, st.canImport], [true, true, false]);
  fake.log = []; const r = await get('/api/strava/activities', 'kOld'), j = await r.json();
  assert.equal(r.status, 403); assert.equal(j.reconnect, true); assert.match(j.error, /Reconnect Strava/); assert.equal(fake.log.length, 0);
  assert.equal((await (await get('/api/strava/status', 'kRead')).json()).canImport, true);
  assert.equal((await get('/api/strava/activities', 'nokey')).status, 401);
});

test('first import: last 12 months, 100 per page until a short page, only the summary fields leave the server', async () => {
  fake.log = []; fake.n = 250;
  const j = await (await get('/api/strava/activities', 'kRead')).json();
  assert.equal(j.activities.length, 250); assert.equal(j.done, true); assert.equal(j.rateLimited, false); assert.equal(j.pages, 3); assert.equal(j.next, null);
  assert.deepEqual(fake.log.map(q => [q.page, q.per_page]), [['1', '100'], ['2', '100'], ['3', '100']]);
  assert.ok(Math.abs(+fake.log[0].after - (now() - 365 * 86400)) < 30); assert.equal(fake.log[0].auth, 'Bearer tok-read');
  const a = j.activities[0]; assert.equal(a.athlete, undefined); assert.equal(a.start_latlng, undefined); assert.deepEqual(a.map, { summary_polyline: 'abc' }); assert.equal(a.sport_type, 'IceSkate'); assert.equal(a.external_id, 'x0');
});

test('after = the last import: only newer activities', async () => {
  fake.log = []; const cut = Date.parse(acts()[239].start_date) / 1000;
  const j = await (await get('/api/strava/activities?after=' + cut, 'kRead')).json();
  assert.equal(fake.log[0].after, String(cut)); assert.equal(j.activities.length, 10); assert.equal(j.activities[0].id, '5240', 'ids leave the server as strings'); assert.equal(j.done, true);
});

test('page cap: 10 pages per call, then "next" to go on from', async () => {
  fake.log = []; fake.n = 1150;
  const j = await (await get('/api/strava/activities', 'kRead')).json();
  assert.equal(fake.log.length, 10); assert.equal(j.activities.length, 1000); assert.equal(j.done, false); assert.equal(j.next, Date.parse(j.activities[999].start_date) / 1000 - 1);
  const k = await (await get('/api/strava/activities?after=' + j.next, 'kRead')).json();
  assert.equal(k.activities.length, 151); assert.equal(k.activities[0].id, j.activities[999].id); assert.equal(k.done, true); // one overlap, the client drops it by id
  fake.n = 250;
});

test('429 from Strava: stop, report, keep what came', async () => {
  fake.log = []; fake.fail429 = 2;
  const r = await get('/api/strava/activities', 'kRead'), j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.rateLimited, true); assert.equal(j.done, false); assert.equal(j.activities.length, 100); assert.equal(fake.log.length, 2); assert.ok(j.next > 0);
  fake.fail429 = 0;
});

test('expired token: refreshed first, the new one is used and kept', async () => {
  fake.log = []; fake.tokenCalls = [];
  const j = await (await get('/api/strava/activities', 'kExp')).json();
  assert.equal(j.activities.length, 250);
  assert.deepEqual(fake.tokenCalls, [{ grant: 'refresh_token', refresh: 'r-tok-exp', code: undefined }]);
  assert.match(fake.log[0].auth, /^Bearer fresh-/);
  const saved = JSON.parse(await readFile(join(DATA, 'strava_tokens.json'), 'utf8')).kExp;
  assert.equal(saved.access_token, fake.log[0].auth.slice(7)); assert.ok(saved.expires_at > now()); assert.match(saved.scope, /activity:read_all/);
  fake.tokenCalls = []; await get('/api/strava/activities', 'kExp'); assert.equal(fake.tokenCalls.length, 0); // still valid: no second refresh
});

test('Strava refuses (permission taken back in Strava): reconnect, not a silent failure', async () => {
  fake.status = 401; const r = await get('/api/strava/activities', 'kRead'), j = await r.json(); fake.status = 200;
  assert.equal(r.status, 403); assert.equal(j.reconnect, true);
});

test('connect asks for activity:read_all (and again with force), the callback keeps the granted scope', async () => {
  const loc = async q => (await get('/api/strava/connect?claim=' + 'a'.repeat(32) + q, '')).headers.get('location');
  const u = new URL(await loc('')); assert.equal(u.searchParams.get('scope'), 'activity:write,activity:read_all,read_all'); assert.equal(u.searchParams.get('approval_prompt'), 'auto'); assert.match(u.pathname, /\/oauth\/authorize$/);
  assert.equal(new URL(await loc('&force=1')).searchParams.get('approval_prompt'), 'force');
  const keyAfter = async scope => { const st = new URL(await loc('')).searchParams.get('state'), h = await (await get(`/api/strava/callback?state=${st}&code=c${scope.length}&scope=${encodeURIComponent(scope)}`, '')).text();
    return (h.match(/rf_strava_key',"([a-f0-9]+)"/) || [])[1]; };
  const k1 = await keyAfter('read,activity:write,activity:read_all'); assert.ok(k1);
  assert.equal((await (await get('/api/strava/status', k1)).json()).canImport, true);
  const k2 = await keyAfter('read,activity:write'); assert.ok(k2); // reading unticked: still connected for uploads, the import asks to reconnect
  assert.equal((await (await get('/api/strava/status', k2)).json()).canImport, false);
});

test('64-bit Strava ids: id_str is used for activities, the athlete, the upload status and new activities; old numeric ids stay strings', async () => {
  fake.big = true; const j = await (await get('/api/strava/activities', 'kRead')).json(); fake.big = false;
  assert.deepEqual(j.activities.map(a => a.id), [BIG, '5001']);
  assert.notEqual(String(JSON.parse(`{"id":${BIG}}`).id), BIG, 'the plain number really loses digits');
  fake.put = []; const s1 = await (await get('/api/strava/upload/1?indoor=1', 'kRead')).json();
  assert.equal(s1.activity_id, BIG); assert.equal(s1.activity_id_str, BIG);
  for (let i = 0; i < 20 && !fake.put.length; i++) await new Promise(r => setTimeout(r, 25));
  assert.deepEqual(fake.put, ['/api/v3/activities/' + BIG], 'the indoor PUT goes to the exact id');
  const s2 = await (await get('/api/strava/upload/2', 'kRead')).json(); assert.equal(s2.activity_id, '4242', 'no activity_id_str (today): the number as a string');
  const a = await (await fetch(base + '/api/strava/activity', { method: 'POST', headers: { 'X-Strava-Key': 'kRead', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', elapsed_time: 600, start_date_local: '2027-06-02T10:00:00' }) })).json();
  assert.equal(a.id, BIG);
  const st = new URL((await get('/api/strava/connect?claim=' + 'b'.repeat(32), '')).headers.get('location')).searchParams.get('state');
  const h = await (await get(`/api/strava/callback?state=${st}&code=cbig&scope=read,activity:write,activity:read_all`, '')).text(), k = (h.match(/rf_strava_key',"([a-f0-9]+)"/) || [])[1];
  assert.ok(k); assert.equal((await (await get('/api/strava/status', k)).json()).athlete.id, BIG, 'the athlete id is kept exactly');
});

test('close to Strava\'s 15-minute limit: stops before running into it (runs last, the limit is kept in memory)', async () => {
  fake.log = []; fake.usage = '98,500';
  const j = await (await get('/api/strava/activities', 'kRead')).json();
  assert.equal(fake.log.length, 1); assert.equal(j.rateLimited, true); assert.equal(j.activities.length, 100);
  fake.log = []; const k = await (await get('/api/strava/activities', 'kRead')).json();
  assert.equal(fake.log.length, 0); assert.equal(k.rateLimited, true); assert.equal(k.activities.length, 0);
});
