// Direct upload to Strava through the host (serve.mjs + tools/strava-api.mjs, e.g. the Mac mini link).
// Without that host (zip on localhost without a Strava app set up) the old way stays: save the .tcx and upload by hand.
import { toTCX, stravaExport } from './tcx.js';

const KEY = 'rf_strava_key';
const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const hdr = () => ({ 'X-Strava-Key': getKey() });

export async function stravaStatus() {
  try { const r = await fetch('/api/strava/status', { headers: hdr(), cache: 'no-store' }); return r.ok ? await r.json() : { configured: false }; }
  catch { return { configured: false }; }
}

/** opens Strava's login in a popup; resolves true once this browser holds a key */
export function stravaConnect() {
  const before = getKey(), claim = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const w = window.open('/api/strava/connect?claim=' + claim, 'strava', 'width=620,height=760');
  if (!w) { location.href = '/api/strava/connect'; return Promise.resolve(false); }
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
  onState('Wird hochgeladen …');
  const km = (rec.distance / 1000).toFixed(1).replace('.', ',');
  const r = await fetch('/api/strava/upload', { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tcx: toTCX(rec, name, eleAt), name: `RIDEFRAME · ${name}`, external_id: 'rideframe-' + rec.id,
      outdoor: !!rec.outdoor, description: rec.sport === 'run' ? `${km} km · ${rec.gain} hm${rec.distance > 0 ? ` · Ø ${paceTxt(rec.duration / rec.distance * 1000)} /km` : ''}\nGelaufen mit RIDEFRAME.` : rec.outdoor ? `${km} km · ${rec.gain} hm${rec.avgPower ? ` · Ø ${rec.avgPower} W` : ''}\nDraußen aufgezeichnet mit RIDEFRAME.`
      : `${km} km · ${rec.gain} hm · Ø ${rec.avgPower} W\nGefahren in RIDEFRAME (Indoor, virtuelle Strecke).` + intervalText(rec) /* no image link in the description (Freddy 12.11.: it exposed the Mac mini address) */ }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Upload fehlgeschlagen');
  onState('Strava verarbeitet die Fahrt …');
  for (let i = 0; i < 40; i++) { // Strava needs a few seconds to process
    await new Promise(r => setTimeout(r, i < 5 ? 1500 : 3000));
    const s = await (await fetch('/api/strava/upload/' + j.id + (rec.outdoor ? '' : '?indoor=1'), { headers: hdr(), cache: 'no-store' })).json().catch(() => ({}));
    if (s.activity_id) return 'https://www.strava.com/activities/' + s.activity_id;
    if (s.error) throw new Error(/duplicate/i.test(s.error) ? 'Diese Fahrt ist schon auf Strava.' : s.error);
  }
  throw new Error('Strava antwortet nicht. Schau gleich in deinem Strava-Profil nach, die Fahrt kommt meist trotzdem an.');
}

/** one button for everything: connect if needed, upload, show the result; falls back to the file */
/** makeImage = optional async () => JPEG canvas of the share image: saved on this device and linked in the description */
export async function stravaButton(btn, rec, name, eleAt, makeImage = null) {
  const st = await stravaStatus();
  if (!st.configured) return stravaExport(rec, name, eleAt);
  const label = btn.textContent, set = t => { btn.textContent = t; };
  btn.disabled = true;
  try {
    if (!st.connected) { set('Mit Strava verbinden …'); if (!(await stravaConnect()) || !(await stravaStatus()).connected) throw new Error('Nicht mit Strava verbunden.'); }
    let imageUrl = '';
    if (makeImage) try {
      set('Bild wird gemacht …'); const c = await makeImage(), jpg = c.toDataURL('image/jpeg', 0.9);
      const a = document.createElement('a'); a.href = jpg; a.download = `RIDEFRAME_${String(name).replace(/[^\w-]+/g, '_')}.jpg`; a.click(); // saved, ready to add in Strava
      const r = await fetch('/api/strava/image', { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify({ jpg }) });
      if (r.ok) imageUrl = (await r.json()).url || '';
    } catch (e) { console.warn('Teilen-Bild:', e); }
    const url = await stravaUpload(rec, name, eleAt, set, imageUrl);
    set('Auf Strava ✓ öffnen'); btn.disabled = false; btn.onclick = () => window.open(url, '_blank');
    window.open(url, '_blank');
    if (makeImage) import('./app.js').then(m => m.toast('Bild ist gespeichert (Downloads). In Strava bei der Fahrt auf Bearbeiten → Foto hinzufügen.', 8000));
  } catch (e) {
    btn.disabled = false; set(label);
    import('./app.js').then(m => m.toast(e.message || String(e), 6000));
  }
}

/** the intervals (workout steps or climbs) as lines for the Strava description: name · time · average watts (target) */
function intervalText(rec) {
  const iv = rec.ivs; if (!iv?.length) return '';
  const mm = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  return '\n\nIntervalle:\n' + iv.map((x, i) => `${i + 1}. ${x.name} · ${mm(x.t)} · Ø ${x.w} W${x.target ? ` (Ziel ${x.target} W)` : ''}`).join('\n');
}

/** a strength workout as a manual Strava activity (Krafttraining, no file). Returns the activity URL. */
export async function stravaStrength({ id, name, start, dur, description }) {
  const d = new Date(start), p = n => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const r = await fetch('/api/strava/activity', { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sport_type: 'WeightTraining', start_date_local: local, elapsed_time: dur, description, external_id: 'rideframe-kraft-' + id }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(/write|scope|permission/i.test(j.error || '') ? 'Strava erlaubt das Anlegen nicht. Bitte Strava einmal neu verbinden.' : j.error || 'Upload fehlgeschlagen');
  return 'https://www.strava.com/activities/' + j.id;
}

/** Strava segments for the outdoor map: starred ones + popular ones in bounds [swLat, swLon, neLat, neLon]; [] without Strava */
export async function stravaSegments(bounds, type = 'riding') {
  try { const r = await fetch('/api/strava/segments?type=' + type + '&bounds=' + bounds.map(v => v.toFixed(5)).join(','), { headers: hdr(), cache: 'no-store' }); return r.ok ? (await r.json()).segments || [] : []; }
  catch { return []; }
}
