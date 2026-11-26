// Body data and the household scale (25.11., owner: eufy scale every morning, values into RIDEFRAME automatically, flatmate Riley too).
// Served by serve.mjs. Phone / browser side (signed in, X-RF-Token like the watch config):
//   GET    /api/body[?from=ms&to=ms]       -> { list, prefs, prompts, at }        the account's own measurements only
//   POST   /api/body                       -> { ok, m }      add one by hand { t, kg, fatPct?, …, note? }
//   PUT    /api/body/<id> · DELETE /api/body/<id>
//   PUT    /api/body/prefs                 -> { ok, prefs }  { goalKg, heightCm, sex: 'm'|'f', birthYear, follow }   follow = the profile weight follows
//                                                            the newest weigh-in; '' or null clears a value, a missing key keeps it
//   POST   /api/body/import                -> { ok, added, merged, skipped }   { rows: [{ t, kg, … }] } (CSV parsed by js/bodylib.js)
//   POST   /api/body/prompts/<id>          -> { ok }         { mine: true | false }   "82.4 kg at 07:12 · Was that you?"
//   GET    /api/scale                      -> household (members count, scales, bridge status) and the scales the bridge hears
//   POST   /api/scale/household · /api/scale/code · /api/scale/join { code } · /api/scale/leave · /api/scale/add { key }
//   PUT    /api/scale/scales/<id> { name?, bia? } · DELETE /api/scale/scales/<id>      (owner)
// Scale bridge side (tools/scale-bridge/, on the same Mac): only from 127.0.0.1 without proxy headers, "Authorization: Bearer <secret>"
// with the secret from <data>/scale-bridge.secret (made here on the first start, 0600):
//   POST   /api/scale/frame    raw advertisement / notification -> decoded here (tools/scale-decode.mjs); answer { connect?, write? }
//   POST   /api/scale/measure  an already decoded weigh-in { key | id, kg, t?, impedance?, hr? } (other bridges, --replay)
// Storage: users/<id>/body.json { list, prefs, at } (private, 0600 like every account file); <data>/scales.json for households, scales,
// join codes (hashes) and the open questions. Members never see each other's values; an open question shows only its own weight and time.
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { accountOf, userByKey, shared } from './accounts-api.mjs';
import { validate, merge, LIM } from '../js/bodylib.js';
import { assign } from './body-assign.mjs';
import { compOf } from '../js/bodycomp.js';
import * as D from './scale-decode.mjs';

const { DATA, readJSON, writeJSON, send, body, limited, clientIp, userDir, sha } = shared;
const SF = join(DATA, 'scales.json'), SECRET = join(DATA, 'scale-bridge.secret'), HOOK = join(DATA, 'weigh-hook.json');
const CODE_MS = 10 * 60e3, ASK_MS = 48 * 3600e3, MAX_MEMBERS = 8, MAX_SCALES = 4, FOUND_MS = 10 * 60e3;
const VERBOSE = !!process.env.RIDEFRAME_SCALE_LOG;
const log = (...a) => { if (VERBOSE) console.log('[scale]', ...a); };
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);

/* ---- per account: body.json, one write at a time ---- */
const bodyFile = uid => join(userDir(uid), 'body.json');
const ulocks = new Map();
function withUser(uid, fn) { const run = (ulocks.get(uid) || Promise.resolve()).then(fn); const tail = run.catch(() => {}); ulocks.set(uid, tail);
  tail.then(() => { if (ulocks.get(uid) === tail) ulocks.delete(uid); }); return run; }
// sex and birthYear (26.11.): only for the body-composition estimate (js/bodycomp.js: the formula is per sex, the age bounds its validity)
const PREFS = p => ({ goalKg: p?.goalKg >= 20 && p?.goalKg <= 300 ? Math.round(p.goalKg * 10) / 10 : null, heightCm: p?.heightCm >= 100 && p?.heightCm <= 250 ? Math.round(p.heightCm) : null, follow: p?.follow !== false,
  announce: p?.announce === true, // the weigh-in hook may say this account's weigh-ins out loud (own opt-in per housemate, default off)
  sex: p?.sex === 'm' || p?.sex === 'f' ? p.sex : null, birthYear: p?.birthYear != null && Number.isInteger(+p.birthYear) && +p.birthYear >= 1900 && +p.birthYear <= new Date().getFullYear() ? +p.birthYear : null });
