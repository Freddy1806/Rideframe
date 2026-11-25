// Garmin watch API (17.11.: strength training on the Forerunner 265 / fenix 7X Pro, garmin/ and the preview watch.html).
// Pairing: the signed-in phone asks for a 6-digit code (10 min, single use), the watch trades it for a long device token.
// Only a hash of the token is stored, with label and created / last-used time; the phone lists and removes watches.
// Every watch call sends "Authorization: Bearer <token>". Sessions land as normal strength records (users/<id>/kraft/),
// so the phone app shows them after its next sync, marked source: 'watch'. Stored in <data>/watches.json.
// 18.11.: the watch config (data pages per sport, "more" sports, workouts, js/watchfields.js) is edited on the phone
// (GET / PUT /api/watch/config with the login), kept in users/<id>/watch.json and served to the watch in a compact form.
import { randomBytes, randomInt } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { accountOf, userByKey, shared } from './accounts-api.mjs';
import { linkStrava, validateAct, storeActivity, linkStrength, segQuery, segmentsFor, validateRoute, routeList, putRoute, deleteRoute, routeForWatch } from './watch-feed.mjs';

const { DATA, readJSON, writeJSON, send, body, limited, clientIp, userDir, sha, count, MAX_FILES } = shared;
const WF = join(DATA, 'watches.json');
const CODE_MS = 10 * 60e3, MAX_WATCHES = 10, USED_EVERY = 10 * 60e3, MAX_SETS = 120;
let wlock = Promise.resolve(); // serialise writes to watches.json
function withW(fn) { const run = wlock.then(async () => fn(await readJSON(WF, { codes: {}, devs: {} }))); wlock = run.catch(() => {}); return run; }
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);

/* ---- what the server knows of the exercises: the catalogue (js/kraftlib.js), the user's own ones (settings.kraftEx) and history ---- */
let CAT = null;
export async function catalog() { // the browser module, loaded lazily so an old Node without ES module detection only loses the names, never the server
  if (!CAT) { CAT = (await import('../js/kraftlib.js').then(m => m.CATALOG, () => [])).slice();
    // 25.11.: plus the guided workouts' exercises (js/kraftguide.js, one per arm, timed) and the watch's standard workouts' own ones
    // (js/watchflow.js STD_EX), so a set the watch sends for them keeps its name and type (a hold is seconds, not 0 kg x reps)
    const more = [...await import('../js/kraftguide.js').then(m => m.GUIDE_EX, () => []), ...await import('../js/watchflow.js').then(m => m.STD_EX, () => [])];
    for (const e of more) if (!CAT.some(x => x.k === e.k)) CAT.push(e); }
  return CAT;
}
const SHORT = { squat: 'Squat', rdl: 'Romanian DL', incline: 'Incline DB press', row: 'Barbell row', tri: 'Tri pushdown', lateral: 'Lateral raise', legraise: 'Hanging leg raise',
  oap_neg_l: 'OA negative left', oap_neg_r: 'OA negative right', oapu_neg_l: 'OA negative left', oapu_neg_r: 'OA negative right',
  oap_hold_l: 'OA lock-off left', oap_hold_r: 'OA lock-off right', oapu_hold_l: 'OA hold left', oapu_hold_r: 'OA hold right' };
/** ≤ 18 characters for the watch: own short form, else without the "(barbell)" part, else cut */
export const shortName = (k, n) => { const s = SHORT[k] || String(n || k).replace(/\s*\(.*?\)\s*/g, ' ').trim(); return s.length <= 18 ? s : s.slice(0, 17).trim() + '.'; };
const e1rm = (kg, r) => kg > 0 && r > 0 ? (r === 1 ? kg : kg * (1 + r / 30)) : 0; // Epley, same as kraftlib.js

