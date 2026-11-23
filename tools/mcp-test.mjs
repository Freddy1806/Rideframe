// Claude connector (tools/mcp-api.mjs) against a real serve.mjs on a free port with a temp data folder: the links in the settings
// (hash only, max 3, revoke), auth (unknown / revoked token 404, Origin, rate limit, body limit), the MCP lifecycle for legacy
// (initialize) and modern (2026-07-28, per-request _meta + headers) clients, tools/list, every tool incl. validation errors and
// name resolution, and that a workout made here shows up for the phone and in the watch's setup / config.
// Usage: node --test tools/mcp-test.mjs   (no real data is touched)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { LIM, MAX_ITEMS, MAX_WORKOUTS } from '../js/watchfields.js';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv, base, DATA, ipN = 0;
const ip = () => `10.7.${ipN >> 8}.${ipN++ & 255}`;
const call = async (method, p, { body, token, bearer, raw, headers = {} } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip(), ...(token ? { 'X-RF-Token': token } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, h: r.headers };
};
const register = async name => { const r = await call('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.token; };
const newLink = async token => { const r = await call('POST', '/api/account/mcp', { token, body: {} }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j; };
const pairWith = async token => { const c = await call('POST', '/api/watch/code', { token }); const p = await call('POST', '/api/watch/pair', { body: { code: c.j.code, label: 'Forerunner 265' } }); assert.equal(p.status, 200); return p.j.token; };
const ACC = { Accept: 'application/json, text/event-stream' };
let rid = 0;
/** one JSON-RPC message, legacy style (MCP-Protocol-Version 2025-06-18 unless given) */
const rpc = (path, method, params, { v = '2025-06-18', headers = {}, id = ++rid, notify = false } = {}) =>
  call('POST', path, { headers: { ...ACC, ...(v ? { 'MCP-Protocol-Version': v } : {}), ...headers }, body: { jsonrpc: '2.0', ...(notify ? {} : { id }), method, ...(params ? { params } : {}) } });
/** a tool call; returns { ok, text, data } */
const tool = async (path, name, args) => { const r = await rpc(path, 'tools/call', { name, arguments: args }); assert.equal(r.status, 200, r.text); assert.ok(r.j.result, r.text);
  return { ok: !r.j.result.isError, text: r.j.result.content[0].text, data: r.j.result.structuredContent }; };
const MV = '2026-07-28', meta = { 'io.modelcontextprotocol/protocolVersion': MV, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
const modern = (path, method, params = {}, headers = {}) => call('POST', path, { headers: { ...ACC, 'MCP-Protocol-Version': MV, 'Mcp-Method': method, ...headers }, body: { jsonrpc: '2.0', id: ++rid, method, params: { ...params, _meta: meta } } });

before(async () => {
  DATA = await mkdtemp(join(tmpdir(), 'rf-mcp-test-'));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
after(async () => { srv?.kill(); if (DATA) await rm(DATA, { recursive: true, force: true }); });

test('links: signed in only, token shown once, only a hash stored, up to 3, removable, per account', async () => {
  const A = await register('Link Lena'), B = await register('Link Bert');
  assert.equal((await call('GET', '/api/account/mcp')).status, 401);
  assert.equal((await call('POST', '/api/account/mcp', { token: 'nope', body: {} })).status, 401);
  assert.deepEqual((await call('GET', '/api/account/mcp', { token: A })).j, { links: [], max: 3 });
  const l1 = await newLink(A);
  assert.match(l1.token, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url'); assert.equal(l1.path, '/mcp/' + l1.token); assert.equal(l1.link.label, 'Claude');
  const M = await readFile(join(DATA, 'mcp.json'), 'utf8'); assert.ok(!M.includes(l1.token), 'only a hash of the token is stored');
  const list = (await call('GET', '/api/account/mcp', { token: A })).j.links; assert.equal(list.length, 1); assert.deepEqual(Object.keys(list[0]).sort(), ['created', 'id', 'label', 'used']);
  assert.ok(!JSON.stringify(list).includes(l1.token), 'the list never shows the token again');
  await newLink(A); await newLink(A);
  const four = await call('POST', '/api/account/mcp', { token: A, body: {} }); assert.equal(four.status, 409); assert.match(four.j.error, /Up to 3/);
  assert.equal((await call('DELETE', '/api/account/mcp/' + list[0].id, { token: B })).status, 404, 'another account cannot remove it');
  assert.equal((await call('GET', '/api/account/mcp', { token: B })).j.links.length, 0, 'and does not see it');
  assert.equal((await rpc(l1.path, 'ping')).status, 200);
  assert.equal((await call('DELETE', '/api/account/mcp/' + list[0].id, { token: A })).status, 200);
  const gone = await rpc(l1.path, 'ping'); assert.equal(gone.status, 404, 'a removed link is dead'); assert.equal(gone.text, '', 'with no detail');
  assert.equal((await call('GET', '/api/account/mcp', { token: A })).j.links.length, 2);
  assert.equal((await call('POST', '/api/account/mcp', { token: A, body: {} })).status, 200, 'room again after removing one');
});

test('auth: unknown or malformed tokens get a bare 404; GET 405; foreign Origin 403; 16 KB body limit', async () => {
  const A = await register('Auth Anna'), { path } = await newLink(A);
  for (const p of ['/mcp/' + 'A'.repeat(43), '/mcp/short', '/mcp', '/mcp/', path + 'x']) { const r = await rpc(p, 'ping'); assert.equal(r.status, 404, p); assert.equal(r.text, '', p); }
  const g = await call('GET', path); assert.equal(g.status, 405); assert.equal(g.h.get('allow'), 'POST');
  assert.equal((await call('DELETE', path)).status, 405);
  assert.equal((await rpc(path, 'ping', null, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await rpc(path, 'ping', null, { headers: { Origin: 'https://claude.ai' } })).status, 200, "Claude's origin is fine");
  assert.equal((await rpc(path, 'ping', null, { headers: { Origin: base } })).status, 200, 'our own origin is fine');
  const big = await call('POST', path, { headers: { ...ACC, 'MCP-Protocol-Version': '2025-06-18' }, raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(17e3) } }) });
  assert.equal(big.status, 413);
  const list = (await call('GET', '/api/account/mcp', { token: A })).j.links; assert.ok(list[0].used > 0, 'last use is recorded');
});

test('auth: rate limit of 60 calls a minute per link', async () => {
  const A = await register('Rate Rita'), { path } = await newLink(A), other = (await newLink(A)).path;
  const codes = []; for (let i = 0; i < 61; i++) codes.push((await rpc(path, 'ping')).status);
  assert.equal(codes.filter(c => c === 200).length, 60); assert.equal(codes[60], 429);
  assert.equal((await rpc(other, 'ping')).status, 200, 'per link');
});

test('auth: a link dies with its account', async () => {
  const A = await register('Gone Gina'), { path } = await newLink(A);
  assert.equal((await rpc(path, 'ping')).status, 200);
  assert.equal((await call('POST', '/api/account/delete', { token: A, body: { password: 'secret-pw-1' } })).status, 200);
  assert.equal((await rpc(path, 'ping')).status, 404);
});

test('lifecycle (legacy): initialize negotiates, initialized 202, ping, version header, bad messages', async () => {
  const { path } = await newLink(await register('Life Lars'));
  for (const v of ['2025-11-25', '2025-06-18', '2025-03-26']) {
    const r = await rpc(path, 'initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '1' } }, { v: null });
    assert.equal(r.status, 200); assert.equal(r.j.result.protocolVersion, v, 'the same version back'); }
  const i = await rpc(path, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } }, { v: null });
  assert.equal(i.j.result.protocolVersion, '2025-11-25', 'unknown: the newest legacy version');
  assert.deepEqual(i.j.result.capabilities, { tools: { listChanged: false } }); assert.equal(i.j.result.serverInfo.name, 'rideframe-workouts'); assert.match(i.j.result.instructions, /list_exercises/);
  assert.equal(i.h.get('content-type'), 'application/json'); assert.equal(i.h.get('mcp-session-id'), null, 'stateless: no session');
  const n = await rpc(path, 'notifications/initialized', null, { notify: true }); assert.equal(n.status, 202); assert.equal(n.text, '');
  const p = await rpc(path, 'ping', null, { id: 'p-1' }); assert.deepEqual(p.j, { jsonrpc: '2.0', id: 'p-1', result: {} });
  assert.equal((await rpc(path, 'ping', null, { v: null })).status, 200, 'no header = 2025-03-26');
  const bad = await rpc(path, 'ping', null, { v: '1999-01-01' }); assert.equal(bad.status, 400); assert.equal(bad.j.error.code, -32022); assert.ok(bad.j.error.data.supported.includes('2025-06-18'));
  const un = await rpc(path, 'resources/list'); assert.equal(un.j.error.code, -32601);
  const pe = await call('POST', path, { headers: ACC, raw: '{nope' }); assert.equal(pe.status, 400); assert.equal(pe.j.error.code, -32700);
  const ba = await call('POST', path, { headers: ACC, body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] }); assert.equal(ba.status, 400); assert.equal(ba.j.error.code, -32600);
  const nr = await call('POST', path, { headers: ACC, body: { id: 1, method: 'ping' } }); assert.equal(nr.status, 400, 'jsonrpc 2.0 is required');
});

test('lifecycle (modern 2026-07-28): server/discover, headers checked against the body', async () => {
  const { path } = await newLink(await register('Modern Mia'));
  const d = await modern(path, 'server/discover'); assert.equal(d.status, 200, d.text);
  assert.equal(d.j.result.resultType, 'complete'); assert.ok(d.j.result.supportedVersions.includes(MV) && d.j.result.supportedVersions.includes('2025-06-18'));
  assert.equal(d.j.result._meta['io.modelcontextprotocol/serverInfo'].name, 'rideframe-workouts');
  const tl = await modern(path, 'tools/list'); assert.equal(tl.j.result.resultType, 'complete'); assert.equal(tl.j.result.tools.length, 6);
  const c = await modern(path, 'tools/call', { name: 'list_workouts', arguments: {} }, { 'Mcp-Name': 'list_workouts' }); assert.equal(c.status, 200); assert.equal(c.j.result.isError, false);
  const c64 = await modern(path, 'tools/call', { name: 'list_workouts', arguments: {} }, { 'Mcp-Name': '=?base64?' + Buffer.from('list_workouts').toString('base64') + '?=' }); assert.equal(c64.status, 200, 'Base64 Mcp-Name');
  const mm = await modern(path, 'tools/list', {}, { 'Mcp-Method': 'ping' }); assert.equal(mm.status, 400); assert.equal(mm.j.error.code, -32020);
  const nn = await modern(path, 'tools/call', { name: 'list_workouts', arguments: {} }); assert.equal(nn.status, 400); assert.equal(nn.j.error.code, -32020, 'Mcp-Name missing');
  const wn = await modern(path, 'tools/call', { name: 'list_workouts', arguments: {} }, { 'Mcp-Name': 'delete_workout' }); assert.equal(wn.j.error.code, -32020, 'Mcp-Name mismatch');
  const vm = await modern(path, 'tools/list', {}, { 'MCP-Protocol-Version': '2025-06-18' }); assert.equal(vm.status, 400); assert.equal(vm.j.error.code, -32020, 'header vs _meta');
  const uv = await call('POST', path, { headers: { ...ACC, 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' }, body: { jsonrpc: '2.0', id: 9, method: 'tools/list', params: { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } } });
  assert.equal(uv.status, 400); assert.equal(uv.j.error.code, -32022); assert.equal(uv.j.error.data.requested, '2099-01-01');
  const um = await modern(path, 'prompts/list'); assert.equal(um.status, 404); assert.equal(um.j.error.code, -32601);
});

test('tools/list: six tools with descriptions and JSON Schemas that match js/watchfields.js', async () => {
  const { path } = await newLink(await register('Schema Sam'));
  const { tools } = (await rpc(path, 'tools/list')).j.result;
  assert.deepEqual(tools.map(t => t.name), ['list_exercises', 'list_workouts', 'create_workout', 'update_workout', 'delete_workout', 'get_strength_history']);
  for (const t of tools) { assert.ok(t.description.length > 30, t.name); assert.equal(t.inputSchema.type, 'object'); assert.equal(t.inputSchema.additionalProperties, false); assert.ok(t.annotations); }
  const c = tools.find(t => t.name === 'create_workout').inputSchema; assert.deepEqual(c.required, ['name', 'items']);
  const it = c.properties.items; assert.equal(it.maxItems, MAX_ITEMS); assert.deepEqual(it.items.required, ['exercise', 'sets', 'reps']);
  const P = it.items.properties; assert.deepEqual([P.sets.minimum, P.sets.maximum], LIM.sets); assert.deepEqual([P.reps.minimum, P.reps.maximum], LIM.reps);
  assert.deepEqual([P.kg.minimum, P.kg.maximum], LIM.kg); assert.deepEqual([P.rest_seconds.minimum, P.rest_seconds.maximum], LIM.rest);
  assert.equal(tools.find(t => t.name === 'delete_workout').annotations.destructiveHint, true); assert.equal(tools.find(t => t.name === 'list_exercises').annotations.readOnlyHint, true);
  const u = await rpc(path, 'tools/call', { name: 'drop_tables', arguments: {} }); assert.equal(u.j.error.code, -32602, 'unknown tool: protocol error');
  const na = await rpc(path, 'tools/call', { name: 'list_workouts', arguments: [1] }); assert.equal(na.j.error.code, -32602);
});

let A, path, watch; // the main account for the tool tests
const now = Date.now(), day = 864e5;
test('list_exercises and get_strength_history: catalogue, own ones, last sets, best, filter', async () => {
  A = await register('Tool Tina'); path = (await newLink(A)).path; watch = await pairWith(A);
  await call('PUT', '/api/account/settings', { token: A, body: { settings: { kraftRest: 120, kraftEx: [{ k: 'my_thai', n: 'Thai kick', t: 'w' }] }, at: now } });
  const sess = (id, ago, ex) => call('PUT', '/api/account/kraft/' + id, { token: A, body: { id, name: 'Push day ' + id, start: now - ago * day, date: now - ago * day + 3600e3, dur: 3600, ex } });
  await sess('s1', 9, [{ k: 'bench', n: 'Bench press', t: 'w', sets: [{ kg: 20, r: 10, done: true, warm: true }, { kg: 70, r: 5, done: true }, { kg: 70, r: 5, done: true }] }]);
  await sess('s2', 2, [{ k: 'bench', n: 'Bench press', t: 'w', sets: [{ kg: 75, r: 5, done: true }, { kg: 75, r: 4, done: true }, { kg: 80, r: 1, done: false }] }, { k: 'pull', n: 'Pull-ups', t: 'bw', sets: [{ kg: '', r: 9, done: true }] }, { k: 'plank', n: 'Plank', t: 'time', sets: [{ kg: '', r: '', s: 75, done: true }] }]);
  const all = await tool(path, 'list_exercises', {}); assert.ok(all.ok);
  const by = id => all.data.exercises.find(x => x.id === id);
  assert.equal(by('bench').type, 'weight'); assert.equal(by('pull').type, 'bodyweight'); assert.equal(by('plank').type, 'time'); assert.equal(by('my_thai').group, 'Custom');
  assert.deepEqual(by('bench').last.sets, [{ kg: 75, reps: 5 }, { kg: 75, reps: 4 }], 'the newest session, undone sets left out'); assert.equal(by('bench').best.e1rm_kg, 87.5);
  assert.deepEqual(by('pull').best, { reps: 9 }); assert.deepEqual(by('plank').best, { seconds: 75 }); assert.equal(by('squat').last, undefined);
  const legs = await tool(path, 'list_exercises', { query: 'legs' }); assert.ok(legs.data.exercises.every(x => x.group === 'Legs' || /legs/i.test(x.name)) && legs.data.count > 5);
  assert.equal((await tool(path, 'list_exercises', { query: 'zzz' })).data.count, 0);
  assert.equal((await tool(path, 'list_exercises', { query: 5 })).ok, false, 'query must be text');
  const h = await tool(path, 'get_strength_history', {}); assert.equal(h.data.count, 2); assert.equal(h.data.sessions[0].name, 'Push day s2');
  assert.deepEqual(h.data.sessions[1].exercises[0].sets, [{ kg: 70, reps: 5 }, { kg: 70, reps: 5 }], 'warm-up sets left out');
  assert.deepEqual(h.data.sessions[0].exercises.find(x => x.exercise === 'plank').sets, [{ seconds: 75 }]);
  const one = await tool(path, 'get_strength_history', { exercise: 'Pull-ups', limit: 5 }); assert.equal(one.data.count, 1); assert.deepEqual(one.data.sessions[0].exercises.map(x => x.exercise), ['pull']);
  assert.equal((await tool(path, 'get_strength_history', { limit: 1 })).data.count, 1);
  const bad = await tool(path, 'get_strength_history', { limit: 0 }); assert.equal(bad.ok, false); assert.match(bad.text, /limit: 1 to 50/);
  const unk = await tool(path, 'get_strength_history', { exercise: 'Bench pres' }); assert.equal(unk.ok, false); assert.match(unk.text, /Closest matches: bench \(Bench press\)/);
});

test('create_workout: names resolved, defaults, stored for the phone and the watch', async () => {
  const r = await tool(path, 'create_workout', { name: 'Push day', items: [
    { exercise: 'BENCH PRESS', sets: 4, reps: 6, kg: 77.5 }, { exercise: 'ohp', sets: 3, reps: 8, kg: 40, rest_seconds: 150 },
    { exercise: 'triceps pushdown', sets: 3, reps: 12, kg: 25 }, { exercise: 'Romanian DL', sets: 3, reps: 10, kg: 60 }, { exercise: 'Dips', sets: 3, reps: 10 }, { exercise: 'plank', sets: 2, reps: 60 }] });
  assert.ok(r.ok, r.text); const w = r.data.workout;
  assert.deepEqual(w.items.map(i => i.exercise), ['bench', 'ohp', 'tri', 'rdl', 'dip', 'plank'], 'full name, id, the watch name and the short name');
  assert.equal(w.items[0].rest_seconds, 120, "default rest = the account's rest setting"); assert.equal(w.items[4].kg, 0); assert.equal(w.items[1].rest_seconds, 150);
  assert.match(w.id, /^[A-Za-z0-9_-]{1,40}$/);
  const phone = (await call('GET', '/api/watch/config', { token: A })).j.config.workouts; assert.deepEqual(phone[0], { id: w.id, name: 'Push day', items: [
    { ex: 'bench', sets: 4, reps: 6, kg: 77.5, rest: 120 }, { ex: 'ohp', sets: 3, reps: 8, kg: 40, rest: 150 }, { ex: 'tri', sets: 3, reps: 12, kg: 25, rest: 120 },
    { ex: 'rdl', sets: 3, reps: 10, kg: 60, rest: 120 }, { ex: 'dip', sets: 3, reps: 10, kg: 0, rest: 120 }, { ex: 'plank', sets: 2, reps: 60, kg: 0, rest: 120 }] }, 'the phone editor sees it');
  const S = (await call('GET', '/api/watch/strength/setup', { bearer: watch })).j; const sw = S.workouts.find(x => x.id === w.id);
  assert.ok(sw, 'in the watch setup'); assert.equal(sw.n, 'Push day'); assert.deepEqual(sw.it[0], ['bench', 4, 6, 77.5, 120]);
  for (const k of ['bench', 'ohp', 'tri', 'rdl', 'dip', 'plank']) assert.ok(S.ex.some(e => e.id === k), 'the watch knows ' + k);
  const C = (await call('GET', '/api/watch/config', { bearer: watch })).j; assert.ok(C.w.some(x => x.id === w.id), 'in the watch config');
  const l = await tool(path, 'list_workouts', {}); assert.equal(l.data.count, 1); assert.equal(l.data.max, MAX_WORKOUTS); assert.equal(l.data.workouts[0].items[0].name, 'Bench press');
});

test('create_workout: validation errors come back as tool errors, nothing stored', async () => {
  const items = [{ exercise: 'bench', sets: 3, reps: 8, kg: 60 }], mk = (name, it = items) => tool(path, 'create_workout', { name, items: it });
  const cases = [
    [mk('X', [{ exercise: 'bench', sets: 11, reps: 8 }]), /items\[0\] \(Bench press\)\.sets: 1 to 10/],
    [mk('X', [{ exercise: 'bench', sets: 3, reps: 0 }]), /reps: 1 to 100/],
    [mk('X', [{ exercise: 'bench', sets: 3, reps: 8, kg: 60.1 }]), /kg: 0 to 500 \(in 0.25 kg steps\)/],
    [mk('X', [{ exercise: 'bench', sets: 3, reps: 8, rest_seconds: 7 }]), /rest_seconds: 0 to 600 \(in 5 s steps\)/],
    [mk('X', [{ exercise: 'bench', sets: '3', reps: 8 }]), /sets: a number/],
    [mk('X', [{ exercise: 'bench', sets: 3 }]), /items\[0\]\.reps is required/],
    [mk('X', [{ exercise: 'bench', sets: 3, reps: 8, tempo: 'slow' }]), /unknown key "tempo"/],
    [mk('X', []), /at least one exercise/],
    [mk('X', Array.from({ length: 21 }, () => items[0])), /items: up to 20 exercises/],
    [mk('x'.repeat(41)), /name: 1 to 40 characters/],
    [mk('   '), /name: 1 to 40 characters/],
    [mk('push DAY'), /already a workout named/],
    [mk('X', [{ exercise: 'Benchpress', sets: 3, reps: 8 }]), /Unknown exercise "Benchpress"\. Closest matches: bench \(Bench press\)/],
    [mk('X', [{ exercise: 'Thai', sets: 3, reps: 8 }]), /Closest matches: my_thai/],
    [tool(path, 'create_workout', { name: 'X' }), /items is required/],
    [tool(path, 'create_workout', { name: 'X', items, colour: 'red' }), /Unknown argument "colour"/],
  ];
  for (const [p, re] of cases) { const r = await p; assert.equal(r.ok, false, re + ''); assert.match(r.text, re); }
  assert.equal((await tool(path, 'list_workouts', {})).data.count, 1, 'nothing was stored');
});

test('create_workout: an ambiguous name is refused, the id works', async () => {
  const B = await register('Twin Tom'), p = (await newLink(B)).path;
  await call('PUT', '/api/account/settings', { token: B, body: { settings: { kraftEx: [{ k: 'my_bench', n: 'Bench press', t: 'w' }] }, at: now } });
  const r = await tool(p, 'create_workout', { name: 'Twins', items: [{ exercise: 'bench press', sets: 3, reps: 5 }] }); assert.equal(r.ok, false); assert.match(r.text, /fits several exercises: .*bench.*my_bench.*Use the id/);
  assert.ok((await tool(p, 'create_workout', { name: 'Twins', items: [{ exercise: 'my_bench', sets: 3, reps: 5 }] })).ok);
  assert.equal((await tool(path, 'list_workouts', {})).data.workouts.some(w => w.name === 'Twins'), false, 'never in another account');
});

test('create_workout: the 30-workout limit of the watch', async () => {
  const B = await register('Full Fiona'), p = (await newLink(B)).path, cfg = (await call('GET', '/api/watch/config', { token: B })).j.config;
  cfg.workouts = Array.from({ length: MAX_WORKOUTS }, (_, i) => ({ id: 'w' + i, name: 'W ' + i, items: [{ ex: 'squat', sets: 3, reps: 5, kg: 60, rest: 90 }] }));
  assert.equal((await call('PUT', '/api/watch/config', { token: B, body: cfg })).status, 200);
  const r = await tool(p, 'create_workout', { name: 'One more', items: [{ exercise: 'squat', sets: 3, reps: 5 }] }); assert.equal(r.ok, false); assert.match(r.text, /already has 30 workouts.*delete_workout/);
  assert.ok((await tool(p, 'delete_workout', { workout: 'W 0' })).ok); assert.ok((await tool(p, 'create_workout', { name: 'One more', items: [{ exercise: 'squat', sets: 3, reps: 5 }] })).ok);
});

test('update_workout and delete_workout: by id or name, errors, the watch follows', async () => {
  const id = (await tool(path, 'list_workouts', {})).data.workouts[0].id;
  assert.ok((await tool(path, 'create_workout', { name: 'Pull day', items: [{ exercise: 'pull', sets: 4, reps: 8 }] })).ok);
  const ren = await tool(path, 'update_workout', { workout: 'push day', name: 'Push heavy' }); assert.ok(ren.ok, ren.text); assert.equal(ren.data.workout.id, id); assert.equal(ren.data.workout.items.length, 6, 'items kept');
  const rep = await tool(path, 'update_workout', { workout: id, items: [{ exercise: 'incline', sets: 4, reps: 8, kg: 30 }, { exercise: 'lateral', sets: 3, reps: 15, kg: 8 }] });
  assert.ok(rep.ok); assert.deepEqual(rep.data.workout.items.map(i => i.exercise), ['incline', 'lateral']); assert.equal(rep.data.workout.name, 'Push heavy');
  const S = (await call('GET', '/api/watch/strength/setup', { bearer: watch })).j; assert.deepEqual(S.workouts.find(w => w.id === id).it.map(i => i[0]), ['incline', 'lateral'], 'the watch gets the change');
  for (const [args, re] of [[{ workout: 'Leg day', name: 'Y' }, /No workout "Leg day"\. The workouts: .*Push heavy.*Pull day/], [{ workout: id }, /Nothing to change/],
    [{ workout: id, name: 'pull DAY' }, /already a workout named/], [{ workout: id, items: [{ exercise: 'incline', sets: 4, reps: 101 }] }, /items\[0\] \(Incline bench press \(dumbbell\)\)\.reps: 1 to 100/]]) {
    const r = await tool(path, 'update_workout', args); assert.equal(r.ok, false); assert.match(r.text, re); }
  assert.equal((await tool(path, 'list_workouts', {})).data.workouts.find(w => w.id === id).items[1].reps, 15, 'a refused change stores nothing');
  const del = await tool(path, 'delete_workout', { workout: 'Pull Day' }); assert.ok(del.ok); assert.equal(del.data.name, 'Pull day'); assert.equal(del.data.left, 1);
  const again = await tool(path, 'delete_workout', { workout: 'Pull Day' }); assert.equal(again.ok, false); assert.match(again.text, /No workout/);
  assert.ok((await tool(path, 'delete_workout', { workout: id })).ok);
  assert.equal((await call('GET', '/api/watch/strength/setup', { bearer: watch })).j.workouts.length, 0, 'gone from the watch');
  assert.match((await tool(path, 'delete_workout', { workout: 'x' })).text, /There are no workouts yet/);
});