async function bodyOf(uid) { const f = await readJSON(bodyFile(uid), null); return { list: Array.isArray(f?.list) ? f.list : [], prefs: PREFS(f?.prefs), at: +f?.at || 0 }; }
const newId = () => randomBytes(6).toString('hex');
/** adds measurements to an account (merging repeats), then lets the profile weight follow the newest one. Returns { added, merged, ids } */
function addTo(uid, ms) {
  return withUser(uid, async () => {
    const b = await bodyOf(uid); let list = b.list, added = 0, merged = 0; const ids = [];
    for (const m0 of ms) { if (list.length >= LIM.count) break; const r = merge(list, { id: newId(), ...m0 }); list = r.list; ids.push(r.id); r.merged ? merged++ : added++; }
    await writeJSON(bodyFile(uid), { list, prefs: b.prefs, at: Date.now() });
    if (b.prefs.follow) await follow(uid, list);
    return { added, merged, ids, prefs: b.prefs, before: b.list };
  });
}
/** the profile weight (settings.riderKg, used for W/kg, the trainer and the climbing speed) = the newest weigh-in */
async function follow(uid, list) {
  const last = list.reduce((a, m) => !a || m.t > a.t ? m : a, null); if (!last) return;
  const f = join(userDir(uid), 'settings.json'), s = await readJSON(f, null), st = { ...(s?.settings || {}) };
  if (st.riderKg === last.kg && st.riderKgAt === last.t) return;
  st.riderKg = last.kg; st.riderKgAt = last.t; await writeJSON(f, { settings: st, at: Date.now() });
}

/* ---- the weigh-in hook (26.11.): the owner's voice assistant on the same Mac says a finished weigh-in out loud ----
 * <data>/weigh-hook.json = { "url": "http://127.0.0.1:<port>/<path>", "header"?, "tokenFile"? } (optional; no file = no hook). Only http to 127.0.0.1 /
 * localhost: weights must not leave the machine through a typo. The file is read when needed (re-read when its mtime changes), so it
 * works without a restart. One POST per NEW scale weigh-in that has an owner (auto-assigned, or "Yes, me"), only for accounts with
 * prefs.announce: { account, name, kg, deltaKg (vs the previous weigh-in, null when none), bodyFatPct (est., null), at (ISO) }.
 * Fire-and-forget, 2 s timeout: a dead hook never delays or fails the weigh-in. A merged repeat (the scale repeats itself) is no
 * new weigh-in, so it is not announced again. */
// A receiver that wants a secret: "header": "X-Some-Token" + "tokenFile": "/abs/path". The token is read from that file at send time
// (trimmed) and only ever goes into that header: never logged, never copied into the data folder or any answer. Unreadable = no POST.
let hookC = { mt: -1, cfg: null }, hookWarned = '';
async function hookCfg() {
  const st = await stat(HOOK).catch(() => null); if (!st) { hookC = { mt: -1, cfg: null }; return null; }
  if (st.mtimeMs === hookC.mt) return hookC.cfg;
  const f = await readJSON(HOOK, null), raw = String(f?.url ?? ''); let url = null;
  try { const u = new URL(raw); if (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && !u.username && !u.password) url = u.href; } catch {}
  if (!url && hookWarned !== raw) { hookWarned = raw; console.log('[scale] weigh-hook.json ignored: the url must be http://127.0.0.1:… or http://localhost:…'); }
  const header = typeof f?.header === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(f.header) ? f.header : null, tokenFile = typeof f?.tokenFile === 'string' && f.tokenFile.startsWith('/') ? f.tokenFile : null;
  hookC = { mt: st.mtimeMs, cfg: url ? { url, header: header && tokenFile ? header : null, tokenFile: header && tokenFile ? tokenFile : null } : null }; return hookC.cfg;
}
/** after a new scale weigh-in m landed in account uid (a = addTo's result); never throws, never awaited by the caller */
function announce(uid, key, m, a) {
  if (!a?.prefs?.announce || a.merged || !a.added) return;
  (async () => {
    const cfg = await hookCfg(); if (!cfg) return; const headers = { 'Content-Type': 'application/json' };
    if (cfg.header) { const tok = (await readFile(cfg.tokenFile, 'utf8').catch(() => '')).trim(); if (!tok) { console.log('[scale] weigh-hook: token file not readable or empty, nothing sent'); return; } headers[cfg.header] = tok; }
    const prev = (a.before || []).filter(x => x.t < m.t).reduce((p, x) => !p || x.t > p.t ? x : p, null), u = await userByKey(key).catch(() => null);
    const body = { account: uid, name: u?.name || '', kg: m.kg, deltaKg: prev ? Math.round((m.kg - prev.kg) * 100) / 100 : null, bodyFatPct: compOf(m, a.prefs)?.fatPct ?? null, at: new Date(m.t).toISOString() };
    const r = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) }); log('weigh-hook', r.status);
  })().catch(e => log('weigh-hook failed:', e?.name || 'error')); // the name only: an error message could carry a header value
}

