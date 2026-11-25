// Personal workouts on screen (js/myworkouts.js): one editor, opened from the route page ("Customise" next to the workout
// choice) and from the profile ("My workouts"), the grouped workout choice of the route page and the profile section
// with the FTP. Every control is a real <button> / <input>, so the gamepad focus navigation reaches it.
import { esc, fmtTime, fmtKm } from './util.js';
import { catalog, MY, workoutById } from './workouts.js';
import { LIM, newId, orderFor, kindOf, defaultName, toV2, fromBuiltin2, newWorkout2, statsOf, chartSVG, isV2 } from './myworkouts.js';
import { fitRoute, fittingRoutes, AFTER_PCT, FREE_PCT } from './routefit.js';
import { loadPersonal, personalList, personalById, savePersonal, deletePersonal, localOnly, uploadLocal, storeMode } from './myworkouts-store.js';

if (!document.querySelector('link[data-mw]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/myworkouts.css'; l.dataset.mw = '1'; document.head.append(l); }
const $ = (s, r = document) => r.querySelector(s);
const mins = sec => `${Math.round(sec / 60)} min`;
const km = fmtKm; // like everywhere in the app
const FIT_HOW = `Estimated with your FTP and weight at the workout's target watts (free blocks at ${FREE_PCT} %, after the workout ${AFTER_PCT} % FTP)`;
const lapsTxt = n => n > 1 ? `${n} laps` : 'the route';
const cut = (s, n = LIM.name) => s.length > n ? s.slice(0, n).trim() : s;

/* ---------------- in-page question (no native confirm / prompt: the gamepad reaches these buttons) ---------------- */
/** asks one question in a small window; buttons = [{ label, value, cls }]; resolves the value, or null on B / Escape / backdrop */
export function ask({ title, text = '', buttons }) {
  return new Promise(done => {
    const m = document.createElement('div'); m.className = 'modal mwask';
    m.innerHTML = `<div class="box" role="alertdialog" aria-modal="true" aria-labelledby="mwAskT"><h3 id="mwAskT">${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="actions">${buttons.map((b, i) => `<button type="button" class="btn small ${b.cls || 'ghost'}" data-k="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const fin = v => { m.remove(); document.removeEventListener('keydown', key, true); done(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fin(null); } };
    document.addEventListener('keydown', key, true);
    m.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) fin(buttons[+b.dataset.k].value); else if (e.target === m) fin(null); });
    document.body.append(m); m.querySelector('button[data-k]')?.focus();
  });
}

/* ---------------- the editor: the workout builder (js/wbuilder.js) ---------------- */
/** opens the builder; draft = a personal workout (v2, or an old one: converted without loss; saved = it exists already), ftp in W,
 *  hrMax in bpm (zones in bpm), route = { id, name, track?, settings?, laps? } it is made for, kind = what sort of session
 *  ("VO2") for the default name. Resolves { saved: workout } | { deleted: id } | null (cancelled). */
export async function openEditor({ draft, saved = false, ftp = 0, hrMax = 0, route = null, kind = '' }) {
  const { openBuilder } = await import('./wbuilder.js');
  const w = toV2(draft); if (route?.id && !w.routeId) { w.routeId = route.id; w.routeName = cut(route.name || ''); }
  kind ||= kindOf(workoutById(w.base)?.name || '');
  const others = personalList().filter(x => x.id !== w.id).map(x => x.name);
  const autoName = !saved && !String(w.name || '').trim(); // a default name ("River Valley VO2 1", "Bike Workout") follows the start until the rider names it
  if (autoName) w.name = w.routeName || w.base ? defaultName(w.routeName || '', kind, others) : 'Bike Workout';
  return openBuilder({ draft: w, saved, ftp, hrMax, route, ask, autoName, nameFor: bw => w.routeName ? defaultName(w.routeName, kindOf(bw.name), others) : cut(bw.name) });
}

