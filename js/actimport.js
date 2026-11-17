// Activities from outside RIDEFRAME (Freddy 17.11.: everything in one app, like Strava): Strava is the collection point
// (Garmin, Polar, Apple Watch … already sync there), plus a file or a hand-written entry without Strava.
// The pure part (record shapes, dedupe) is tested in Node (tools/import-test.mjs); importStrava() runs in the browser.
import { groupOf, famOf, labelOf } from './sports.js';
import { sportOf } from './fitness.js';

/** the Strava activity id a local activity is linked to: imported ones carry it, uploaded ones keep the link (a.strava) */
export const sidOf = a => a.stravaId ? String(a.stravaId) : (String(a.strava || '').match(/activities\/(\d+)/) || [])[1] || '';
/** start time in ms: recorded rides store the end in date (start = date - elapsed), strength sessions their start */
export const startOf = a => a.kraft ? a.start || a.date : a.start || a.date - (a.elapsed || a.duration || 0) * 1000;
const dursOf = a => (a.kraft ? [a.dur] : [a.duration, a.elapsed]).filter(v => v > 0);
/** the common fields of every outside activity; g = group from sports.js */
const base = (type, start, moving, elapsed) => { const g = groupOf(type);
  return { routeId: 'ext', sportType: type, sport: g === 'run' ? 'run' : famOf(g) === 'bike' ? 'ride' : g, start, date: start, // date = start, like Strava and the strength sessions
    duration: Math.round(moving), elapsed: Math.round(elapsed), complete: true, avgPower: 0 }; };

/** one Strava SummaryActivity -> a ride record (source 'strava', no samples: streams are not downloaded in v1) */
export function fromStrava(s) {
  const id = String(s.id), type = String(s.sport_type || s.type || 'Workout').replace(/[^A-Za-z]/g, '') || 'Workout', el = Math.max(0, Math.round(+s.elapsed_time || 0)), mv = Math.round(+s.moving_time || el);
  const r = { id: 'st' + id, ...base(type, Date.parse(s.start_date) || 0, mv, el), source: 'strava', stravaId: id, strava: 'https://www.strava.com/activities/' + id,
    workout: String(s.name || labelOf(type)).slice(0, 200), outdoor: !s.trainer, distance: Math.round(+s.distance || 0), gain: Math.round(+s.total_elevation_gain || 0) };
  const n = (k, v) => { if (+v > 0) r[k] = Math.round(+v); };
  n('avgHr', s.average_heartrate); n('maxHr', s.max_heartrate); n('avgPower', s.average_watts); n('maxPower', s.max_watts); n('kj', s.kilojoules); n('kcal', s.calories);
  if (s.device_watts && famOf(groupOf(type)) === 'bike') n('np', s.weighted_average_watts); // measured watts only: estimated ones would steer the load
  if (s.map?.summary_polyline) r.polyline = String(s.map.summary_polyline).slice(0, 20000);
  if (s.external_id) r.ext = String(s.external_id).slice(0, 120); // only for the dedupe, never stored
  return r;
}
/** a hand-written entry or a parsed file -> ride record; f = { sportType, start, duration (s), distance, gain, avgHr, note, name, samples … } */
export function fromEntry(f, source, id) {
  const type = f.sportType || 'Workout', dur = Math.max(60, Math.round(+f.duration || 0)), r = { id, ...base(type, +f.start, dur, Math.max(dur, Math.round(+f.elapsed || 0))), source,
    workout: String(f.name || labelOf(type)).slice(0, 200), distance: Math.max(0, Math.round(+f.distance || 0)), gain: Math.max(0, Math.round(+f.gain || 0)) };
  for (const k of ['avgHr', 'maxHr', 'kcal', 'avgPower', 'np', 'maxPower', 'best5', 'best20', 'kj']) if (+f[k] > 0) r[k] = Math.round(+f[k]);
  if (f.note) r.note = String(f.note).slice(0, 2000);
  if (f.samples?.length) { r.samples = f.samples; r.outdoor = f.samples.some(s => s[6] != null); }
  return r;
}

/** the same session twice? same family (all bikes are one), starts within 2 minutes, durations within 5 % */
export function sameAct(a, b) {
  if (famOf(sportOf(a)) !== famOf(sportOf(b)) || Math.abs(startOf(a) - startOf(b)) > 120e3) return false;
  return dursOf(a).some(x => dursOf(b).some(y => Math.abs(x - y) <= 0.05 * Math.max(x, y)));
}
/** what to do with incoming records: add (new), link (an existing local one gets the Strava id), skip (already here or deleted here).
 *  gone = Strava ids deleted on this device, so a re-import never brings them back. */
