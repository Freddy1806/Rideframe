// RIDEFRAME Activities (aktivitaeten.html, UX review 16.11.): ONE feed for all sports (rides, runs, indoor, virtual,
// strength), newest first, grouped by week with the week's totals, filter chips per sport, and ONE detail sheet for every
// sport. The row and the sheet are exported, so Home (handy.js) shows the same rows and opens the same sheet.
import { db } from './db.js';
import { fmtTime, fmtNum, esc, weekStart } from './util.js';
import { MODES, icon, applyTheme } from './theme.js';
import { profileOf, loadOf, sportOf } from './fitness.js';
import { labelOf, famOf, paceOf, distOf } from './sports.js';
import { nm, e1rm, doneSets, sessVol, setTxt, kgTxt, nSets, stravaText } from './kraftlib.js';
import { nav } from './nav.js';
import { collapse } from './actimport.js';

const $ = (s, r = document) => r.querySelector(s);
export const ORDER = ['ride', 'run', 'trainer', 'world', 'kraft', 'walk', 'swim', 'skate', 'ski', 'water', 'fit', 'ball', 'other'];

/** every activity of every sport, newest first; strength sessions come as copies with kraft: true and date = start (the form fitness.js expects) */
export async function loadActs() {
  const S = (await db.kvGet('settings').catch(() => null)) || {};
  const rides = (await db.all('rides').catch(() => [])).filter(r => r.routeId !== 'demo' && !r.unsaved && r.date);
  const kraft = ((await db.kvGet('kraft').catch(() => null)) || []).map(k => ({ ...k, kraft: true, date: k.start || k.date }));
  const acts = collapse([...rides, ...kraft]).sort((a, b) => b.date - a.date); // a watch session and its Strava copy are one entry (actimport.js)
  return { S, acts, P: profileOf(S, acts) };
}

export const durOf = a => a.kraft ? a.dur || 0 : a.duration || 0;
export const nameOf = a => a.kraft ? a.name || 'Workout' : a.source ? a.workout || labelOf(a.sportType) : a.workout && ['outdoor', 'run', 'pure'].includes(a.routeId) ? a.workout : a.routeName || MODES[sportOf(a)].short;
const paceS = (d, s) => d > 0 ? (x => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`)(s / d * 1000) : '–:––';
const kmTxt = a => `${fmtNum(a.distance / 1000, 1)} km`;
/** the small line of a row, per sport: km · time · W avg (bike), km · pace · time (run), time · sets (strength) */
export function lineOf(a) {
  if (a.kraft) return `${fmtTime(a.dur || 0)} · ${nSets(doneSets(a))}`;
  const g = sportOf(a);
  if (g !== 'run' && famOf(g) !== 'bike') return [esc(labelOf(a.sportType)), a.distance > 0 && distOf(g, a.distance), paceOf(g, a.sportType, a.distance, a.duration), fmtTime(a.duration)].filter(Boolean).join(' · '); // the other sports: what it was, then the numbers
  return (g === 'run' ? [kmTxt(a), paceS(a.distance, a.duration) + ' /km', fmtTime(a.duration)] : [kmTxt(a), fmtTime(a.duration), a.avgPower > 0 && `${a.avgPower} W avg`]).filter(Boolean).join(' · ');
}
const day = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const keyOf = a => (a.kraft ? 'k:' : 'r:') + a.id;
const mc = m => document.documentElement.dataset.modecolors === '1' ? `--mc:${MODES[m].color};--mcl:${MODES[m].light}` : '--mc:var(--accent);--mcl:var(--accent)';
export const hm = s => `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')} h`;

/** one activity row: icon in the mode colour, name, sport line, load points and day on the right */
export function rowHtml(a, P) {
  const m = sportOf(a);
  return `<button class="hrow frow" data-act="${esc(keyOf(a))}" style="${mc(m)}">${icon(m, 'rico')}<div><b>${esc(nameOf(a))}</b><small>${lineOf(a)}</small></div>
    <span class="fside"><b>${fmtNum(loadOf(a, P).pts)}<i> pts</i></b><small>${new Date(a.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</small></span></button>`;
}
/** wires every [data-act] in root to the detail sheet */
export function wireRows(root, D, onChange) { root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => detail(D.acts.find(a => keyOf(a) === b.dataset.act), D.P, onChange)); }