/* ---------------- route page ---------------- */
const optText = (w, routeId) => `${esc(w.name)} · ${Math.round(w.steps.reduce((a, s) => a + s.dur, 0) / 60)} min${w.routeId && w.routeId === routeId ? ' · made for this route' : ''}`;
/** the options of the route page's workout choice: free ride, "My workouts" (made for this route first), the standard ones */
export function workoutOptions(routeId) {
  const mine = orderFor(personalList(), routeId).map(p => workoutById(p.id)).filter(Boolean);
  const own = [...mine, ...MY], cat = catalog(), co = cat.filter(w => w.coach), std = cat.filter(w => !w.coach); // coach workouts (js/coachworkouts.js) under their own heading
  return `<option value="">Free ride (route gradient)</option>
    ${own.length ? `<optgroup label="My workouts">${own.map(w => `<option value="${esc(w.id)}">${w.mine ? '★ ' : ''}${optText(w, routeId)}</option>`).join('')}</optgroup>` : ''}
    ${co.length ? `<optgroup label="Coach">${co.map(w => `<option value="${esc(w.id)}">${optText(w, routeId)}</option>`).join('')}</optgroup>` : ''}
    <optgroup label="Standard workouts">${std.map(w => `<option value="${w.id}">${optText(w, routeId)}</option>`).join('')}</optgroup>`;
}
/** the line under the workout choice: does the workout fit this route (js/routefit.js)? fits / too short (more laps or
 *  another route, as buttons) / much longer (where the workout ends). routes = all routes for the suggestions. */
