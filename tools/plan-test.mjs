// The Today page's server side (25.11.) against a real serve.mjs on a free port with a temp data folder: the card layout per
// account (tools/home-api.mjs, and the whole-settings upload keeping the newer one), the training plan API (tools/plan-api.mjs:
// add, edit, delete, done / undo, auto-match with finished activities, validation, account isolation) and the Claude connector's
// plan tools (list_plan, plan_session, update_plan, delete_plan) incl. account isolation.
// Usage: node --test tools/plan-test.mjs   (no real data is touched)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { dayKey, addDays, monday } from '../js/planlib.js';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv, base, DATA, ipN = 0;
const ip = () => `10.9.${ipN >> 8}.${ipN++ & 255}`;
const call = async (method, p, { body, token, headers = {} } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip(), ...(token ? { 'X-RF-Token': token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
};
const register = async name => { const r = await call('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.token; };
let rid = 0;
const tool = async (path, name, args) => {
  const r = await call('POST', path, { headers: { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: { jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } } });
  assert.equal(r.status, 200, r.text); assert.ok(r.j.result, r.text); return { ok: !r.j.result.isError, text: r.j.result.content[0].text, data: r.j.result.structuredContent };
};
const today = dayKey(Date.now()), at = (d, h) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), h).getTime();

before(async () => {
  DATA = await mkdtemp(join(tmpdir(), 'rf-plan-test-'));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
after(async () => { srv?.kill(); if (DATA) await rm(DATA, { recursive: true, force: true }); });

test('card layout: per account, the newer one wins, a settings upload never takes it back', async () => {
  const A = await register('Home Hanna'), B = await register('Home Ben');
  assert.equal((await call('GET', '/api/account/home')).status, 401);
  assert.deepEqual((await call('GET', '/api/account/home', { token: A })).j, { layout: null });
  const L1 = { v: 1, at: 1000, cards: [{ id: 'fitness', size: 'full' }, { id: 'today', size: 'half' }], hidden: ['records'] };
  let r = await call('PUT', '/api/account/home', { token: A, body: { layout: L1 } }); assert.equal(r.status, 200); assert.equal(r.j.saved, true); assert.equal(r.j.layout.cards[0].id, 'fitness');
  r = await call('PUT', '/api/account/home', { token: A, body: { layout: { ...L1, at: 500, cards: [{ id: 'last', size: 'full' }] } } });
  assert.equal(r.j.saved, false, 'an older one is not stored'); assert.equal(r.j.layout.at, 1000, 'and the newer comes back');
  assert.equal((await call('PUT', '/api/account/home', { token: A, body: { layout: { at: 2000, cards: [{ id: 'Bad id', size: 'half' }] } } })).status, 400);
  assert.equal((await call('PUT', '/api/account/home', { token: A, body: { layout: { at: 2000, cards: [{ id: 'x', size: 'half' }, { id: 'x', size: 'half' }] } } })).status, 400);
  assert.deepEqual((await call('GET', '/api/account/home', { token: B })).j, { layout: null }, 'another account sees nothing');
  // a device with older settings uploads them all: the arrangement stays, the other settings change
  await call('PUT', '/api/account/settings', { token: A, body: { settings: { ftp: 260, homeCards: { at: 10, cards: [{ id: 'last', size: 'full' }] } }, at: Date.now() } });
  const s = await call('GET', '/api/account/me', { token: A }); assert.equal(s.j.settings.ftp, 260); assert.equal(s.j.settings.homeCards.at, 1000);
  await call('PUT', '/api/account/settings', { token: A, body: { settings: { ftp: 270 }, at: Date.now() + 5 } });
  assert.equal((await call('GET', '/api/account/home', { token: A })).j.layout.at, 1000, 'an upload without it keeps it');
  r = await call('PUT', '/api/account/home', { token: A, body: { layout: { at: 3000, def: true } } }); assert.equal(r.j.saved, true);
  assert.deepEqual((await call('GET', '/api/account/home', { token: A })).j.layout, { v: 1, at: 3000, def: true }, 'reset: stored as the default');
  assert.equal((await call('GET', '/api/account/me', { token: A })).j.settings.ftp, 270, 'the other settings stay');
});

test('plan API: add, list, edit, done / undo, delete, validation, per account', async () => {
  const A = await register('Plan Paula'), B = await register('Plan Paul');
  assert.equal((await call('GET', '/api/account/plan')).status, 401);
  let r = await call('POST', '/api/account/plan', { token: A, body: { day: today, kind: 'ride', title: 'Sweet spot 3 × 10', ref: 'ss3x10', minutes: 70, note: 'Steady.' } });
  assert.equal(r.status, 200, r.text); const e1 = r.j.entry; assert.match(e1.id, /^p[0-9a-z]{6,30}$/); assert.equal(e1.title, 'Sweet spot 3 × 10'); assert.equal(e1.ref, 'ss3x10'); assert.ok(!('by' in e1), 'planned by the user');
  const e2 = (await call('POST', '/api/account/plan', { token: A, body: { day: addDays(today, 2), kind: 'rest' } })).j.entry; assert.equal(e2.title, 'Rest day');
  const far = (await call('POST', '/api/account/plan', { token: A, body: { day: addDays(monday(today), 20), kind: 'run' } })).j.entry;
  for (const b of [{ day: 'tomorrow', kind: 'ride' }, { day: today, kind: 'swim' }, { day: today, kind: 'ride', minutes: 9999 }, { day: today, kind: 'ride', evil: 1 }])
    assert.equal((await call('POST', '/api/account/plan', { token: A, body: b })).status, 400, JSON.stringify(b));
  let l = (await call('GET', '/api/account/plan', { token: A })).j.entries; assert.deepEqual(l.map(e => e.id), [e1.id, e2.id], 'default: this week and next, by day');
  l = (await call('GET', `/api/account/plan?from=${today}&to=${addDays(monday(today), 21)}`, { token: A })).j.entries; assert.equal(l.length, 3);
  assert.equal((await call('GET', `/api/account/plan?from=${today}&to=${addDays(today, 100)}`, { token: A })).status, 400, 'at most 92 days');
  assert.equal((await call('GET', `/api/account/plan?from=${today}&to=${addDays(today, -1)}`, { token: A })).status, 400);
  // edit
  r = await call('PUT', '/api/account/plan/' + e1.id, { token: A, body: { minutes: 80, note: null } }); assert.equal(r.status, 200); assert.equal(r.j.entry.minutes, 80); assert.ok(!('note' in r.j.entry));
  assert.equal((await call('PUT', '/api/account/plan/' + e1.id, { token: A, body: {} })).status, 400, 'nothing to change');
  assert.equal((await call('PUT', '/api/account/plan/pnothere1', { token: A, body: { minutes: 5 } })).status, 404);
  // another account: nothing to see, nothing to change
  assert.deepEqual((await call('GET', '/api/account/plan', { token: B })).j.entries, []);
  assert.equal((await call('PUT', '/api/account/plan/' + e1.id, { token: B, body: { minutes: 5 } })).status, 404);
  assert.equal((await call('DELETE', '/api/account/plan/' + e1.id, { token: B })).status, 404);
  assert.equal((await call('POST', `/api/account/plan/${e1.id}/done`, { token: B, body: { activity: 'x1' } })).status, 404);
  // done by hand, undo
  r = await call('POST', `/api/account/plan/${e1.id}/done`, { token: A, body: { activity: 'r-manual' } }); assert.equal(r.j.entry.done, 'r-manual');
  assert.equal((await call('POST', `/api/account/plan/${e1.id}/done`, { token: A, body: { activity: 'bad id!' } })).status, 400);
  r = await call('POST', `/api/account/plan/${e1.id}/done`, { token: A, body: { activity: null } }); assert.ok(!('done' in r.j.entry)); assert.ok(r.j.entry.undone > 0);
  // delete
  assert.equal((await call('DELETE', '/api/account/plan/' + far.id, { token: A })).status, 200);
  assert.equal((await call('DELETE', '/api/account/plan/' + far.id, { token: A })).status, 404);
  assert.equal((await call('GET', '/api/account/plan/whatever', { token: A })).status, 404);
});

test('plan API: a finished activity of the same day and kind marks the entry done; undone by hand stays open', async () => {
  const A = await register('Match Mona');
  const y = addDays(today, -1);
  const pr = (await call('POST', '/api/account/plan', { token: A, body: { day: y, kind: 'ride' } })).j.entry;
  const ps = (await call('POST', '/api/account/plan', { token: A, body: { day: y, kind: 'strength' } })).j.entry;
  const pn = (await call('POST', '/api/account/plan', { token: A, body: { day: y, kind: 'run' } })).j.entry;
  assert.equal((await call('PUT', '/api/account/rides/rm1', { token: A, body: { id: 'rm1', routeId: 'pure', date: at(y, 9), duration: 3600, distance: 30000, complete: true } })).status, 200);
  assert.equal((await call('PUT', '/api/account/kraft/km1', { token: A, body: { id: 'km1', name: 'Push', start: at(y, 18), date: at(y, 19), dur: 2400, ex: [{ k: 'bench', n: 'Bench press', t: 'w', sets: [{ kg: 80, r: 5, done: true }] }] } })).status, 200);
  const l = (await call('GET', `/api/account/plan?from=${y}&to=${today}`, { token: A })).j.entries, by = id => l.find(e => e.id === id);
  assert.equal(by(pr.id).done, 'rm1'); assert.equal(by(pr.id).auto, true); assert.equal(by(ps.id).done, 'km1'); assert.ok(!by(pn.id).done, 'no run that day');
  await call('POST', `/api/account/plan/${pr.id}/done`, { token: A, body: { activity: null } });
  const l2 = (await call('GET', `/api/account/plan?from=${y}&to=${today}`, { token: A })).j.entries;
  assert.ok(!l2.find(e => e.id === pr.id).done, 'undone by hand: not matched again');
});

test('Claude connector: plan tools, stored as the coach\'s, per account', async () => {
  const A = await register('Coach Cleo'), B = await register('Coach Carl');
  const pa = (await call('POST', '/api/account/mcp', { token: A, body: {} })).j.path, pb = (await call('POST', '/api/account/mcp', { token: B, body: {} })).j.path;
  let t = await tool(pa, 'list_plan', {}); assert.ok(t.ok, t.text); assert.equal(t.data.count, 0); assert.match(t.data.hint, /Nothing planned/); assert.equal(t.data.from, today);
  t = await tool(pa, 'plan_session', { day: addDays(today, 1), kind: 'strength', title: 'Push day', ref: 'w1', minutes: 50, note: 'Bench 4 × 6.' });
  assert.ok(t.ok, t.text); const e = t.data.entry; assert.equal(e.by, 'coach'); assert.equal(e.kind, 'strength'); assert.equal(e.ref, 'w1');
  const app = (await call('GET', '/api/account/plan', { token: A })).j.entries; assert.equal(app.length, 1, 'the app sees it'); assert.equal(app[0].id, e.id);
  t = await tool(pa, 'plan_session', { day: 'someday', kind: 'ride' }); assert.equal(t.ok, false); assert.match(t.text, /day/);
  t = await tool(pa, 'plan_session', { day: today, kind: 'swim' }); assert.equal(t.ok, false);
  t = await tool(pa, 'update_plan', { id: e.id, minutes: 60, note: '' }); assert.ok(t.ok, t.text); assert.equal(t.data.entry.minutes, 60); assert.ok(!('note' in t.data.entry));
  t = await tool(pa, 'list_plan', { from: today, to: addDays(today, 3) }); assert.equal(t.data.count, 1);
  t = await tool(pa, 'list_plan', { from: today, to: addDays(today, 200) }); assert.equal(t.ok, false); assert.match(t.text, /92/);
  // the other account's link: neither sees nor changes it
  t = await tool(pb, 'list_plan', {}); assert.equal(t.data.count, 0);
  t = await tool(pb, 'update_plan', { id: e.id, minutes: 5 }); assert.equal(t.ok, false); assert.match(t.text, /No plan entry/);
  t = await tool(pb, 'delete_plan', { id: e.id }); assert.equal(t.ok, false);
  assert.equal((await call('GET', '/api/account/plan', { token: A })).j.entries[0].minutes, 60);
  t = await tool(pa, 'delete_plan', { id: e.id }); assert.ok(t.ok, t.text); assert.equal(t.data.deleted, true); assert.equal(t.data.title, 'Push day');
  assert.deepEqual((await call('GET', '/api/account/plan', { token: A })).j.entries, []);
});
