// Phone remote API (tools/remote-api.mjs) against a real serve.mjs on a free port with a temp data folder: pairing by code,
// single use, wrong-code lockout, isolation between sessions, account discovery only for the same account, the event and
// status streams (SSE and long-poll), size and flood limits, max sessions, cross-site calls, and (second server with short
// clocks) code expiry and session expiry without desktop heartbeat.
// Usage: node --test tools/remote-test.mjs   (no real data is touched)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import net from 'node:net';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let ipN = 0; const ip = () => `10.7.${ipN >> 8}.${ipN++ & 255}`;
const servers = [];
async function server(env = {}) {
  const DATA = await mkdtemp(pjoin(tmpdir(), 'rf-remote-test-')), port = await free(), base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '', ...env }, stdio: 'ignore' });
  servers.push({ srv, DATA });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await wait(100); } }
  const call = async (method, p, { body, token, raw, xip, headers = {} } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xip || ip(), ...(token ? { 'X-RF-Token': token } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j };
  };
  return { base, call };
}
/** a Server-Sent Events reader on fetch: collects { ev, data } */
function sseOpen(url) {
  const ac = new AbortController(), got = [], o = { got, status: 0, close: () => ac.abort() };
  o.ready = fetch(url, { signal: ac.signal, headers: { 'X-Forwarded-For': ip() } }).then(async r => {
    o.status = r.status; if (r.status !== 200) return;
    (async () => { const dec = new TextDecoder(); let buf = '';
      try { for await (const c of r.body) { buf += dec.decode(c, { stream: true }); let k; while ((k = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, k); buf = buf.slice(k + 2);
        const ev = /^event: (.*)$/m.exec(blk)?.[1], d = /^data: (.*)$/m.exec(blk)?.[1]; if (ev) got.push({ ev, data: JSON.parse(d) }); } } } catch {} })();
  }).catch(() => {});
  o.until = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const x = got.find(pred); if (x) return x; await wait(15); } return null; };
  return o;
}
let S, A, B; // the main server, account tokens of two accounts
const register = async name => { const r = await S.call('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.token; };
const open = async (opt = {}) => { const r = await S.call('POST', '/api/remote/open', { body: { label: opt.label || 'Test laptop' }, ...opt }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j; };
const join = async code => { const r = await S.call('POST', '/api/remote/join', { body: { code } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.tok; };

before(async () => { S = await server(); A = await register('Remote Rider'); B = await register('Other Rider'); });
after(async () => { for (const { srv, DATA } of servers) { srv.kill(); await rm(DATA, { recursive: true, force: true }); } });

test('open: random id and key, a 6-digit code for 10 minutes', async () => {
  const d = await open(); assert.match(d.id, /^[\w-]{16}$/); assert.match(d.key, /^[\w-]{32}$/); assert.match(d.code, /^\d{6}$/); assert.equal(d.ttl, 600);
  assert.ok(Math.abs(d.exp - Date.now() - 600e3) < 5e3); assert.equal(d.account, false);
  const d2 = await open(); assert.notEqual(d.id, d2.id); assert.notEqual(d.code, d2.code);
});

test('pairing: the code joins once, events reach only that desktop (SSE), status reaches its phone', async () => {
  const d = await open(), other = await open();
  const ds = sseOpen(`${S.base}/api/remote/stream?id=${d.id}&key=${d.key}`), os = sseOpen(`${S.base}/api/remote/stream?id=${other.id}&key=${other.key}`);
  await ds.ready; await os.ready; assert.equal(ds.status, 200);
  const j = await S.call('POST', '/api/remote/join', { body: { code: d.code } }); assert.equal(j.status, 200); assert.match(j.j.tok, /^[\w-]{32}$/); assert.equal(j.j.label, 'Test laptop');
  assert.equal((await S.call('POST', '/api/remote/join', { body: { code: d.code } })).status, 401, 'a code is single use');
  assert.ok(await ds.until(x => x.ev === 'ev' && x.data.t === 'phones' && x.data.c === 1), 'the desktop hears "1 phone"');
  const tok = j.j.tok;
  const s1 = await S.call('POST', '/api/remote/send', { body: { tok, t: 'btn', i: 12, down: true } }); assert.equal(s1.status, 200);
  await S.call('POST', '/api/remote/send', { body: { tok, t: 'btn', i: 12, down: false } });
  await S.call('POST', '/api/remote/send', { body: { tok, t: 'cmd', name: 'pause' } });
  assert.ok(await ds.until(x => x.data.t === 'btn' && x.data.i === 12 && x.data.down === true));
  assert.ok(await ds.until(x => x.data.t === 'btn' && x.data.i === 12 && x.data.down === false));
  assert.ok(await ds.until(x => x.data.t === 'cmd' && x.data.name === 'pause'));
  await wait(150); assert.ok(!os.got.some(x => x.data.t === 'btn' || x.data.t === 'cmd'), 'the other desktop got nothing');
  // status desktop -> phone
  const ps = sseOpen(`${S.base}/api/remote/stream?tok=${tok}`); await ps.ready; assert.equal(ps.status, 200);
  assert.ok(await ps.until(x => x.ev === 'hello' && x.data.label === 'Test laptop'));
  const st = await S.call('POST', '/api/remote/status', { body: { id: d.id, key: d.key, s: { scr: 'ride', step: 'VO2max 1/5', tgt: 275 } } }); assert.equal(st.status, 200); assert.equal(st.j.phones, 1);
  const got = await ps.until(x => x.ev === 'status'); assert.equal(got?.data.s.tgt, 275);
  assert.equal((await S.call('POST', '/api/remote/status', { body: { id: other.id, key: d.key, s: { scr: 'x' } } })).status, 404, 'a key only fits its own session');
  assert.equal((await S.call('POST', '/api/remote/status', { body: { id: d.id, key: other.key, s: {} } })).status, 404);
  // leave: the desktop hears 0 phones, the token is dead
  ps.close(); await S.call('POST', '/api/remote/leave', { body: { tok } });
  assert.ok(await ds.until(x => x.data.t === 'phones' && x.data.c === 0));
  assert.equal((await S.call('POST', '/api/remote/send', { body: { tok, t: 'cmd', name: 'pause' } })).status, 404);
  ds.close(); os.close();
});

test('long-poll fallback: desktop events and phone status without SSE', async () => {
  const d = await open(), tok = await join(d.code);
  const p0 = await S.call('GET', `/api/remote/poll?id=${d.id}&key=${d.key}&after=0`); assert.equal(p0.status, 200); const n0 = p0.j.n;
  const waiting = S.call('GET', `/api/remote/poll?id=${d.id}&key=${d.key}&after=${n0}`); await wait(100);
  const t0 = Date.now(); await S.call('POST', '/api/remote/send', { body: { tok, t: 'btn', i: 0, down: true } });
  const p1 = await waiting; assert.equal(p1.status, 200); assert.ok(Date.now() - t0 < 1000, 'a waiting poll answers at once');
  assert.deepEqual(p1.j.evs.filter(e => e.t === 'btn').map(e => [e.i, e.down]), [[0, true]]);
});

test('phone poll gets the status the desktop posts', async () => {
  const d = await open(), tok = await join(d.code);
  const w = S.call('GET', `/api/remote/poll?tok=${tok}&after=0`); await wait(100);
  await S.call('POST', '/api/remote/status', { body: { id: d.id, key: d.key, s: { scr: 'menu', tab: 'Routes' } } });
  const r = await w; assert.equal(r.status, 200); assert.equal(r.j.s.tab, 'Routes'); assert.ok(r.j.n >= 1);
});

test('strict validation: unknown events, button range, sizes, bad JSON', async () => {
  const d = await open(), tok = await join(d.code), send = b => S.call('POST', '/api/remote/send', { body: { tok, ...b } });
  assert.equal((await send({ t: 'btn', i: 17, down: true })).status, 400);
  assert.equal((await send({ t: 'btn', i: -1, down: true })).status, 400);
  assert.equal((await send({ t: 'btn', i: 1.5, down: true })).status, 400);
  assert.equal((await send({ t: 'btn', i: 3, down: 'yes' })).status, 400);
  assert.equal((await send({ t: 'cmd', name: 'eval' })).status, 400);
  assert.equal((await send({ t: 'cmd', name: '__proto__' })).status, 400);
  assert.equal((await send({ t: 'cmd', name: 'wbview' })).status, 200);
  assert.equal((await send({ evs: [{ t: 'btn', i: 5, down: true }, { t: 'btn', i: 5, down: false }] })).status, 200, 'a batch of events');
  assert.equal((await send({ evs: Array.from({ length: 9 }, () => ({ t: 'cmd', name: 'view' })) })).status, 400, 'at most 8 in a batch');
  assert.equal((await send({ evs: [{ t: 'cmd', name: 'view' }, { t: 'cmd', name: 'nope' }] })).status, 400, 'one bad event refuses the batch');
  const pl = await S.call('GET', `/api/remote/poll?id=${d.id}&key=${d.key}&after=0`);
  assert.deepEqual(pl.j.evs.filter(e => e.t === 'btn').map(e => e.down), [true, false], 'a batch arrives in order, the refused one not at all');
  assert.equal((await S.call('POST', '/api/remote/send', { raw: '{"tok":"' + tok + '","t":"cmd","name":"pause","x":"' + 'a'.repeat(800) + '"}' })).status, 413);
  assert.equal((await S.call('POST', '/api/remote/send', { raw: 'not json' })).status, 400);
  assert.equal((await S.call('POST', '/api/remote/send', { raw: '[1,2]' })).status, 400);
  assert.equal((await S.call('POST', '/api/remote/status', { body: { id: d.id, key: d.key, s: { x: 'a'.repeat(2100) } } })).status, 413);
  assert.equal((await S.call('POST', '/api/remote/send', { body: { tok: 'x'.repeat(32), t: 'cmd', name: 'pause' } })).status, 404);
  assert.equal((await S.call('GET', '/api/remote/stream?tok=nope')).status, 404);
  assert.equal((await S.call('GET', `/api/remote/stream?id=${d.id}&key=wrong`)).status, 404);
  assert.equal((await S.call('DELETE', '/api/remote/open')).status, 405);
  const o = await S.call('POST', '/api/remote/open', { body: { label: '<b>Evil</b>\u0000 laptop ' + 'x'.repeat(80) } }); assert.equal(o.status, 200);
  const t2 = await S.call('POST', '/api/remote/join', { body: { code: o.j.code } }); assert.ok(!/[<>\u0000]/.test(t2.j.label) && t2.j.label.length <= 40, t2.j.label);
});

test('no cross-site use: a foreign Origin or Sec-Fetch-Site is refused, no CORS header', async () => {
  const r = await S.call('POST', '/api/remote/open', { body: {}, headers: { Origin: 'https://evil.example' } }); assert.equal(r.status, 403);
  const r2 = await S.call('POST', '/api/remote/join', { body: { code: '123456' }, headers: { 'Sec-Fetch-Site': 'cross-site' } }); assert.equal(r2.status, 403);
  const r3 = await fetch(S.base + '/api/remote/open', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() }, body: '{}' });
  assert.equal(r3.headers.get('access-control-allow-origin'), null);
});

test('wrong codes: 400 / 401, then a lockout per address; other addresses still pair', async () => {
  const x = ip(), d = await open();
  let last;
  for (let i = 0; i < 10; i++) last = await S.call('POST', '/api/remote/join', { body: { code: String((+d.code + 1 + i) % 1e6).padStart(6, '0') }, xip: x });
  assert.equal(last.status, 401);
  assert.equal((await S.call('POST', '/api/remote/join', { body: { code: d.code }, xip: x })).status, 429, 'locked out, even with the right code');
  assert.equal((await S.call('POST', '/api/remote/join', { body: { code: '12' } })).status, 400);
  assert.equal((await S.call('POST', '/api/remote/join', { body: { code: d.code } })).status, 200, 'another address pairs fine');
});

test('account discovery: only the same account sees and joins its desktops', async () => {
  const mine = await open({ token: A, label: 'Remote Rider’s Mac' }); assert.equal(mine.account, true);
  const anon = await open();
  const lA = await S.call('GET', '/api/remote/mine', { token: A }); assert.equal(lA.status, 200);
  assert.deepEqual(lA.j.desks.map(x => x.id), [mine.id]); assert.equal(lA.j.desks[0].label, 'Remote Rider’s Mac');
  assert.ok(!('key' in lA.j.desks[0]) && !('code' in lA.j.desks[0]), 'no key or code is handed out');
  const lB = await S.call('GET', '/api/remote/mine', { token: B }); assert.deepEqual(lB.j.desks, []);
  assert.equal((await S.call('GET', '/api/remote/mine')).status, 401);
  assert.equal((await S.call('POST', '/api/remote/join', { body: { id: mine.id }, token: B })).status, 404, 'another account cannot join');
  assert.equal((await S.call('POST', '/api/remote/join', { body: { id: mine.id } })).status, 404, 'no account, no join by id');
  assert.equal((await S.call('POST', '/api/remote/join', { body: { id: anon.id }, token: A })).status, 404, 'a desktop without account is code only');
  const j = await S.call('POST', '/api/remote/join', { body: { id: mine.id }, token: A }); assert.equal(j.status, 200); assert.ok(j.j.tok);
  await S.call('POST', '/api/remote/close', { body: { id: mine.id, key: mine.key } });
  assert.deepEqual((await S.call('GET', '/api/remote/mine', { token: A })).j.desks, [], 'closed: gone from the list');
  assert.equal((await S.call('POST', '/api/remote/send', { body: { tok: j.j.tok, t: 'cmd', name: 'pause' } })).status, 404, 'closed: the phone token is dead');
});

test('a fresh code for a second phone; at most 4 phones, the quietest one is dropped', async () => {
  const d = await open(), toks = [await join(d.code)];
  for (let i = 0; i < 4; i++) { const c = await S.call('POST', '/api/remote/code', { body: { id: d.id, key: d.key } }); assert.equal(c.status, 200); toks.push(await join(c.j.code)); }
  const alive = await Promise.all(toks.map(tok => S.call('POST', '/api/remote/send', { body: { tok, t: 'cmd', name: 'view' } }).then(r => r.status)));
  assert.deepEqual(alive, [404, 200, 200, 200, 200]);
  assert.equal((await S.call('POST', '/api/remote/code', { body: { id: d.id, key: 'nope' } })).status, 404);
});

test('flood limits: phone events, status posts, sessions per address', async () => {
  const d = await open(), tok = await join(d.code);
  const rs = await Promise.all(Array.from({ length: 120 }, (_, i) => S.call('POST', '/api/remote/send', { body: { tok, t: 'btn', i: 0, down: i % 2 === 0 } }).then(r => r.status)));
  const okN = rs.filter(s => s === 200).length, slow = rs.filter(s => s === 429).length;
  assert.ok(okN >= 40 && okN < 100 && slow > 0, `burst of 120: ${okN} taken, ${slow} refused`);
  await wait(600); assert.equal((await S.call('POST', '/api/remote/send', { body: { tok, t: 'cmd', name: 'hud' } })).status, 200, 'refilled after a moment');
  const st = await Promise.all(Array.from({ length: 30 }, (_, i) => S.call('POST', '/api/remote/status', { body: { id: d.id, key: d.key, s: { i } } }).then(r => r.status)));
  assert.ok(st.filter(s => s === 429).length >= 15, 'status: at most 10 per second');
  const x = ip(), got = [];
  for (let i = 0; i < 6; i++) got.push((await S.call('POST', '/api/remote/open', { body: {}, xip: x })).status);
  assert.deepEqual(got, [200, 200, 200, 200, 429, 429], 'at most 4 open sessions per address');
  const y = ip(); let lastOpen;
  for (let i = 0; i < 31; i++) { lastOpen = await S.call('POST', '/api/remote/open', { body: {}, xip: y }); if (lastOpen.status === 200) await S.call('POST', '/api/remote/close', { body: { id: lastOpen.j.id, key: lastOpen.j.key }, xip: y }); }
  assert.equal(lastOpen.status, 429, 'at most 30 opens per 10 minutes per address');
  const accs = []; for (let i = 0; i < 5; i++) accs.push((await S.call('POST', '/api/remote/open', { body: {}, token: B })).status);
  assert.deepEqual(accs, [200, 200, 200, 200, 429], 'at most 4 open sessions per account');
});

test('expiry (short clocks): a code dies after its time, a session without heartbeat after its time, the phone hears "bye"', async () => {
  const T = await server({ RIDEFRAME_REMOTE_TIME: '0.005' }); // code 3 s, session 0.3 s without heartbeat
  const o = await T.call('POST', '/api/remote/open', { body: {} }); assert.equal(o.status, 200); assert.equal(o.j.ttl, 3);
  const ds = sseOpen(`${T.base}/api/remote/stream?id=${o.j.id}&key=${o.j.key}`); await ds.ready; // an open desktop stream keeps it alive
  await wait(3300);
  assert.equal((await T.call('POST', '/api/remote/join', { body: { code: o.j.code } })).status, 401, 'the code expired');
  const c = await T.call('POST', '/api/remote/code', { body: { id: o.j.id, key: o.j.key } }); assert.equal(c.status, 200, 'the session lives on with its stream');
  const j = await T.call('POST', '/api/remote/join', { body: { code: c.j.code } }); assert.equal(j.status, 200);
  const ps = sseOpen(`${T.base}/api/remote/stream?tok=${j.j.tok}`); await ps.ready;
  ds.close(); // the desktop goes away: no stream, no status
  assert.ok(await ps.until(x => x.ev === 'bye' && x.data.why === 'expired', 3000), 'the phone hears "bye"');
  assert.equal((await T.call('POST', '/api/remote/status', { body: { id: o.j.id, key: o.j.key, s: {} } })).status, 404, 'the session is gone');
  // status posts alone keep a session alive
  const o2 = await T.call('POST', '/api/remote/open', { body: {} });
  for (let i = 0; i < 8; i++) { await wait(120); assert.equal((await T.call('POST', '/api/remote/status', { body: { id: o2.j.id, key: o2.j.key, s: { i } } })).status, 200); }
  await wait(600); assert.equal((await T.call('POST', '/api/remote/status', { body: { id: o2.j.id, key: o2.j.key, s: {} } })).status, 404);
  ps.close();
}, { timeout: 20000 });
