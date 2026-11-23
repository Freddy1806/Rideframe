// Direct Strava upload, served by serve.mjs under /api/strava/* (only where RIDEFRAME is hosted, e.g. the Mac mini).
// The Strava app secret never reaches the browser: it lives in <data>/strava.json on the host:
//   { "client_id": "12345", "client_secret": "…", "public_url": "https://mac-mini-….ts.net" }
// Each browser that connects gets a random key (kept in its localStorage); the host keeps that rider's Strava tokens.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA = process.env.RIDEFRAME_DATA || join(homedir(), 'RIDEFRAME_data');
const CFG = join(DATA, 'strava.json'), TOK = join(DATA, 'strava_tokens.json');
const BASE = (process.env.STRAVA_BASE || 'https://www.strava.com').replace(/\/$/, ''), API = BASE + '/api/v3', OAUTH = BASE + '/oauth'; // STRAVA_BASE: a fake Strava for the tests (tools/import-test.mjs)
const READ = /\bactivity:read(_all)?\b/; // the permission the import needs; connections from before 17.11. only have activity:write,read
const ROUTES = /(^|,)read(_all)?(,|$)/; // routes: "read" gives the public ones, "read_all" the private ones too
const rate = { u15: 0, uDay: 0, l15: 100, lDay: 1000, at: 0 }; // Strava's app-wide limits, from the X-RateLimit headers of the last answer
const noteRate = r => { const u = String(r.headers.get('x-ratelimit-usage') || '').split(',').map(Number), l = String(r.headers.get('x-ratelimit-limit') || '').split(',').map(Number);
  if (u.length === 2 && u.every(Number.isFinite)) Object.assign(rate, { u15: u[0], uDay: u[1], at: Date.now() }, l.length === 2 && l.every(v => v > 0) ? { l15: l[0], lDay: l[1] } : {}); };
const nearLimit = () => Date.now() - rate.at < 15 * 60e3 && (rate.u15 >= rate.l15 - 3 || rate.uDay >= rate.lDay - 10); // keep a few calls for uploads
/** Strava ids as strings (64-bit ids from 1 June 2027 lose digits as JSON numbers): x.id_str when sent, else String(x.id); null when missing */
export const sid = (x, k = 'id') => x?.[k + '_str'] != null ? String(x[k + '_str']) : x?.[k] != null ? String(x[k]) : null;
const segDet = new Map(); // "key|segment id" -> { at, v }: one detail call per segment and rider a day
const imgDay = new Map(); // strava key -> { d: day, n: share images today }
const pending = new Map(); // oauth state -> time
const claims = new Map(), stateClaim = new Map(); // installed phone app (iOS): the login runs in a separate browser with its own storage, so the app fetches its key by a one-time claim code

const readJSON = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
async function saveTokens(t) { await mkdir(DATA, { recursive: true, mode: 0o700 }); await writeFile(TOK, JSON.stringify(t, null, 1), { mode: 0o600 }); } // Strava logins of the riders: readable by the host user only
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const html = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:18px system-ui;background:#0b0b0b;color:#f4f4ef;display:grid;place-items:center;height:90vh;text-align:center">${body}`); };
async function body(req, max = 20e6) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function baseUrl(req, cfg) {
  if (cfg.public_url) return cfg.public_url.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https')}://${host}`;
}

