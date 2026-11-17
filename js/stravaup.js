// Direct upload to Strava through the host (serve.mjs + tools/strava-api.mjs, e.g. the Mac mini link).
// Without that host (zip on localhost without a Strava app set up) the old way stays: save the .tcx and upload by hand.
import { toTCX, stravaExport } from './tcx.js';

const KEY = 'rf_strava_key';
const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const hdr = () => ({ 'X-Strava-Key': getKey() });

const PEND = 'rf_strava_claim';
/** a login that left this page (popup blocked: iPhone after an await, installed home-screen app) comes back through its one-time claim code */
async function claimPending() {
  let p; try { p = JSON.parse(localStorage.getItem(PEND) || 'null'); } catch {} if (!p) return;
  if (Date.now() - p.t > 15 * 60e3) return localStorage.removeItem(PEND);
  try { const j = await (await fetch('/api/strava/claim/' + p.c, { cache: 'no-store' })).json(); if (j.key) { localStorage.setItem(KEY, j.key); localStorage.removeItem(PEND); } } catch {}
}
export async function stravaStatus() {
  await claimPending();
  try { const r = await fetch('/api/strava/status', { headers: hdr(), cache: 'no-store' }); return r.ok ? await r.json() : { configured: false }; }
  catch { return { configured: false }; }
}

/** opens Strava's login in a popup; resolves true once this browser holds a key. force = ask Strava again (reconnect for the import permission) */
export function stravaConnect(force = false) {
  const before = getKey(), claim = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''), url = '/api/strava/connect?claim=' + claim + (force ? '&force=1' : '');
  const w = window.open(url, 'strava', 'width=620,height=760');
  if (!w) { try { localStorage.setItem(PEND, JSON.stringify({ c: claim, t: Date.now() })); } catch {} location.href = url; return Promise.resolve(false); } // popup blocked: log in in this tab, the key is fetched by the claim code when the app is opened again
  let asking = false; // the installed iPhone app logs in in a separate browser: fetch the key by the claim code
  const ask = async () => { if (asking) return; asking = true; try { const j = await (await fetch('/api/strava/claim/' + claim, { cache: 'no-store' })).json(); if (j.key) localStorage.setItem(KEY, j.key); } catch {} asking = false; };
  return new Promise(res => {
    const t0 = Date.now(), iv = setInterval(() => {
      const k = getKey();
      if (!(k && k !== before) && (Date.now() - t0) % 2000 < 400) ask();
      if (k && k !== before) { clearInterval(iv); res(true); }
      else if (w.closed && Date.now() - t0 > 1500) { clearInterval(iv); setTimeout(async () => { asking = false; await ask(); res(!!getKey() && getKey() !== before); }, 300); }
      else if (Date.now() - t0 > 5 * 60e3) { clearInterval(iv); res(false); }
    }, 400);
  });
}