export function fitLineHTML(route, w, settings, routes = []) {
  const f = w ? fitRoute(route.track, w, settings, { laps: settings.laps || 1 }) : null; if (!f) return '';
  const W = mins(f.workoutSec), R = mins(f.routeSec), L = route.track.length;
  if (f.verdict === 'fits') return `<p class="mwfitline ok" id="mwFitLine" data-fit="fits" title="${FIT_HOW}">✓ Workout ${W} · ${lapsTxt(f.laps) === 'the route' ? 'route takes' : `${f.laps} laps take`} about ${R} at these watts: fits${f.spare >= 60 ? `, ${mins(f.spare)} to spare` : ''}</p>`;
  if (f.verdict === 'long') return `<p class="mwfitline ok" id="mwFitLine" data-fit="long" title="${FIT_HOW}">✓ Workout ${W} · ${f.laps > 1 ? `${f.laps} laps take` : 'route takes'} about ${R}: the workout ends at km ${km(f.endD)} of ${km(L)}${f.laps > 1 ? ` in lap ${f.endLap}` : ''}, the rest is free riding</p>`;
  const sugg = fittingRoutes(routes, w, { ...settings, laps: 1 }, { not: route.id });
  const lapBtn = f.lapsNeeded && f.lapsNeeded > f.laps ? `<button type="button" class="btn ghost small" id="mwFitLaps" data-laps="${f.lapsNeeded}">Ride ${f.lapsNeeded} laps</button>` : '';
  return `<div class="mwfitline bad" id="mwFitLine" data-fit="short" title="${FIT_HOW}"><p>⚠ ${f.laps > 1 ? `${f.laps} laps end` : 'Route ends'} after about ${R}, the workout needs ${W}: this workout does not fit on this route.</p>
    <div class="mwfitacts">${lapBtn}${sugg.length ? `<span>${lapBtn ? 'or pick' : 'Pick'} a longer route:</span>${sugg.map(x => `<button type="button" class="btn ghost small mwfitr" data-route="${esc(x.id)}" title="Fits with ${mins(x.fit.spare)} to spare">${esc(x.name)}</button>`).join('')}` : lapBtn ? '' : '<span>Shorten it with “Customise”.</span>'}</div></div>`;
}
/** the "Customise" button and the route fit line on the route page; ctx = { route, state, saveSettings, rerender, routes, openRoute } */
export function wireRoutePick(root, { route, state, saveSettings, rerender, routes = () => [], openRoute = () => {} }) {
  const sel = $('#workSel', root), info = $('#mwFitInfo', root), btn = $('#wCustom', root); if (!sel || !btn) return;
  const show = async () => {
    const w = workoutById(sel.value), up = localOnly();
    info.innerHTML = fitLineHTML(route, w, state.settings, w ? routes() : [])
      + (up.length ? `<p class="mwup">${up.length} ${up.length === 1 ? 'workout' : 'workouts'} from this browser not in your account yet. <button type="button" class="btn ghost small" id="mwUp">Upload</button></p>` : '');
    const ub = $('#mwUp', info); if (ub) ub.onclick = async () => { ub.disabled = true; await uploadLocal(); rerender(); };
    const lb = $('#mwFitLaps', info); if (lb) lb.onclick = async () => { const n = +lb.dataset.laps, ls = $('#lapSel', root);
      if (ls && ![...ls.options].some(o => +o.value === n)) ls.add(new Option(`${n} laps · ${(route.track.length * n / 1000).toFixed(1)} km`, String(n)));
      state.settings.laps = n; if (ls) ls.value = String(n); await saveSettings(); await show(); (ls || $('#workSel', root))?.focus(); }; // focus on the laps, so the pad stays on the page
    info.querySelectorAll('[data-route]').forEach(b => b.onclick = () => openRoute(b.dataset.route));
  };
  const mine = $('#wMine', root); if (mine) mine.onclick = () => { location.href = 'profil.html#myworkouts'; };
  sel.addEventListener('change', show); $('#lapSel', root)?.addEventListener('change', () => setTimeout(show)); show(); // after app.js stored the laps
  btn.onclick = async () => {
    const cur = workoutById(sel.value), own = cur?.personal ? personalById(cur.id) : null;
    const draft = own || (cur ? { ...fromBuiltin2(cur), name: '' } : { ...newWorkout2(), name: '' }); // the editor names it: "River Valley VO2 1"
    const res = await openEditor({ draft, saved: !!own, ftp: +state.settings.ftp || 0, hrMax: +state.settings.hrMax || 0, route: { id: route.id, name: route.name, track: route.track, settings: state.settings, laps: state.settings.laps || 1 }, kind: own ? '' : kindOf(cur?.name || '') });
    if (!res) return;
    state.settings.workout = res.saved ? res.saved.id : ''; await saveSettings(); rerender();
  };
}

// no mark on the library cards (owner 18.11.: "too short" belongs on the route page, where you pick the workout, not on the card)