/* ---- scales.json: households, scales, codes, open questions ---- */
let slock = Promise.resolve();
const EMPTY = () => ({ households: {}, scales: {}, codes: {}, pending: [] });
function withS(fn) { const run = slock.then(async () => { const S = { ...EMPTY(), ...(await readJSON(SF, null) || {}) }; return fn(S); }); slock = run.catch(() => {}); return run; }
const saveS = S => writeJSON(SF, S);
/** the household an account belongs to: [hid, h] or null; members whose account is gone are dropped */
async function homeOf(S, uid) {
  for (const [hid, h] of Object.entries(S.households)) if (h.members.some(m => m.uid === uid)) return [hid, h];
  return null;
}
async function prune(S) { // accounts deleted since: out of their household; empty households go, their scales are free again
  let ch = false; const now = Date.now();
  for (const [hid, h] of Object.entries(S.households)) {
    const keep = []; for (const m of h.members) { const u = await userByKey(m.key); if (u && u.id === m.uid) keep.push(m); else ch = true; }
    h.members = keep; if (!keep.length) { delete S.households[hid]; for (const s of Object.values(S.scales)) if (s.hid === hid) delete S.scales[s.key]; ch = true; continue; }
    if (!keep.some(m => m.uid === h.owner)) { h.owner = keep[0].uid; ch = true; }
  }
  const n = S.pending.length; S.pending = S.pending.filter(p => p.exp > now && S.households[p.hid]); if (S.pending.length !== n) ch = true;
  for (const [k, c] of Object.entries(S.codes)) if (!(c.exp > now) || !S.households[c.hid]) { delete S.codes[k]; ch = true; }
  return ch;
}

/* ---- the bridge: what it hears (in memory; the bridge repeats itself every 30 s) ---- */
const bridge = { lastSeen: 0, version: '', ip: '' };
const periph = new Map(); // bridge peripheral id -> { name, model, mac, sess, connected, connAt, auth, key }
const live = new Map();   // scale key -> { key, model, name, rssi, lastSeen, battery }
const P = id => periph.get(id) || periph.set(id, { sess: D.session(), connAt: 0 }).get(id);
const keyOf = (p, id) => p.mac ? 'mac:' + p.mac.replace(/:/g, '') : 'p:' + id;
let secret = null;
export async function bridgeSecret() {
  if (secret) return secret;
  const s = (await readFile(SECRET, 'utf8').catch(() => '')).trim();
  if (/^[A-Za-z0-9_-]{32,}$/.test(s)) return secret = s;
  const n = randomBytes(32).toString('base64url'); const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(DATA, { recursive: true, mode: 0o700 }); await writeFile(SECRET, n + '\n', { mode: 0o600 }); return secret = n;
}
bridgeSecret().catch(() => {}); // made on the first start, so the bridge finds it right away
async function bridgeOk(req) {
  const ra = String(req.socket?.remoteAddress || ''), local = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  const proxied = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'tailscale-user-login'].some(h => req.headers[h]); // Tailscale Funnel / serve come in from 127.0.0.1 too
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!local || proxied || !['127.0.0.1', 'localhost', '[::1]'].includes(host)) return false;
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S{32,200})$/); if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(await bridgeSecret()); return a.length === b.length && timingSafeEqual(a, b);
}