function flash(t) { let f = $('#fflash'); if (!f) { f = document.createElement('div'); f.id = 'fflash'; f.className = 'pflash'; document.body.append(f); } f.textContent = t; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), 3200); }
function sheet(html) { const s = document.createElement('div'); s.className = 'psheet'; s.innerHTML = `<div class="psheetin fdet">${html}</div>`; s.onclick = e => { if (e.target === s) s.remove(); }; document.body.append(s); return s; }

const SRCN = { strava: 'from Strava', file: 'from a file', manual: 'entered by hand', watch: 'from the watch' };
const SRC = { power: 'from power', 'heart rate': 'from heart rate', pace: 'from pace', duration: 'from duration' };
/** calories like the outdoor tile: runs ≈ kg × km, rides from the work (kJ × 1.1), else a flat 8 kcal/kg/h */
const kcalOf = (a, kg) => sportOf(a) === 'run' ? Math.round(a.distance / 1000 * kg) : a.kj > 0 ? Math.round(a.kj * 1.1) : Math.round(a.duration / 3600 * 8 * kg);

/** the one detail sheet for every sport; onChange() after a delete or upload so the caller can redraw */
export function detail(a, P, onChange = () => {}) {
  if (!a) return;
  const m = sportOf(a), run = m === 'run', L = loadOf(a, P), hr = (a.samples || []).map(s => s[5]).filter(v => v > 0), ext = a.kraft ? null : a.source; // strength from the watch: source 'watch', otherwise like any workout
  const cell = (l, v) => v ? `<div><span>${l}</span><b>${v}</b></div>` : '';
  const pc = !run && !a.kraft && paceOf(m, a.sportType, a.distance, a.duration); // swim /100 m, walk /km, rowing /500 m
  const nums = a.kraft ? cell('Time', fmtTime(a.dur || 0)) + cell('Sets', String(doneSets(a))) + cell('Volume', kgTxt(sessVol(a))) + cell('Records', a.prs ? '🏆 ' + a.prs : '') + cell('Avg HR', a.avgHr > 0 && String(a.avgHr)) + cell('Max HR', a.maxHr > 0 && String(a.maxHr)) + cell('Calories', a.kcal > 0 && `${fmtNum(a.kcal)} kcal`)
    : cell('Distance', a.distance > 0 && (m === 'swim' && a.distance < 10000 ? distOf(m, a.distance) : `${fmtNum(a.distance / 1000, 2)} km`)) + cell('Time', fmtTime(a.duration))
      + (run ? cell('Avg pace', `${paceS(a.distance, a.duration)} /km`) + cell('Fastest km', a.kmSplits?.length && fmtTime(Math.min(...a.kmSplits)))
        : pc ? cell('Avg pace', pc) : cell('Avg speed', a.duration && a.distance && `${fmtNum(a.distance / a.duration * 3.6, 1)} km/h`) + cell('Avg power', a.avgPower > 0 && `${a.avgPower} W`) + cell('NP', a.np > 0 && `${a.np} W`) + cell('Max power', a.maxPower > 0 && `${a.maxPower} W`) + cell('Cadence', a.avgCad > 0 && `${a.avgCad} rpm`))
      + cell('Avg HR', hr.length ? String(Math.round(hr.reduce((x, y) => x + y, 0) / hr.length)) : a.avgHr > 0 && String(a.avgHr)) + cell('Max HR', hr.length ? String(Math.max(...hr, a.maxHr || 0)) : a.maxHr > 0 && String(a.maxHr)) // 23.11.: the watch's samples are 10 s averages, its own max is higher
      + cell('Climb', a.gain > 0 && `${fmtNum(a.gain)} m`) + cell('Work', a.kj > 0 && `${fmtNum(a.kj)} kJ`) + cell('Calories', `${fmtNum(a.kcal > 0 ? a.kcal : kcalOf(a, P.kg))} kcal`);
  const laps = (a.laps || []).filter(l => l && l.t > 0);
  const at = ext && a.start ? a.start : a.date; // outside activities show their start, like Strava
  const s = sheet(`<div class="label">${new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${a.sportType ? ' · ' + esc(labelOf(a.sportType)) : ''}${ext ? ' · ' + SRCN[ext] : ''}</div>
    <div class="fdh" style="${mc(m)}">${icon(m, 'rico')}<h2>${esc(nameOf(a))}</h2></div>${a.source === 'watch' ? '<p class="hint fwsrc">Recorded on watch</p>' : ''}
    <div class="psum">${nums}<div class="fldc"><span>Load</span><b>${fmtNum(L.pts)} pts</b><small>${SRC[L.src] || L.src}</small></div></div>
    ${a.kraft ? '' : chart(a)}${ext ? routeSvg(a) : ''}
    ${a.note ? `<p class="fnotev">${esc(a.note)}</p>` : ''}
    ${a.kmSplits?.length ? `<div class="label">Splits</div><div class="kdet fspl">${a.kmSplits.map((t, i) => `<div><span>${i + 1}</span><span><i style="width:${Math.round(100 * Math.min(...a.kmSplits) / t)}%"></i></span><span>${fmtTime(t)} /km</span></div>`).join('')}</div>` : ''}
    ${laps.length > 1 ? `<div class="label">Laps</div><div class="kdet">${laps.map((l, i) => `<div><span>${i + 1}</span><span>${l.d ? fmtNum(l.d / 1000, 2) + ' km' : ''}${l.w ? ` · ${l.w} W` : ''}</span><span>${fmtTime(l.t)}</span></div>`).join('')}</div>` : ''}
    ${a.kraft ? (a.ex || []).map(x => `<div class="kdet"><b>${esc(nm(x))}</b>${x.sets.filter(y => y.done).map((y, j) => `<div><span>${y.warm ? 'W' : j + 1}</span><span>${setTxt(x.t, y)}${y.pr ? ' 🏆' : ''}</span><span>${x.t === 'w' ? fmtNum(e1rm(+y.kg, +y.r), 1) + ' kg 1RM' : ''}</span></div>`).join('')}</div>`).join('') : ''}
    <div class="pfoot col">${a.strava ? `<a class="btn ghost" href="${esc(a.strava)}" target="_blank" rel="noopener">View on Strava</a>` : !ext || ext === 'manual' ? '<button class="btn ghost" id="dStrava">Upload to Strava</button>' : ''}
      ${ext === 'manual' ? '<button class="btn ghost" id="dEdit">Edit</button>' : ''}${!a.kraft && (m === 'ride' || run) && ptsOf(a).length > 1 ? '<button class="btn ghost" id="dRoute">Use as route</button>' : ''}<button class="btn danger" id="dDel">Delete</button></div>`);
  const ur = $('#dRoute', s); if (ur) ur.onclick = async () => { // ride (or run) it again: saved as a route, selected on the outdoor page, which opens
    const { makeRoute } = await import('./navroute.js'), list = (await db.kvGet('navRoutes').catch(() => null)) || [];
    let rt = list.find(r => r.from === a.id); if (!rt) { rt = makeRoute(nameOf(a), ptsOf(a), { from: a.id }); list.unshift(rt); await db.kvSet('navRoutes', list).catch(() => {}); }
    const st = (await db.kvGet('settings').catch(() => null)) || {}, k = run ? 'run' : 'outdoor'; st[k] = { ...st[k], route: rt.id }; await db.kvSet('settings', st).catch(() => {});
    location.href = run ? 'outdoor.html?sport=run' : 'outdoor.html'; };
  const st = $('#dStrava', s); if (st) st.onclick = async () => { st.disabled = true; const url = await (a.kraft ? stravaKraft(a) : ext === 'manual' ? (await import('./addact.js')).manualToStrava(a, flash) : stravaRide(a, st)); st.disabled = false;
    if (url) { st.outerHTML = `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">View on Strava</a>`; onChange(); } };
  const ed = $('#dEdit', s); if (ed) ed.onclick = async () => { s.remove(); (await import('./addact.js')).addSheet({ edit: a, onSaved: (r, t) => { flash(t); onChange(); } }); };
  $('#dDel', s).onclick = async () => {
    if (!confirm(ext === 'strava' ? 'Delete this activity here? It stays on Strava.' : `Delete this ${a.kraft || ext ? 'activity' : run ? 'run' : 'ride'} for good?`)) return;
    if (a.kraft) { // same path as kraft.js: delete on the host, or remember it for the next sync when offline
      try { const ac = await import('./account.js'); await ac.deleteKraftRemote?.(a.id); }
      catch { const g = (await db.kvGet('kraftGone').catch(() => null)) || []; g.push(a.id); await db.kvSet('kraftGone', g).catch(() => {}); }
      const list = (await db.kvGet('kraft').catch(() => null)) || []; await db.kvSet('kraft', list.filter(x => x.id !== a.id)).catch(() => {});
    } else { // same path as outdoor.js: the host first, so a ride deleted here does not come back with the next sync
      try { const ac = await import('./account.js'); await ac.deleteRideRemote(a.id); } catch (e) { return flash('Server: ' + e.message); }
      await db.del('rides', a.id);
      if (ext) await (await import('./actimport.js')).forget(a); // the next import must not bring it back (on Strava it stays)
    }
    s.remove(); flash('Deleted.'); onChange();
  };
}
/** rides and runs: like outdoor.js toStrava (file export when the host has no Strava app); the link is kept on the ride */
async function stravaRide(a, btn) {
  const { stravaStatus, stravaConnect, stravaUpload } = await import('./stravaup.js'), { stravaExport } = await import('./tcx.js');
  const st = await stravaStatus(), name = nameOf(a);
  if (!st.configured) { stravaExport(a, name); return null; }
  try {
    if (!st.connected && !(await stravaConnect())) throw new Error('Not connected to Strava.');
    const url = await stravaUpload(a, name, null, t => { btn.textContent = t; });
    a.strava = url; await db.put('rides', a).catch(() => {}); flash('On Strava ✓'); window.open(url, '_blank'); return url;
  } catch (e) { flash(e.message || String(e)); btn.textContent = 'Upload to Strava'; return null; }
}
/** strength: like kraft.js toStrava (manual activity with the sets as text; text to the clipboard without Strava) */
async function stravaKraft(a) {
  const { stravaStatus, stravaConnect, stravaStrength } = await import('./stravaup.js');
  const st = await stravaStatus();
  if (!st.configured) { try { await navigator.clipboard.writeText(stravaText(a)); } catch {} flash('Strava is not set up on this server. Text copied.'); return null; }
  try {
    if (!st.connected && !(await stravaConnect())) throw new Error('Not connected to Strava.');
    flash('Sending to Strava …');
    const url = await stravaStrength({ id: a.id, name: a.name, start: a.start, dur: a.dur, description: stravaText(a) });
    const list = (await db.kvGet('kraft').catch(() => null)) || [], w = list.find(x => x.id === a.id); a.strava = url;
    if (w) { w.strava = url; await db.kvSet('kraft', list).catch(() => {}); import('./account.js').then(m => m.pushKraft?.(w)).catch(() => {}); }
    flash('On Strava ✓'); window.open(url, '_blank'); return url;
  } catch (e) { flash(e.message || String(e)); return null; }
}

