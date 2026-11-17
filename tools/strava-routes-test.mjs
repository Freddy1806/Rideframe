// Segment detail (PR, KOM) and Strava routes on the server (tools/strava-api.mjs) against a fake Strava: 24 h cache per rider
// and segment, Strava's rate-limit headers, the route list and the GPX export, missing permission. Starts serve.mjs on free
// ports with a temp data folder. Usage: node --test tools/strava-routes-test.mjs   (no real Strava, no real data)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const now = () => Math.floor(Date.now() / 1000);
const fake = { log: [], usage: '5,50', nRoutes: 63 };
const GPX = '<?xml version="1.0"?><gpx version="1.1" creator="StravaGPX"><trk><name>Sunday hills</name><trkseg><trkpt lat="48.1" lon="11.5"><ele>500</ele></trkpt><trkpt lat="48.11" lon="11.51"><ele>520</ele></trkpt></trkseg></trk></gpx>';
let F, srv, base, DATA;

before(async () => {
  F = createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); fake.log.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), auth: req.headers.authorization });
    const h = { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': fake.usage }, json = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    let m;
    if ((m = u.pathname.match(/^\/api\/v3\/segments\/(\d+)$/))) return m[1] === '404' ? json(404, { message: 'Record Not Found' })
      : json(200, { id: +m[1], name: 'Hill ' + m[1], distance: 1234.5, average_grade: 5.1, athlete_segment_stats: { pr_elapsed_time: 161, effort_count: 4 }, xoms: { kom: '2:05', qom: '2:31', overall: '2:05' }, map: { polyline: 'x' } });
    if ((m = u.pathname.match(/^\/api\/v3\/athletes\/(\d+)\/routes$/))) { const pp = +u.searchParams.get('per_page'), pg = +u.searchParams.get('page');
      return json(200, [...Array(fake.nRoutes)].map((_, i) => ({ id: 3300000000000000000 + i, id_str: String(3300000000000000000n + BigInt(i)), name: 'Route ' + i, distance: 42123.4, elevation_gain: 612.2, type: i % 2 ? 2 : 1, map: { summary_polyline: 'zzz' }, athlete: { id: 7 } })).slice((pg - 1) * pp, pg * pp)); }
    if ((m = u.pathname.match(/^\/api\/v3\/routes\/(\d+)\/export_gpx$/))) { res.writeHead(200, { 'Content-Type': 'application/gpx+xml', ...h }); return res.end(GPX); }
    json(404, {});
  }).listen(0, '127.0.0.1');
  await new Promise(r => F.once('listening', r));
  DATA = await mkdtemp(join(tmpdir(), 'rf-strava-routes-test-'));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  await writeFile(join(DATA, 'strava.json'), JSON.stringify({ client_id: 'test-client', client_secret: 'test-only-not-a-secret', public_url: base }));
  const tok = (access, scope) => ({ access_token: access, refresh_token: 'r-' + access, expires_at: now() + 3600, athlete: { id: 7, name: 'T' }, at: Date.now(), ...(scope ? { scope } : {}) });
  await writeFile(join(DATA, 'strava_tokens.json'), JSON.stringify({ kOld: tok('tok-old', null), kRead: tok('tok-read', 'read,activity:write,activity:read_all'), kB: tok('tok-b', 'read,activity:write,activity:read_all') }));
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, STRAVA_BASE: `http://127.0.0.1:${F.address().port}` }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/strava/status'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
after(async () => { srv?.kill(); F?.close(); await rm(DATA, { recursive: true, force: true }); });
const get = (p, key) => fetch(base + p, { headers: key ? { 'X-Strava-Key': key } : {} });

test('segment detail: PR, KOM/QOM as text and seconds, no ranks', async () => {
  fake.log = []; const r = await get('/api/strava/segment/111', 'kRead'), j = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(j, { id: '111', name: 'Hill 111', dist: 1234.5, grade: 5.1, pr: 161, kom: '2:05', qom: '2:31', komS: 125, qomS: 151, efforts: 4 });
  assert.equal(fake.log[0].auth, 'Bearer tok-read'); assert.equal(fake.log[0].path, '/api/v3/segments/111');
});
test('segment detail is cached 24 h per rider: the second ask does not reach Strava, another rider asks for their own PR', async () => {
  fake.log = []; await get('/api/strava/segment/222', 'kRead'); await get('/api/strava/segment/222', 'kRead'); await get('/api/strava/segment/111', 'kRead');
  assert.equal(fake.log.length, 1); await get('/api/strava/segment/222', 'kB'); assert.equal(fake.log.length, 2); assert.equal(fake.log[1].auth, 'Bearer tok-b');
});
test('segment detail: unknown segment, not connected, bad id', async () => {
  assert.equal((await get('/api/strava/segment/404', 'kRead')).status, 404);
  assert.equal((await get('/api/strava/segment/333', 'nope')).status, 401);
  assert.equal((await get('/api/strava/segment/abc', 'kRead')).status, 404);
});
test('Strava routes: two pages of 50, small fields, big ids as text', async () => {
  fake.log = []; const a = await (await get('/api/strava/routes', 'kRead')).json();
  assert.equal(fake.log[0].path, '/api/v3/athletes/7/routes'); assert.equal(fake.log[0].q.per_page, '50');
  assert.equal(a.routes.length, 50); assert.equal(a.more, true); assert.deepEqual(a.routes[1], { id: '3300000000000000001', name: 'Route 1', distance: 42123, elevation_gain: 612, type: 'run' });
  const b = await (await get('/api/strava/routes?page=2', 'kRead')).json(); assert.equal(b.routes.length, 13); assert.equal(b.more, false); assert.equal(b.routes[0].type, 'ride');
});
test('Strava route as GPX; an old connection without the read permission is asked to reconnect', async () => {
  const r = await get('/api/strava/routes/3300000000000000001.gpx', 'kRead'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /gpx/); assert.equal(await r.text(), GPX);
  for (const p of ['/api/strava/routes', '/api/strava/routes/1.gpx']) { const o = await get(p, 'kOld'), j = await o.json(); assert.equal(o.status, 403); assert.equal(j.reconnect, true); assert.match(j.error, /Reconnect Strava/); }
});
test('close to the rate limit: no further calls to Strava (runs last, the limit is kept in memory)', async () => {
  fake.usage = '98,500'; await get('/api/strava/segment/555', 'kRead'); fake.log = [];
  const r = await get('/api/strava/segment/556', 'kRead'); assert.equal(r.status, 429); assert.equal((await r.json()).rateLimited, true); assert.equal(fake.log.length, 0);
  assert.equal((await get('/api/strava/segment/555', 'kRead')).status, 200, 'cached answers still come');
  assert.equal((await get('/api/strava/routes', 'kRead')).status, 429); assert.equal(fake.log.length, 0);
});
