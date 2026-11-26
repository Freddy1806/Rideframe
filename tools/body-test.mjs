// Body data + household scale API (tools/body-api.mjs) against a real serve.mjs on a free port with a temp data folder:
// auth and privacy (a second account never reads or changes the first one's data), validation, merge of repeats, prefs and the
// profile weight following the newest weigh-in, CSV import rows, the bridge's own auth (localhost + secret, no proxy headers),
// household create / code / join / owner rules, a P2 weigh-in from raw advertisements to the right member, "Was that you?".
// Usage: node --test tools/body-test.mjs   (no real data is touched)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv, base, DATA, SECRET, ipN = 0;
const call = async (method, p, { body, token, bearer, headers = {} } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-RF-Token': token } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j };
};
const pub = (m, p, o = {}) => call(m, p, { ...o, headers: { 'X-Forwarded-For': `10.8.0.${ipN++ & 255}`, ...(o.headers || {}) } }); // as through the public link
const register = async name => { const r = await pub('POST', '/api/account/register', { body: { name, email: name.replace(/\W/g, '') + '@example.org', password: 'secret-pw-1', password2: 'secret-pw-1' } }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.token; };
const day = 864e5, wait = ms => new Promise(r => setTimeout(r, ms));
let A, B, C;

before(async () => {
  DATA = await mkdtemp(join(tmpdir(), 'rf-body-test-'));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), UE_PORT: String(await free()), RIDEFRAME_DATA: DATA, RIDEFRAME_INVITE: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/account/ping'); break; } catch { await wait(100); } }
  A = await register('Freddy Scale'); B = await register('Riley Flat'); C = await register('Guest Gina');
  for (let i = 0; i < 30 && !SECRET; i++) { SECRET = (await readFile(join(DATA, 'scale-bridge.secret'), 'utf8').catch(() => '')).trim(); if (!SECRET) await wait(100); }
});
after(async () => { srv?.kill(); if (DATA) await rm(DATA, { recursive: true, force: true }); });

