// What the Garmin watch gets and sends besides strength (19.11.): its run / ride / more activities, Strava segments around it
// (through the account's Strava connection, server-side), and the routes the user sends to the watch from the phone.
// Wired into tools/watch-api.mjs (auth, per-watch rate limit); the browser modules (sports.js, actimport.js, navroute.js,
// segtrack.js) are pure and loaded lazily, like kraftlib.js there. Formats: garmin/README.md.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { shared } from './accounts-api.mjs';
import { stravaKnown, stravaToken, exploreSegs, segDetail, segCached, nearLimit } from './strava-api.mjs';

const { readJSON, writeJSON, userDir, count, MAX_FILES } = shared;
const SP = () => import('../js/sports.js'), AI = () => import('../js/actimport.js'), NR = () => import('../js/navroute.js'), ST = () => import('../js/segtrack.js');
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);
const r5 = v => Math.round(v * 1e5) / 1e5;
const cut = (s, n) => s.length <= n ? s : s.slice(0, n - 1).trim() + '.';
let lock = Promise.resolve(); // one writer at a time for the per-account files here (routes, Strava link, merges)
const serial = fn => { const run = lock.then(fn); lock = run.catch(() => {}); return run; };

/* ---- the account's Strava connection: Strava keys belong to a browser, so the phone tells the host which one is the account's ---- */
const linkFile = uid => join(userDir(uid), 'strava-link.json');
/** phone calls to /api/watch/* carry X-Strava-Key when the phone is connected to Strava: remembered for the account (never sent back) */
export async function linkStrava(req, uid) {
  const k = String(req.headers['x-strava-key'] || ''); if (!k || !(await stravaKnown(k))) return;
  const f = linkFile(uid), old = await readJSON(f, null); if (old?.key === k && Date.now() - (old.at || 0) < 864e5) return;
  await serial(() => writeJSON(f, { key: k, at: Date.now() }));
}

