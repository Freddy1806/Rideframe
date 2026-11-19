// Phone remote for the desktop 3D app (owner 21.11.: "an HTML page on my phone that controls the app, like the gamepad").
// The desktop opens a session and shows a 6-digit code (or, signed in on both devices with the same account, the phone
// finds it by the account); the phone joins and sends button down / up events and a few commands; the desktop gets them as
// Server-Sent Events (long-poll fallback) and feeds a virtual gamepad (js/remotepad.js). The desktop posts a small status
// (menu / ride / paused, step, target, watts) every 1-2 s, which the phone gets on its own stream.
// In memory only: nothing is written to disk, a restart of the server ends all sessions (the desktop opens a new one).
//   POST /api/remote/open   {label?}                 -> { id, key, code, exp }   desktop (X-RF-Token optional: account discovery)
//   POST /api/remote/code   {id, key}                -> { code, exp }            desktop: a fresh code (old one dropped)
//   POST /api/remote/status {id, key, s}             -> { ok, phones }           desktop heartbeat + status for the phones
//   POST /api/remote/close  {id, key}                                            desktop ends the session
//   GET  /api/remote/stream?id&key | ?tok             SSE: desktop gets events, phone gets status
//   GET  /api/remote/poll?id&key&after | ?tok&after   long-poll fallback (25 s)
//   GET  /api/remote/mine   (X-RF-Token)             -> { desks: [{ id, label, ago }] }  this account's open desktops
//   POST /api/remote/join   {code} | {id} + X-RF-Token -> { tok, label }
//   POST /api/remote/send   {tok, t:'btn', i, down} | {tok, t:'cmd', name} | {tok, evs: [up to 8 of those]}
//   POST /api/remote/leave  {tok}
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { accountOf, shared } from './accounts-api.mjs';

const { send, limited, clientIp } = shared;
const K = Math.min(1, Math.max(0.001, +process.env.RIDEFRAME_REMOTE_TIME || 1)); // only tools/remote-test.mjs shortens the clocks (expiry tests)
export const LIMITS = {
  CODE_MS: K * 10 * 60e3, // a code lives 10 min or until used
  DEAD_MS: K * 60e3, // a session without desktop heartbeat (status / open stream) for 60 s is gone
  PHONE_MS: K * 35e3, // a phone without stream and without a call for 35 s counts as gone
  MAX_SESS: 1000, MAX_PER_IP: 4, MAX_PER_ACC: 4, MAX_PHONES: 4,
  OPEN_PER_IP: 30, // opens per 10 min and address
  TRY_PER_IP: 10, // join tries per 10 min and address
  BAD_ALL: 60, // wrong codes over all addresses per 10 min, then pairing by code rests
  BUCKET: 40, REFILL: 20, // events a phone may send: a burst of 40, then 20 per second
  STATUS_PER_S: 10, QUEUE: 200, BODY: 600, STATUS_BODY: 2048,
};
const CMDS = new Set(['mode:erg', 'mode:real', 'mode:virtual', 'photo', 'lap', 'pause', 'music', 'next', 'view', 'hud', 'wbview']);
const sess = new Map(); // id -> session
const codes = new Map(); // code -> id
const phones = new Map(); // tok -> { id, last, streams }
const badHits = [];
const rnd = n => randomBytes(n).toString('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);
function bad() { const now = Date.now(); badHits.push(now); while (badHits.length && now - badHits[0] > 10 * 60e3) badHits.shift(); }
function badCount() { const now = Date.now(); while (badHits.length && now - badHits[0] > 10 * 60e3) badHits.shift(); return badHits.length; }

async function readBody(req, max) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('too large'), { code: 413 }); chunks.push(c); }
  const t = Buffer.concat(chunks).toString('utf8') || '{}';
  const v = JSON.parse(t); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
  return v;
}
/** the desktop's own session, checked by its key */
function desk(id, key) { const s = typeof id === 'string' && sess.get(id); return s && typeof key === 'string' && same(s.key, key) ? s : null; }
function phoneOf(tok) { const p = typeof tok === 'string' && tok.length < 80 && phones.get(tok); if (!p) return null; const s = sess.get(p.id); if (!s) { phones.delete(tok); return null; } return { p, s }; }

