// "Riding now" (owner 17.11.: "I want to simply see when someone is online and join him with one tap").
// While a signed-in rider is in a 3D ride, the browser sends a heartbeat every 20 s (POST /api/live); without one for
// 60 s the entry is gone, DELETE /api/live ends it at once. GET /api/live lists who rides right now, for signed-in
// accounts of this host only. One-tap join: POST /api/live/join { to } asks a rider; his next heartbeat answer carries
// the request, his client opens a group (on its own or after Accept) and reports the code with the next heartbeat; the
// asker polls GET /api/live/join/<id> until it is "ready" (with the code), "declined", "gone" or "expired".
// Everything lives in memory: a restart only forgets who rides at this minute. Settings (account settings.json):
// liveShow (default on) = appear at all, liveAuto (default on) = friends join without asking.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { accountOf, shared } from './accounts-api.mjs';

const { readJSON, writeJSON, send, body, limited, userDir } = shared;
const TTL = Math.max(300, +process.env.RIDEFRAME_LIVE_TTL || 60e3), ASK_TTL = Math.max(300, +process.env.RIDEFRAME_LIVE_ASK_TTL || 45e3), EVERY = 20;
const MAX_LIVE = 300, MAX_ASKS = 2000;
const live = new Map(); // account key -> { sid, key, name, look, routeId, routeName, d, len, code, since, at, auto }
const asks = new Map(); // id -> { id, from, fromName, to, toName, at, state: pending | accepted | ready | declined | gone | cancelled | expired, code }
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);
const ROUTE = /^[\w.:-]{1,80}$/, CODE = /^[a-hjkmnp-z2-9]{5}$/, HEX = /^[0-9a-f]{12}$/;
const hex = () => randomBytes(6).toString('hex');
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : NaN;

async function settingsOf(u) { const f = join(userDir(u.id), 'settings.json'); return { f, s: await readJSON(f, null) }; }
const prefsOf = st => ({ show: st?.liveShow !== false, auto: st?.liveAuto !== false });
const lookOf = st => { const l = st?.look; return l && typeof l === 'object' && !Array.isArray(l) && JSON.stringify(l).length <= 2000 ? l : null; };

function sweep(now = Date.now()) {
  for (const [k, e] of live) if (now - e.at > TTL) live.delete(k);
  for (const [id, a] of asks) {
    if ((a.state === 'pending' || a.state === 'accepted') && !live.has(a.to)) a.state = 'gone';
    if ((a.state === 'pending' || a.state === 'accepted') && now - a.at > ASK_TTL) a.state = 'expired';
    if (now - a.at > ASK_TTL + 120e3) asks.delete(id);
  }
}
/** a rider stopped (finish, leave, setting off): whoever is still asking him learns it on the next poll */
function gone(key) { live.delete(key); for (const a of asks.values()) if (a.to === key && (a.state === 'pending' || a.state === 'accepted')) a.state = 'gone'; }
/** requests that can be answered with the code right away (group open and the rider lets friends in, or he accepted) */
function settle(e) { if (!e?.code) return; for (const a of asks.values()) if (a.to === e.key && (a.state === 'accepted' || (a.state === 'pending' && e.auto))) { a.state = 'ready'; a.code = e.code; } }