/** power (bike with a power meter) or pace (run, bike without one) as the accent line, heart rate as the second line; 30 s buckets keep it calm */
function chart(a) {
  const ss = a.samples || []; if (ss.length < 30) return '';
  const col = i => ss.map(s => +s[i] || 0), ok = v => v.filter(x => x > 0).length > v.length * .5;
  const pw = col(2), sp = col(3), hr = col(5), run = sportOf(a) === 'run', main = !run && ok(pw) ? pw : ok(sp) ? sp : null, isP = main === pw, isPace = main === sp && run;
  if (!main && !ok(hr)) return '';
  const N = Math.min(120, ss.length), bucket = v => [...Array(N)].map((_, i) => { const sl = v.slice(Math.floor(i * v.length / N), Math.floor((i + 1) * v.length / N)).filter(x => x > 0); return sl.length ? sl.reduce((x, y) => x + y, 0) / sl.length : 0; });
  const W0 = 320, H = 120, T = 16, B = 18, x = i => i / (N - 1) * W0, line = (v, y) => v.map((p, i) => p > 0 ? `${i && v[i - 1] > 0 ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}` : '').join('');
  let path = '', hrPath = '', top = '', hrTop = '';
  if (main) { const v = bucket(main), hi = Math.max(...v) * 1.08 || 1, lo = isP ? 0 : Math.min(...v.filter(p => p > 0)) * .9, y = p => T + (1 - (p - lo) / Math.max(1e-6, hi - lo)) * (H - T - B);
    path = line(v, y); top = isP ? `${Math.round(Math.max(...v))} W` : isPace ? `${paceS(1000, 3600 / Math.max(...v))} /km` : `${fmtNum(Math.max(...v), 0)} km/h`; }
  if (ok(hr)) { const v = bucket(hr), hi = Math.max(...v) + 5, lo = Math.min(...v.filter(p => p > 0)) - 5, y = p => T + (1 - (p - lo) / (hi - lo)) * (H - T - B); hrPath = line(v, y); hrTop = `${Math.round(Math.max(...v))} bpm`; }
  const end = fmtTime(ss[ss.length - 1][0] || ss.length);
  return `<div class="label">${main ? (isP ? 'Power' : isPace ? 'Pace' : 'Speed') : ''}${main && hrPath ? ' &amp; ' : ''}${hrPath ? 'heart rate' : ''}</div>
    <svg class="kchart fchart" viewBox="0 0 ${W0} ${H}" role="img" aria-label="Chart over time">
      <line x1="0" x2="${W0}" y1="${H - B}" y2="${H - B}" class="kgrid"/>${hrPath ? `<path d="${hrPath}" class="fhr"/>` : ''}${path ? `<path d="${path}" class="kline" style="stroke-width:1.8"/>` : ''}
      ${top ? `<text x="2" y="10">${top}</text>` : ''}${hrTop ? `<text x="${W0 - 2}" y="10" text-anchor="end" class="fhrt">${hrTop}</text>` : ''}<text x="2" y="${H - 4}">0:00</text><text x="${W0 - 2}" y="${H - 4}" text-anchor="end">${end}</text></svg>`;
}