const cache = new Map(); // file -> { m, s } compact view of one strength session
export async function sessions(uid) { // every strength session of the account, newest first: { id, start, ex: [{ k, n, t, sets: [[kg, r]] }] }
  const d = join(userDir(uid), 'kraft'), out = [];
  for (const f of (await readdir(d).catch(() => [])).filter(x => x.endsWith('.json'))) {
    const fp = join(d, f), st = await stat(fp).catch(() => null); if (!st) continue;
    let c = cache.get(fp);
    if (!c || c.m !== st.mtimeMs) { const w = await readJSON(fp, null); c = { m: st.mtimeMs, s: w && { id: w.id, start: +(w.start || w.date) || 0, dur: +w.dur || 0, name: String(w.name || ''), source: w.source, stravaId: w.stravaId, strava: w.strava,
      ex: (Array.isArray(w.ex) ? w.ex : []).map(x => ({ k: String(x?.k || ''), n: String(x?.n || ''), t: x?.t, sets: (Array.isArray(x?.sets) ? x.sets : []).filter(y => y && y.done !== false && !y.warm).map(y => [+y.kg || 0, +y.r || 0, +y.s || 0]) })).filter(x => x.k) } };
      cache.set(fp, c); if (cache.size > 20000) cache.clear(); }
    if (c.s) out.push(c.s);
  }
  return out.sort((a, b) => b.start - a.start);
}
const settingsOf = async uid => (await readJSON(join(userDir(uid), 'settings.json'), null))?.settings || {};

/* ---- the watch config (18.11.): data pages per sport, "more" sports, workouts; set up on the phone, one file per account ---- */
const WFM = () => import('../js/watchfields.js'); // pure browser module, like kraftlib.js
const cfgFile = uid => join(userDir(uid), 'watch.json');
export async function configOf(uid) { const W = await WFM(), f = await readJSON(cfgFile(uid), null), v = f && W.validate(f.cfg);
  return v && v.cfg ? { cfg: v.cfg, at: +f.at || 0, stored: true } : { cfg: W.defaults(), at: 0, stored: false }; }

/** what the account knows of its exercises: info = id -> { n, t, g, own } (catalogue, own ones, the top 20, whatever a session used),
 *  use = id -> { last, n, sets, best } from the history (sets of the newest session). Shared by setup() and the Claude connector (tools/mcp-api.mjs) */
export async function exerciseData(u) {
  const S = await settingsOf(u.id), list = await sessions(u.id), cat = await catalog(), info = new Map(), W = await WFM();
  for (const e of cat) info.set(e.k, { n: e.n, t: e.t, g: e.g });
  for (const e of Array.isArray(S.kraftEx) ? S.kraftEx : []) if (e?.k && !info.has(e.k)) info.set(String(e.k), { n: String(e.n || e.k), t: e.t, own: true });
  for (const e of W.TOP) if (!info.has(e.id)) info.set(e.id, { n: e.n, t: e.t });
  const use = new Map(), now = Date.now();
  for (const s of list) for (const x of s.ex) {
    if (!info.has(x.k)) info.set(x.k, { n: x.n || x.k, t: x.t });
    const sets = x.sets.filter(y => y[1] > 0 || y[2] > 0); if (!sets.length) continue;
    const m = use.get(x.k) || use.set(x.k, { last: s.start, n: 0, sets, best: 0 }).get(x.k);
    if (now - s.start < 90 * 864e5) m.n++;
    for (const [kg, r, sec] of sets) m.best = Math.max(m.best, x.t === 'time' ? sec : x.t === 'bw' ? r : e1rm(kg, r));
  }
  return { S, list, info, use, W };
}

/** the watch's whole strength setup, kept small (< 8 KB): exercises most recently / often used first, their last sets and best;
 *  since 18.11. also the workouts from the phone, the 20 standard exercises (top) and the recent ones (recent), all of them in ex */
