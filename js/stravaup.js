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
  const before = getKey();
  const w = window.open('/api/strava/connect', 'strava', 'width=620,height=760');
  if (!w) { location.href = '/api/strava/connect'; return Promise.resolve(false); }
  return new Promise(res => {
    const t0 = Date.now(), iv = setInterval(() => {
      const k = getKey();
      if (k && k !== before) { clearInterval(iv); res(true); }
      else if (w.closed && Date.now() - t0 > 1500) { clearInterval(iv); setTimeout(() => res(!!getKey() && getKey() !== before), 300); }
      else if (Date.now() - t0 > 5 * 60e3) { clearInterval(iv); res(false); }
    }, 400);
  });
}

/** uploads one ride; onState(text) gets progress. Returns the Strava activity URL. */
export async function stravaUpload(rec, name, eleAt, onState = () => {}, imageUrl = '') {
  onState('Wird hochgeladen …');
  const km = (rec.distance / 1000).toFixed(1).replace('.', ',');
  const r = await fetch('/api/strava/upload', { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tcx: toTCX(rec, name, eleAt), name: `RIDEFRAME · ${name}`, external_id: 'rideframe-' + rec.id,
      description: `${km} km · ${rec.gain} hm · Ø ${rec.avgPower} W\nGefahren in RIDEFRAME (Indoor, virtuelle Strecke).${imageUrl ? '\n📸 Bild zur Fahrt: ' + imageUrl : ''}` }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Upload fehlgeschlagen');
  onState('Strava verarbeitet die Fahrt …');
  for (let i = 0; i < 40; i++) { // Strava needs a few seconds to process
    await new Promise(r => setTimeout(r, i < 5 ? 1500 : 3000));
    const s = await (await fetch('/api/strava/upload/' + j.id, { headers: hdr(), cache: 'no-store' })).json().catch(() => ({}));
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
    window.open(makeImage ? url + '/edit' : url, '_blank'); // with an image: straight to Strava's edit page, where photos can be added
    if (makeImage) import('./app.js').then(m => m.toast('Bild ist gespeichert (Downloads). Strava ist zum Bearbeiten offen: dort das Bild als Foto hinzufügen und speichern.', 8000));
  } catch (e) {
    btn.disabled = false; set(label);
    import('./app.js').then(m => m.toast(e.message || String(e), 6000));
  }
}
