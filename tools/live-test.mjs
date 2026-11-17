// "Riding now" (tools/live-api.mjs) against a real serve.mjs on a free port with a temp data folder: auth, validation,
// the list (look, progress, own entry), hidden when "Show me when I ride" is off, finish (DELETE), the one-tap join flow
// (auto, group already open, ask + accept, ask + decline, rider gone), rate limits, and expiry on a second server with a short TTL.
// Usage: node --test tools/live-test.mjs   (no real data is touched)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let ipN = 0; const ip = () => `10.8.${ipN >> 8}.${ipN++ & 255}`;
const servers = [];
async function server(env = {}) {
  const DATA = await mkdtemp(join(tmpdir(), 'rf-live-test-')), port = await free(), base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '', ...env }, stdio: 'ignore' });
  servers.push({ srv, DATA });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await wait(100); } }
  const call = async (method, p, { body, token, raw } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip(), ...(token ? { 'X-RF-Token': token } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j };
  };
  const register = async name => { const r = await call('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.token; };
  return { call, register };
}
const hb = (over = {}) => ({ routeId: 'coast', routeName: 'Rocky Coast', d: 12400, len: 37000, code: null, startedAt: Date.now() - 600e3, ...over });

let S, A, B, C;
before(async () => { S = await server(); A = await S.register('Max Rider'); B = await S.register('Freddy'); C = await S.register('Spammy Sam'); });
after(async () => { for (const { srv, DATA } of servers) { srv.kill(); await rm(DATA, { recursive: true, force: true }); } });

test('only signed-in accounts of this host: everything needs a valid login', async () => {
  for (const [m, p] of [['GET', '/api/live'], ['POST', '/api/live'], ['DELETE', '/api/live'], ['POST', '/api/live/join'], ['GET', '/api/live/join/0123456789ab'], ['GET', '/api/live/prefs']]) {
    assert.equal((await S.call(m, p, { body: m === 'POST' ? hb() : undefined })).status, 401, `${m} ${p} without login`);
    assert.equal((await S.call(m, p, { token: 'nope', body: m === 'POST' ? hb() : undefined })).status, 401, `${m} ${p} with a wrong token`);
  }
});

test('heartbeat validation: strict, small, and nothing else leaks into the list', async () => {
  const bad = [{ routeId: '' }, { routeId: '../../etc' }, { routeId: 'x'.repeat(81) }, { len: 0 }, { len: '37000' }, { len: 2e6 }, { d: -1 }, { d: 'far' }, { code: 'ABCDE' }, { code: 'abc' }, { code: 'abcd1' },
    { answers: 'yes' }, { answers: [{ id: 'nothex', ok: true }] }, { answers: [{ id: '0123456789ab', ok: 'y' }] }, { answers: Array(21).fill({ id: '0123456789ab', ok: true }) }];
  for (const o of bad) assert.equal((await S.call('POST', '/api/live', { token: C, body: hb(o) })).status, 400, JSON.stringify(o));
  assert.equal((await S.call('POST', '/api/live', { token: C, raw: '{not json' })).status, 400, 'broken JSON');
  assert.equal((await S.call('POST', '/api/live', { token: C, raw: JSON.stringify({ ...hb(), pad: 'x'.repeat(5000) }) })).status, 400, 'too large');
  assert.equal((await S.call('POST', '/api/live', { token: C, raw: '[1,2]' })).status, 400, 'an array');
  const r = await S.call('POST', '/api/live', { token: C, body: hb({ routeName: '<b>Evil</b>\u0000 name ' + 'y'.repeat(200), d: 99999, extra: 'ignored', startedAt: 5 }) });
  assert.equal(r.status, 200); assert.match(r.j.sid, /^[0-9a-f]{12}$/); assert.equal(r.j.every, 20); assert.deepEqual(r.j.requests, []);
  const me = (await S.call('GET', '/api/live', { token: C })).j.riders.find(x => x.me);
  assert.ok(me && !me.canJoin, 'own entry, flagged me, not joinable');
  assert.ok(!/[<>\u0000]/.test(me.routeName) && me.routeName.length <= 80, 'route name cleaned and cut: ' + me.routeName);
  assert.equal(me.d, 37000, 'distance clamped to the route length'); assert.ok(Date.now() - me.since < 60e3, 'a silly start time becomes now');
  assert.equal(me.extra, undefined);
  assert.equal((await S.call('DELETE', '/api/live', { token: C })).status, 200);
});

test('the list: who rides where, how far, since when, with the look of the leaderboard; DELETE ends it', async () => {
  const look = { type: 'm', skin: 2, hair: 1 };
  assert.equal((await S.call('PUT', '/api/account/settings', { token: A, body: { settings: { look }, at: Date.now() } })).status, 200);
  const r = await S.call('POST', '/api/live', { token: A, body: hb() }); assert.equal(r.status, 200);
  const l = await S.call('GET', '/api/live', { token: B }); assert.equal(l.status, 200);
  const max = l.j.riders.find(x => x.name === 'Max Rider');
  assert.ok(max, 'B sees Max'); assert.equal(max.id, r.j.sid); assert.equal(max.routeName, 'Rocky Coast'); assert.equal(max.routeId, 'coast');
  assert.equal(max.d, 12400); assert.equal(max.len, 37000); assert.ok(max.since < Date.now() - 500e3); assert.deepEqual(max.look, look);
  assert.equal(max.canJoin, true); assert.equal(max.me, false); assert.equal(max.code, null); assert.equal(max.group, false);
  assert.equal(JSON.stringify(l.j).includes('secret') || JSON.stringify(l.j).includes('@example.org'), false, 'no email, no secrets');
  const r2 = await S.call('POST', '/api/live', { token: A, body: hb({ d: 13000 }) }); assert.equal(r2.j.sid, r.j.sid, 'the same id while riding');
  assert.equal((await S.call('GET', '/api/live', { token: B })).j.riders.find(x => x.name === 'Max Rider').d, 13000);
  await S.call('DELETE', '/api/live', { token: A });
  assert.equal((await S.call('GET', '/api/live', { token: B })).j.riders.some(x => x.name === 'Max Rider'), false, 'gone after finishing');
});

test('hidden when "Show me when I ride" is off (account settings or /api/live/prefs)', async () => {
  await S.call('PUT', '/api/account/settings', { token: A, body: { settings: { liveShow: false, look: { type: 'm', skin: 2, hair: 1 } }, at: Date.now() } });
  const r = await S.call('POST', '/api/live', { token: A, body: hb() }); assert.equal(r.status, 200); assert.equal(r.j.hidden, true);
  assert.equal((await S.call('GET', '/api/live', { token: B })).j.riders.some(x => x.name === 'Max Rider'), false);
  assert.deepEqual((await S.call('GET', '/api/live/prefs', { token: A })).j, { show: false, auto: true });
  assert.deepEqual((await S.call('PUT', '/api/live/prefs', { token: A, body: { show: true } })).j, { show: true, auto: true });
  await S.call('POST', '/api/live', { token: A, body: hb() });
  assert.equal((await S.call('GET', '/api/live', { token: B })).j.riders.some(x => x.name === 'Max Rider'), true, 'visible again');
  assert.equal((await S.call('PUT', '/api/live/prefs', { token: A, body: { show: 'no' } })).status, 400);
  await S.call('PUT', '/api/live/prefs', { token: A, body: { show: false } });
  assert.equal((await S.call('GET', '/api/live', { token: B })).j.riders.some(x => x.name === 'Max Rider'), false, 'switching off hides at once');
  const set = (await S.call('GET', '/api/account/me', { token: A })).j.settings; assert.equal(set.liveShow, false); assert.ok(set.look, 'the other settings are kept');
  await S.call('PUT', '/api/live/prefs', { token: A, body: { show: true } });
});

test('one-tap join, rider riding solo with "join without asking": request, group opened, code back', async () => {
  const sid = (await S.call('POST', '/api/live', { token: A, body: hb() })).j.sid;
  assert.equal((await S.call('POST', '/api/live/join', { token: B, body: { to: 'zz' } })).status, 400);
  assert.equal((await S.call('POST', '/api/live/join', { token: B, body: { to: '0123456789ab' } })).status, 404);
  assert.equal((await S.call('POST', '/api/live/join', { token: A, body: { to: sid } })).status, 400, 'not yourself');
  const q = await S.call('POST', '/api/live/join', { token: B, body: { to: sid } }); assert.equal(q.status, 200, JSON.stringify(q.j)); assert.equal(q.j.state, 'pending'); assert.equal(q.j.name, 'Max Rider');
  assert.equal((await S.call('POST', '/api/live/join', { token: B, body: { to: sid } })).j.id, q.j.id, 'asking twice is the same request');
  assert.equal((await S.call('GET', '/api/live/join/' + q.j.id, { token: C })).status, 404, 'only the asker reads his request');
  const h = await S.call('POST', '/api/live', { token: A, body: hb() });
  assert.deepEqual(h.j.requests, [{ id: q.j.id, from: 'Freddy', auto: true }], 'the heartbeat answer carries the request');
  await S.call('POST', '/api/live', { token: A, body: hb({ code: 'kq7mz', answers: [{ id: q.j.id, ok: true }] }) });
  const p = await S.call('GET', '/api/live/join/' + q.j.id, { token: B }); assert.deepEqual([p.j.state, p.j.code], ['ready', 'kq7mz']);
  const l = (await S.call('GET', '/api/live', { token: B })).j.riders.find(x => x.name === 'Max Rider'); assert.equal(l.code, 'kq7mz'); assert.equal(l.group, true);
  assert.equal((await S.call('POST', '/api/live', { token: A, body: hb({ code: 'kq7mz' }) })).j.requests.length, 0, 'answered requests are not sent again');
  await S.call('DELETE', '/api/live', { token: A });
});

test('group already open: Join gets the code at once', async () => {
  const sid = (await S.call('POST', '/api/live', { token: A, body: hb({ code: 'abc23' }) })).j.sid;
  const q = await S.call('POST', '/api/live/join', { token: B, body: { to: sid } }); assert.deepEqual([q.j.state, q.j.code], ['ready', 'abc23']);
  await S.call('DELETE', '/api/live', { token: A });
});

test('"Friends can join me without asking" off: no code in the list, the rider accepts or declines', async () => {
  await S.call('PUT', '/api/live/prefs', { token: A, body: { auto: false } });
  const sid = (await S.call('POST', '/api/live', { token: A, body: hb({ code: 'abc23' }) })).j.sid;
  const l = (await S.call('GET', '/api/live', { token: B })).j.riders.find(x => x.name === 'Max Rider'); assert.equal(l.code, null, 'the code stays hidden'); assert.equal(l.ask, true);
  const q = await S.call('POST', '/api/live/join', { token: B, body: { to: sid } }); assert.equal(q.j.state, 'pending');
  const h = await S.call('POST', '/api/live', { token: A, body: hb({ code: 'abc23' }) }); assert.deepEqual(h.j.requests, [{ id: q.j.id, from: 'Freddy', auto: false }]);
  await S.call('POST', '/api/live', { token: A, body: hb({ code: 'abc23', answers: [{ id: q.j.id, ok: false }] }) });
  assert.equal((await S.call('GET', '/api/live/join/' + q.j.id, { token: B })).j.state, 'declined');
  assert.equal((await S.call('GET', '/api/live/join/' + q.j.id, { token: B })).j.code, null);
  // accepted while riding solo: "accepted" until the code arrives with the next heartbeat
  await S.call('POST', '/api/live', { token: A, body: hb({ code: null }) });
  const q2 = await S.call('POST', '/api/live/join', { token: B, body: { to: sid } }); assert.notEqual(q2.j.id, q.j.id);
  const h2 = await S.call('POST', '/api/live', { token: A, body: hb({ answers: [{ id: q2.j.id, ok: true }] }) }); assert.deepEqual(h2.j.waiting, [q2.j.id]);
  assert.equal((await S.call('GET', '/api/live/join/' + q2.j.id, { token: B })).j.state, 'accepted');
  await S.call('POST', '/api/live', { token: A, body: hb({ code: 'xyz89' }) });
  assert.deepEqual((await S.call('GET', '/api/live/join/' + q2.j.id, { token: B })).j.code, 'xyz89');
  // the rider stops while somebody asks: "gone"; the asker can also cancel
  const q3 = await S.call('POST', '/api/live/join', { token: C, body: { to: sid } }); await S.call('DELETE', '/api/live', { token: A });
  assert.equal((await S.call('GET', '/api/live/join/' + q3.j.id, { token: C })).j.state, 'gone');
  await S.call('PUT', '/api/live/prefs', { token: A, body: { auto: true } });
});

test('rate limits: join requests per account and heartbeats', async () => {
  const D = await S.register('Busy Bee'), E = await S.register('Target Tim');
  const sid = (await S.call('POST', '/api/live', { token: E, body: hb() })).j.sid;
  let st = [];
  for (let i = 0; i < 12; i++) { const q = await S.call('POST', '/api/live/join', { token: D, body: { to: sid } }); st.push(q.status); if (q.j.id) await S.call('DELETE', '/api/live/join/' + q.j.id, { token: D }); }
  assert.deepEqual(st.slice(0, 10), Array(10).fill(200)); assert.equal(st[10], 429, 'the 11th request in 10 minutes is refused');
  st = []; for (let i = 0; i < 21; i++) st.push((await S.call('POST', '/api/live', { token: D, body: hb() })).status);
  assert.equal(st[19], 200); assert.equal(st[20], 429, 'more than 20 heartbeats a minute');
});

test('expiry: without a heartbeat the rider drops out, open requests expire (short TTL server)', async () => {
  const T = await server({ RIDEFRAME_LIVE_TTL: '700', RIDEFRAME_LIVE_ASK_TTL: '500' });
  const a = await T.register('Quick Quinn'), b = await T.register('Slow Sue');
  const sid = (await T.call('POST', '/api/live', { token: a, body: hb() })).j.sid;
  assert.equal((await T.call('GET', '/api/live', { token: b })).j.riders.length, 1);
  const q = await T.call('POST', '/api/live/join', { token: b, body: { to: sid } });
  await wait(400); await T.call('POST', '/api/live', { token: a, body: hb() }); // still riding: the heartbeat keeps him
  await wait(450); assert.equal((await T.call('GET', '/api/live', { token: b })).j.riders.length, 1, 'kept alive by the heartbeat');
  assert.equal((await T.call('GET', '/api/live/join/' + q.j.id, { token: b })).j.state, 'expired', 'nobody answered within the ask time');
  await wait(800); assert.equal((await T.call('GET', '/api/live', { token: b })).j.riders.length, 0, 'gone after the TTL without heartbeat');
});