test('body data needs a login and stays private: B never sees or changes A\'s measurements', async () => {
  assert.equal((await pub('GET', '/api/body')).status, 401); assert.equal((await pub('POST', '/api/body', { body: { t: Date.now(), kg: 80 } })).status, 401);
  const a = await pub('POST', '/api/body', { token: A, body: { t: Date.now() - 2 * day, kg: '82,35', note: 'after the <b>holiday</b>' } });
  assert.equal(a.status, 200); assert.equal(a.j.m.kg, 82.35); assert.equal(a.j.m.src, 'manual'); assert.equal(a.j.m.note, 'after the bholiday/b'); assert.match(a.j.m.id, /^[0-9a-f]{12}$/);
  assert.equal((await pub('GET', '/api/body', { token: B })).j.list.length, 0, 'B: empty');
  assert.equal((await pub('PUT', '/api/body/' + a.j.m.id, { token: B, body: { kg: 50 } })).status, 404);
  assert.equal((await pub('DELETE', '/api/body/' + a.j.m.id, { token: B })).status, 404);
  const l = (await pub('GET', '/api/body', { token: A })).j.list; assert.equal(l.length, 1); assert.equal(l[0].kg, 82.35);
  const f = join(DATA, 'users'), st = await stat(join(f, (await readFile(join(DATA, 'accounts.json'), 'utf8')).match(/"freddy scale":\{[^}]*"id":"([0-9a-f]+)"/)[1], 'body.json')); assert.equal(st.mode & 0o777, 0o600);
});
test('validation, edit, delete, merge of a repeat within 3 min / 0.2 kg', async () => {
  for (const b of [{ t: Date.now(), kg: 5 }, { t: Date.now(), kg: 'x' }, { kg: 80 }, { t: Date.now() + 2 * day, kg: 80 }, { t: Date.now(), kg: 80, fatPct: 90 }])
    assert.equal((await pub('POST', '/api/body', { token: B, body: b })).status, 400, JSON.stringify(b));
  const t = Date.now() - day, x = await pub('POST', '/api/body', { token: B, body: { t, kg: 64.2 } }), y = await pub('POST', '/api/body', { token: B, body: { t: t + 60e3, kg: 64.3 } });
  assert.equal(y.j.m.id, x.j.m.id, 'the same weigh-in'); assert.equal((await pub('GET', '/api/body', { token: B })).j.list.length, 1);
  const e = await pub('PUT', '/api/body/' + x.j.m.id, { token: B, body: { kg: 64.1, fatPct: 24.5 } }); assert.equal(e.status, 200); assert.equal(e.j.m.kg, 64.1); assert.equal(e.j.m.fatPct, 24.5);
  assert.equal((await pub('PUT', '/api/body/' + x.j.m.id, { token: B, body: { kg: 999 } })).status, 400);
  assert.equal((await pub('DELETE', '/api/body/' + x.j.m.id, { token: B })).status, 200); assert.equal((await pub('GET', '/api/body', { token: B })).j.list.length, 0);
  assert.equal((await pub('DELETE', '/api/body/' + x.j.m.id, { token: B })).status, 404);
});
test('prefs; the profile weight follows the newest weigh-in unless turned off', async () => {
  assert.equal((await pub('PUT', '/api/body/prefs', { token: A, body: { goalKg: 5 } })).status, 400);
  const p = await pub('PUT', '/api/body/prefs', { token: A, body: { goalKg: 78.5, heightCm: 183 } }); assert.deepEqual(p.j.prefs, { goalKg: 78.5, heightCm: 183, follow: true, announce: false, sex: null, birthYear: null });
  await pub('POST', '/api/body', { token: A, body: { t: Date.now() - 60e3, kg: 81.9 } });
  let me = await pub('GET', '/api/account/me', { token: A }); assert.equal(me.j.settings.riderKg, 81.9); assert.ok(me.j.settingsAt > Date.now() - 10e3, 'newer, so the devices pull it');
  await pub('PUT', '/api/body/prefs', { token: A, body: { follow: false } }); await pub('POST', '/api/body', { token: A, body: { t: Date.now() - 30e3, kg: 81.5 } });
  me = await pub('GET', '/api/account/me', { token: A }); assert.equal(me.j.settings.riderKg, 81.9, 'off: unchanged');
  await pub('PUT', '/api/body/prefs', { token: A, body: { follow: true } }); me = await pub('GET', '/api/account/me', { token: A }); assert.equal(me.j.settings.riderKg, 81.5, 'on again: caught up');
  assert.equal((await pub('GET', '/api/body', { token: A })).j.prefs.goalKg, 78.5, 'kept');
});
test('prefs (26.11.): sex and birth year for the body-fat estimate, announce; validated, cleared with "", kept when missing', async () => {
  const y = new Date().getFullYear();
  for (const b of [{ sex: 'x' }, { sex: 1 }, { birthYear: 1899 }, { birthYear: y + 1 }, { birthYear: 1990.5 }, { birthYear: 'abc' }, { announce: 'yes' }])
    assert.equal((await pub('PUT', '/api/body/prefs', { token: A, body: b })).status, 400, JSON.stringify(b));
  assert.equal((await pub('PUT', '/api/body/prefs', { token: A, body: [1] })).status, 400, 'not an object');
  let p = await pub('PUT', '/api/body/prefs', { token: A, body: { sex: 'm', birthYear: '1993' } }); assert.equal(p.status, 200);
  assert.deepEqual(p.j.prefs, { goalKg: 78.5, heightCm: 183, follow: true, announce: false, sex: 'm', birthYear: 1993 });
  p = await pub('PUT', '/api/body/prefs', { token: A, body: { sex: '', birthYear: null } }); assert.equal(p.j.prefs.sex, null); assert.equal(p.j.prefs.birthYear, null); assert.equal(p.j.prefs.heightCm, 183, 'missing keys kept');
  p = await pub('PUT', '/api/body/prefs', { token: A, body: { sex: 'm', birthYear: 1993, announce: true } }); assert.equal(p.j.prefs.announce, true);
  assert.equal((await pub('PUT', '/api/body/prefs', { token: A, body: { birthYear: y } })).j.prefs.birthYear, y, 'this year is allowed');
  await pub('PUT', '/api/body/prefs', { token: A, body: { birthYear: 1993 } }); assert.equal((await pub('GET', '/api/body', { token: B })).j.prefs.sex, null, 'per account');
});
test('import rows: valid ones stored as import, broken ones counted', async () => {
  const rows = [...Array(20)].map((_, i) => ({ t: Date.now() - (40 - i) * day, kg: 83 - i * 0.05, fatPct: 22.1 })).concat([{ t: 'x', kg: 80 }, { t: Date.now(), kg: 2 }]);
  const r = await pub('POST', '/api/body/import', { token: A, body: { rows } }); assert.equal(r.status, 200); assert.equal(r.j.added, 20); assert.equal(r.j.skipped, 2);
  const again = await pub('POST', '/api/body/import', { token: A, body: { rows: rows.slice(0, 20) } }); assert.equal(again.j.added, 0, 'the same file twice adds nothing'); assert.equal(again.j.merged, 20);
  const l = (await pub('GET', '/api/body?from=' + (Date.now() - 45 * day) + '&to=' + (Date.now() - 30 * day), { token: A })).j.list; assert.ok(l.length >= 10 && l.every(m => m.src === 'import' && m.fatPct === 22.1));
  assert.equal((await pub('POST', '/api/body/import', { token: A, body: { rows: [{ t: 1, kg: 1 }] } })).status, 400);
});

