// "+ Add activity" on the Activities page: any sport by hand (sport, start, duration, optional distance, climb, heart rate,
// note) or from a file of any watch (.gpx, .tcx, .fit, read in the browser by actfile.js). Saved like every ride (IndexedDB +
// the account on the host). Hand-written ones can be edited and go to Strava like strength workouts (a manual activity).
import { db, uid } from './db.js';
import { esc, fmtNum } from './util.js';
import { PICK, labelOf, groupOf } from './sports.js';
import { fromEntry, dupOf } from './actimport.js';

const $ = (s, r) => r.querySelector(s);
const p2 = n => String(n).padStart(2, '0');
const localDT = t => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };

/** opens the sheet; edit = an existing manual entry; onSaved(rec, text) after saving */
export function addSheet({ edit = null, onSaved = () => {}, acts = [], file: pickFile = false } = {}) {
  const e = edit || {}, s = document.createElement('div'); s.className = 'psheet'; document.body.append(s);
  let file = null; // what the chosen file gave: { name, samples, … }
  const dur = e.duration || 3600, start = e.start || (e.date ? e.date - (e.elapsed || e.duration || 0) * 1000 : Date.now() - 3600e3);
  s.innerHTML = `<div class="psheetin fadd"><div class="label">${edit ? 'Edit activity' : 'Add activity'}</div>
    ${edit ? '' : `<button class="btn ghost" id="aFile">Import file (.gpx, .tcx, .fit)</button><input type="file" id="aFileIn" accept=".gpx,.tcx,.fit,application/gpx+xml,application/vnd.garmin.tcx+xml,application/octet-stream" hidden>
    <p class="hint" id="aFileTxt">From Garmin, Polar, Suunto, Wahoo and others. Or enter it yourself:</p>`}
    <label class="olbl" for="aSport">Sport</label>
    <select class="ksearch" id="aSport">${PICK.map(k => `<option value="${k}" ${(e.sportType || 'Ride') === k ? 'selected' : ''}>${esc(labelOf(k))}</option>`).join('')}</select>
    <label class="olbl" for="aName">Name (optional)</label><input class="ksearch" id="aName" maxlength="120" value="${esc(edit && e.workout !== labelOf(e.sportType) ? e.workout || '' : '')}" placeholder="${esc(labelOf(e.sportType || 'Ride'))}">
    <label class="olbl" for="aStart">Start</label><input class="ksearch" type="datetime-local" id="aStart" value="${localDT(start)}">
    <div class="olbl">Duration</div>
    <div class="fdur"><label><input type="number" id="aH" min="0" max="99" inputmode="numeric" value="${Math.floor(dur / 3600)}"><span>h</span></label><label><input type="number" id="aM" min="0" max="59" inputmode="numeric" value="${Math.round(dur % 3600 / 60)}"><span>min</span></label></div>
    <label class="prow">Distance<input type="number" id="aDist" min="0" step="0.01" inputmode="decimal" value="${e.distance ? +(e.distance / 1000).toFixed(2) : ''}"><span>km</span></label>
    <label class="prow">Climb<input type="number" id="aGain" min="0" inputmode="numeric" value="${e.gain || ''}"><span>m</span></label>
    <label class="prow">Avg heart rate<input type="number" id="aHr" min="0" max="250" inputmode="numeric" value="${e.avgHr || ''}"><span>bpm</span></label>
    <label class="olbl" for="aNote">Note</label><textarea class="ksearch fnote" id="aNote" maxlength="2000" rows="3">${esc(e.note || '')}</textarea>
    <p class="ferr" id="aErr" role="alert"></p>
    <div class="pfoot"><button class="btn ghost" id="aCancel">Cancel</button><button class="btn" id="aSave">Save</button></div></div>`;
  s.onclick = ev => { if (ev.target === s) s.remove(); };
  const err = t => { $('#aErr', s).textContent = t; };
  $('#aCancel', s).onclick = () => s.remove();
  $('#aSport', s).onchange = ev => { $('#aName', s).placeholder = labelOf(ev.target.value); };
  const fb = $('#aFile', s), fi = $('#aFileIn', s);
  if (fb) fb.onclick = () => fi.click();
  if (pickFile && fi) fi.click(); // "Import file" (the Activities "+" menu, Settings): straight to the file picker, still inside the tap
  if (fi) fi.onchange = async () => {
    const f = fi.files?.[0]; if (!f) return; err('');
    try {
      const { parseActivity } = await import('./actfile.js'), r = parseActivity(f.name, await f.arrayBuffer());
      file = { ...r, file: f.name };
      if (r.sportType) $('#aSport', s).value = r.sportType;
      $('#aName', s).value = r.name || ''; $('#aName', s).placeholder = labelOf($('#aSport', s).value);
      $('#aStart', s).value = localDT(r.start); $('#aH', s).value = Math.floor(r.duration / 3600); $('#aM', s).value = Math.round(r.duration % 3600 / 60);
      $('#aDist', s).value = r.distance ? +(r.distance / 1000).toFixed(2) : ''; $('#aGain', s).value = r.gain || ''; $('#aHr', s).value = r.avgHr || '';
      $('#aFileTxt', s).textContent = `${f.name}: ${fmtNum(r.samples.length)} points${r.sportType ? '' : '. Please choose the sport'}. Check and save.`;
    } catch (x) { file = null; err(x.message || String(x)); }
  };
  $('#aSave', s).onclick = async () => {
    const t = Date.parse($('#aStart', s).value), secs = (+$('#aH', s).value || 0) * 3600 + (+$('#aM', s).value || 0) * 60;
    if (!Number.isFinite(t)) return err('Please enter the start.');
    if (secs < 60) return err('Please enter the duration (at least 1 minute).');
    if (t > Date.now() + 5 * 60e3) return err('The start is in the future.');
    const type = $('#aSport', s).value, km = +$('#aDist', s).value || 0;
    // a file keeps its own exact time unless the person changed the minutes
    const keep = file && Math.round(file.duration / 60) === Math.round(secs / 60);
    const f = { ...(file || {}), sportType: type, name: $('#aName', s).value.trim() || labelOf(type), start: t, duration: keep ? file.duration : secs, elapsed: keep ? file.elapsed : secs,
      distance: km * 1000, gain: +$('#aGain', s).value || 0, avgHr: +$('#aHr', s).value || 0, note: $('#aNote', s).value.trim() };
    if (file && !keep) delete f.elapsed;
    const rec = fromEntry(f, edit ? edit.source || 'manual' : file ? 'file' : 'manual', edit ? edit.id : uid());
    if (edit) { for (const k of ['strava', 'stravaId', 'samples', 'outdoor']) if (edit[k] != null && rec[k] == null) rec[k] = edit[k]; }
    if (file) { const d = dupOf(acts, rec); if (d) return err(`This activity is already here (${new Date(d.date).toLocaleDateString('en-GB')}, ${d.workout || d.name || labelOf(d.sportType) || 'same time'}).`); }
    $('#aSave', s).disabled = true;
    await db.put('rides', rec).catch(() => {});
    import('./account.js').then(m => m.pushRide?.(rec)).catch(() => {});
    s.remove(); onSaved(rec, edit ? 'Saved.' : file ? 'Imported.' : 'Added.');
  };
}

/** a manual entry to Strava as a manual activity (like strength workouts); returns the URL or null */
export async function manualToStrava(a, flash = () => {}, quiet = false) {
  const su = await import('./stravaup.js'), st = await su.stravaStatus();
  if (!st.configured) { if (!quiet) flash('Strava is not set up on this server.'); return null; }
  try {
    if (!st.connected) { if (quiet) return null; if (!(await su.stravaConnect())) throw new Error('Not connected to Strava.'); }
    const url = await su.stravaStrength({ id: a.id, name: a.workout, start: a.start, dur: a.elapsed || a.duration, description: a.note || '', sportType: a.sportType, distance: groupOf(a.sportType) === 'kraft' ? 0 : a.distance, prefix: 'rideframe-man-' });
    const r = (await db.get('rides', a.id).catch(() => null)) || a; r.strava = a.strava = url; await db.put('rides', r).catch(() => {});
    import('./account.js').then(m => m.pushRide?.(r)).catch(() => {});
    flash('On Strava ✓'); return url;
  } catch (x) { flash(x.message || String(x)); return null; }
}