export async function setup(u) {
  const { S, list, info, use, W } = await exerciseData(u), C = (await configOf(u.id)).cfg, now = Date.now();
  // recent use counts most: one point per session in the last 90 days, plus up to 10 for having been done in the last days
  const score = k => { const m = use.get(k); return m ? m.n + 10 * Math.max(0, 1 - (now - m.last) / (60 * 864e5)) + 1e-15 * m.last : -1; };
  const top = W.TOP.map(e => e.id), inW = new Set(C.workouts.flatMap(w => w.items.map(i => i.ex)));
  const keys = [...info.keys()].filter(k => ['w', 'bw'].includes(info.get(k).t)); // timed exercises (plank) only as one of the top 20 or in a workout
  keys.sort((a, b) => score(b) - score(a) || (info.get(b).own ? 1 : 0) - (info.get(a).own ? 1 : 0)); // then own ones, then the catalogue order
  const r1 = v => Math.round(v * 10) / 10, name = k => shortName(k, W.TOP.find(e => e.id === k)?.n || info.get(k)?.n || k);
  const one = k => { const e = info.get(k) || { n: k, t: 'w' }, m = use.get(k), o = { id: k, n: name(k), t: ['bw', 'time'].includes(e.t) ? e.t : 'w' };
    if (m) { o.s = m.sets.slice(0, 6).map(([kg, r, sec]) => e.t === 'time' ? [0, sec] : [r1(kg), r]); o.b = r1(m.best); } return o; };
  const ids = keys.slice(0, 40); for (const k of [...top, ...inW]) if (!ids.includes(k)) ids.push(k);
  const recent = [...use.entries()].filter(([, m]) => now - m.last < 90 * 864e5).sort((a, b) => b[1].last - a[1].last).slice(0, 8).map(([k]) => k).filter(k => ids.includes(k));
  const last = list[0], sets = last ? last.ex.reduce((a, x) => a + x.sets.length, 0) : 0;
  return { v: 1, unit: 'kg', rest: Math.min(600, Math.max(15, +S.kraftRest || 90)), ex: ids.map(one), last: last ? { at: Math.round(last.start / 1000), sets, n: clean(last.name, 24) } : null,
    top, recent, workouts: W.compact(C).w };
}

/* ---- 23.11.: a workout saved on the watch (the session as a template) -> the account's watch config, so it shows on the phone
 *      (Settings > Devices > Watch screens & workouts, the Strength page) and comes back to the watch with the setup / config ---- */
let cfgLock = Promise.resolve(); // serialise the read-change-write of one config against itself
/** body { id, n, it: [[ex, sets, reps, kg, rest]] } (js/watchflow.js tplOf); the same id again replaces its exercises and keeps the phone's name.
 *  Returns [status, body]: 400 for anything the watch must not send again (bad, or 30 workouts already) */
export function saveWatchWorkout(uid, b) {
  const run = cfgLock.then(async () => {
    if (!b || typeof b !== 'object') return [400, { error: 'Body must be JSON.' }];
    const id = String(b.id || ''); if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return [400, { error: 'id: 1 to 40 letters, digits, _ or -.' }];
    if (!Array.isArray(b.it) || !b.it.length || b.it.length > 20) return [400, { error: 'it: 1 to 20 exercises.' }];
    if (!b.it.every(x => Array.isArray(x) && x.length >= 5)) return [400, { error: 'it: [ex, sets, reps, kg, rest].' }];
    const W = await WFM(), c = await configOf(uid), list = c.cfg.workouts.slice(), k = list.findIndex(x => x.id === id);
    const items = b.it.map(([ex, sets, reps, kg, rest]) => ({ ex, sets, reps, kg, rest }));
    if (k >= 0) list[k] = { ...list[k], items }; else { if (list.length >= W.MAX_WORKOUTS) return [400, { error: `Up to ${W.MAX_WORKOUTS} workouts. Delete one on the phone.` }]; list.push({ id, name: clean(b.n, 40) || 'Workout', items }); }
    const v = W.validate({ ...c.cfg, workouts: list }); if (v.error) return [400, { error: v.error }];
    await writeJSON(cfgFile(uid), { cfg: v.cfg, at: Date.now() });
    return [200, { ok: true, id, new: k < 0 }];
  });
  cfgLock = run.catch(() => {}); return run;
}