/* ---- the bridge ---- */
const p2adv = (kg, fin = true) => { const b = Buffer.from('cfe8121833eecf51c00e29dcd69700000000e4', 'hex'), r = Math.round(kg * 100); b[9] = r & 255; b[10] = r >> 8; b[15] = fin ? 0 : 1; let x = 0; for (let i = 6; i < 18; i++) x ^= b[i]; b[18] = x;
  return '48ff' + b.toString('hex'); }; // a real P2 Pro frame (eufylife-ble-client#8) with another weight, checksum fixed up
const frame = (b, o = {}) => call('POST', '/api/scale/frame', { bearer: SECRET, body: b, ...o });
test('bridge calls: only from localhost with the secret, never through the public proxy', async () => {
  assert.match(SECRET, /^[A-Za-z0-9_-]{43}$/); assert.equal((await stat(join(DATA, 'scale-bridge.secret'))).mode & 0o777, 0o600);
  assert.equal((await call('POST', '/api/scale/frame', { body: { kind: 'hello', id: 'x' } })).status, 401);
  assert.equal((await call('POST', '/api/scale/frame', { bearer: 'y'.repeat(43), body: { kind: 'hello', id: 'x' } })).status, 401);
  assert.equal((await frame({ kind: 'hello', id: 'x' }, { headers: { 'X-Forwarded-For': '1.2.3.4' } })).status, 401, 'Tailscale Funnel comes from 127.0.0.1 too');
  assert.equal((await frame({ kind: 'hello', id: 'x' }, { token: A })).status, 200);
  assert.equal((await call('POST', '/api/scale/measure', { token: A, body: { key: 'mac:CFE8121833EE', kg: 80 } })).status, 401, 'a phone login is not the bridge');
  assert.equal((await frame({ kind: 'adv', id: 'periph-1', name: 'Some speaker', mfr: '4c000215' })).j.ignored, true);
});
test('household: create, 6-digit code, join, owner-only actions, add the scale the bridge hears', async () => {
  assert.equal((await pub('POST', '/api/scale/code', { token: A })).status, 409, 'no household yet');
  const h = await pub('POST', '/api/scale/household', { token: A, body: { name: 'Flat' } }); assert.equal(h.status, 200); assert.equal(h.j.household.owner, true); assert.equal(h.j.household.members, 1);
  assert.equal((await pub('POST', '/api/scale/household', { token: A })).status, 409);
  await frame({ kind: 'adv', id: 'periph-1', name: 'eufy T9149', mfr: p2adv(0), rssi: -61 });
  const v = await pub('GET', '/api/scale', { token: A }); assert.equal(v.j.bridge.online, true); assert.equal(v.j.found.length, 1); assert.equal(v.j.found[0].key, 'mac:CFE8121833EE'); assert.equal(v.j.found[0].model, 'T9149');
  const add = await pub('POST', '/api/scale/add', { token: A, body: { key: 'mac:CFE8121833EE' } }); assert.equal(add.status, 200); assert.equal(add.j.household.scales[0].name, 'Smart Scale P2 Pro'); assert.equal(add.j.found.length, 0);
  assert.equal((await pub('POST', '/api/scale/add', { token: A, body: { key: 'mac:000000000000' } })).status, 404);
  const c = await pub('POST', '/api/scale/code', { token: A }); assert.match(c.j.code, /^\d{6}$/); assert.ok(!(await readFile(join(DATA, 'scales.json'), 'utf8')).includes(c.j.code), 'only a hash');
  const wrong = String((+c.j.code + 1) % 1e6).padStart(6, '0'); assert.equal((await pub('POST', '/api/scale/join', { token: B, body: { code: wrong } })).status, 401);
  assert.equal((await pub('POST', '/api/scale/join', { token: B, body: { code: '12' } })).status, 400);
  const j = await pub('POST', '/api/scale/join', { token: B, body: { code: c.j.code } }); assert.equal(j.status, 200); assert.equal(j.j.household.members, 2); assert.equal(j.j.household.owner, false);
  assert.equal((await pub('POST', '/api/scale/join', { token: C, body: { code: c.j.code } })).status, 401, 'single use');
  assert.equal((await pub('POST', '/api/scale/code', { token: B })).status, 403); assert.equal((await pub('DELETE', '/api/scale/scales/' + add.j.household.scales[0].id, { token: B })).status, 403);
  assert.equal((await pub('GET', '/api/scale', { token: B })).j.found.length, 0, 'members do not get the list of other scales');
  const view = JSON.stringify((await pub('GET', '/api/scale', { token: B })).j); assert.ok(!/Freddy|riderKg|kg"?:\s*8/.test(view), 'no names or weights of others');
});
test('a P2 weigh-in from raw advertisements goes to the member it clearly belongs to; nobody else sees it', async () => {
  for (const [tok, kg] of [[B, 64.1], [B, 64.3]]) await pub('POST', '/api/body', { token: tok, body: { t: Date.now() - (kg > 64.2 ? 1 : 2) * day, kg } });
  const before = (await pub('GET', '/api/body', { token: A })).j.list.length;
  for (const kg of [81.2, 81.85]) await frame({ kind: 'adv', id: 'periph-1', mfr: p2adv(kg, false) }); // live frames first
  for (let i = 0; i < 3; i++) { await frame({ kind: 'adv', id: 'periph-1', mfr: p2adv(81.85) }); await wait(300); }
  let l = []; for (let i = 0; i < 30; i++) { l = (await pub('GET', '/api/body', { token: A })).j.list; if (l.length > before) break; await wait(300); }
  assert.equal(l.length, before + 1, 'one weigh-in, one measurement'); const m = l.find(x => x.src === 'scale'); assert.equal(m.kg, 81.85); assert.match(m.scaleId, /^[0-9a-f]{12}$/); assert.equal(m.hr, 81);
  assert.ok(!(await pub('GET', '/api/body', { token: B })).j.list.some(x => x.src === 'scale'), 'not in Riley\'s data'); assert.equal((await pub('GET', '/api/body', { token: B })).j.prompts.length, 0, 'not asked either');
  assert.ok((await pub('GET', '/api/scale', { token: A })).j.household.scales[0].lastAt > Date.now() - 30e3, 'last measurement time');
});
test('"Was that you?": an unclear weigh-in is asked to every member; Yes makes it theirs, No hides it; nobody sees whose it became', async () => {
  const r = await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:CFE8121833EE', kg: 73.4 } }); assert.equal(r.j.auto, false); assert.equal(r.j.reason, 'nobody near');
  const pa = (await pub('GET', '/api/body', { token: A })).j.prompts, pb = (await pub('GET', '/api/body', { token: B })).j.prompts;
  assert.equal(pa.length, 1); assert.deepEqual(Object.keys(pa[0]).sort(), ['id', 'kg', 't']); assert.equal(pb[0].id, pa[0].id);
  assert.equal((await pub('GET', '/api/body', { token: C })).j.prompts.length, 0, 'not in the household: never asked');
  assert.equal((await pub('POST', '/api/body/prompts/' + pa[0].id, { token: C, body: { mine: true } })).status, 404);
  assert.equal((await pub('POST', '/api/body/prompts/' + pa[0].id, { token: A, body: { mine: false } })).status, 200);
  assert.equal((await pub('GET', '/api/body', { token: A })).j.prompts.length, 0, 'No: hidden for Freddy'); assert.equal((await pub('GET', '/api/body', { token: B })).j.prompts.length, 1, 'still asked to Riley');
  assert.equal((await pub('POST', '/api/body/prompts/' + pa[0].id, { token: B, body: { mine: true } })).j.answer, 'yes');
  assert.ok((await pub('GET', '/api/body', { token: B })).j.list.some(m => m.kg === 73.4 && m.src === 'scale'), 'Riley\'s now');
  assert.ok(!(await pub('GET', '/api/body', { token: A })).j.list.some(m => m.kg === 73.4));
  assert.equal((await pub('POST', '/api/body/prompts/' + pa[0].id, { token: A, body: { mine: true } })).status, 404, 'gone');
  // two "No" = nobody's; an old one expires after 48 h
  await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:CFE8121833EE', kg: 101 } }); const q = (await pub('GET', '/api/body', { token: A })).j.prompts[0];
  await pub('POST', '/api/body/prompts/' + q.id, { token: A, body: { mine: false } }); await pub('POST', '/api/body/prompts/' + q.id, { token: B, body: { mine: false } });
  assert.ok(!JSON.parse(await readFile(join(DATA, 'scales.json'), 'utf8')).pending.some(p => p.id === q.id), 'nobody\'s: dropped');
  await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:CFE8121833EE', kg: 120 } });
  const f = join(DATA, 'scales.json'), S = JSON.parse(await readFile(f, 'utf8')); for (const p of S.pending) p.exp = Date.now() - 1; await writeFile(f, JSON.stringify(S));
  assert.equal((await pub('GET', '/api/body', { token: B })).j.prompts.length, 0, 'expired');
  assert.equal((await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:0000000000AA', kg: 80 } })).j.stored, false, 'a scale no household added: dropped');
});
/* ---- 26.11.: the C20 impedance through the frame path, the weigh-in hook ---- */
const c20 = (hex, kg) => { const b = Buffer.from(hex, 'hex'), r = Math.round(kg * 100); b[12] = r & 255; b[13] = r >> 8; return '64bc' + b.toString('hex'); }; // Freddy's frames, weight set to his history here
const C20LOCK = '0fb7030da20063cb076b2500942000000000', C20END = '0fb7030da20063cb076b2580942000000041141e14850000';
let hookSrv, hookPort, hits = [];
const hookFile = o => writeFile(join(DATA, 'weigh-hook.json'), JSON.stringify(o));
const uidOf = async name => (await readFile(join(DATA, 'accounts.json'), 'utf8')).match(new RegExp(`"${name}":\\{[^}]*"id":"([0-9a-f]+)"`))[1];
const waitHits = async (n, ms = 3000) => { for (let i = 0; i < ms / 100 && hits.length < n; i++) await wait(100); };
test('C20 frames: lock, 5 s of measuring, the END frame with the impedance -> one weigh-in that keeps 518.5 Ω and x; the hook fires once', async () => {
  const { createServer } = await import('node:http'); hookPort = await free();
  hookSrv = createServer((req, res) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { hits.push({ url: req.url, headers: req.headers, body: JSON.parse(d || '{}') }); res.end('{}'); }); }).listen(hookPort, '127.0.0.1');
  await writeFile(join(DATA, 'hook.token'), '  s3cret-token\n'); await hookFile({ url: `http://127.0.0.1:${hookPort}/weigh`, header: 'X-Gary-Token', tokenFile: join(DATA, 'hook.token') });
  await pub('PUT', '/api/body/prefs', { token: A, body: { heightCm: 183, sex: 'm', birthYear: 1993, announce: true } });
  await frame({ kind: 'adv', id: 'periph-c20', name: 'eufy T9130', mfr: c20(C20LOCK, 0) });
  const add = await pub('POST', '/api/scale/add', { token: A, body: { key: 'mac:BC0FB7030DA2' } }); assert.equal(add.status, 200, JSON.stringify(add.j));
  const before = (await pub('GET', '/api/body', { token: A })).j.list, prev = before.reduce((a, m) => !a || m.t > a.t ? m : a, null);
  await frame({ kind: 'adv', id: 'periph-c20', mfr: c20(C20LOCK, 82.6) }); await wait(5000); // longer than SETTLE (4 s): the old code emitted here, without the impedance
  await frame({ kind: 'adv', id: 'periph-c20', mfr: c20(C20END, 82.6) }); await frame({ kind: 'adv', id: 'periph-c20', mfr: c20(C20END, 82.6) }); // the scale repeats
  let l = []; for (let i = 0; i < 30; i++) { l = (await pub('GET', '/api/body', { token: A })).j.list; if (l.length > before.length) break; await wait(200); }
  const m = l.filter(x => x.src === 'scale' && x.kg === 82.6); assert.equal(m.length, 1, 'one weigh-in'); assert.equal(m[0].impedance, 518.5); assert.equal(m[0].x, '1e1485');
  await waitHits(1); await wait(500); assert.equal(hits.length, 1, 'exactly one POST');
  const { compOf } = await import('../js/bodycomp.js'), h = hits[0];
  assert.equal(h.url, '/weigh'); assert.equal(h.headers['x-gary-token'], 's3cret-token', 'trimmed token in the configured header');
  assert.deepEqual(h.body, { account: await uidOf('freddy scale'), name: 'Freddy Scale', kg: 82.6, deltaKg: Math.round((82.6 - prev.kg) * 100) / 100, bodyFatPct: compOf(m[0], { heightCm: 183, sex: 'm', birthYear: 1993 }).fatPct, at: new Date(m[0].t).toISOString() });
  assert.equal(typeof h.body.bodyFatPct, 'number');
  assert.ok(!(await readFile(join(DATA, 'scales.json'), 'utf8')).includes('s3cret'), 'the token is not copied into the data');
  assert.ok(!JSON.stringify((await pub('GET', '/api/body', { token: A })).j).includes('s3cret'), 'nor into any answer');
});
test('hook: not for an account without announce, not to a non-local URL, not without a readable token; the weigh-in is stored anyway', async () => {
  hits = []; const t0 = Date.now();
  const r = await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:BC0FB7030DA2', kg: 64.2, t: t0 - 30 * 60e3 } }); assert.equal(r.j.uid, await uidOf('riley flat'), JSON.stringify(r.j));
  await wait(800); assert.equal(hits.length, 0, 'Riley did not opt in');
  await hookFile({ url: `http://example.org:${hookPort}/weigh` });
  assert.equal((await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:BC0FB7030DA2', kg: 81.7, t: t0 - 20 * 60e3 } })).j.stored, true); await wait(800); assert.equal(hits.length, 0, 'non-local URL ignored');
  await hookFile({ url: `http://127.0.0.1:${hookPort}/weigh`, header: 'X-Gary-Token', tokenFile: join(DATA, 'nope.token') });
  assert.equal((await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:BC0FB7030DA2', kg: 81.75, t: t0 - 12 * 60e3 } })).j.stored, true); await wait(800); assert.equal(hits.length, 0, 'unreadable token file: skipped');
  await hookFile({ url: `http://localhost:${hookPort}/weigh` });
  assert.equal((await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:BC0FB7030DA2', kg: 81.65, t: t0 - 6 * 60e3 } })).j.stored, true); await waitHits(1);
  assert.equal(hits.length, 1, 'localhost works, without a token'); assert.equal(hits[0].body.kg, 81.65); assert.equal(hits[0].body.bodyFatPct, null, 'no impedance: null'); assert.equal(hits[0].headers['x-gary-token'], undefined);
  await new Promise(r => hookSrv.close(r)); const s0 = Date.now(); // the target is down now
  const d = await call('POST', '/api/scale/measure', { bearer: SECRET, body: { key: 'mac:BC0FB7030DA2', kg: 81.6, t: t0 - 60e3 } }); assert.equal(d.j.stored, true); assert.ok(Date.now() - s0 < 1500, 'not delayed by the dead hook');
  assert.ok((await pub('GET', '/api/body', { token: A })).j.list.some(m => m.kg === 81.6 && m.src === 'scale'));
  for (const kg of [81.7, 81.75]) assert.ok((await pub('GET', '/api/body', { token: A })).j.list.some(m => m.kg === kg), kg + ' stored');
});
test('leaving: the owner role passes on; the last one out frees the scale', async () => {
  assert.equal((await pub('POST', '/api/scale/leave', { token: A })).j.household, null);
  const b = await pub('GET', '/api/scale', { token: B }); assert.equal(b.j.household.owner, true); assert.equal(b.j.household.members, 1);
  await pub('POST', '/api/scale/leave', { token: B });
  await frame({ kind: 'adv', id: 'periph-1', mfr: p2adv(0) }); assert.ok((await pub('GET', '/api/scale', { token: C })).j.found.some(f => f.key === 'mac:CFE8121833EE'), 'free again');
});