/* ---------------- profile ---------------- */
/** "My workouts" with the FTP, in the profile; ctx = { ftp: () => W, setFtp: async W => {} } */
export async function profileSection(el, ctx) {
  if (!el) return;
  await loadPersonal();
  const draw = () => {
    const list = personalList(), ftp = +ctx.ftp() || 0, up = localOnly();
    el.innerHTML = `<h3 class="ksec" id="myworkouts">My workouts</h3>
    <section class="kcard mwprof">
      <div class="mwftp"><label class="mwftpin" for="mwFtp"><span>FTP</span></label><input type="number" id="mwFtp" min="60" max="600" step="1" inputmode="numeric" value="${ftp || ''}" placeholder="e.g. 250"><small>W</small></div>
      <p class="hint mwhint">FTP is the power you can hold for about an hour; every workout target is a % of it.</p>
      <div class="mwest"><label for="mwB20">Best 20 min</label><input type="number" id="mwB20" min="60" max="700" step="1" inputmode="numeric" placeholder="W"><span>× 0.95 =</span><b id="mwEst">–</b><button type="button" class="btn ghost ksmall" id="mwUse" disabled>Use as FTP</button></div>
      ${storeMode() === 'local' ? '<p class="hint mwhint">Saved in this browser only. Sign in to keep them private in your account on every device.</p>' : ''}
      ${up.length ? `<div class="mwupbox"><span>${up.length} ${up.length === 1 ? 'workout' : 'workouts'} from this browser not in your account yet.</span><button type="button" class="btn ghost ksmall" id="mwUpP">Upload</button></div>` : ''}
      <div class="mwlist">${list.length ? list.map(w => { const st = statsOf(w); return `<div class="mwitem" data-id="${esc(w.id)}">
        <div class="mwitop"><b>${esc(w.name)}</b><small>${st.exact ? '' : '~'}${fmtTime(st.sec)} · ${st.steps} steps${st.avg ? ` · avg ${st.avg} %` : ''}${w.routeName ? ` · for ${esc(w.routeName)}` : ''}</small></div>
        ${chartSVG(toV2(w).steps, { h: 34, cls: 'mwthumb', ftp: +ctx.ftp() || undefined })}
        <div class="mwiacts"><button type="button" class="btn ghost ksmall" data-ed="${esc(w.id)}">Edit</button><button type="button" class="btn ghost ksmall" data-dup="${esc(w.id)}">Duplicate</button><button type="button" class="btn ghost ksmall mwdanger" data-del="${esc(w.id)}">Delete</button></div></div>`; }).join('')
        : '<p class="hint mwhint">No personal workouts yet. Open a route on the big screen, pick a workout and tap “Customise”, or build one here.</p>'}</div>
      <button type="button" class="btn ghost ksmall mwnew" id="mwNew">+ New workout</button>
      <p class="mwerr" id="mwPErr" role="alert"></p>
    </section>`;
    const perr = t => { $('#mwPErr', el).textContent = t || ''; };
    const fi = $('#mwFtp', el); fi.onchange = async () => { const v = Math.round(+fi.value); if (!(v >= 60 && v <= 600)) { fi.value = ftp || ''; return perr('FTP: 60–600 W.'); } perr(); await ctx.setFtp(v); };
    const b20 = $('#mwB20', el), est = () => { const v = +b20.value; return v >= 60 && v <= 700 ? Math.round(v * 0.95) : 0; };
    b20.oninput = () => { const e = est(); $('#mwEst', el).textContent = e ? e + ' W' : '–'; $('#mwUse', el).disabled = !e; };
    $('#mwUse', el).onclick = async () => { const e = est(); if (e >= 60 && e <= 600) await ctx.setFtp(e); };
    const edit = async (w, saved) => { const res = await openEditor({ draft: w, saved, ftp: +ctx.ftp() || 0, hrMax: +ctx.hrMax?.() || 0, route: w.routeId ? { id: w.routeId, name: w.routeName || '' } : null }); if (res) draw(); };
    el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const w = personalById(b.dataset.ed); if (w) edit(w, true); });
    el.querySelectorAll('[data-dup]').forEach(b => b.onclick = async () => { const w = personalById(b.dataset.dup); if (!w) return;
      try { await savePersonal({ ...w, id: newId(), name: cut(w.name, LIM.name - 5) + ' copy' }); draw(); } catch (e) { perr('Not saved: ' + e.message); } });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const w = personalById(b.dataset.del); if (!w) return;
      if (await ask({ title: `Delete “${w.name}”?`, text: 'It is removed from your workouts for good.', buttons: [{ label: 'Keep it', value: null }, { label: 'Delete', value: 'del', cls: 'danger' }] }) !== 'del') return b.focus();
      try { await deletePersonal(w.id); draw(); } catch (e) { perr('Not deleted: ' + e.message); } });
    $('#mwNew', el).onclick = () => edit({ ...newWorkout2(), name: '' }, false);
    const ub = $('#mwUpP', el); if (ub) ub.onclick = async () => { ub.disabled = true; await uploadLocal(); draw(); };
  };
  draw();
  if (location.hash === '#myworkouts') $('#myworkouts', el)?.scrollIntoView();
}