/** returns true when the request was an /api/live call (answered here) */
export async function liveApi(req, res, path) {
  if (path !== '/api/live' && !path.startsWith('/api/live/')) return false;
  const op = path.slice(9), m = req.method;
  try {
    const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
    const key = me.key, now = Date.now(); sweep(now);

    if (op === '' && m === 'POST') { // heartbeat
      if (limited('live-hb:' + key, 20, 60e3)) return send(res, 429, { error: 'Too many heartbeats.' });
      const b = await body(req, 4e3); if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Bad request.' });
      const routeId = String(b.routeId ?? ''), len = num(b.len), d = num(b.d), code = b.code == null || b.code === '' ? null : String(b.code), st0 = num(b.startedAt);
      if (!ROUTE.test(routeId)) return send(res, 400, { error: 'routeId missing or invalid.' });
      if (!(len > 0 && len <= 1e6)) return send(res, 400, { error: 'len must be the route length in metres.' });
      if (!(d >= 0 && d <= 2e6)) return send(res, 400, { error: 'd must be the distance in metres.' });
      if (code !== null && !CODE.test(code)) return send(res, 400, { error: 'code must be a group code.' });
      const answers = b.answers == null ? [] : b.answers;
      if (!Array.isArray(answers) || answers.length > 20 || answers.some(a => !a || !HEX.test(String(a.id)) || typeof a.ok !== 'boolean')) return send(res, 400, { error: 'answers: [{ id, ok }]' });
      const { s } = await settingsOf(me.u), st = s?.settings, p = prefsOf(st);
      if (!p.show) { gone(key); return send(res, 200, { ok: true, hidden: true, requests: [] }); }
      let e = live.get(key);
      if (!e) { if (live.size >= MAX_LIVE) return send(res, 503, { error: 'Too many riders right now.' }); e = { sid: hex(), key, since: st0 >= now - 864e5 && st0 <= now + 60e3 ? st0 : now }; live.set(key, e); }
      Object.assign(e, { name: me.u.name, look: lookOf(st), routeId, routeName: clean(b.routeName, 80) || routeId, len: Math.round(len), d: Math.round(Math.min(d, len)), code, at: now, auto: p.auto });
      for (const x of answers) { const a = asks.get(x.id); if (a && a.to === key && (a.state === 'pending' || a.state === 'accepted')) a.state = x.ok ? 'accepted' : 'declined'; }
      settle(e);
      const requests = [...asks.values()].filter(a => a.to === key && a.state === 'pending').map(a => ({ id: a.id, from: a.fromName, auto: e.auto }));
      const waiting = [...asks.values()].filter(a => a.to === key && a.state === 'accepted').map(a => a.id); // accepted, the code still to come
      return send(res, 200, { ok: true, sid: e.sid, ttl: TTL, every: EVERY, requests, waiting });
    }
    if (op === '' && m === 'DELETE') { gone(key); return send(res, 200, { ok: true }); }
    if (op === '' && m === 'GET') {
      if (limited('live-get:' + key, 30, 60e3)) return send(res, 429, { error: 'Too many requests.' });
      const riders = [...live.values()].sort((x, y) => x.since - y.since).map(e => ({ id: e.sid, name: e.name, look: e.look, routeId: e.routeId, routeName: e.routeName, d: e.d, len: e.len, since: e.since,
        me: e.key === key, canJoin: e.key !== key, group: !!e.code, code: e.key !== key && e.auto && e.code ? e.code : null, ask: !e.auto }));
      return send(res, 200, { riders, now, every: EVERY });
    }
    if (op === '/join' && m === 'POST') {
      const b = await body(req, 1e3), to = String(b?.to ?? '');
      if (!HEX.test(to)) return send(res, 400, { error: 'to must be a rider id.' });
      const t = [...live.values()].find(e => e.sid === to);
      if (!t) return send(res, 404, { error: 'Not riding any more.', state: 'gone' });
      if (t.key === key) return send(res, 400, { error: 'That is you.' });
      const old = [...asks.values()].find(a => a.from === key && a.sid === t.sid && (a.state === 'pending' || a.state === 'accepted'));
      if (old) return send(res, 200, { id: old.id, state: old.state, code: old.state === 'ready' ? old.code : null, name: t.name });
      if (limited('live-ask:' + key, 10, 10 * 60e3)) return send(res, 429, { error: 'Too many join requests. Please wait a few minutes.' });
      if (asks.size >= MAX_ASKS) return send(res, 503, { error: 'Too many requests right now.' });
      const a = { id: hex(), from: key, fromName: me.u.name, to: t.key, sid: t.sid, toName: t.name, at: now, state: 'pending', code: null };
      asks.set(a.id, a); settle(t);
      return send(res, 200, { id: a.id, state: a.state, code: a.state === 'ready' ? a.code : null, name: t.name });
    }
    const jm = op.match(/^\/join\/([0-9a-f]{12})$/);
    if (jm) {
      const a = asks.get(jm[1]); if (!a || a.from !== key) return send(res, 404, { error: 'Unknown request.' });
      if (m === 'DELETE') { if (a.state === 'pending' || a.state === 'accepted') a.state = 'cancelled'; return send(res, 200, { ok: true }); }
      if (m !== 'GET') return send(res, 405, { error: 'not allowed' });
      if (limited('live-poll:' + key, 60, 60e3)) return send(res, 429, { error: 'Too many requests.' });
      return send(res, 200, { id: a.id, state: a.state, code: a.state === 'ready' ? a.code : null, name: a.toName });
    }
    if (op === '/prefs') { // the two switches, also from the phone (whose local settings may be older than the account's)
      const { f, s } = await settingsOf(me.u);
      if (m === 'GET') return send(res, 200, prefsOf(s?.settings));
      if (m !== 'PUT') return send(res, 405, { error: 'not allowed' });
      if (limited('live-prefs:' + key, 30, 60e3)) return send(res, 429, { error: 'Too many requests.' });
      const b = await body(req, 1e3), st = { ...(s?.settings || {}) };
      if (b?.show != null) { if (typeof b.show !== 'boolean') return send(res, 400, { error: 'show: true or false' }); st.liveShow = b.show; }
      if (b?.auto != null) { if (typeof b.auto !== 'boolean') return send(res, 400, { error: 'auto: true or false' }); st.liveAuto = b.auto; }
      await writeJSON(f, { settings: st, at: Date.now() });
      if (st.liveShow === false) gone(key); else if (live.has(key)) live.get(key).auto = st.liveAuto !== false;
      return send(res, 200, prefsOf(st));
    }
    return send(res, 404, { error: 'unknown' });
  } catch (e) { const bad = e instanceof SyntaxError || /too large/.test(e?.message || ''); return send(res, bad ? 400 : 500, { error: bad ? 'Bad request.' : 'Server error.' }); }
}