export function plan(local, incoming, gone = []) {
  const ids = new Set([...local.map(sidOf).filter(Boolean), ...gone.map(String)]), byId = new Map(local.map(a => [String(a.id), a]));
  const add = [], link = [], skip = [];
  for (const r of incoming) {
    const sid = sidOf(r);
    if (ids.has(sid)) { skip.push(r); continue; }
    ids.add(sid);
    const m = /^rideframe-(?:kraft-|man-)?([\w-]+?)(?:\.\w+)?$/.exec(r.ext || ''); // uploaded by RIDEFRAME (external_id)
    if (m) { const a = byId.get(m[1]); if (a && !sidOf(a)) link.push({ act: a, sid }); skip.push(r); continue; }
    const a = local.find(x => !sidOf(x) && !link.some(l => l.act === x) && sameAct(x, r));
    if (a) { link.push({ act: a, sid }); skip.push(r); continue; }
    const { ext, ...rec } = r; add.push(rec);
  }
  return { add, link, skip };
}
/** a local file / manual entry that is already here (start + duration like above) */
export const dupOf = (local, r) => local.find(a => sameAct(a, r)) || null;

// ---------------- browser: the import itself ----------------
const KV = 'stravaImport', GONE = 'stravaGone';
let running = null;
/** fetches new Strava activities and saves them. Returns { added, linked, text, reconnect?, error? }; never throws. */
export function importStrava(o = {}) { return running ||= run(o).finally(() => { running = null; }); }
async function run({ onState = () => {} } = {}) {
  const { db } = await import('./db.js'), su = await import('./stravaup.js'), { loadActs } = await import('./feed.js');
  const st = await su.stravaStatus();
  if (!st.configured) return { added: 0, error: true, text: 'Strava is not set up on this server.' };
  if (!st.connected) return { added: 0, error: true, connect: true, text: 'Connect Strava first.' };
  if (!st.canImport) return { added: 0, error: true, reconnect: true, text: 'Reconnect Strava to import your activities.' };
  const mem = (await db.kvGet(KV).catch(() => null)) || {}, gone = (await db.kvGet(GONE).catch(() => null)) || [];
  await db.kvSet(KV, { ...mem, at: Date.now() }).catch(() => {});
  // after = the newest start already read, minus 3 days (late syncs from a watch); nothing yet = the server's default, the last 12 months
  let after = mem.cursor ? Math.floor(mem.cursor / 1000) - 3 * 86400 : 0, all = [], done = false, limited = false, ok = false, err = '';
  for (let call = 0; call < 3 && !done && !limited; call++) { // the server reads up to 10 pages per call
    onState(call ? `Reading Strava … ${all.length}` : 'Reading Strava …');
    const j = await su.stravaActivities(after);
    if (j.reconnect) return { added: 0, error: true, reconnect: true, text: 'Reconnect Strava to import your activities.' };
    if (j.error && !j.activities) { err = j.error; break; }
    all.push(...(j.activities || [])); done = !!j.done; limited = !!j.rateLimited; ok = done || !!j.next; // read without a gap up to here
    if (!j.next) break; after = j.next;
  }
  const inc = all.map(fromStrava).filter(r => r.start > 0);
  const cursor = ok ? Math.max(mem.cursor || 0, ...inc.map(r => r.start)) : mem.cursor || 0;
  const D = await loadActs(), P = plan(D.acts, inc, gone);
  const acc = await import('./account.js').catch(() => null);
  for (const r of P.add) { await db.put('rides', r).catch(() => {}); acc?.pushRide?.(r); }
  let kraftList = null;
  for (const { act, sid } of P.link) {
    const url = 'https://www.strava.com/activities/' + sid;
    if (act.kraft) { kraftList ||= (await db.kvGet('kraft').catch(() => null)) || []; const w = kraftList.find(x => x.id === act.id); if (w && !w.strava) { w.strava = url; acc?.pushKraft?.(w); } continue; }
    const r = await db.get('rides', act.id).catch(() => null); if (!r) continue;
    Object.assign(r, { stravaId: sid, strava: r.strava || url }); await db.put('rides', r).catch(() => {}); acc?.pushRide?.(r);
  }
  if (kraftList) await db.kvSet('kraft', kraftList).catch(() => {});
  await db.kvSet(KV, { cursor, at: Date.now() }).catch(() => {});
  const n = P.add.length, tail = limited ? ' Strava limit reached, the rest follows later.' : err ? ' ' + err : '';
  return { added: n, linked: P.link.length, error: !n && !!err, text: (n ? `${n} new ${n === 1 ? 'activity' : 'activities'}.` : 'Nothing new.') + tail };
}
/** on app open: at most every 30 minutes, only with the read permission and unless switched off in the settings */
export async function autoImport(S = {}) {
  if (S.stravaImport === false) return null;
  try {
    const { db } = await import('./db.js'), mem = (await db.kvGet(KV).catch(() => null)) || {};
    if (Date.now() - (mem.at || 0) < 30 * 60e3) return null;
    const st = await (await import('./stravaup.js')).stravaStatus(); if (!st.connected || !st.canImport) return null;
    return await importStrava();
  } catch { return null; }
}
/** after deleting an imported activity here: remember its id, so the next import skips it (it stays on Strava) */
export async function forget(a) {
  const sid = sidOf(a); if (!sid) return;
  const { db } = await import('./db.js'), g = (await db.kvGet(GONE).catch(() => null)) || [];
  if (!g.includes(sid)) { g.push(sid); await db.kvSet(GONE, g.slice(-5000)).catch(() => {}); }
}