/** the route as a line: Strava's summary polyline (imported) or the GPS of a file; no map tiles, just the shape */
function ptsOf(a) {
  let pts = (a.samples || []).filter(s => s[6] != null).map(s => [s[6], s[7], s[8] ?? null]);
  if (pts.length < 2 && a.polyline) { pts = []; const p = a.polyline; let i = 0, la = 0, lo = 0; // Google encoded polyline (Strava map.summary_polyline)
    const nx = () => { let r = 0, sh = 0, b; do { b = p.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i < p.length); return r & 1 ? ~(r >> 1) : r >> 1; };
    while (i < p.length) { la += nx(); if (i >= p.length) break; lo += nx(); pts.push([la / 1e5, lo / 1e5, null]); } }
  return pts;
}
function routeSvg(a) {
  const pts = ptsOf(a);
  if (pts.length < 2) return '';
  const k = Math.cos(pts[0][0] * Math.PI / 180), xs = pts.map(q => q[1] * k), ys = pts.map(q => -q[0]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1e-6, h = Math.max(...ys) - y0 || 1e-6;
  const W0 = 320, H = 150, sc = Math.min((W0 - 16) / w, (H - 16) / h), ox = (W0 - w * sc) / 2, oy = (H - h * sc) / 2, step = Math.max(1, Math.floor(pts.length / 600));
  let d = ''; for (let i = 0; i < pts.length; i = i + step < pts.length || i === pts.length - 1 ? i + step : pts.length - 1) d += `${d ? 'L' : 'M'}${(ox + (xs[i] - x0) * sc).toFixed(1)},${(oy + (ys[i] - y0) * sc).toFixed(1)}`;
  return `<div class="label">Route</div><svg class="kchart froute" viewBox="0 0 ${W0} ${H}" role="img" aria-label="Route shape"><path d="${d}" class="kline" style="stroke-width:2.2"/></svg>`;
}

// ---------------- the page ----------------
function weekLabel(w0) {
  const now = weekStart(Date.now()), p = new Date(now); p.setDate(p.getDate() - 7);
  if (w0 === now) return 'This week'; if (w0 === p.getTime()) return 'Last week';
  const s = new Date(w0), e = new Date(w0); e.setDate(e.getDate() + 6); const mo = d => d.toLocaleDateString('en-GB', { month: 'short' }), yr = e.getFullYear() !== new Date().getFullYear() ? ' ' + e.getFullYear() : '';
  return s.getMonth() === e.getMonth() ? `${s.getDate()}–${e.getDate()} ${mo(e)}${yr}` : `${s.getDate()} ${mo(s)} – ${e.getDate()} ${mo(e)}${yr}`;
}
async function page(root) {
  let D = await loadActs(), f = new URLSearchParams(location.search).get('f') || 'all';
  applyTheme(D.S, null); nav('feed');
  const reload = async () => { D = await loadActs(); draw(); };
  // Strava import + adding by hand (17.11.); su = stravaup.js, loaded up front so a tap can open Strava's login without waiting
  let su = null, st = null, msg = '', busy = false, fOpen = false, mOpen = false;
  document.addEventListener('click', e => { if (mOpen && !e.target.closest?.('#fMenu, #fPlus')) { mOpen = false; const m = $('#fMenu', root); if (m) m.hidden = true; $('#fPlus', root)?.setAttribute('aria-expanded', 'false'); } });
  const paintMsg = () => { const m = $('#fMsg', root); if (m) { m.textContent = msg; m.hidden = !msg; } };
  const doImport = async () => {
    busy = true; msg = 'Reading Strava …'; draw();
    const r = await (await import('./actimport.js')).importStrava({ onState: t => { msg = t; paintMsg(); } });
    busy = false; msg = r.text; if (r.added || r.linked) await reload(); else draw();
  };
  const impTap = () => {
    if (!su || busy) return;
    if (!st?.connected || !st.canImport) { // connect (or reconnect for the read permission) first; the window opens right in the tap
      const pr = su.stravaConnect(!!st?.connected); msg = 'Waiting for Strava …'; paintMsg();
      pr.then(async ok => { st = await su.stravaStatus(); if (ok && st.canImport) return doImport();
        msg = st.connected && !st.canImport ? 'Reconnect Strava to import your activities and leave reading activities allowed.' : 'Not connected to Strava.'; draw(); });
      return;
    }
    doImport();
  };
  let AA = null; const addTap = async (file = false) => (AA ||= await import('./addact.js')).addSheet({ acts: D.acts, file, onSaved: async (rec, t) => {
    flash(t); await reload();
    if (D.S.autoStrava && rec.source === 'manual') (await import('./addact.js')).manualToStrava(rec, flash, true).then(u => u && reload()); // like every save: upload on its own when switched on
  } });
  const draw = () => {
    const have = ORDER.filter(m => D.acts.some(a => sportOf(a) === m)); if (f !== 'all' && !have.includes(f)) f = 'all';
    const groups = new Map(); for (const a of D.acts) if (f === 'all' || sportOf(a) === f) { const w = weekStart(a.date); (groups.get(w) || groups.set(w, []).get(w)).push(a); }
    const reco = st?.connected && !st.canImport;
    // 27.11. (owner): the filter chips behind a "Filter" button that names the active filter; adding and importing behind one small "+"
    // (Add activity · Import from Strava · Import file) and in Settings → Activities & Strava, no big buttons on top of the feed
    const fl = f === 'all' ? 'Filter' : `Filter · ${MODES[f]?.short || f}`;
    root.innerHTML = `<header class="ptop"><div class="pbrand"><b>RIDEFRAME </b><span>Activities</span></div>
        ${D.acts.length ? `<button type="button" class="fhbtn${f !== 'all' ? ' on' : ''}" id="fFilter" aria-expanded="${fOpen}" aria-controls="fChips">${icon('list', 'fsico')}<span>${esc(fl)}</span></button>` : ''}
        <button type="button" class="pgear hbtn fplus" id="fPlus" aria-label="Add or import activities" aria-expanded="${mOpen}" aria-controls="fMenu">${icon('plus', 'gico')}</button>
        <a class="btn ghost ksmall fstats" href="statistik.html" id="fStats">${icon('chart', 'fsico')}Stats</a>
        <div class="fmenu" id="fMenu" role="menu" ${mOpen ? '' : 'hidden'}><button type="button" role="menuitem" id="fAdd">${icon('plus', 'fsico')}Add activity</button>
          <button type="button" role="menuitem" id="fImp" ${st?.configured ? '' : 'hidden'} ${busy ? 'disabled' : ''}>${icon('list', 'fsico')}${reco ? 'Reconnect Strava' : 'Import from Strava'}</button>
          <button type="button" role="menuitem" id="fFile">${icon('other', 'fsico')}Import file</button></div></header>
      <p class="fmsg" id="fMsg" role="status" ${msg || reco ? '' : 'hidden'}>${esc(msg || (reco ? 'Reconnect Strava to import your activities.' : ''))}</p>
      ${!D.acts.length ? `<div class="fempty"><p class="hint">No activities yet. Record one on Today, or add or import them with the + above.</p><a class="btn" href="handy.html">Go to Today</a></div>`
      : `<div class="fchips" id="fChips" role="tablist" ${fOpen ? '' : 'hidden'}>${[['all', 'All'], ...have.map(m => [m, MODES[m].short])].map(([k, l]) => `<button role="tab" data-f="${k}" class="fchip ${f === k ? 'on' : ''}" aria-selected="${f === k}" ${k !== 'all' ? `style="${mc(k)}"` : ''}>${l}</button>`).join('')}</div>
        ${[...groups].map(([w, l]) => `<section class="fweek"><div class="fwh"><span class="label">${weekLabel(w)}</span><span class="fwt">${l.length} · ${hm(l.reduce((x, a) => x + durOf(a), 0))} · ${fmtNum(l.reduce((x, a) => x + loadOf(a, D.P).pts, 0))} pts</span></div>
          ${l.map(a => rowHtml(a, D.P)).join('')}</section>`).join('')}`}`;
    root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { f = b.dataset.f; fOpen = false; const u = new URL(location.href); if (f === 'all') u.searchParams.delete('f'); else u.searchParams.set('f', f); history.replaceState(null, '', u); draw(); });
    wireRows(root, D, reload);
    $('#fFilter', root)?.addEventListener('click', () => { fOpen = !fOpen; mOpen = false; draw(); });
    $('#fPlus', root).onclick = e => { e.stopPropagation(); mOpen = !mOpen; if (mOpen) import('./addact.js').then(m => { AA = m; }).catch(() => {}); draw(); };
    const pick = fn => () => { mOpen = false; $('#fMenu', root).hidden = true; $('#fPlus', root).setAttribute('aria-expanded', 'false'); fn(); };
    $('#fImp', root).onclick = pick(impTap); $('#fAdd', root).onclick = pick(() => addTap()); $('#fFile', root).onclick = pick(() => addTap(true));
  };
  draw();
  { const o = new URLSearchParams(location.search).get('open'), a = o && D.acts.find(x => keyOf(x) === o); if (a) detail(a, D.P, reload); } // ?open=r:<id> | k:<id>: the overview's "Last activity" card (js/cards.js)
  // strength sessions from another device or the Garmin watch (tools/watch-api.mjs) reach this phone with the strength sync
  // ... and the account's activities this phone does not have yet: the host's background Strava import (tools/strava-auto.mjs), the laptop's import
  const pull = () => import('./account.js').then(async ac => { if (!ac.account()) return; const before = D.acts.map(a => a.id).join();
    const n = await ac.pullRides().catch(() => 0); await ac.syncKraft(); D = await loadActs(); if (n || D.acts.map(a => a.id).join() !== before) draw(); }).catch(() => {});
  const auto = async () => { if (st?.connected && st.canImport) { const r = await (await import('./actimport.js')).autoImport(D.S); if (r?.added) { msg = r.text.replace('.', ' from Strava.'); await reload(); } } };
  pull();
  import('./stravaup.js').then(async m => { su = m; st = await m.stravaStatus(); draw(); await auto(); }).catch(() => {});
  // back to the front (from Garmin Connect, the Strava app) or back online: look again, quietly (autoImport keeps its 5 minutes)
  const again = () => { if (document.hidden || !root.isConnected) return; pull(); auto().catch(() => {}); };
  document.addEventListener('visibilitychange', again); addEventListener('online', again);
}
const root = document.getElementById('feed');
if (root) { await page(root); if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); }