/** 23.11. (Claude connector, tools/mcp-api.mjs): change the account's workouts under the same lock as saveWatchWorkout.
 *  fn(list, W) gets a copy of the workouts and returns { list, ...extra } or { error }; the whole config then goes through
 *  W.validate (js/watchfields.js, the phone editor's check) before it is written. Returns { cfg, ...extra } or { error } */
export function editWorkouts(uid, fn) {
  const run = cfgLock.then(async () => {
    const W = await WFM(), c = await configOf(uid), r = await fn(c.cfg.workouts.map(w => ({ ...w, items: w.items.map(i => ({ ...i })) })), W);
    if (!r || r.error) return r || { error: 'Nothing changed.' };
    const { list, ...extra } = r, v = W.validate({ ...c.cfg, workouts: list }); if (v.error) return { error: v.error };
    await writeJSON(cfgFile(uid), { cfg: v.cfg, at: Date.now() });
    return { cfg: v.cfg, ...extra };
  });
  cfgLock = run.catch(() => {}); return run;
}

/* ---- a finished watch session -> a strength record exactly like kraft.js saves it ---- */
/** checks and normalises the watch's JSON; returns { error } or { rec } (without names / records, see toRecord) */
export function validate(b) {
  if (!b || typeof b !== 'object') return { error: 'Body must be JSON.' };
  const id = String(b.id || ''); if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return { error: 'id: 6–40 letters, digits, _ or -.' };
  let start = +b.start; if (!(start > 0)) return { error: 'start missing.' };
  if (start < 1e11) start *= 1000; // the watch sends Unix seconds (Monkey C numbers are 32 bit); ms are taken too
  const now = Date.now(); if (start > now + 10 * 60e3 || start < now - 60 * 864e5) return { error: 'start is not within the last 60 days.' };
  const dur = Math.round(+b.duration || 0); if (!(dur >= 0 && dur <= 6 * 3600)) return { error: 'duration: 0 to 6 hours in seconds.' };
  if (!Array.isArray(b.sets) || !b.sets.length || b.sets.length > MAX_SETS) return { error: `sets: 1 to ${MAX_SETS}.` };
  const sets = [];
  for (const s of b.sets) {
    const ex = String(s?.ex || ''), kg = +s?.kg || 0, reps = +s?.reps, t = Math.round(+s?.t || 0);
    if (!/^[\w-]{1,64}$/.test(ex)) return { error: 'set.ex: an exercise id.' };
    if (!(kg >= 0 && kg <= 600)) return { error: 'set.kg: 0 to 600.' };
    if (!Number.isInteger(reps) || reps < 1 || reps > 500) return { error: 'set.reps: 1 to 500.' };
    if (!(t >= 0 && t <= dur + 600)) return { error: 'set.t: seconds since start.' };
    sets.push({ ex, kg: Math.round(kg * 100) / 100, reps, t });
  }
  const hr = b.hr && typeof b.hr === 'object' ? { avg: Math.round(+b.hr.avg || 0), max: Math.round(+b.hr.max || 0) } : null;
  const okHr = v => v >= 30 && v <= 240;
  return { id, start, dur, sets, hr: hr && okHr(hr.avg) && okHr(hr.max) ? hr : null, kcal: +b.kcal > 0 && +b.kcal < 5000 ? Math.round(+b.kcal) : 0, label: clean(b.name, 40) };
}
const nameAt = t => { const h = new Date(t).getHours(); return h < 11 ? 'Morning workout' : h < 17 ? 'Midday workout' : 'Evening workout'; };
/** builds the record and marks records (pr) against the account's earlier sessions, like kraft.js markPrs */
export function toRecord(v, info, history) {
  const ex = [], at = new Map();
  for (const s of v.sets.slice().sort((a, b) => a.t - b.t)) { // one block per exercise, in the order first done
    let x = at.get(s.ex); if (!x) { const e = info.get(s.ex) || { n: s.ex, t: 'w' }; x = { k: s.ex, n: e.n, t: ['bw', 'time'].includes(e.t) ? e.t : 'w', sets: [] }; at.set(s.ex, x); ex.push(x); }
    x.sets.push(x.t === 'time' ? { kg: '', r: '', s: s.reps, done: true } : { kg: x.t === 'bw' && !s.kg ? '' : s.kg, r: s.reps, s: '', done: true }); // a timed exercise: the watch's reps are seconds
  }
  let prs = 0;
  for (const x of ex) { const h = history.flatMap(w => w.ex.filter(y => y.k === x.k).flatMap(y => y.sets)); if (!h.length || x.t === 'time') continue;
    const best = Math.max(...h.map(([kg, r]) => x.t === 'bw' ? r : e1rm(kg, r))); let hit = false;
    for (const y of x.sets) if (x.t === 'bw' ? +y.r > best : e1rm(+y.kg, +y.r) > best + .01) { y.pr = true; hit = true; }
    if (hit) prs++; }
  const rec = { id: 'watch-' + v.id, name: v.label || nameAt(v.start), start: v.start, date: v.start + v.dur * 1000, dur: v.dur, source: 'watch', ex };
  if (prs) rec.prs = prs; if (v.hr) { rec.avgHr = v.hr.avg; rec.maxHr = v.hr.max; } if (v.kcal) rec.kcal = v.kcal;
  return rec;
}

