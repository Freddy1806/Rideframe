// Strava activities without opening RIDEFRAME (Freddy 23.11.: "Can it do that automatically?"). Every 15 minutes (and once a minute
// after the start) the host reads the newest page of activities of every Strava connection that may read them and belongs to an
// account, and stores the new ones in that account (users/<id>/rides/st<id>.json), exactly as the browser import would
// (js/actimport.js fromStrava + plan: one shared mapping and dedupe). Every signed-in device gets them with its next sync.
// The link key -> account comes from the browser (watch-feed.mjs linkStrava): a signed-in page that calls /api/strava/status or
// /activities sends both its login and its Strava key. A key used by several accounts belongs to the one that used it last.
// Read only: nothing is ever uploaded, changed or deleted on Strava. Deleted here = never again (strava-gone.json + seen).
// Off: per account with the setting stravaImport === false (synced settings), for the host with RIDEFRAME_STRAVA_AUTO=0.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { accountOf, shared } from './accounts-api.mjs';
import { linkStrava } from './watch-feed.mjs';
import { stravaToken, stravaCanRead, stravaNewActs, rateBusy } from './strava-api.mjs';

const { DATA, readJSON, writeJSON, userDir, full, goneOf, invalidateBoard } = shared;
const AI = () => import('../js/actimport.js');
const GONE_SINCE = Date.UTC(2026, 10, 23); // deletions since then reach the host (accounts-api noteGone)
const OVERLAP = 3 * 864e5, FIRST_BACK = 7 * 864e5, SEEN = 3000; // re-read 3 days (late uploads from a watch); a first run looks at most one week back

/** /api/strava/status and /activities from a signed-in browser: remember which account this Strava key belongs to */
export async function stravaLink(req, path) {
  if (!/^\/api\/strava\/(status|activities)$/.test(path) || !req.headers['x-strava-key'] || !req.headers['x-rf-token']) return;
  const me = await accountOf(req); if (me) await linkStrava(req, me.u.id);
}

const acts = new Map(); // file -> { m, a }: what plan() needs of a stored ride / strength session, never the samples
const pick = r => r && { id: r.id, stravaId: r.stravaId, strava: r.strava, start: r.start, date: r.date, elapsed: r.elapsed, duration: r.duration, sportType: r.sportType, sport: r.sport, routeId: r.routeId, outdoor: r.outdoor, source: r.source };
async function stored(uid) {
  const out = [];
  for (const [sub, kraft] of [['rides', false], ['kraft', true]]) {
    const d = join(userDir(uid), sub);
    for (const f of (await readdir(d).catch(() => [])).filter(x => x.endsWith('.json'))) {
      const fp = join(d, f), st = await stat(fp).catch(() => null); if (!st) continue;
      let c = acts.get(fp); if (!c || c.m !== st.mtimeMs) { const r = await readJSON(fp, null); c = { m: st.mtimeMs, a: kraft ? r && { kraft: true, id: r.id, date: +(r.start || r.date) || 0, start: +(r.start || r.date) || 0, dur: +r.dur || 0, source: r.source, stravaId: r.stravaId, strava: r.strava } : pick(r) };
        acts.set(fp, c); if (acts.size > 50000) acts.clear(); }
      if (c.a?.id) out.push(c.a);
    }
  }
  return out;
}

/** one connection: [added, note]. Never throws on Strava's answers (the caller catches the rest). */
async function one(u, key) {
  const dir = userDir(u.id), sf = join(dir, 'strava-auto.json');
  if ((await readJSON(join(dir, 'settings.json'), null))?.settings?.stravaImport === false) return [0, 'off'];
  if (!(await stravaCanRead(key))) return [0, 'no read permission'];
  const synced = !!(await readJSON(join(dir, 'strava-gone.json'), null))?.synced; // a browser's import has sent its "deleted here" ids once. Without it (27.11.: no account had it, so nothing was ever imported) the import runs all the same, only never for activities from before 23.11.: their deletions live only on the devices, later ones the host knows itself
  const tok = await stravaToken(key); if (!tok) return [0, 'no token'];
  const { fromStrava, plan, sidOf, startOf } = await AI(), S = (await readJSON(sf, null)) || {}, local = await stored(u.id);
  const cur = +S.cursor || Math.max(Date.now() - FIRST_BACK, ...local.filter(sidOf).map(startOf).filter(Number.isFinite)); // first run: from the newest Strava one here, at most a week back
  const [code, j] = await stravaNewActs(key, tok, Math.max(1, Math.floor((cur - OVERLAP) / 1000)));
  if (code !== 200 || !Array.isArray(j?.activities)) { await writeJSON(sf, { ...S, at: Date.now(), last: { at: Date.now(), error: j?.reconnect ? 'reconnect' : String(j?.error || code).slice(0, 120) } }); return [0, 'strava ' + code]; }
  const inc = j.activities.map(fromStrava).filter(r => r.start > 0 && (synced || r.start >= GONE_SINCE)), seen = Array.isArray(S.seen) ? S.seen : [];
  const P = plan(local, inc, [...await goneOf(dir), ...seen]); let n = 0, room = true;
  const gone = new Set(await goneOf(dir)); // once more right before writing: a delete from a phone a moment ago wins
  for (const r of P.add) {
    if (gone.has(r.stravaId)) continue;
    if (await full(join(dir, 'rides'))) { room = false; break; } // account full: nothing counts as read, the next run tries again
    const f = join(dir, 'rides', r.id + '.json'); if (await readJSON(f, null)) continue; // the browser pushed the same one meanwhile
    await writeJSON(f, r); n++;
  }
  if (n) invalidateBoard();
  if (!room) return [n, 'full'];
  const ids = inc.map(sidOf), cursor = j.pages ? Math.max(cur, ...inc.map(r => r.start)) : cur; // read without error: the newest start read is the next "after"
  await writeJSON(sf, { cursor, seen: [...seen.filter(x => !ids.includes(x)), ...ids].slice(-SEEN), at: Date.now(), last: { at: Date.now(), read: inc.length, added: n, ...(j.error ? { error: String(j.error).slice(0, 120) } : {}) } });
  return [n, j.rateLimited ? 'limit' : ''];
}