/* ---- POST /api/watch/activity: a run / ride / more recording, stored like a manual "+ Add activity" entry ---- */
const ACT = { id: 1, type: 1, start: 1, duration: 1, moving: 1, dist: 1, climb: 1, hr: 1, maxHr: 1, kcal: 1, power: 0, laps: 0 }; // 1 = required
/** strict check of the watch's JSON: { error } or the normalised values */
export async function validateAct(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'Body must be a JSON object.' };
  for (const k of Object.keys(b)) if (!Object.hasOwn(ACT, k)) return { error: `unknown key "${clean(k, 20)}".` };
  for (const [k, req] of Object.entries(ACT)) if (req && b[k] == null) return { error: k + ' missing.' };
  const id = b.id; if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(id)) return { error: 'id: 6–40 letters, digits, _ or -.' };
  const { STRAVA } = await SP(); if (typeof b.type !== 'string' || !Object.hasOwn(STRAVA, b.type)) return { error: 'type: a Strava sport type (Run, Ride, Hike …).' };
  const num = (k, lo, hi) => { const v = b[k]; if (v == null) return 0; if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k}: ${lo} to ${hi}.`); return Math.round(v); };
  try {
    let start = b.start; if (typeof start !== 'number' || !(start > 0)) return { error: 'start: Unix seconds.' };
    if (start < 1e11) start *= 1000; start = Math.round(start); // Unix seconds from the watch (32-bit numbers); ms are taken too
    const now = Date.now(); if (start > now + 10 * 60e3 || start < now - 60 * 864e5) return { error: 'start is not within the last 60 days.' };
    const v = { id, type: b.type, start, duration: num('duration', 1, 86400), moving: num('moving', 0, 86400), dist: num('dist', 0, 1e6), climb: num('climb', 0, 20000),
      hr: num('hr', 0, 250), maxHr: num('maxHr', 0, 250), kcal: num('kcal', 0, 20000), power: num('power', 0, 3000), laps: num('laps', 0, 1000) };
    if (v.moving > v.duration + 60) return { error: 'moving: at most the duration.' };
    if (v.hr && v.hr < 25) v.hr = 0; if (v.maxHr && v.maxHr < 25) v.maxHr = 0; // a sensor that is not worn
    return v;
  } catch (e) { return { error: e.message }; }
}
/** the ride record, the same shape as js/addact.js saves a manual entry (js/actimport.js fromEntry), source 'watch' */
export async function toActivity(v) {
  const { fromEntry } = await AI();
  const r = fromEntry({ sportType: v.type, start: v.start, duration: v.moving || v.duration, elapsed: v.duration, distance: v.dist, gain: v.climb, avgHr: v.hr, maxHr: Math.max(v.maxHr, v.hr), kcal: v.kcal, avgPower: v.power }, 'watch', 'watch-' + v.id);
  if (v.laps) r.nLaps = v.laps; // a count (rides keep their laps as a list in laps) if (v.dist > 0 && v.type !== 'VirtualRide' && v.type !== 'VirtualRun') r.outdoor = true;
  return r;
}
/** the account's rides around a start (± 1 day), full records; the leaderboard's summary cache keeps this cheap */
async function ridesNear(uid, start) {
  const rd = join(userDir(uid), 'rides'), out = [];
  for (const f of (await readdir(rd).catch(() => [])).filter(x => x.endsWith('.json'))) {
    const fp = join(rd, f), st = await stat(fp).catch(() => null); if (!st) continue;
    let s = shared.sums.get(fp); if (!s || s.m !== st.mtimeMs) { const r = await readJSON(fp, null); s = shared.summary(st.mtimeMs, r); shared.sums.set(fp, s); }
    if (Math.abs((s.date || 0) - start) > 864e5) continue;
    const r = await readJSON(fp, null); if (r?.id) out.push({ f: fp, r });
  }
  return out;
}
/** stores one watch activity: [status, answer]. Idempotent by id. When the Strava import brought the same session first, the
 *  watch's numbers go into that record (one entry); the other way round the phone's import links them (actimport.js). */
export async function storeActivity(uid, v) {
  const dir = join(userDir(uid), 'rides'), f = join(dir, 'watch-' + v.id + '.json');
  return serial(async () => {
    if (await readJSON(f, null)) return [200, { ok: true, id: 'watch-' + v.id, dup: true }];
    const rec = await toActivity(v), near = await ridesNear(uid, v.start), { sameAct, mergeAct } = await AI();
    const merged = near.find(x => x.r.watch === v.id); if (merged) return [200, { ok: true, id: merged.r.id, dup: true, merged: true }];
    const twin = near.find(x => x.r.source === 'strava' && sameAct(rec, x.r));
    if (twin) { const m = { ...mergeAct(twin.r, rec), watch: v.id }; await writeJSON(twin.f, m); return [200, { ok: true, id: m.id, merged: true }]; }
    if (await count(dir) >= MAX_FILES) return [507, { error: 'Storage for this account is full.' }];
    await writeJSON(f, rec); return [200, { ok: true, id: rec.id }];
  });
}
/** a watch strength session (tools/watch-api.mjs toRecord) whose Strava WeightTraining copy was imported first: linked to it, so
 *  the feed shows one entry (actimport.js collapse) and the import never adds it again */
export async function linkStrength(uid, rec) {
  const { sameAct, sidOf } = await AI(), k = { ...rec, kraft: true, date: rec.start };
  const twin = (await ridesNear(uid, rec.start)).find(x => x.r.source === 'strava' && sameAct(k, x.r));
  if (twin && !sidOf(rec)) { rec.stravaId = sidOf(twin.r); rec.strava = twin.r.strava; if (!rec.avgHr && twin.r.avgHr) { rec.avgHr = twin.r.avgHr; if (twin.r.maxHr) rec.maxHr = twin.r.maxHr; } }
  return rec;
}

/* ---- GET /api/watch/segments?lat=&lon=&type=run|ride: Strava segments near the watch, nearest first ---- */
const segCache = new Map(); // watch hash | type | rounded position -> { at, v }
const SEG_MS = 5 * 60e3, SEG_MAX = 8, SEG_PTS = 40, SEG_BYTES = 8192, NEW_DETAILS = 3;
export function segQuery(q) {
  const lat = Number(q.get('lat')), lon = Number(q.get('lon')), type = q.get('type');
  if (!q.has('lat') || !q.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'lat, lon: a position in degrees.' };
  if (type !== 'run' && type !== 'ride') return { error: 'type: run or ride.' };
  return { lat, lon, type };
}
export async function segmentsFor(w, { lat, lon, type }) {
  const ck = `${w.h}|${type}|${lat.toFixed(2)},${lon.toFixed(2)}`, c = segCache.get(ck); // ~1 km: a watch asking again (retry, every 3 km) costs no Strava call
  if (c && Date.now() - c.at < SEG_MS) return c.v;
  const link = await readJSON(linkFile(w.u.id), null), tok = link?.key ? await stravaToken(link.key) : null;
  if (!tok) return { segs: [], strava: false };
  const d = .06, ex = await exploreSegs(tok, [lat - d, lon - d * 2, lat + d, lon + d * 2], type === 'run' ? 'running' : 'riding'); // the phone's box (outdoor.js loadSegs)
  if (!ex) return { segs: [], strava: true, limited: nearLimit() }; // not cached: the next call may get through
  const { decode } = await ST(), { simplify, dist } = await NR(), me = [lat, lon];
  const list = ex.map(e => ({ e, pts: typeof e.points === 'string' ? decode(e.points) : [] })).filter(x => x.pts.length > 1 && /^\d{1,20}$/.test(String(x.e.id_str ?? x.e.id)))
    .map(x => ({ ...x, d: dist(me, x.pts[0]) })).sort((a, b) => a.d - b.d).slice(0, SEG_MAX);
  let asked = 0; const segs = [];
  for (const { e, pts } of list) {
    const id = String(e.id_str ?? e.id); let det = segCached(link.key, id);
    if (!det && asked < NEW_DETAILS && !nearLimit()) { asked++; const [code, v] = await segDetail(link.key, tok, id); if (code === 200) det = v; } // PR and KOM: a few new ones per call, 24 h cached
    segs.push({ id, n: cut(clean(e.name, 80) || 'Segment', 24), len: Math.round(+e.distance || 0), pr: Math.round(+det?.pr || 0), kom: Math.round(+det?.komS || 0), p: simplify(pts, SEG_PTS).map(q => [r5(q[0]), r5(q[1])]) });
  }
  const v = { segs, strava: true }; while (segs.length && JSON.stringify(v).length >= SEG_BYTES) segs.pop();
  segCache.set(ck, { at: Date.now(), v }); if (segCache.size > 2000) segCache.clear();
  return v;
}

/* ---- routes for the watch: the phone sends a simplified copy (PUT / DELETE, max 20), the watch lists and loads them ---- */
const routeFile = uid => join(userDir(uid), 'watch-routes.json');
const MAX_ROUTES = 20, KEEP_PTS = 500, WATCH_PTS = 200, ROUTE_BYTES = 12288;
const routesOf = async uid => { const j = await readJSON(routeFile(uid), null); return Array.isArray(j?.routes) ? j.routes : []; };
/** the phone's route (js/navroute.js makeRoute: { name, pts: [[lat, lon, ele|null]] }) -> { error } or the copy to keep */
export async function validateRoute(id, b) {
  if (!/^[\w-]{1,64}$/.test(id)) return { error: 'id: 1–64 letters, digits, _ or -.' };
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'Body must be a JSON object.' };
  const name = clean(b.name, 80); if (!name) return { error: 'name: 1 to 80 characters.' };
  if (!Array.isArray(b.pts) || b.pts.length < 2 || b.pts.length > 5000) return { error: 'pts: 2 to 5000 points.' };
  const pts = [];
  for (const p of b.pts) {
    if (!Array.isArray(p) || p.length < 2 || p.length > 3) return { error: 'pts: [lat, lon, ele?] each.' };
    const [la, lo, el] = p; if (typeof la !== 'number' || typeof lo !== 'number' || !(Math.abs(la) <= 90) || !(Math.abs(lo) <= 180)) return { error: 'pts: lat -90..90, lon -180..180.' };
    if (el != null && (typeof el !== 'number' || !Number.isFinite(el) || Math.abs(el) > 9000)) return { error: 'pts: ele in metres or null.' };
    pts.push([la, lo, el ?? null]);
  }
  const { simplify, dist, climbOf } = await NR(), s = simplify(pts, KEEP_PTS).map(q => [+q[0].toFixed(6), +q[1].toFixed(6), q[2] != null ? Math.round(q[2] * 10) / 10 : null]);
  let len = 0; for (let i = 1; i < s.length; i++) len += dist(s[i - 1], s[i]); const cl = climbOf(s);
  if (len < 50) return { error: 'The route is shorter than 50 m.' };
  return { id, name, dist: Math.round(len), climb: Math.round(cl[cl.length - 1]), at: Date.now(), pts: s };
}
export const routeList = async uid => (await routesOf(uid)).sort((a, b) => b.at - a.at).slice(0, MAX_ROUTES).map(r => ({ id: r.id, name: r.name, dist: r.dist, climb: r.climb, at: r.at }));
/** [status, answer]: replaces a route with the same id, refuses a 21st */
export function putRoute(uid, r) {
  return serial(async () => { const l = await routesOf(uid), i = l.findIndex(x => x.id === r.id);
    if (i < 0 && l.length >= MAX_ROUTES) return [409, { error: `Up to ${MAX_ROUTES} routes on the watch. Remove one first.` }];
    if (i < 0) l.push(r); else l[i] = r; await writeJSON(routeFile(uid), { routes: l });
    return [200, { ok: true, id: r.id, dist: r.dist, climb: r.climb, n: l.length }]; });
}
export function deleteRoute(uid, id) {
  return serial(async () => { const l = await routesOf(uid), k = l.filter(x => x.id !== id); if (k.length !== l.length) await writeJSON(routeFile(uid), { routes: k }); return [200, { ok: true, removed: k.length !== l.length }]; });
}
/** one route for the watch: at most 200 points with 5 decimals and the turns of js/navroute.js turnsOf as [metres along, L | R | U], under 12 KB */
export async function routeForWatch(uid, id) {
  const r = (await routesOf(uid)).find(x => x.id === id); if (!r) return null;
  const { simplify, turnsOf, dist } = await NR();
  for (let max = WATCH_PTS; max >= 20; max = Math.floor(max * .75)) {
    const p = simplify(r.pts, max).map(q => [r5(q[0]), r5(q[1])]); let len = 0; for (let i = 1; i < p.length; i++) len += dist(p[i - 1], p[i]);
    const turns = p.length > 2 ? turnsOf(p).slice(0, 80).map(t => [t.at, t.dir === 'uturn' ? 'U' : t.dir === 'left' ? 'L' : 'R']) : [];
    const v = { id: r.id, name: cut(r.name, 24), dist: Math.round(len), climb: r.climb, p, turns };
    if (JSON.stringify(v).length < ROUTE_BYTES) return v;
  }
  return null;
}
