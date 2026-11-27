// The watch's recovery values (tools/health-api.mjs): POST /api/watch/health from a paired watch (the body js/watchflow.js healthBody
// builds, = garmin/source/Health.mc), validation (ranges, day vs t, unknown keys), the merge per day (newest snapshot wins per field,
// first / last seen), GET /api/account/health for the phone, other accounts, and the 400-day limit.
// Usage: node --test tools/health-test.mjs   (temp data folder, no real data is touched)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { healthBody, DEMO_HEALTH } from '../js/watchflow.js';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv, base, DATA, ipN = 0;
const call = async (method, p, { body, token, bearer } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${ipN >> 8}.${ipN++ & 255}`, ...(token ? { 'X-RF-Token': token } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text };
};
const register = async name => { const r = await call('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(r.status, 200); return { token: r.j.token }; };
const pairWith = async token => { const c = await call('POST', '/api/watch/code', { token }); const p = await call('POST', '/api/watch/pair', { body: { code: c.j.code, label: 'fenix 8' } }); assert.equal(p.status, 200); return p.j.token; };
const pad = n => String(n).padStart(2, '0');
const dk = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const S = t => Math.round(t / 1000), now = Date.now(), DAY = 864e5;

before(async () => {
  DATA = await mkdtemp(join(tmpdir(), 'rf-health-test-'));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
after(async () => { srv?.kill(); if (DATA) await rm(DATA, { recursive: true, force: true }); });

let A, wA;
test('the watch sends its snapshot (healthBody of the demo values); the phone reads it back', async () => {
  A = await register('Health Hanna'); wA = await pairWith(A.token);
  const b = healthBody(DEMO_HEALTH, S(now));
  assert.equal((await call('POST', '/api/watch/health', { body: b })).status, 401, 'paired watches only');
  const r = await call('POST', '/api/watch/health', { bearer: wA, body: b }); assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.j, { ok: true, day: dk(now), kept: ['ss', 'bb', 'rt', 'st', 'rhr', 'v2r', 'v2b', 'rr', 'spo2', 'steps', 'ts'] });
  assert.equal((await call('GET', '/api/account/health')).status, 401, 'signed in only');
  const g = await call('GET', '/api/account/health', { token: A.token }); assert.equal(g.status, 200);
  assert.equal(g.j.days.length, 1); assert.equal(g.j.days[0].ss, 84); assert.equal(g.j.days[0].ts, 'Productive'); assert.equal(g.j.days[0].rr, 13.4);
  assert.deepEqual(g.j.latest.rhr, { v: 47, day: dk(now), t: b.t * 1000 }, '27.11.7: t = the time of the snapshot that carried it'); assert.deepEqual(g.j.keys.rt, ['recovery time', 'minutes']);
  const f = JSON.parse(await readFile(join(DATA, 'users', (JSON.parse(await readFile(join(DATA, 'accounts.json'), 'utf8')).users['health hanna'].id), 'health.json'), 'utf8'));
  assert.ok(f.days[dk(now)].first > 0, 'stored per day in users/<id>/health.json');
});

test('validation: bad bodies refused, out-of-range values and unknown keys dropped (never stored)', async () => {
  const t = S(now), day = dk(now), post = body => call('POST', '/api/watch/health', { bearer: wA, body });
  for (const [b, re] of [[{ t }, /day:/], [{ day: '2026-02-30', t, ss: 1 }, /day:/], [{ day }, /t: Unix/], [{ day, t: S(now + 3600e3) }, /future/], [{ day, t: S(now - 401 * DAY) }, /older than 400/],
    [{ day: dk(now - 5 * DAY), t }, /does not fit/], [[1, 2], /JSON object/]]) { const r = await post(b); assert.equal(r.status, 400, JSON.stringify(b)); assert.match(r.j.error, re); }
  assert.equal((await post('{nope')).status, 400); assert.equal((await post({ day, t, ts: 'x'.repeat(3000) })).status, 413, 'small bodies only');
  const r = await post({ day, t: t + 1, ss: 140, bb: -1, rhr: 12, st: '30', steps: 1e7, spo2: 97.4, rr: 14.25, ts: '<b>Peaking</b>', mood: 5 }); assert.equal(r.status, 200);
  assert.deepEqual(r.j.kept, ['spo2', 'rr', 'ts']); assert.deepEqual(r.j.dropped.sort(), ['bb', 'mood', 'rhr', 'ss', 'st', 'steps']);
  const d = (await call('GET', '/api/account/health?days=1', { token: A.token })).j.days[0];
  assert.equal(d.ss, 84, 'a bad value never overwrites'); assert.equal(d.spo2, 97); assert.equal(d.rr, 14.3); assert.equal(d.ts, 'bPeaking/b'); assert.equal(d.mood, undefined);
  for (const q of ['0', '401', 'x']) assert.equal((await call('GET', '/api/account/health?days=' + q, { token: A.token })).status, 400, q);
});

test('merge per day: the newest snapshot wins per field, also when an older one arrives late; first / last seen', async () => {
  const B = await register('Merge Max'), w = await pairWith(B.token), y = now - DAY, day = dk(y), post = body => call('POST', '/api/watch/health', { bearer: w, body: { day, ...body } });
  const t1 = S(new Date(y).setHours(7, 0, 0, 0)), t2 = t1 + 3600, t0 = t1 - 1800;
  assert.equal((await post({ t: t1, bb: 80, steps: 500, ss: 77 })).status, 200);
  assert.equal((await post({ t: t2, bb: 65, steps: 4000 })).status, 200);
  assert.equal((await post({ t: t0, bb: 90, steps: 10, rhr: 50 })).status, 200, 'an older snapshot from the queue');
  await post({ day: dk(now), t: S(now), bb: 40 });
  const g = (await call('GET', '/api/account/health?days=7', { token: B.token })).j;
  assert.deepEqual(g.days.map(x => x.day), [dk(now), day], 'newest first');
  const d = g.days[1]; assert.deepEqual([d.bb, d.steps, d.ss, d.rhr], [65, 4000, 77, 50], 'newest per field, the late one fills only what was missing');
  assert.equal(d.first, t0 * 1000); assert.equal(d.last, t2 * 1000);
  assert.deepEqual(g.latest.bb, { v: 40, day: dk(now), t: S(now) * 1000 }); assert.deepEqual(g.latest.rhr, { v: 50, day, t: t0 * 1000 }, 'per field: the snapshot that carried it');
  assert.equal(d.at.bb, t2 * 1000); assert.equal(d.at.ss, t1 * 1000);
  assert.equal((await call('GET', '/api/account/health?days=1', { token: B.token })).j.days.length, 1);
});

test('isolation: an account sees only its own values; a new one has none', async () => {
  const C = await register('Other Olga');
  const g = await call('GET', '/api/account/health', { token: C.token }); assert.deepEqual(g.j.days, []); assert.deepEqual(g.j.latest, {});
  assert.ok(!(await call('GET', '/api/account/health', { token: A.token })).text.includes('"bb":65'), "Hanna does not see Max's values");
});

test('400 days kept: older days go when a new snapshot is stored', async () => {
  process.env.RIDEFRAME_DATA = DATA; // the module reads the data folder at import
  const H = await import('./health-api.mjs'), uid = 'zz-old', day0 = now - 405 * DAY;
  const old = H.validateHealth({ day: dk(day0), t: S(day0), bb: 50 }, day0 + 3600e3); assert.ok(!old.error, old.error);
  await H.storeHealth(uid, old, day0 + 3600e3);
  const recent = H.validateHealth({ day: dk(now), t: S(now), bb: 60 }); await H.storeHealth(uid, recent);
  const all = await H.healthOf(uid, 400); assert.deepEqual(all.map(x => x.day), [dk(now)]);
  assert.equal(H.validateHealth({ day: dk(now), t: S(now), bb: 50.6 }).v.bb, 51);
});

test('27.11.7 the card: a value of today older than 3 h (body battery, recovery time, stress) shows its time instead of its word; the header stays', async () => {
  const { renderHealthCard, staleTime, STALE_MS } = await import('../js/healthcard.js');
  const N = new Date(2026, 10, 27, 21, 16).getTime(), at = (h, m) => new Date(2026, 10, 27, h, m).getTime(), today = dk(N), yest = dk(N - DAY);
  const latest = { bb: { v: 62, day: today, t: at(18, 5) }, st: { v: 30, day: today, t: at(20, 0) }, ss: { v: 84, day: today, t: at(7, 2) }, rt: { v: 600, day: yest, t: at(9, 0) - DAY } };
  const el = {}; renderHealthCard(el, { days: [{ day: today, first: at(7, 2), last: at(21, 16), rhr: 48, at: {} }], latest }, { now: N });
  const h = el.innerHTML, tileOf = l => (h.split('<div class="hct">').find(x => x.startsWith(`<span>${l}</span>`)) || '');
  assert.match(h, /Garmin watch · today 21:16/, 'the header as before');
  assert.match(tileOf('Body battery'), /<em class="">18:05<\/em>/, 'body battery from 18:05: its time');
  assert.match(tileOf('Stress'), /<em class="">low<\/em>/, 'stress from 20:00: under 3 h, the word');
  assert.match(tileOf('Sleep score'), /good|excellent/, 'the sleep score keeps its word (one per day)');
  assert.match(tileOf('Recovery'), /yesterday/, 'another day: the day as before');
  assert.equal(staleTime({ v: 1, day: today, t: N - STALE_MS }, N, 'bb'), '', 'exactly 3 h: not yet');
  assert.equal(staleTime({ v: 1, day: today, t: N - STALE_MS - 60e3 }, N, 'bb'), '18:15'); assert.equal(staleTime({ v: 1, day: today }, N, 'bb'), '', 'no time: nothing');
  assert.equal(staleTime({ v: 1, day: today, t: at(1, 0) }, N, 'rt'), '01:00'); assert.equal(staleTime({ v: 1, day: today, t: at(1, 0) }, N, 'ss'), '');
});