/** a finished weigh-in from scale `key`: to the member it clearly belongs to, else a question for the household. Returns what happened */
export function ingest(key, w, now = Date.now()) {
  return withS(async S => {
    await prune(S);
    const sc = S.scales[key]; if (!sc) { log('weigh-in from a scale no household added:', key, w.kg); return { stored: false, reason: 'unknown scale' }; }
    const h = S.households[sc.hid]; if (!h) return { stored: false, reason: 'no household' };
    sc.lastAt = now; const t = Math.round(w.t || now);
    const m = { t, kg: w.kg, src: 'scale', scaleId: sc.id }; if (w.impedance) m.impedance = w.impedance; if (w.impedance && w.x) m.x = w.x; if (w.hr) m.hr = w.hr;
    const v = validate(m, now + 60e3); if (v.error) { await saveS(S); return { stored: false, reason: v.error }; }
    const members = []; for (const x of h.members) members.push({ id: x.uid, joined: x.joined, list: (await bodyOf(x.uid)).list });
    const r = assign(v.m.kg, members, t); log(key, v.m.kg, 'kg ->', r.decision, r.reason);
    if (r.decision === 'auto') { await saveS(S); const a = await addTo(r.id, [v.m]); announce(r.id, h.members.find(x => x.uid === r.id)?.key, v.m, a); return { stored: true, auto: true, uid: r.id, id: a.ids[0] }; }
    const same = S.pending.find(p => p.hid === sc.hid && Math.abs(p.t - t) <= 3 * 60e3 && Math.abs(p.m.kg - v.m.kg) <= 0.2 + 1e-9);
    if (same) { same.m = { ...same.m, ...v.m }; same.t = t; } else S.pending.push({ id: newId(), hid: sc.hid, t, exp: t + ASK_MS, m: v.m, no: [], reason: r.reason });
    await saveS(S); return { stored: true, auto: false, reason: r.reason };
  });
}

/* ---- the bridge's raw frames ---- */
async function frame(b, now = Date.now()) {
  const id = String(b.id || '').slice(0, 80); if (!/^[\w:-]{1,80}$/.test(id)) return [400, { error: 'id missing.' }];
  const p = P(id), out = { ok: true };
  if (b.name) p.name = clean(b.name, 40);
  if (b.kind === 'adv') {
    const mfr = String(b.mfr || '').replace(/[^0-9a-f]/gi, '').slice(0, 128), model = D.identify(p.name, mfr) || p.model; if (!model) return [200, { ok: true, ignored: true }];
    p.model = model; p.mac = D.macOf(model, mfr) || p.mac; p.key = keyOf(p, id);
    live.set(p.key, { ...(live.get(p.key) || {}), key: p.key, model, name: D.MODELS[model].name, rssi: +b.rssi || null, lastSeen: now });
    const f = D.decodeAdv(model, mfr); if (f) log(id.slice(0, 8), model, f.final ? 'final' : 'live', f.kg, 'kg');
    await step(p, f, now);
    const S = await readJSON(SF, EMPTY()), sc = S.scales?.[p.key], M = D.MODELS[model];
    if (sc && !p.connected && now - p.connAt > 30e3 && (M.link === 'connect' || (M.bia && sc.bia && p.mac))) { p.connAt = now; out.connect = true; }
    return [200, out];
  }
  if (b.kind === 'connected') { p.connected = true; p.auth = null; const sc = (await readJSON(SF, EMPTY())).scales?.[p.key];
    if (D.MODELS[p.model]?.bia && sc?.bia && p.mac) { p.auth = D.p2Auth(p.mac); out.write = p.auth.c0().map(f => ({ char: 'FFF1', hex: D.hexOf(f), delay: 1000 })); log('P2 auth: C0 sent'); }
    return [200, out]; }
  if (b.kind === 'notify') {
    const ch = D.shortUuid(b.char), hex = String(b.hex || '').slice(0, 512);
    if (ch === 'FFF4' && p.auth) { const r = p.auth.onAuth(D.bytes(hex)); if (Array.isArray(r)) out.write = r.map(f => ({ char: 'FFF1', hex: D.hexOf(f), delay: 300 })); else if (r != null) log('P2 auth', r ? 'ok' : 'refused'); return [200, out]; }
    const f = D.decodeNotify(p.model, ch, hex); if (f) log(id.slice(0, 8), 'notify', f.final ? 'final' : 'live', f.kg, f.impedance ? f.impedance + ' ohm' : '');
    await step(p, f, now); return [200, out];
  }
  if (b.kind === 'disconnected') { p.connected = false; p.auth = null; return [200, out]; }
  if (b.kind === 'battery') { if (p.key && +b.level >= 0 && +b.level <= 100) live.set(p.key, { ...(live.get(p.key) || {}), battery: Math.round(+b.level) }); return [200, out]; }
  return [200, out]; // hello / unknown kinds: only "the bridge is alive"
}
async function step(p, f, now) { if (!f && !p.sess.fin) return; const r = D.feed(p.sess, f, now); p.sess = r.s; if (r.out) await ingest(p.key, r.out, now); }
// a weigh-in that settled without an end flag (P2 repeats one final frame): flushed here
setInterval(() => { const now = Date.now(); for (const p of periph.values()) { if (!p.sess.fin) continue; const r = D.flush(p.sess, now); p.sess = r.s; if (r.out && p.key) ingest(p.key, r.out, now).catch(() => {}); } }, 1000).unref();