/** a valid access token for this key (refreshed when it runs out) */
async function access(key, cfg) {
  const all = await readJSON(TOK, {}), t = all[key];
  if (!t) return null;
  if (t.expires_at - 120 > Date.now() / 1000) return t.access_token;
  const r = await fetch(OAUTH + '/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, grant_type: 'refresh_token', refresh_token: t.refresh_token }) });
  if (!r.ok) return null;
  const j = await r.json(); Object.assign(t, { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at });
  all[key] = t; await saveTokens(all); return t.access_token;
}

/** returns true when the request was an /api/strava call (answered here) */
export async function stravaApi(req, res, path) {
  if (!path.startsWith('/api/strava/')) return false;
  const cfg = await readJSON(CFG, {}), configured = !!(cfg.client_id && cfg.client_secret);
  const key = req.headers['x-strava-key'] || '', op = path.slice(12);
  try {
    const im = op.match(/^image\/([a-f0-9]{24})\.jpg$/); // share images, public (linked from the Strava description)
    if (im && req.method === 'GET') {
      try { const b = await readFile(join(DATA, 'shares', im[1] + '.jpg')); res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' }); res.end(b); }
      catch { send(res, 404, { error: 'not found' }); }
      return true;
    }
    if (op === 'status') {
      const t = key && (await readJSON(TOK, {}))[key];
      return send(res, 200, { configured, connected: !!t, athlete: t?.athlete || null, canImport: !!t && READ.test(t.scope || '') }), true;
    }
    const cm = op.match(/^claim\/([a-f0-9]{32,64})$/); // one-time, 5 minutes: only the app that started this login knows the code
    if (cm) { const v = claims.get(cm[1]); if (v) claims.delete(cm[1]); return send(res, 200, { key: v && Date.now() - v.t < 5 * 60e3 ? v.key : null }), true; }
    if (!configured) return send(res, 503, { error: 'Strava is not set up on this server yet.' }), true;
    if (op === 'connect') {
      const state = randomBytes(12).toString('hex'); pending.set(state, Date.now());
      { const c = new URL(req.url, 'http://x').searchParams.get('claim') || ''; if (/^[a-f0-9]{32,64}$/.test(c)) stateClaim.set(state, c); }
      if (pending.size > 2000) { pending.clear(); stateClaim.clear(); } // someone hammering the link never fills the memory
      for (const [c, v] of claims) if (Date.now() - v.t > 15 * 60e3) claims.delete(c);
      for (const [s, t] of pending) if (Date.now() - t > 15 * 60e3) { pending.delete(s); stateClaim.delete(s); }
      const u = new URL(OAUTH + '/authorize'), force = new URL(req.url, 'http://x').searchParams.get('force') === '1'; // force: ask again, so an old connection gets the read permission
      u.search = new URLSearchParams({ client_id: cfg.client_id, response_type: 'code', redirect_uri: baseUrl(req, cfg) + '/api/strava/callback', approval_prompt: force ? 'force' : 'auto', scope: 'activity:write,activity:read_all,read_all', state });
      res.writeHead(302, { Location: u.toString() }); res.end(); return true;
    }
    if (op.startsWith('callback')) {
      const q = new URL(req.url, 'http://x').searchParams;
      const claim = stateClaim.get(q.get('state') || ''); stateClaim.delete(q.get('state') || '');
      if (!pending.delete(q.get('state') || '')) return html(res, 'The sign-in has expired. Please click “Connect Strava” in the game again.'), true;
      if (q.get('error') || !q.get('code')) return html(res, 'Strava connection cancelled. You can close this window.'), true;
      if (!(q.get('scope') || '').includes('activity:write')) return html(res, 'Please allow uploading activities when connecting (leave the box ticked) and try again.'), true;
      const r = await fetch(OAUTH + '/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, code: q.get('code'), grant_type: 'authorization_code' }) });
      const j = await r.json();
      if (!r.ok) return html(res, 'Strava refused the connection: ' + String(j.message || r.status).replace(/[<>&"']/g, '')
        + (r.status === 403 ? '<br><small>New Strava apps only allow the app owner at first.</small>' : '')), true;
      const k = randomBytes(24).toString('hex'), all = await readJSON(TOK, {});
      all[k] = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, athlete: { id: sid(j.athlete), name: [j.athlete?.firstname, j.athlete?.lastname].filter(Boolean).join(' ') }, at: Date.now(), scope: String(q.get('scope') || '').slice(0, 200) }; // the granted permissions: the import needs activity:read
      await saveTokens(all); if (claim) claims.set(claim, { t: Date.now(), key: k });
      return html(res, `<div>Connected to Strava ✓<br><small>This window closes in a moment; otherwise just close it.</small></div><script>try{localStorage.setItem('rf_strava_key',${JSON.stringify(k)})}catch(e){}setTimeout(()=>window.close(),900);if(!window.opener)setTimeout(()=>location.href='/',1500)</script>`), true;
    }
    if (op === 'disconnect' && req.method === 'POST') { const all = await readJSON(TOK, {}); delete all[key]; await saveTokens(all); return send(res, 200, { ok: true }), true; }
    const tok = key && await access(key, cfg);
    if (!tok) return send(res, 401, { error: 'Not connected to Strava.' }), true;
    if (op === 'activities' && req.method === 'GET') return send(res, ...await activities(key, tok, new URL(req.url, 'http://x').searchParams)), true;
    if (op === 'image' && req.method === 'POST') { // the share image, so the Strava description can link to it
      const b = await body(req, 8e6), m = String(b.jpg || '').match(/^data:image\/jpeg;base64,(.+)$/);
      if (!m) return send(res, 400, { error: 'no image' }), true;
      const id = randomBytes(12).toString('hex'); await mkdir(join(DATA, 'shares'), { recursive: true });
      const day = new Date().toDateString(), n = imgDay.get(key); // 40 share images per rider and day, 5000 on the host in total
      if ((n?.d === day && n.n >= 40) || (await readdir(join(DATA, 'shares')).catch(() => [])).length >= 5000) return send(res, 429, { error: 'Too many images for today.' }), true;
      imgDay.set(key, { d: day, n: n?.d === day ? n.n + 1 : 1 }); if (imgDay.size > 5000) imgDay.clear();
      await writeFile(join(DATA, 'shares', id + '.jpg'), Buffer.from(m[1], 'base64'));
      return send(res, 200, { url: baseUrl(req, cfg) + '/api/strava/image/' + id + '.jpg' }), true;
    }
    if (op === 'upload' && req.method === 'POST') {
      const b = await body(req), fd = new FormData();
      fd.append('file', new Blob([b.tcx], { type: 'application/xml' }), 'rideframe.tcx');
      fd.append('data_type', 'tcx'); fd.append('name', String(b.name || 'RIDEFRAME').slice(0, 200));
      fd.append('description', String(b.description || '').slice(0, 2000)); fd.append('trainer', b.outdoor ? '0' : '1');
      if (b.external_id) fd.append('external_id', String(b.external_id).slice(0, 100));
      const r = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd });
      const j = await r.json(); return send(res, r.ok ? 200 : r.status, r.ok ? { id: sid(j), status: j.status, error: j.error } : { error: j.message || 'Upload failed' }), true;
    }
    if (op === 'segments' && req.method === 'GET') { // Strava segments for the outdoor map: the rider's starred ones (all) plus popular ones around a point
      const q = new URL(req.url, 'http://x').searchParams, out = new Map(), H = { Authorization: 'Bearer ' + tok };
      const cacheF = join(DATA, 'strava_segs.json'), cache = await readJSON(cacheF, {});
      const st = await fetch(API + '/segments/starred?per_page=60', { headers: H }).then(r => r.ok ? r.json() : []).catch(() => []);
      for (const sg of Array.isArray(st) ? st.slice(0, 60) : []) {
        const id = sid(sg); if (!/^\d{1,20}$/.test(id || '')) continue; let c = cache[id]; // old caches keyed by the number: the same string key
        if (!c || Date.now() - (c.at || 0) > 3 * 864e5) { const d = await fetch(`${API}/segments/${id}`, { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null); if (!d?.map?.polyline) continue;
          c = cache[id] = { id, name: d.name, dist: d.distance, grade: d.average_grade, line: d.map.polyline, pr: d.athlete_segment_stats?.pr_elapsed_time || null, kom: d.xoms?.kom || null, at: Date.now() }; }
        out.set(id, { ...c, id: String(c.id ?? id), starred: true });
      }
      const b = (q.get('bounds') || '').split(',').map(Number);
      if (b.length === 4 && b.every(Number.isFinite)) {
        const ex = await fetch(`${API}/segments/explore?activity_type=${q.get('type') === 'running' ? 'running' : 'riding'}&bounds=${b.join(',')}`, { headers: H }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
        for (const e of ex.segments || []) { const id = sid(e); if (id && !out.has(id)) out.set(id, { id, name: e.name, dist: e.distance, grade: e.avg_grade, line: e.points, starred: false }); }
      }
      await mkdir(DATA, { recursive: true }); await writeFile(cacheF, JSON.stringify(cache));
      return send(res, 200, { segments: [...out.values()] }), true;
    }
    const sd = op.match(/^segment\/(\d{1,20})$/); // one segment's detail (PR, KOM/QOM) while approaching or riding it: outdoor.js asks a few times per ride at most
    if (sd && req.method === 'GET') return send(res, ...await segDetail(key, tok, sd[1])), true;
    if (op === 'routes' && req.method === 'GET') return send(res, ...await routes(key, tok, new URL(req.url, 'http://x').searchParams)), true;
    const rg = op.match(/^routes\/(\d{1,20})\.gpx$/); // one Strava route as GPX, parsed in the browser like any route file
    if (rg && req.method === 'GET') {
      if (!ROUTES.test((await readJSON(TOK, {}))[key]?.scope || '')) return send(res, 403, { error: 'Reconnect Strava to import your routes.', reconnect: true }), true;
      if (nearLimit()) return send(res, 429, { error: 'Strava limit reached. Try again in 15 minutes.', rateLimited: true }), true;
      const r = await fetch(`${API}/routes/${rg[1]}/export_gpx`, { headers: { Authorization: 'Bearer ' + tok } }); noteRate(r);
      if (!r.ok) return send(res, r.status === 429 ? 429 : r.status === 404 ? 404 : 502, { error: r.status === 404 ? 'Route not found on Strava.' : 'Strava answered ' + r.status }), true;
      const t = await r.text(); if (t.length > 10e6 || !/<gpx[\s>]/i.test(t)) return send(res, 502, { error: 'Strava sent no GPX.' }), true;
      res.writeHead(200, { 'Content-Type': 'application/gpx+xml; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(t); return true;
    }
    if (op === 'activity' && req.method === 'POST') { // strength workouts (kraft.html): no file, a manual activity "Krafttraining"
      const b = await body(req, 1e5), f = new URLSearchParams({ name: String(b.name || 'Strength training').slice(0, 200), sport_type: String(b.sport_type || 'WeightTraining').replace(/[^A-Za-z]/g, '') || 'Workout',
        start_date_local: String(b.start_date_local || ''), elapsed_time: String(Math.max(60, Math.round(+b.elapsed_time || 0))), description: String(b.description || '').slice(0, 4000) });
      if (b.external_id) f.set('external_id', String(b.external_id).slice(0, 100));
      if (+b.distance > 0) f.set('distance', String(Math.round(+b.distance))); // manual entries (Activities, + Add activity)
      const r = await fetch(API + '/activities', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f });
      const j = await r.json().catch(() => ({})); return send(res, r.ok ? 200 : r.status, r.ok ? { id: sid(j) } : { error: j.message || 'Strava refused' }), true;
    }
    const m = op.match(/^upload\/(\d+)$/);
    if (m) {
      const r = await fetch(`${API}/uploads/${m[1]}`, { headers: { Authorization: 'Bearer ' + tok } }), j = await r.json();
      const act = sid(j, 'activity_id'); // activity_id_str ?? activity_id
      if (act && new URL(req.url, 'http://x').searchParams.get('indoor') === '1') { // indoor ride only (outdoor rides and runs stay as they are): mark it as a virtual ride on the trainer (best effort)
        fetch(`${API}/activities/${act}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ sport_type: 'VirtualRide', trainer: true }) }).catch(() => {});
      }
      return send(res, 200, { status: j.status, error: j.error, activity_id: act, activity_id_str: act }), true;
    }
    return send(res, 404, { error: 'unbekannt' }), true;
  } catch (e) { return send(res, 500, { error: String(e.message || e) }), true; }
}

/** the rider's own activities for the import (Activities, "Import from Strava"): GET /athlete/activities, 100 per page, at most
 *  10 pages per call. after = Unix seconds (default: the last 12 months). Stops at a 429 or close to Strava's limits (100 per
 *  15 minutes and 1000 a day for the whole app) and says so. Only the summary fields the record needs leave the server. */
const KEEP = ['id', 'name', 'sport_type', 'type', 'start_date', 'elapsed_time', 'moving_time', 'distance', 'total_elevation_gain', 'average_heartrate', 'max_heartrate', 'average_watts',
  'weighted_average_watts', 'device_watts', 'max_watts', 'kilojoules', 'calories', 'trainer', 'external_id'];
async function activities(key, tok, q, maxPages = 10) {
  const t = (await readJSON(TOK, {}))[key];
  if (!READ.test(t?.scope || '')) return [403, { error: 'Reconnect Strava to import your activities.', reconnect: true }];
  const after = Math.max(0, Math.floor(+q.get('after') || 0)) || Math.floor(Date.now() / 1000) - 365 * 86400, out = [];
  let done = false, rateLimited = false, asc = true, pages = 0, error = null;
  for (let page = 1; page <= maxPages; page++) {
    if (nearLimit()) { rateLimited = true; break; }
    const r = await fetch(`${API}/athlete/activities?per_page=100&page=${page}&after=${after}`, { headers: { Authorization: 'Bearer ' + tok } }); noteRate(r);
    if (r.status === 429) { rateLimited = true; break; }
    const j = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) return [403, { error: 'Reconnect Strava to import your activities.', reconnect: true }];
    if (!r.ok || !Array.isArray(j)) { error = j?.message || 'Strava answered ' + r.status; break; }
    pages++;
    for (const a of j) { const o = {}; for (const k of KEEP) if (a[k] != null) o[k] = a[k]; o.id = sid(a); if (a.map?.summary_polyline) o.map = { summary_polyline: a.map.summary_polyline };
      if (out.length && Date.parse(o.start_date) < Date.parse(out[out.length - 1].start_date)) asc = false; out.push(o); }
    if (j.length < 100) { done = true; break; }
  }
  // next: where a following call goes on (with "after" Strava answers oldest first; only then is the newest start a safe cursor)
  const next = !done && asc && out.length ? Math.floor(Date.parse(out[out.length - 1].start_date) / 1000) - 1 : null;
  return [error && !out.length ? 502 : 200, { activities: out, done, rateLimited, next, pages, error }];
}

/** a segment's detail for the live screen: the rider's PR and the KOM/QOM time (Strava's leaderboard and ranks are not open to apps).
 *  24 h in memory per rider and segment; nothing is asked close to Strava's limits. */
const xom = v => { const s = String(v ?? '').trim(), m = s.match(/^(\d+)\s*s$/); return m ? +m[1] : /^\d+(:\d{1,2}){1,2}$/.test(s) ? s.split(':').reduce((a, x) => a * 60 + +x, 0) : null; };
async function segDetail(key, tok, id) {
  const ck = key + '|' + id, c = segDet.get(ck); if (c && Date.now() - c.at < 864e5) return [200, c.v];
  if (nearLimit()) return [429, { error: 'Strava limit reached.', rateLimited: true }];
  const r = await fetch(`${API}/segments/${id}`, { headers: { Authorization: 'Bearer ' + tok } }); noteRate(r);
  if (r.status === 429) return [429, { error: 'Strava limit reached.', rateLimited: true }];
  const d = await r.json().catch(() => null); if (!r.ok || !d) return [r.status === 404 ? 404 : 502, { error: 'Strava answered ' + r.status }];
  const v = { id: String(id), name: d.name || '', dist: d.distance || 0, grade: d.average_grade ?? null, pr: d.athlete_segment_stats?.pr_elapsed_time || null,
    kom: d.xoms?.kom || null, qom: d.xoms?.qom || null, komS: xom(d.xoms?.kom), qomS: xom(d.xoms?.qom), efforts: d.athlete_segment_stats?.effort_count ?? null };
  if (segDet.size > 5000) segDet.clear(); segDet.set(ck, { at: Date.now(), v }); return [200, v];
}
/* ---- for the Garmin watch (tools/watch-api.mjs, 19.11.): segments near the watch through the account's linked Strava key ---- */
/** is this a Strava key the host knows (a connected browser)? */
export async function stravaKnown(key) { return /^[a-f0-9]{32,64}$/.test(String(key || '')) && Object.hasOwn(await readJSON(TOK, {}), key); }
/** a valid access token for a key, or null (Strava not set up here, key unknown or its refresh failed) */
export async function stravaToken(key) {
  const cfg = await readJSON(CFG, {}); if (!cfg.client_id || !cfg.client_secret || !(await stravaKnown(key))) return null;
  return access(key, cfg).catch(() => null);
}
/** GET /segments/explore in a box [s, w, n, e]: [{ id, name, distance, points (encoded) }]; null = not asked (near the limit) or failed */
export async function exploreSegs(tok, box, type) {
  if (nearLimit()) return null;
  const r = await fetch(`${API}/segments/explore?activity_type=${type === 'running' ? 'running' : 'riding'}&bounds=${box.map(v => v.toFixed(5)).join(',')}`, { headers: { Authorization: 'Bearer ' + tok } }).catch(() => null);
  if (!r) return null; noteRate(r); if (!r.ok) return null;
  const j = await r.json().catch(() => null); return Array.isArray(j?.segments) ? j.segments : null;
}
/** a segment's detail from the 24 h cache only (no call), or null */
export const segCached = (key, id) => { const c = segDet.get(key + '|' + id); return c && Date.now() - c.at < 864e5 ? c.v : null; };
export { segDetail, nearLimit };
/* ---- the background import (tools/strava-auto.mjs, 23.11.): one page of new activities per connection, read only ---- */
/** may this key read activities? (the scope it was granted; no call to Strava) */
export async function stravaCanRead(key) { return READ.test((await readJSON(TOK, {}))[key]?.scope || ''); }
/** the background leaves most of Strava's app-wide budget to the riders: it stops at 70 % of either limit (or near it) */
export const rateBusy = () => nearLimit() || (Date.now() - rate.at < 15 * 60e3 && (rate.u15 >= rate.l15 * 0.7 || rate.uDay >= rate.lDay * 0.7));
/** one page (100, oldest first) of activities started after `after` (Unix s): [status, { activities, done, rateLimited, next, error }] */
export const stravaNewActs = (key, tok, after) => activities(key, tok, new URLSearchParams({ after: String(after) }), 1);

/** the rider's own Strava routes (Routes sheet on the outdoor page): GET /athletes/{id}/routes, 50 a page, small fields only */
async function routes(key, tok, q) {
  const t = (await readJSON(TOK, {}))[key];
  if (!ROUTES.test(t?.scope || '') || !t?.athlete?.id) return [403, { error: 'Reconnect Strava to import your routes.', reconnect: true }];
  if (nearLimit()) return [429, { error: 'Strava limit reached. Try again in 15 minutes.', rateLimited: true }];
  const page = Math.max(1, Math.min(50, Math.floor(+q.get('page') || 1)));
  const r = await fetch(`${API}/athletes/${encodeURIComponent(t.athlete.id)}/routes?per_page=50&page=${page}`, { headers: { Authorization: 'Bearer ' + tok } }); noteRate(r);
  if (r.status === 429) return [429, { error: 'Strava limit reached. Try again in 15 minutes.', rateLimited: true }];
  if (r.status === 401 || r.status === 403) return [403, { error: 'Reconnect Strava to import your routes.', reconnect: true }];
  const j = await r.json().catch(() => null); if (!r.ok || !Array.isArray(j)) return [502, { error: j?.message || 'Strava answered ' + r.status }];
  return [200, { routes: j.map(x => ({ id: sid(x), name: String(x.name || 'Route').slice(0, 120), distance: Math.round(x.distance || 0), elevation_gain: Math.round(x.elevation_gain || 0), type: x.type === 2 ? 'run' : 'ride' })), more: j.length === 50, page }];
}