let running = null;
/** one pass over every linked account. Returns { accounts, added, skipped, stopped, errors }; never throws. Tests call it directly. */
export function runStravaAuto() { return running ||= pass().catch(e => { console.log('Strava auto import:', e?.message || e); return { error: true }; }).finally(() => { running = null; }); }
async function pass() {
  const out = { accounts: 0, added: 0, skipped: 0, stopped: null, errors: 0, notes: [] };
  const cfg = await readJSON(join(DATA, 'strava.json'), {}); if (!cfg.client_id || !cfg.client_secret) return said(out, 'Strava is not set up');
  const a = await readJSON(join(DATA, 'accounts.json'), { users: {} }), links = [];
  for (const u of Object.values(a.users || {})) { const l = await readJSON(join(userDir(u.id), 'strava-link.json'), null); if (l?.key) links.push({ u, key: String(l.key), at: +l.at || 0 }); }
  links.sort((x, y) => y.at - x.at); // most recently used first; a key used by two accounts belongs to the newer one
  const owner = new Map(); for (const l of links) if (!owner.has(l.key)) owner.set(l.key, l.u.id);
  for (const l of links) {
    if (owner.get(l.key) !== l.u.id) { out.skipped++; continue; }
    if (rateBusy()) { out.stopped = 'limit'; break; } // the riders' own clicks and uploads come first
    try { const [n, note] = await one(l.u, l.key); out.accounts++; out.added += n; if (note) out.notes.push(note); if (note === 'limit') { out.stopped = 'limit'; break; } }
    catch (e) { out.errors++; console.log('Strava auto import failed for one account:', String(e?.message || e).slice(0, 200)); } // never the token
  }
  return said(out, links.length ? '' : 'no account has linked Strava yet (open RIDEFRAME signed in, with Strava connected)');
}
let lastSaid = '';
/** one line in the host's log whenever the picture changes or something was added (27.11.: a pass that imported nothing said nothing,
 *  so nobody saw that it never ran). Counts and reasons only: never a name, a key or a token. */
function said(out, why = '') {
  const t = `${out.accounts} account(s), ${out.added} added` + (out.skipped ? `, ${out.skipped} skipped` : '') + (out.errors ? `, ${out.errors} failed` : '') + (out.stopped ? `, stopped: ${out.stopped}` : '') + (out.notes.length ? ` (${[...new Set(out.notes)].join(', ')})` : '') + (why ? ` · ${why}` : '');
  if (t !== lastSaid || out.added) { lastSaid = t; console.log('Strava auto import:', t); }
  return out;
}

/** serve.mjs: once a minute after the start, then every 15 minutes. Off with RIDEFRAME_STRAVA_AUTO=0, and against a fake Strava
 *  (STRAVA_BASE, the tests) unless RIDEFRAME_STRAVA_AUTO is set; RIDEFRAME_STRAVA_AUTO_MS sets the period (tests). */
export function startStravaAuto(env = process.env) {
  const on = env.RIDEFRAME_STRAVA_AUTO; if (on === '0' || (env.STRAVA_BASE && !on)) return false;
  const every = Math.max(1000, +env.RIDEFRAME_STRAVA_AUTO_MS || 15 * 60e3), tick = () => { runStravaAuto(); };
  setTimeout(tick, Math.min(60e3, every)).unref(); setInterval(tick, every).unref();
  return true;
}