/* ---- week summary for the glance: points (js/fitness.js, the same numbers as the phone), sessions, streak ---- */
const sumCache = new Map(); // uid -> { at, v }
async function summaryOf(u) {
  const c = sumCache.get(u.id); if (c && Date.now() - c.at < 5 * 60e3) return c.v;
  const F = await import('../js/fitness.js').catch(() => null), S = await settingsOf(u.id);
  const mon = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const w0 = mon(Date.now()), w1 = mon(w0 - 3 * 864e5), since = Date.now() - 56 * 864e5;
  const kr = (await sessions(u.id)).map(s => ({ kraft: true, id: s.id, date: s.start, start: s.start, dur: s.dur, source: s.source, stravaId: s.stravaId, strava: s.strava }));
  // rides: dates of all (the streak) from the leaderboard's summary cache; the full file only for the last 8 weeks (points need the samples)
  const rd = join(userDir(u.id), 'rides'), dates = [], recent = [];
  for (const f of (await readdir(rd).catch(() => [])).filter(x => x.endsWith('.json'))) {
    const fp = join(rd, f), st = await stat(fp).catch(() => null); if (!st) continue;
    let s = shared.sums.get(fp); if (!s || s.m !== st.mtimeMs) { const r = await readJSON(fp, null); s = shared.summary(st.mtimeMs, r); shared.sums.set(fp, s); if (r && s.date >= since && r.routeId !== 'demo') recent.push(r); }
    else if (s.date >= since && s.routeId !== 'demo') { const r = await readJSON(fp, null); if (r) recent.push(r); }
    if (s.date && s.routeId !== 'demo') dates.push({ date: s.date });
  }
  const AI = await import('../js/actimport.js').catch(() => null), one = l => AI ? AI.collapse(l) : l; // a watch session and its Strava copy count once
  const acts = one([...recent.filter(r => !r.unsaved && r.date), ...kr.filter(k => k.date >= since)]);
  let pts = null, prev = null;
  if (F) { const P = F.profileOf(S, acts), sum = l => Math.round(l.reduce((a, x) => a + F.loadOf(x, P).pts, 0));
    pts = sum(acts.filter(a => a.date >= w0)); prev = sum(acts.filter(a => a.date >= w1 && a.date < w0)); }
  const v = { pts, prev, delta: pts == null ? null : pts - prev, sessions: acts.filter(a => a.date >= w0).length, strength: kr.filter(k => k.date >= w0).length,
    streak: F ? F.streak([...dates, ...kr]) : null, week: Math.round(w0 / 1000) };
  sumCache.set(u.id, { at: Date.now(), v }); if (sumCache.size > 500) sumCache.clear();
  return v;
}