/* ---- views ---- */
const promptsFor = (S, uid, hid) => S.pending.filter(p => p.hid === hid && !p.no.includes(uid)).sort((a, b) => b.t - a.t).map(p => ({ id: p.id, t: p.t, kg: p.m.kg }));
function scaleView(S, me, hid) {
  const now = Date.now(), h = hid && S.households[hid], owner = h && h.owner === me;
  const scales = h ? Object.values(S.scales).filter(s => s.hid === hid).map(s => { const l = live.get(s.key) || {};
    return { id: s.id, model: s.model, name: s.name, lastSeen: l.lastSeen || 0, lastAt: s.lastAt || 0, battery: l.battery ?? null, bia: !!s.bia, biaOk: !!D.MODELS[s.model]?.bia }; }) : [];
  const found = [...live.values()].filter(l => now - l.lastSeen < FOUND_MS && !S.scales[l.key]).map(l => ({ key: l.key, model: l.model, name: l.name, rssi: l.rssi, lastSeen: l.lastSeen }));
  return { household: h ? { name: h.name, owner, members: h.members.length, you: h.members.find(m => m.uid === me)?.joined || 0, scales } : null,
    bridge: { online: now - bridge.lastSeen < 2 * 60e3, lastSeen: bridge.lastSeen, version: bridge.version }, found: !h || owner ? found : [] };
}