const sse = (res, ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
function deskEvent(s, ev) { // to the desktop: its open streams at once, the long-poll queue keeps the last ones
  s.n++; s.q.push({ n: s.n, ev }); if (s.q.length > LIMITS.QUEUE) s.q.splice(0, s.q.length - LIMITS.QUEUE);
  for (const r of s.streams) sse(r, 'ev', { n: s.n, ...ev });
  for (const w of s.waiters.splice(0)) w();
}
function phoneCount(s) { const now = Date.now(); let n = 0; for (const t of s.phones) { const p = phones.get(t); if (p && (p.streams.size || now - p.last < LIMITS.PHONE_MS)) n++; } return n; }
function notifyPhones(s) { const n = phoneCount(s); if (n !== s.lastPhones) { s.lastPhones = n; deskEvent(s, { t: 'phones', c: n }); } }
function toPhones(s, ev, data) {
  for (const t of s.phones) { const p = phones.get(t); if (p) for (const r of p.streams) sse(r, ev, data); }
  for (const w of s.pwait.splice(0)) w();
}
function newCode(s) {
  if (s.code) codes.delete(s.code);
  let c; do c = String(randomInt(0, 1e6)).padStart(6, '0'); while (codes.has(c));
  s.code = c; s.codeExp = Date.now() + LIMITS.CODE_MS; codes.set(c, s.id);
  return { code: c, exp: s.codeExp, ttl: Math.round(LIMITS.CODE_MS / 1000) };
}
function close(s, why = 'closed') {
  if (!sess.has(s.id)) return;
  sess.delete(s.id); if (s.code && codes.get(s.code) === s.id) codes.delete(s.code);
  for (const t of s.phones) { const p = phones.get(t); if (p) for (const r of p.streams) { sse(r, 'bye', { why }); try { r.end(); } catch {} } phones.delete(t); }
  for (const r of s.streams) { sse(r, 'bye', { why }); try { r.end(); } catch {} }
  for (const w of [...s.waiters.splice(0), ...s.pwait.splice(0)]) w();
}
function alive(s, now) { return now - s.beat < LIMITS.DEAD_MS || [...s.streams].some(r => !r.destroyed && !r.writableEnded); }
/** sweeper: expired sessions, expired codes, phone count changes; also called by the tests through _sweep */
function sweep(now = Date.now()) {
  for (const s of [...sess.values()]) {
    if (!alive(s, now)) { close(s, 'expired'); continue; }
    if (s.code && !(s.codeExp > now)) { codes.delete(s.code); s.code = null; }
    notifyPhones(s);
  }
}
const sweeper = setInterval(sweep, Math.max(20, K * 5000)); sweeper.unref?.();
const pinger = setInterval(() => { // keeps the streams open through proxies (Tailscale funnel) and finds dead ones
  for (const s of sess.values()) { for (const r of s.streams) { try { r.write(': ping\n\n'); } catch {} } for (const t of s.phones) { const p = phones.get(t); if (p) for (const r of p.streams) { try { r.write(': ping\n\n'); } catch {} } } }
}, 15000); pinger.unref?.();

function openStream(req, res, set, onClose) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n'); set.add(res); req.socket?.setNoDelay?.(true);
  const done = () => { set.delete(res); onClose?.(); };
  res.on('close', done); res.on('error', done);
}
/** a bucket per phone: a burst of BUCKET events, refilled REFILL per second */
function take(p) { const now = Date.now(); p.tokens = Math.min(LIMITS.BUCKET, (p.tokens ?? LIMITS.BUCKET) + (now - (p.tAt || now)) / 1000 * LIMITS.REFILL); p.tAt = now; if (p.tokens < 1) return false; p.tokens--; return true; }