/* ---- auth ---- */
async function watchOf(req) { // the paired watch behind "Authorization: Bearer …", or null
  const m = String(req.headers.authorization || '').match(/^Bearer\s+([A-Za-z0-9_-]{20,100})$/); if (!m) return null;
  const h = sha(m[1]), W = await readJSON(WF, { codes: {}, devs: {} }), d = Object.hasOwn(W.devs, h) ? W.devs[h] : null; if (!d) return null;
  const u = await userByKey(d.key); if (!u || u.id !== d.uid) return null; // a deleted account (or a new one with the same name) never inherits a watch
  if (Date.now() - (d.used || 0) > USED_EVERY) withW(async W => { if (W.devs[h]) { W.devs[h].used = Date.now(); await writeJSON(WF, W); } }).catch(() => {});
  return { u, d, h };
}
const watchView = d => ({ id: d.id, label: d.label, created: d.created, used: d.used || 0 });

/** returns true when the request was a /api/watch call (answered here) */
export async function watchApi(req, res, path) {
  if (!path.startsWith('/api/watch/')) return false;
  const op = path.slice(11), M = req.method;
  try {
    /* -- phone side (signed in with the normal login token) -- */
    if (op === 'code' && M === 'POST') {
      const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' }); await linkStrava(req, me.u.id).catch(() => {});
      if (limited('wcode:' + me.key, 10, 36e5)) return send(res, 429, { error: 'Too many codes. Please try again in an hour.' });
      return await withW(async W => {
        const now = Date.now(); for (const [k, c] of Object.entries(W.codes)) if (!(c.exp > now) || c.key === me.key) delete W.codes[k]; // one live code per account
        if (Object.keys(W.codes).length > 500) return send(res, 503, { error: 'Pairing is busy. Please try again in a few minutes.' });
        let code; do code = String(randomInt(0, 1e6)).padStart(6, '0'); while (Object.hasOwn(W.codes, sha('wc:' + code)));
        W.codes[sha('wc:' + code)] = { key: me.key, uid: me.u.id, exp: now + CODE_MS }; await writeJSON(WF, W);
        return send(res, 200, { code, exp: now + CODE_MS, ttl: CODE_MS / 1000 });
      });
    }
    if (op === 'devices' && M === 'GET') {
      const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' }); await linkStrava(req, me.u.id).catch(() => {}); // the watch's segments use the phone's Strava (watch-feed.mjs)
      const W = await readJSON(WF, { codes: {}, devs: {} });
      return send(res, 200, { watches: Object.values(W.devs).filter(d => d.key === me.key && d.uid === me.u.id).sort((a, b) => b.created - a.created).map(watchView) });
    }
    const dm = op.match(/^devices\/([0-9a-f]{12})$/);
    if (dm && M === 'DELETE') {
      const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
      return await withW(async W => { const e = Object.entries(W.devs).find(([, d]) => d.id === dm[1] && d.key === me.key); if (!e) return send(res, 404, { error: 'Watch not found.' });
        delete W.devs[e[0]]; await writeJSON(WF, W); return send(res, 200, { ok: true }); });
    }
    if (op === 'config' && !req.headers.authorization) { // the phone: read / replace the account's watch config (js/watchcfg.js)
      const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' }); await linkStrava(req, me.u.id).catch(() => {});
      if (M === 'GET') { const c = await configOf(me.u.id); return send(res, 200, { config: c.cfg, at: c.at, stored: c.stored }); }
      if (M !== 'PUT') return send(res, 405, { error: 'not allowed' });
      if (limited('wcfg:' + me.key, 120, 10 * 60e3)) return send(res, 429, { error: 'Too many saves. Please wait a few minutes.' });
      let b; try { b = await body(req, 64e3); } catch (e) { return send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'Config too large.' : 'Body must be JSON.' }); }
      const v = (await WFM()).validate(b); if (v.error) return send(res, 400, { error: v.error });
      const at = Date.now(); await writeJSON(cfgFile(me.u.id), { cfg: v.cfg, at });
      return send(res, 200, { ok: true, config: v.cfg, at });
    }
    const rm = op.match(/^routes(?:\/([^/]{1,80}))?$/);
    if (rm && !req.headers.authorization) { // the phone: routes sent to the watch (js/outdoor.js routes sheet), a simplified copy per account
      const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' }); await linkStrava(req, me.u.id).catch(() => {});
      if (!rm[1]) return M === 'GET' ? send(res, 200, { routes: await routeList(me.u.id) }) : send(res, 405, { error: 'not allowed' });
      const id = rm[1];
      if (M === 'DELETE') { if (!/^[\w-]{1,64}$/.test(id)) return send(res, 400, { error: 'id: 1–64 letters, digits, _ or -.' }); return send(res, ...await deleteRoute(me.u.id, id)); }
      if (M !== 'PUT') return send(res, 405, { error: 'not allowed' });
      if (limited('wrt:' + me.key, 60, 10 * 60e3)) return send(res, 429, { error: 'Too many routes sent. Please wait a few minutes.' });
      let b; try { b = await body(req, 256e3); } catch (e) { return send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'Route too large.' : 'Body must be JSON.' }); }
      const v = await validateRoute(id, b); if (v.error) return send(res, 400, { error: v.error });
      return send(res, ...await putRoute(me.u.id, v));
    }
    if (op === 'route' && !req.headers.authorization && M === 'GET') { // the preview (watch.html) signed in on the phone, without a paired watch
      const me = await accountOf(req); if (!me) return send(res, 401, { error: 'Not signed in.' });
      const r = await routeForWatch(me.u.id, new URL(req.url, 'http://x').searchParams.get('id') || ''); return r ? send(res, 200, r) : send(res, 404, { error: 'Route not found.' });
    }
    /* -- watch side -- */
    if (op === 'pair' && M === 'POST') {
      // brute-force brakes: every try counts per address (10 per 10 min); wrong codes count for everyone (60 per 10 min), so 6 digits cannot be walked through
      const ip = clientIp(req), slow = { error: 'Too many tries. Please wait 10 minutes.' };
      if (badCount() >= 60) return send(res, 429, slow);
      if (limited('wpair-ip:' + ip, 10, 10 * 60e3)) return send(res, 429, slow);
      const b = await body(req, 2e3).catch(() => ({})), code = String(b.code ?? '').replace(/\D/g, ''), label = clean(b.label, 40) || 'Garmin watch';
      if (code.length !== 6) { bad(); return send(res, 400, { error: 'The code has 6 digits.' }); }
      return await withW(async W => {
        const k = sha('wc:' + code), c = Object.hasOwn(W.codes, k) ? W.codes[k] : null, now = Date.now();
        if (!c || !(c.exp > now)) { if (c) { delete W.codes[k]; await writeJSON(WF, W); } bad(); return send(res, 401, { error: 'Wrong or expired code.' }); }
        delete W.codes[k]; // single use
        const u = await userByKey(c.key); if (!u || u.id !== c.uid) { await writeJSON(WF, W); return send(res, 401, { error: 'Wrong or expired code.' }); }
        const mine = Object.entries(W.devs).filter(([, d]) => d.key === c.key).sort((a, b) => (a[1].used || a[1].created) - (b[1].used || b[1].created));
        while (mine.length >= MAX_WATCHES) delete W.devs[mine.shift()[0]]; // the longest unused one makes room
        const token = 'rfw_' + randomBytes(32).toString('base64url');
        W.devs[sha(token)] = { id: randomBytes(6).toString('hex'), key: c.key, uid: u.id, label, created: now, used: now };
        await writeJSON(WF, W); return send(res, 200, { token, name: u.name, label });
      });
    }
    if (!['strength/setup', 'strength', 'summary', 'me', 'config', 'activity', 'segments', 'routes', 'route', 'workout'].includes(op)) return send(res, 404, { error: 'unknown' });
    const w = await watchOf(req); if (!w) return send(res, 401, { error: 'Not paired.' });
    if (limited('wcall:' + w.h, 120, 10 * 60e3)) return send(res, 429, { error: 'Too many requests.' });
    if (op === 'me') return send(res, 200, { name: w.u.name, label: w.d.label });
    if (op === 'strength/setup' && M === 'GET') return send(res, 200, await setup(w.u));
    if (op === 'summary' && M === 'GET') return send(res, 200, await summaryOf(w.u));
    if (op === 'config' && M === 'GET') { const c = await configOf(w.u.id); return send(res, 200, { ...(await WFM()).compact(c.cfg), at: Math.round(c.at / 1000) }); }
    if (op === 'strength' && M === 'POST') {
      let b; try { b = await body(req, 32e3); } catch (e) { return send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'Session too large.' : 'Body must be JSON.' }); }
      const v = validate(b); if (v.error) return send(res, 400, { error: v.error });
      const dir = join(userDir(w.u.id), 'kraft'), f = join(dir, 'watch-' + v.id + '.json');
      if (await readJSON(f, null)) return send(res, 200, { ok: true, id: 'watch-' + v.id, dup: true }); // sent twice (the answer got lost): stored once
      if (await count(dir) >= MAX_FILES) return send(res, 507, { error: 'Storage for this account is full.' });
      const S = await settingsOf(w.u.id), info = new Map((await catalog()).map(e => [e.k, e])), hist = (await sessions(w.u.id)).filter(s => s.start < v.start);
      for (const e of Array.isArray(S.kraftEx) ? S.kraftEx : []) if (e?.k && !info.has(e.k)) info.set(e.k, e);
      for (const s of hist) for (const x of s.ex) if (!info.has(x.k)) info.set(x.k, { n: x.n, t: x.t });
      const rec = await linkStrength(w.u.id, toRecord(v, info, hist)).catch(() => toRecord(v, info, hist)); // its Strava copy already here: linked (watch-feed.mjs)
      await writeJSON(f, rec); sumCache.delete(w.u.id);
      return send(res, 200, { ok: true, id: rec.id, prs: rec.prs || 0 });
    }
    if (op === 'workout' && M === 'POST') { // 23.11.: a workout saved on the watch (queued there like the sessions)
      let b; try { b = await body(req, 8e3); } catch (e) { return send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'Workout too large.' : 'Body must be JSON.' }); }
      return send(res, ...await saveWatchWorkout(w.u.id, b));
    }
    if (op === 'activity' && M === 'POST') { // a run / ride / more recording (19.11.): one ride record, source 'watch' (watch-feed.mjs)
      let b; try { b = await body(req, 8e3); } catch (e) { return send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'Activity too large.' : 'Body must be JSON.' }); } // 23.11.: 8 KB (the trainer's series)
      const v = await validateAct(b); if (v.error) return send(res, 400, { error: v.error });
      const r = await storeActivity(w.u.id, v); if (r[0] === 200) sumCache.delete(w.u.id); return send(res, ...r);
    }
    const q = new URL(req.url, 'http://x').searchParams;
    if (op === 'segments' && M === 'GET') {
      if (limited('wseg:' + w.h, 30, 10 * 60e3)) return send(res, 429, { error: 'Too many segment requests.' });
      const v = segQuery(q); if (v.error) return send(res, 400, { error: v.error });
      return send(res, 200, await segmentsFor(w, v));
    }
    if (op === 'routes' && M === 'GET') return send(res, 200, { routes: (await routeList(w.u.id)).map(({ at, ...r }) => ({ ...r, name: r.name.length > 24 ? r.name.slice(0, 23).trim() + '.' : r.name })) });
    if (op === 'route' && M === 'GET') { const r = await routeForWatch(w.u.id, q.get('id') || ''); return r ? send(res, 200, r) : send(res, 404, { error: 'Route not found.' }); }
    return send(res, 405, { error: 'not allowed' });
  } catch (e) { return send(res, 500, { error: 'Server error.' }); }
}
// wrong pairing codes over all addresses: counted in a window of their own, so a flood blocks pairing for 10 minutes and nothing else
const badHits = [];
function bad() { const now = Date.now(); badHits.push(now); while (badHits.length && now - badHits[0] > 10 * 60e3) badHits.shift(); }
function badCount() { const now = Date.now(); while (badHits.length && now - badHits[0] > 10 * 60e3) badHits.shift(); return badHits.length; }