/** returns true when the request was a /api/body or /api/scale call (answered here) */
export async function bodyApi(req, res, path) {
  if (!/^\/api\/(body|scale)(\/|$)/.test(path)) return false;
  const M = req.method;
  try {
    /* -- the bridge -- */
    if (path === '/api/scale/frame' || path === '/api/scale/measure') {
      if (M !== 'POST') return send(res, 405, { error: 'not allowed' });
      if (!(await bridgeOk(req))) return send(res, 401, { error: 'Bridge only (localhost + secret).' });
      let b; try { b = await body(req, 8e3); } catch { return send(res, 400, { error: 'Body must be JSON.' }); }
      bridge.lastSeen = Date.now(); if (b?.version) bridge.version = clean(b.version, 20);
      if (path === '/api/scale/frame') return send(res, ...await frame(b || {}));
      const key = b?.key ? String(b.key) : b?.id ? keyOf(P(String(b.id)), String(b.id)) : ''; if (!/^(mac|p):[\w-]{1,80}$/.test(key)) return send(res, 400, { error: 'key or id missing.' });
      if (b.model && D.MODELS[b.model]) live.set(key, { ...(live.get(key) || {}), key, model: b.model, name: D.MODELS[b.model].name, lastSeen: Date.now() });
      const r = await ingest(key, { kg: +b.kg, t: +b.t || undefined, impedance: +b.impedance || undefined, hr: +b.hr || undefined });
      return send(res, 200, r);
    }
    const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
    const uid = me.u.id, sub = path.replace(/^\/api\/(body|scale)\/?/, ''), isBody = path.startsWith('/api/body');
    const slow = () => limited('body:' + me.key, 600, 10 * 60e3);
    if (isBody) {
      if (sub === '' && M === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams, from = +q.get('from') || 0, to = +q.get('to') || Infinity;
        const b = await bodyOf(uid), S = await withS(async S => { if (await prune(S)) await saveS(S); return S; }), h = await homeOf(S, uid);
        return send(res, 200, { list: b.list.filter(m => m.t >= from && m.t <= to), prefs: b.prefs, prompts: h ? promptsFor(S, uid, h[0]) : [], at: b.at });
      }
      if (M !== 'GET' && slow()) return send(res, 429, { error: 'Too many changes. Please wait a few minutes.' });
      if (sub === '' && M === 'POST') {
        let b; try { b = await body(req, 4e3); } catch { return send(res, 400, { error: 'Body must be JSON.' }); }
        const v = validate({ ...b, src: 'manual' }); if (v.error) return send(res, 400, { error: v.error });
        const r = await addTo(uid, [v.m]); const list = (await bodyOf(uid)).list; return send(res, 200, { ok: true, m: list.find(x => x.id === r.ids[0]) });
      }
      if (sub === 'prefs' && M === 'PUT') {
        let b; try { b = await body(req, 2e3); } catch { return send(res, 400, { error: 'Body must be JSON.' }); } if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Body must be JSON.' });
        const bad = (k, lo, hi) => b[k] != null && b[k] !== '' && !(+b[k] >= lo && +b[k] <= hi);
        if (bad('goalKg', 20, 300)) return send(res, 400, { error: 'Goal: 20 to 300 kg.' }); if (bad('heightCm', 100, 250)) return send(res, 400, { error: 'Height: 100 to 250 cm.' });
        const yNow = new Date().getFullYear();
        if (bad('birthYear', 1900, yNow) || (b.birthYear != null && b.birthYear !== '' && !Number.isInteger(+b.birthYear))) return send(res, 400, { error: `Birth year: 1900 to ${yNow}.` });
        if (b.sex != null && b.sex !== '' && b.sex !== 'm' && b.sex !== 'f') return send(res, 400, { error: 'Sex: m or f.' });
        if (b.announce != null && typeof b.announce !== 'boolean') return send(res, 400, { error: 'announce: true or false.' });
        return await withUser(uid, async () => { const cur = await bodyOf(uid), keep = k => b[k] === '' || b[k] === null ? null : b[k] !== undefined ? b[k] : cur.prefs[k]; // '' / null clears, a missing key keeps
          const prefs = PREFS({ goalKg: keep('goalKg'), heightCm: keep('heightCm'), follow: b.follow ?? cur.prefs.follow, announce: b.announce ?? cur.prefs.announce, sex: keep('sex'), birthYear: keep('birthYear') });
          for (const k of ['goalKg', 'heightCm']) if (prefs[k] != null) prefs[k] = +prefs[k];
          await writeJSON(bodyFile(uid), { list: cur.list, prefs, at: Date.now() }); if (prefs.follow && !cur.prefs.follow) await follow(uid, cur.list); return send(res, 200, { ok: true, prefs }); });
      }
      if (sub === 'import' && M === 'POST') {
        if (limited('bodyimp:' + me.key, 20, 36e5)) return send(res, 429, { error: 'Too many imports. Please try again later.' });
        let b; try { b = await body(req, 3e6); } catch (e) { return send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'File too large (3 MB at most).' : 'Body must be JSON.' }); }
        const rows = Array.isArray(b?.rows) ? b.rows.slice(0, 10000) : []; let skipped = (Array.isArray(b?.rows) ? b.rows.length : 0) - rows.length; const ok = [];
        for (const r of rows) { const v = validate({ ...r, src: 'import' }); if (v.error) skipped++; else ok.push(v.m); }
        if (!ok.length) return send(res, 400, { error: 'No valid rows (date and kg) found.', skipped });
        const r = await addTo(uid, ok); return send(res, 200, { ok: true, added: r.added, merged: r.merged, skipped });
      }
      const pm = sub.match(/^prompts\/([0-9a-f]{12})$/);
      if (pm && M === 'POST') {
        let b; try { b = await body(req, 1e3); } catch { return send(res, 400, { error: 'Body must be JSON.' }); }
        const got = await withS(async S => { await prune(S); const h = await homeOf(S, uid), p = h && S.pending.find(x => x.id === pm[1] && x.hid === h[0] && !x.no.includes(uid));
          if (!p) { await saveS(S); return null; }
          if (b?.mine === true) { S.pending = S.pending.filter(x => x !== p); await saveS(S); announce(uid, me.key, p.m, await addTo(uid, [p.m])); return 'yes'; }
          p.no.push(uid); if (h[1].members.every(m => p.no.includes(m.uid))) S.pending = S.pending.filter(x => x !== p); // nobody's: gone
          await saveS(S); return 'no'; });
        return got ? send(res, 200, { ok: true, answer: got }) : send(res, 404, { error: 'This question is gone (answered or expired).' });
      }
      const im = sub.match(/^([0-9a-f]{12})$/);
      if (im && (M === 'PUT' || M === 'DELETE')) {
        let b = {}; if (M === 'PUT') { try { b = await body(req, 4e3); } catch { return send(res, 400, { error: 'Body must be JSON.' }); } }
        return await withUser(uid, async () => {
          const cur = await bodyOf(uid), i = cur.list.findIndex(x => x.id === im[1]); if (i < 0) return send(res, 404, { error: 'Measurement not found.' });
          let list;
          if (M === 'DELETE') list = cur.list.filter((_, j) => j !== i);
          else { const old = cur.list[i], v = validate({ ...old, ...b, src: old.src }); if (v.error) return send(res, 400, { error: v.error });
            const m = { ...v.m, id: old.id }; if (b.note === '') delete m.note; list = cur.list.map((x, j) => j === i ? m : x).sort((a, c) => a.t - c.t); }
          await writeJSON(bodyFile(uid), { list, prefs: cur.prefs, at: Date.now() }); if (cur.prefs.follow) await follow(uid, list);
          return send(res, 200, { ok: true, m: list.find(x => x.id === im[1]) || null });
        });
      }
      return send(res, 404, { error: 'unknown' });
    }
    /* -- household & scale (signed in) -- */
    if (sub === '' && M === 'GET') return send(res, 200, await withS(async S => { if (await prune(S)) await saveS(S); const h = await homeOf(S, uid); return scaleView(S, uid, h?.[0]); }));
    if (M === 'GET') return send(res, 404, { error: 'unknown' });
    if (limited('scale:' + me.key, 120, 10 * 60e3)) return send(res, 429, { error: 'Too many requests. Please wait a few minutes.' });
    let b = {}; try { b = await body(req, 2e3); } catch { return send(res, 400, { error: 'Body must be JSON.' }); }
    if (sub === 'join' && M === 'POST') {
      const ip = clientIp(req), code = String(b?.code ?? '').replace(/\D/g, ''), slowMsg = { error: 'Too many tries. Please wait 10 minutes.' };
      if (badCount() >= 60 || limited('sjoin-ip:' + ip, 10, 10 * 60e3)) return send(res, 429, slowMsg);
      if (code.length !== 6) { bad(); return send(res, 400, { error: 'The code has 6 digits.' }); }
      return await withS(async S => { await prune(S); const k = sha('sc:' + code), c = Object.hasOwn(S.codes, k) ? S.codes[k] : null;
        if (!c || !(c.exp > Date.now()) || !S.households[c.hid]) { bad(); return send(res, 401, { error: 'Wrong or expired code.' }); }
        if (await homeOf(S, uid)) return send(res, 409, { error: 'You are already in a household. Leave it first.' });
        const h = S.households[c.hid]; if (h.members.length >= MAX_MEMBERS) return send(res, 409, { error: `A household has at most ${MAX_MEMBERS} members.` });
        delete S.codes[k]; h.members.push({ uid, key: me.key, joined: Date.now() }); await saveS(S); return send(res, 200, { ok: true, ...scaleView(S, uid, c.hid) }); });
    }
    return await withS(async S => {
      await prune(S); const h0 = await homeOf(S, uid), now = Date.now();
      const done = async (hid = h0?.[0]) => { await saveS(S); return send(res, 200, { ok: true, ...scaleView(S, uid, hid) }); };
      if (sub === 'household' && M === 'POST') { if (h0) return send(res, 409, { error: 'You are already in a household.' });
        const hid = newId(); S.households[hid] = { name: clean(b.name, 30) || 'Home', owner: uid, created: now, members: [{ uid, key: me.key, joined: now }] }; return done(hid); }
      if (!h0) return send(res, 409, { error: 'Create a household first, or join one with a code.' });
      const [hid, h] = h0, owner = h.owner === uid;
      if (sub === 'leave' && M === 'POST') { h.members = h.members.filter(m => m.uid !== uid);
        for (const p of S.pending) p.no = p.no.filter(x => x !== uid);
        if (!h.members.length) { delete S.households[hid]; for (const s of Object.values(S.scales)) if (s.hid === hid) delete S.scales[s.key]; S.pending = S.pending.filter(p => p.hid !== hid); }
        else if (owner) h.owner = h.members[0].uid;
        return done(null); }
      if (!owner) return send(res, 403, { error: 'Only the person who set up the scale can do this.' });
      if (sub === 'code' && M === 'POST') {
        if (limited('scode:' + me.key, 10, 36e5)) return send(res, 429, { error: 'Too many codes. Please try again in an hour.' });
        for (const [k, c] of Object.entries(S.codes)) if (c.hid === hid) delete S.codes[k];
        let code; do code = String(randomInt(0, 1e6)).padStart(6, '0'); while (Object.hasOwn(S.codes, sha('sc:' + code)));
        S.codes[sha('sc:' + code)] = { hid, exp: now + CODE_MS }; await saveS(S); return send(res, 200, { code, exp: now + CODE_MS, ttl: CODE_MS / 1000 }); }
      if (sub === 'add' && M === 'POST') {
        const key = String(b.key || ''), l = live.get(key); if (!l || now - l.lastSeen > FOUND_MS) return send(res, 404, { error: 'The bridge has not heard this scale in the last 10 minutes. Step on it once and try again.' });
        if (S.scales[key]) return send(res, 409, { error: 'This scale already belongs to a household.' });
        if (Object.values(S.scales).filter(s => s.hid === hid).length >= MAX_SCALES) return send(res, 409, { error: `At most ${MAX_SCALES} scales per household.` });
        S.scales[key] = { id: newId(), key, hid, model: l.model, name: l.name, added: now, bia: false }; return done(); }
      const sm = sub.match(/^scales\/([0-9a-f]{12})$/), sc = sm && Object.values(S.scales).find(s => s.id === sm[1] && s.hid === hid);
      if (sm && !sc) return send(res, 404, { error: 'Scale not found.' });
      if (sc && M === 'DELETE') { delete S.scales[sc.key]; return done(); }
      if (sc && M === 'PUT') { if (typeof b.bia === 'boolean') sc.bia = b.bia && !!D.MODELS[sc.model]?.bia; if (b.name != null) sc.name = clean(b.name, 30) || sc.name; return done(); }
      return send(res, 404, { error: 'unknown' });
    });
  } catch (e) { console.log('Body-API-Fehler:', e?.message || e); return send(res, 500, { error: 'Server error.' }); }
}
// wrong join codes over all addresses (like the watch pairing): a flood blocks joining for 10 minutes and nothing else
const badHits = [];
function bad() { const now = Date.now(); badHits.push(now); while (badHits.length && now - badHits[0] > 10 * 60e3) badHits.shift(); }
function badCount() { const now = Date.now(); while (badHits.length && now - badHits[0] > 10 * 60e3) badHits.shift(); return badHits.length; }
/** for tests: the in-memory bridge state */
export const _state = { periph, live, bridge };