/** returns true when the request was an /api/remote call (answered here) */
export async function remoteApi(req, res, path) {
  if (!path.startsWith('/api/remote/')) return false;
  const op = path.slice(12), M = req.method, ip = clientIp(req);
  // no other site may drive this: a browser marks cross-site calls (no CORS headers are ever sent either)
  const sfs = req.headers['sec-fetch-site'], origin = req.headers.origin;
  if ((sfs && !/^(same-origin|none)$/.test(sfs)) || (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host)) return send(res, 403, { error: 'Not allowed.' });
  try {
    const q = new URL(req.url, 'http://x').searchParams, now = Date.now();
    if (M === 'POST' && op !== 'status' && limited('rmt-ip:' + ip, 3000, 60e3)) return send(res, 429, { error: 'Too many requests.' }); // a hard ceiling per address
    if (op === 'open' && M === 'POST') {
      const b = await readBody(req, LIMITS.BODY);
      if (limited('rmt-open:' + ip, LIMITS.OPEN_PER_IP, 10 * 60e3)) return send(res, 429, { error: 'Too many sessions opened. Try again in a few minutes.' });
      const me = await accountOf(req).catch(() => null);
      const all = [...sess.values()];
      if (sess.size >= LIMITS.MAX_SESS) return send(res, 503, { error: 'The remote is busy. Try again in a minute.' });
      if (all.filter(s => s.ip === ip).length >= LIMITS.MAX_PER_IP) return send(res, 429, { error: 'Too many open remote sessions from this address.' });
      if (me && all.filter(s => s.acct === me.key).length >= LIMITS.MAX_PER_ACC) return send(res, 429, { error: 'Too many open remote sessions for this account.' });
      let id; do id = rnd(12); while (sess.has(id));
      const s = { id, key: rnd(24), ip, acct: me ? me.key : null, label: clean(b.label, 40) || 'RIDEFRAME', created: now, beat: now, n: 0, q: [], streams: new Set(), waiters: [], pwait: [],
        phones: new Set(), status: null, sn: 0, lastPhones: 0, st: [] };
      sess.set(id, s);
      return send(res, 200, { id, key: s.key, ...newCode(s), account: !!me });
    }
    if (op === 'code' && M === 'POST') {
      const b = await readBody(req, LIMITS.BODY), s = desk(b.id, b.key); if (!s) return send(res, 404, { error: 'No such session.' });
      if (limited('rmt-code:' + s.id, 20, 10 * 60e3)) return send(res, 429, { error: 'Too many codes.' });
      s.beat = now; return send(res, 200, newCode(s));
    }
    if (op === 'status' && M === 'POST') {
      const b = await readBody(req, LIMITS.STATUS_BODY), s = desk(b.id, b.key); if (!s) return send(res, 404, { error: 'No such session.' });
      s.st = s.st.filter(t => now - t < 1000); if (s.st.length >= LIMITS.STATUS_PER_S) return send(res, 429, { error: 'Too many status updates.' }); s.st.push(now);
      s.beat = now;
      if (b.s && typeof b.s === 'object' && !Array.isArray(b.s)) {
        const j = JSON.stringify(b.s);
        if (j !== JSON.stringify(s.status)) { s.status = b.s; s.sn++; toPhones(s, 'status', { n: s.sn, s: s.status }); }
      }
      notifyPhones(s);
      return send(res, 200, { ok: true, phones: phoneCount(s) });
    }
    if (op === 'close' && M === 'POST') {
      const b = await readBody(req, LIMITS.BODY), s = desk(b.id, b.key); if (s) close(s, 'closed'); return send(res, 200, { ok: true });
    }
    if (op === 'mine' && M === 'GET') {
      const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
      if (limited('rmt-mine:' + ip, 120, 10 * 60e3)) return send(res, 429, { error: 'Too many requests.' });
      return send(res, 200, { desks: [...sess.values()].filter(s => s.acct === me.key && alive(s, now)).sort((a, b) => b.beat - a.beat).map(s => ({ id: s.id, label: s.label, ago: Math.round((now - s.beat) / 1000) })) });
    }
    if (op === 'join' && M === 'POST') {
      const slow = { error: 'Too many tries. Please wait 10 minutes.' };
      if (limited('rmt-try:' + ip, LIMITS.TRY_PER_IP, 10 * 60e3)) return send(res, 429, slow);
      const b = await readBody(req, LIMITS.BODY); let s = null;
      if (b.id != null) { // signed in on both devices: the account is the key
        const me = await accountOf(req); const c = typeof b.id === 'string' && sess.get(b.id);
        if (!me || !c || c.acct !== me.key) return send(res, 404, { error: 'This computer is not open for your account.' });
        s = c;
      } else {
        if (badCount() >= LIMITS.BAD_ALL) return send(res, 429, slow);
        const code = String(b.code ?? '').replace(/\D/g, '');
        if (code.length !== 6) { bad(); return send(res, 400, { error: 'The code has 6 digits.' }); }
        const id = codes.get(code), c = id && sess.get(id);
        if (!c || !(c.codeExp > now)) { bad(); return send(res, 401, { error: 'Wrong or expired code.' }); }
        codes.delete(code); c.code = null; s = c; // single use; the desktop shows a fresh one for a second phone
      }
      // a full session drops its quietest phone, so a phone that lost its token can always come back
      if (s.phones.size >= LIMITS.MAX_PHONES) { const old = [...s.phones].map(t => [t, phones.get(t)]).sort((a, b) => (a[1]?.last || 0) - (b[1]?.last || 0))[0]; if (old) dropPhone(s, old[0], 'replaced'); }
      const tok = rnd(24); phones.set(tok, { id: s.id, last: now, streams: new Set() }); s.phones.add(tok);
      notifyPhones(s);
      return send(res, 200, { tok, label: s.label, status: s.status });
    }
    if (op === 'send' && M === 'POST') {
      const b = await readBody(req, LIMITS.BODY), ps = phoneOf(b.tok); if (!ps) return send(res, 404, { error: 'Not connected.' });
      const { p, s } = ps;
      // one event, or up to 8 in order (a tap, a held D-pad's repeat); every event costs one from the bucket
      const list = Array.isArray(b.evs) ? b.evs : [b]; if (!list.length || list.length > 8) return send(res, 400, { error: '1 to 8 events.' });
      const evs = list.map(e => !e || typeof e !== 'object' ? null
        : e.t === 'btn' && Number.isInteger(e.i) && e.i >= 0 && e.i <= 16 && typeof e.down === 'boolean' ? { t: 'btn', i: e.i, down: e.down }
        : e.t === 'cmd' && typeof e.name === 'string' && CMDS.has(e.name) ? { t: 'cmd', name: e.name } : null);
      if (evs.includes(null)) return send(res, 400, { error: 'Unknown event.' });
      for (let k = 0; k < evs.length; k++) if (!take(p)) { if (!k) return send(res, 429, { error: 'Too fast.' }); evs.length = k; break; }
      p.last = now; for (const ev of evs) deskEvent(s, ev); notifyPhones(s);
      return send(res, 200, { ok: true, live: s.streams.size > 0 || now - s.beat < 5000 });
    }
    if (op === 'leave' && M === 'POST') {
      const b = await readBody(req, LIMITS.BODY), ps = phoneOf(b.tok); if (ps) dropPhone(ps.s, b.tok, 'left'); return send(res, 200, { ok: true });
    }
    if (op === 'stream' && M === 'GET') {
      if (q.has('tok')) {
        const ps = phoneOf(q.get('tok')); if (!ps) return send(res, 404, { error: 'Not connected.' });
        const { p, s } = ps; if (p.streams.size >= 3) return send(res, 429, { error: 'Too many streams.' });
        p.last = now; openStream(req, res, p.streams, () => { p.last = Date.now(); notifyPhones(s); });
        sse(res, 'hello', { label: s.label }); if (s.status) sse(res, 'status', { n: s.sn, s: s.status });
        notifyPhones(s); return true;
      }
      const s = desk(q.get('id'), q.get('key')); if (!s) return send(res, 404, { error: 'No such session.' });
      if (s.streams.size >= 3) return send(res, 429, { error: 'Too many streams.' });
      s.beat = now; openStream(req, res, s.streams, () => { s.beat = Date.now(); });
      sse(res, 'hello', { n: s.n, phones: phoneCount(s) }); return true;
    }
    if (op === 'poll' && M === 'GET') {
      const after = Math.max(0, Math.floor(+q.get('after') || 0)), wait = arr => new Promise(r => { // resolves on news, after 25 s or when the caller hangs up; never stays in the list
        let done = false; const fin = () => { if (done) return; done = true; clearTimeout(t); const i = arr.indexOf(fin); if (i >= 0) arr.splice(i, 1); r(); };
        const t = setTimeout(fin, 25000); arr.push(fin); res.on('close', fin); });
      if (q.has('tok')) {
        let ps = phoneOf(q.get('tok')); if (!ps) return send(res, 404, { error: 'Not connected.' });
        if (q.has('peek')) return send(res, 200, { ok: true }); // "still there?" after a lost stream
        ps.p.last = now; notifyPhones(ps.s);
        if (ps.s.sn <= after) { if (ps.s.pwait.length >= 12) return send(res, 429, { error: 'Too many waiting calls.' }); await wait(ps.s.pwait); ps = phoneOf(q.get('tok')); if (!ps) return send(res, 404, { error: 'Not connected.' }); ps.p.last = Date.now(); }
        return send(res, 200, { n: ps.s.sn, s: ps.s.sn > after ? ps.s.status : undefined });
      }
      let s = desk(q.get('id'), q.get('key')); if (!s) return send(res, 404, { error: 'No such session.' });
      s.beat = now; if (q.has('peek')) return send(res, 200, { ok: true });
      if (!s.q.some(e => e.n > after)) { if (s.waiters.length >= 4) return send(res, 429, { error: 'Too many waiting calls.' }); await wait(s.waiters); if (!sess.has(s.id)) return send(res, 404, { error: 'No such session.' }); s.beat = Date.now(); }
      return send(res, 200, { n: s.n, evs: s.q.filter(e => e.n > after).map(e => ({ n: e.n, ...e.ev })), phones: phoneCount(s) });
    }
    return send(res, 405, { error: 'not allowed' });
  } catch (e) { return send(res, e?.code === 413 ? 413 : 400, { error: e?.code === 413 ? 'Too large.' : 'Bad request.' }); }
}
function dropPhone(s, tok, why) {
  const p = phones.get(tok); if (p) for (const r of p.streams) { sse(r, 'bye', { why }); try { r.end(); } catch {} }
  phones.delete(tok); s.phones.delete(tok); notifyPhones(s);
}
/** for tools/remote-test.mjs: run the sweeper at a given time, look inside */
export const _test = { sweep, sess, phones, codes, reset() { for (const s of [...sess.values()]) close(s); badHits.length = 0; } };