const paceTxt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
/** uploads one ride; onState(text) gets progress. Returns the Strava activity URL. */
export async function stravaUpload(rec, name, eleAt, onState = () => {}, imageUrl = '') {
  onState('Uploading …');
  const km = (rec.distance / 1000).toFixed(1);
  const r = await fetch('/api/strava/upload', { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tcx: toTCX(rec, name, eleAt), name: `RIDEFRAME · ${name}${rec.erg ? ' · Workout (ERG)' : ''}`, external_id: 'rideframe-' + rec.id,
      outdoor: !!rec.outdoor, description: rec.sport === 'run' ? `${km} km · ${rec.gain} m climb${rec.distance > 0 ? ` · avg ${paceTxt(rec.duration / rec.distance * 1000)} /km` : ''}\nRun with RIDEFRAME.` : rec.outdoor ? `${km} km · ${rec.gain} m climb${rec.avgPower ? ` · avg ${rec.avgPower} W` : ''}\nRecorded outdoors with RIDEFRAME.`
      : rec.erg ? `${km} km · ${rec.gain} m climb · avg ${rec.avgPower} W\nWorkout (ERG) in RIDEFRAME (indoor, virtual route): the trainer held the target watts.` + intervalText(rec)
      : `${km} km · ${rec.gain} m climb · avg ${rec.avgPower} W\nRidden in RIDEFRAME (indoor, virtual route).` + intervalText(rec) /* no image link in the description (Freddy 12.11.: it exposed the Mac mini address) */ }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Upload failed');
  onState('Strava is processing the ride …');
  for (let i = 0; i < 40; i++) { // Strava needs a few seconds to process
    await new Promise(r => setTimeout(r, i < 5 ? 1500 : 3000));
    const s = await (await fetch('/api/strava/upload/' + j.id + (rec.outdoor ? '' : '?indoor=1'), { headers: hdr(), cache: 'no-store' })).json().catch(() => ({}));
    const act = s.activity_id_str ?? s.activity_id; // 64-bit ids from June 2027: the string form when sent
    if (act) return 'https://www.strava.com/activities/' + act;
    if (s.error) throw new Error(/duplicate/i.test(s.error) ? 'This ride is already on Strava.' : s.error);
  }
  throw new Error('Strava is not answering. Check your Strava profile in a moment, the ride usually arrives anyway.');
}

/** one button for everything: connect if needed, upload, show the result; falls back to the file */
/** makeImage = optional async () => JPEG canvas of the share image: saved on this device and linked in the description */
export async function stravaButton(btn, rec, name, eleAt, makeImage = null) {
  const st = await stravaStatus();
  if (!st.configured) return stravaExport(rec, name, eleAt);
  const label = btn.textContent, set = t => { btn.textContent = t; };
  btn.disabled = true;
  try {
    if (!st.connected) { set('Connecting to Strava …'); if (!(await stravaConnect()) || !(await stravaStatus()).connected) throw new Error('Not connected to Strava.'); }
    let imageUrl = '';
    if (makeImage) try {
      set('Making image …'); const c = await makeImage(), jpg = c.toDataURL('image/jpeg', 0.9);
      const a = document.createElement('a'); a.href = jpg; a.download = `RIDEFRAME_${String(name).replace(/[^\w-]+/g, '_')}.jpg`; a.click(); // saved, ready to add in Strava
      const r = await fetch('/api/strava/image', { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify({ jpg }) });
      if (r.ok) imageUrl = (await r.json()).url || '';
    } catch (e) { console.warn('Teilen-Bild:', e); }
    const url = await stravaUpload(rec, name, eleAt, set, imageUrl);
    set('Open on Strava ✓'); btn.disabled = false; btn.onclick = () => window.open(url, '_blank');
    window.open(url, '_blank');
    if (makeImage) import('./app.js').then(m => m.toast('Image saved (Downloads). In Strava, open the ride, Edit → Add photo.', 8000));
  } catch (e) {
    btn.disabled = false; set(label);
    import('./app.js').then(m => m.toast(e.message || String(e), 6000));
  }
}

/** the intervals (workout steps or climbs) as lines for the Strava description: name · time · the watts actually ridden (no targets: Freddy 17.11.) */
function intervalText(rec) {
  const iv = rec.ivs; if (!iv?.length) return '';
  const mm = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  return '\n\nIntervals:\n' + iv.map((x, i) => `${i + 1}. ${x.name} · ${mm(x.t)} · avg ${x.w} W`).join('\n');
}

/** a strength workout as a manual Strava activity (Krafttraining, no file). Returns the activity URL.
 *  Also any hand-written entry from the Activities page: sportType, distance and its own external id prefix. */
export async function stravaStrength({ id, name, start, dur, description, sportType = 'WeightTraining', distance = 0, prefix = 'rideframe-kraft-' }) {
  const d = new Date(start), p = n => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const r = await fetch('/api/strava/activity', { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sport_type: sportType, start_date_local: local, elapsed_time: dur, description, distance, external_id: prefix + id }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(/write|scope|permission/i.test(j.error || '') ? 'Strava does not allow creating activities. Please reconnect Strava once.' : j.error || 'Upload failed');
  return 'https://www.strava.com/activities/' + (j.id_str ?? j.id);
}

/** Strava segments for the outdoor map: starred ones + popular ones in bounds [swLat, swLon, neLat, neLon]; [] without Strava */
export async function stravaSegments(bounds, type = 'riding') {
  try { const r = await fetch('/api/strava/segments?type=' + type + '&bounds=' + bounds.map(v => v.toFixed(5)).join(','), { headers: hdr(), cache: 'no-store' }); return r.ok ? (await r.json()).segments || [] : []; }
  catch { return []; }
}

/** one batch of the rider's Strava activities for the import (js/actimport.js): { activities, done, next, rateLimited } or { error, reconnect } */
export async function stravaActivities(after = 0) {
  try { const r = await fetch('/api/strava/activities' + (after ? '?after=' + Math.floor(after) : ''), { headers: hdr(), cache: 'no-store' }), j = await r.json().catch(() => ({}));
    return r.ok ? j : { ...j, error: j.error || 'Strava import failed (' + r.status + ').' }; }
  catch { return { error: 'No connection to the server.' }; }
}

/** one segment's PR and KOM/QOM (seconds in komS / qomS) for the live screen; null without Strava or near its limits */
export async function stravaSegment(id) {
  try { const r = await fetch('/api/strava/segment/' + encodeURIComponent(id), { headers: hdr(), cache: 'no-store' }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
/** the rider's Strava routes, 50 a page: { routes: [{ id, name, distance, elevation_gain, type }], more } or { error, reconnect } */
export async function stravaRoutes(page = 1) {
  try { const r = await fetch('/api/strava/routes?page=' + page, { headers: hdr(), cache: 'no-store' }), j = await r.json().catch(() => ({}));
    return r.ok ? j : { ...j, error: j.error || 'Strava routes failed (' + r.status + ').' }; }
  catch { return { error: 'No connection to the server.' }; }
}
/** one Strava route as GPX text */
export async function stravaRouteGpx(id) {
  const r = await fetch('/api/strava/routes/' + encodeURIComponent(id) + '.gpx', { headers: hdr(), cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Strava route failed (' + r.status + ').');
  return r.text();
}
