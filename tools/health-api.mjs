// Recovery values from the watch (25.11., Freddy: "Claude is my coach who sees all of it": sleep score, body battery, resting heart
// rate, recovery time, VO2max … as Garmin's own watch computes them). The RIDEFRAME watch app reads them once per start and before
// each upload (garmin/source/Health.mc healthSnapshot, the JS twin js/watchflow.js healthBody) and sends them along:
//   POST /api/watch/health  (paired watch, Bearer; tools/watch-api.mjs)  { day: 'YYYY-MM-DD' (the watch's local day), t: Unix s, ss?, bb?, … }
//   GET  /api/account/health?days=30  (phone login, X-RF-Token)          -> { days: [newest first], latest, keys }
// Storage: users/<id>/health.json { days: { 'YYYY-MM-DD': { first, last, v: { ss: 82, … }, at: { ss: ms, … } } } }: one record per
// local day, per field the value of the newest snapshot that carried it (snapshots can arrive out of order from the watch's queue),
// first- and last-seen time of the day; 400 days kept. Out-of-range values are dropped (and named in the answer), never stored.
import { join } from 'node:path';
import { accountOf, shared } from './accounts-api.mjs';

const { readJSON, writeJSON, send, userDir } = shared;
export const KEEP_DAYS = 400, MAX_BODY = 2e3;
/** the short keys: [name, unit, lo, hi, decimals] (the card, the connector and the checks use them) */
export const HEALTH = {
  ss: ['sleep score', '0-100', 0, 100, 0], bb: ['body battery', '0-100', 0, 100, 0], rt: ['recovery time', 'minutes', 0, 10080, 0],
  st: ['stress', '0-100', 0, 100, 0], rhr: ['resting heart rate', 'bpm', 25, 150, 0], v2r: ['VO2max running', 'ml/kg/min', 10, 100, 0],
  v2b: ['VO2max cycling', 'ml/kg/min', 10, 100, 0], ts: ['training status', 'text', 0, 0, 0], rr: ['respiration rate', 'breaths/min', 3, 60, 1],
  spo2: ['pulse ox', '%', 50, 100, 0], steps: ['steps today', 'steps', 0, 200000, 0],
};
const file = uid => join(userDir(uid), 'health.json');
const pad = n => String(n).padStart(2, '0');
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayMs = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return NaN; const d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d.getTime() : NaN; };

/** checks one snapshot; returns { error } or { day, t (ms), v: { key: value }, dropped: [keys] } */
export function validateHealth(b, now = Date.now()) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'Body must be a JSON object.' };
  const day = String(b.day ?? ''), d0 = dayMs(day); if (!Number.isFinite(d0)) return { error: 'day: the watch\'s local day, YYYY-MM-DD.' };
  let t = b.t; if (typeof t !== 'number' || !(t > 0)) return { error: 't: Unix seconds.' };
  if (t < 1e11) t *= 1000; t = Math.round(t);
  if (t > now + 10 * 60e3) return { error: 't is in the future.' };
  if (t < now - KEEP_DAYS * 864e5) return { error: `t is older than ${KEEP_DAYS} days.` };
  if (Math.abs(t - (d0 + 12 * 3600e3)) > 36 * 3600e3) return { error: 'day does not fit t.' }; // time zones: the watch's day is within a day and a half of t
  const v = {}, dropped = [];
  for (const [k, x] of Object.entries(b)) {
    if (k === 'day' || k === 't') continue;
    const f = HEALTH[k]; if (!f) { dropped.push(String(k).slice(0, 20)); continue; }
    if (x == null) continue;
    if (k === 'ts') { const s = typeof x === 'string' ? x.replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 40) : ''; if (s) v.ts = s; else dropped.push(k); continue; }
    const n = typeof x === 'number' ? x : NaN, r = 10 ** f[4];
    if (Number.isFinite(n) && n >= f[2] && n <= f[3]) v[k] = Math.round(n * r) / r; else dropped.push(k);
  }
  return { day, t, v, dropped: dropped.slice(0, 20) };
}

const locks = new Map(); // one write at a time per account
function withUser(uid, fn) { const run = (locks.get(uid) || Promise.resolve()).then(fn); const tail = run.catch(() => {}); locks.set(uid, tail);
  tail.then(() => { if (locks.get(uid) === tail) locks.delete(uid); }); return run; }

/** merges a checked snapshot into the day's record: per field the newer snapshot wins; days older than KEEP_DAYS go */
export function storeHealth(uid, s, now = Date.now()) {
  return withUser(uid, async () => {
    const f = await readJSON(file(uid), null), days = f && typeof f.days === 'object' && f.days ? f.days : {};
    const d = days[s.day] || { first: s.t, last: s.t, v: {}, at: {} };
    d.first = Math.min(d.first, s.t); d.last = Math.max(d.last, s.t);
    for (const [k, x] of Object.entries(s.v)) if (!(d.at[k] > s.t)) { d.v[k] = x; d.at[k] = s.t; }
    days[s.day] = d;
    const old = dayKey(now - KEEP_DAYS * 864e5); for (const k of Object.keys(days)) if (k < old) delete days[k];
    await writeJSON(file(uid), { days, at: now });
    return d;
  });
}

/** the account's records of the last n days (by the watch's day), newest first: [{ day, first, last, at: { key: ms }, ...values }]
 *  (27.11.7: at = per field the time of the snapshot that carried its value, as stored since 25.11.; {} when missing) */
export async function healthOf(uid, n = 30, now = Date.now()) {
  const f = await readJSON(file(uid), null), days = f && typeof f.days === 'object' && f.days ? f.days : {}, from = dayKey(now - (n - 1) * 864e5);
  return Object.keys(days).filter(k => k >= from).sort().reverse().map(k => ({ day: k, first: days[k].first, last: days[k].last, at: days[k].at && typeof days[k].at === 'object' ? days[k].at : {}, ...days[k].v }));
}
/** the newest value of each field over the list (with the day it is from; 27.11.7: t = its snapshot's time in ms, else the day's last) */
export function latestOf(list) {
  const o = {}; for (const r of list) for (const k of Object.keys(HEALTH)) if (r[k] != null && !o[k]) o[k] = { v: r[k], day: r.day, t: r.at?.[k] > 0 ? r.at[k] : r.last };
  return o;
}

/** GET /api/account/health?days= (1 to 400, default 30); true when the path was this one */
export async function healthApi(req, res, path) {
  if (path !== '/api/account/health') return false;
  const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
  if (req.method !== 'GET') return send(res, 405, { error: 'not allowed' });
  const q = new URL(req.url, 'http://x').searchParams.get('days'), n = q == null ? 30 : Math.round(+q);
  if (!(n >= 1 && n <= KEEP_DAYS)) return send(res, 400, { error: `days: 1 to ${KEEP_DAYS}.` });
  const days = await healthOf(me.u.id, n);
  return send(res, 200, { days, latest: latestOf(days), keys: Object.fromEntries(Object.entries(HEALTH).map(([k, f]) => [k, [f[0], f[1]]])) });
}
