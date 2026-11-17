// Personal workouts on screen (js/myworkouts.js): one editor, opened from the route page ("Customise" next to the workout
// choice) and from the profile ("My workouts"), the grouped workout choice of the route page and the profile section
// with the FTP. Every control is a real <button> / <input>, so the gamepad focus navigation reaches it.
import { esc, fmtTime } from './util.js';
import { WORKOUTS, MY, workoutById } from './workouts.js';
import { LIM, newId, totalSec, avgPct, stepAvg, isWork, watts, scaleWork, repeatBlock, graphSVG, zoneOf, fromBuiltin, freeTemplate, orderFor, kindOf, defaultName, nameSuggestions } from './myworkouts.js';
import { loadPersonal, personalList, personalById, savePersonal, deletePersonal, localOnly, uploadLocal, storeMode } from './myworkouts-store.js';

if (!document.querySelector('link[data-mw]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/myworkouts.css'; l.dataset.mw = '1'; document.head.append(l); }
const $ = (s, r = document) => r.querySelector(s);
const mins = sec => `${Math.round(sec / 60)} min`;
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

/* ---------------- the editor ---------------- */
const wattsText = (s, ftp) => !ftp ? '–' : s.pct2 != null ? `${watts(s.pct, ftp)} → ${watts(s.pct2, ftp)} W` : `${watts(s.pct, ftp)} W`;
const FIELD = { min: [LIM.minMin, LIM.maxMin, 'Minutes'], pct: [LIM.minPct, LIM.maxPct, '% FTP'], pct2: [LIM.minPct, LIM.maxPct, 'Ramp to % FTP'] };
/** opens the editor; draft = a personal workout (saved = it exists already), ftp in W, route = { id, name, sec? } it is made for,
 *  kind = what sort of session ("VO2") for the name suggestions. Resolves { saved: workout } | { deleted: id } | null (cancelled). */
export function openEditor({ draft, saved = false, ftp = 0, route = null, kind = '' }) {
  return new Promise(done => {
    const w = JSON.parse(JSON.stringify(draft)); if (route?.id && !w.routeId) { w.routeId = route.id; w.routeName = cut(route.name || ''); }
    kind ||= kindOf(workoutById(w.base)?.name || ''); // 'Intervals' when there is no built-in behind it
    const others = personalList().filter(x => x.id !== w.id).map(x => x.name);
    if (!saved && !String(w.name || '').trim()) w.name = defaultName(w.routeName || '', kind, others);
    const sugg = nameSuggestions(w.routeName || '', kind, others, { minutes: Math.round(totalSec(w.steps) / 60) });
    if (!sugg.includes(w.name)) sugg.unshift(w.name); sugg.length = Math.min(sugg.length, 4);
    const start = JSON.stringify([w.name, w.steps]), dirty = () => JSON.stringify([String(w.name).trim(), w.steps]) !== start;
    let snap = null, sel = -1; // snap: the steps when the intensity slider started moving
    const m = document.createElement('div'); m.className = 'modal mwmodal';
    m.innerHTML = `<div class="box mwbox" role="dialog" aria-modal="true" aria-labelledby="mwTitle">
      <div class="mwhead"><div class="label" id="mwTitle">${saved ? 'Edit workout' : 'Customise workout'}${w.routeName ? ` · for ${esc(w.routeName)}` : ''}</div>
        <button type="button" class="mwx" id="mwClose" aria-label="Close">✕</button></div>
      <label class="mwname"><span class="label">Name</span><input type="text" id="mwName" maxlength="${LIM.name}" value="${esc(w.name)}" autocomplete="off"></label>
      <div class="mwchips" id="mwChips" aria-label="Name suggestions">${sugg.map(n => `<button type="button" class="mwchip${n === w.name ? ' on' : ''}" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div class="mwsum" id="mwSum"></div>
      <div class="mwgwrap" id="mwGraph"></div>
      <div class="mwint"><label for="mwInt">Intensity of the work steps</label><input type="range" id="mwInt" min="-20" max="20" step="1" value="0"><b id="mwIntV">±0 %</b></div>
      <div class="mwcols" aria-hidden="true"><span>#</span><span>Step</span><span>Minutes</span><span>% FTP</span><span title="Empty = flat. A ramp moves the target evenly from % FTP to this value; set it to the same % to make the step flat again.">Ramp to</span><span>Watts</span><span></span></div>
      <div class="mwsteps" id="mwSteps"></div>
      <div class="mwtools"><button type="button" class="btn ghost small" id="mwAdd">+ Step</button>
        <div class="mwrep"><span>Repeat steps</span><input type="number" id="mwRf" min="1" inputmode="numeric" aria-label="Repeat from step"><span>to</span><input type="number" id="mwRt" min="1" inputmode="numeric" aria-label="Repeat to step"><span>×</span><input type="number" id="mwRn" min="2" max="${LIM.rep}" value="3" inputmode="numeric" aria-label="Times in a row"><button type="button" class="btn ghost small" id="mwRep">Repeat</button></div></div>
      <p class="mwerr" id="mwErr" role="alert"></p>
      <div class="actions mwacts">${saved ? '<button type="button" class="btn danger small" id="mwDel">Delete</button>' : ''}<span class="mwsp"></span>
        <button type="button" class="btn ghost small" id="mwCancel">Cancel</button>${saved ? '<button type="button" class="btn ghost small" id="mwSaveNew">Save as new</button>' : ''}<button type="button" class="btn small mwsave" id="mwSave">Save</button></div></div>`;
    document.body.append(m);
    const err = t => { $('#mwErr', m).textContent = t || ''; };
    const close = v => { m.remove(); document.removeEventListener('keydown', onKey, true); done(v); };
    let asking = false;
    /** Cancel, ✕, B, Escape, backdrop: with unsaved changes ask first (keep editing / save / discard) */
    const leave = async () => {
      if (asking) return; if (!dirty()) return close(null);
      asking = true; const v = await ask({ title: 'Discard your changes?', text: `“${String(w.name).trim() || 'This workout'}” has changes that are not saved yet.`,
        buttons: [{ label: 'Keep editing', value: 'keep' }, { label: 'Discard', value: 'discard', cls: 'danger' }, { label: 'Save', value: 'save', cls: 'mwsave' }] }); asking = false;
      if (v === 'discard') close(null); else if (v === 'save') save(false); else $('#mwCancel', m)?.focus();
    };
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.mwask')) { e.stopPropagation(); leave(); } };
    document.addEventListener('keydown', onKey, true);

    const summary = () => {
      const sec = totalSec(w.steps), avg = avgPct(w.steps), aw = watts(avg, ftp);
      let fit = '';
      if (route?.sec > 0) { const d = sec - route.sec;
        fit = d > 60 ? `<p class="mwwarn" id="mwWarn">⚠ ${mins(d)} longer than the route (${esc(route.name)} ≈ ${mins(route.sec)} at your pace). Shorten it or ride more laps.</p>`
          : `<p class="mwfit">Fits the route: ${esc(route.name)} takes about ${mins(route.sec)}.</p>`; }
      $('#mwSum', m).innerHTML = `<span><b id="mwTotal">${fmtTime(sec)}</b><small>total</small></span><span><b>${avg} %</b><small>avg FTP</small></span>
        <span><b>${aw ? aw + ' W' : '–'}</b><small>${ftp ? `avg · FTP ${ftp} W` : 'set your FTP in the profile'}</small></span><span><b>${w.steps.length}</b><small>steps</small></span>${fit}`;
      $('#mwGraph', m).innerHTML = graphSVG(w.steps, { h: 80, mark: sel });
    };
    const rowHTML = (s, i) => `<div class="mwstep" data-i="${i}">
      <span class="mwno" style="--z:${zoneOf(stepAvg(s))[2]}">${i + 1}</span>
      <input type="text" class="mwlab" data-f="label" maxlength="${LIM.label}" value="${esc(s.label || '')}" placeholder="Label" aria-label="Step ${i + 1} label">
      <label class="mwnum"><input type="number" data-f="min" min="${LIM.minMin}" max="${LIM.maxMin}" step="0.5" inputmode="decimal" value="${s.min}" aria-label="Step ${i + 1} minutes"><small>min</small></label>
      <label class="mwnum"><input type="number" data-f="pct" min="${LIM.minPct}" max="${LIM.maxPct}" step="5" inputmode="numeric" value="${s.pct}" aria-label="Step ${i + 1} percent of FTP"><small>%</small></label>
      <label class="mwnum mwramp"><small>→</small><input type="number" data-f="pct2" min="${LIM.minPct}" max="${LIM.maxPct}" step="5" inputmode="numeric" value="${s.pct2 ?? ''}" placeholder="flat" data-start="${s.pct}" aria-label="Step ${i + 1} ramp to percent of FTP, empty for flat"><small>%</small></label>
      <b class="mww" data-w="${i}">${wattsText(s, ftp)}</b>
      <span class="mwbtns"><button type="button" data-a="up" aria-label="Move step ${i + 1} up" ${i ? '' : 'disabled'}>↑</button><button type="button" data-a="down" aria-label="Move step ${i + 1} down" ${i < w.steps.length - 1 ? '' : 'disabled'}>↓</button><button type="button" data-a="dup" aria-label="Duplicate step ${i + 1}" title="Duplicate">⧉</button><button type="button" data-a="del" aria-label="Remove step ${i + 1}" title="Remove" ${w.steps.length > 1 ? '' : 'disabled'}>✕</button></span></div>`;
    const draw = () => {
      $('#mwSteps', m).innerHTML = w.steps.map(rowHTML).join('');
      const rf = $('#mwRf', m), rt = $('#mwRt', m); rf.max = rt.max = w.steps.length;
      if (!(+rf.value >= 1 && +rf.value <= w.steps.length)) rf.value = Math.min(w.steps.length, 1);
      if (!(+rt.value >= +rf.value && +rt.value <= w.steps.length)) rt.value = Math.min(w.steps.length, +rf.value + 1);
      $('#mwAdd', m).disabled = w.steps.length >= LIM.steps; summary();
    };
    const edited = () => { snap = null; $('#mwInt', m).value = 0; $('#mwIntV', m).textContent = '±0 %'; };
    const structural = fn => { fn(); edited(); err(); draw(); };
    const rowInfo = (row, s) => { row.querySelector('.mww').textContent = wattsText(s, ftp); row.querySelector('.mwno').style.setProperty('--z', zoneOf(stepAvg(s))[2]); row.querySelector('[data-f="pct2"]').dataset.start = s.pct; };

    $('#mwSteps', m).addEventListener('input', e => {
      const f = e.target.dataset.f, row = e.target.closest('.mwstep'); if (!f || !row) return;
      const i = +row.dataset.i, s = w.steps[i]; sel = i;
      if (f === 'label') { s.label = e.target.value.slice(0, LIM.label); return; }
      const raw = String(e.target.value).trim().replace(',', '.'), [lo, hi, nm] = FIELD[f];
      if (f === 'pct2' && raw === '') { delete s.pct2; e.target.classList.remove('bad'); err(); edited(); rowInfo(row, s); return summary(); }
      const v = parseFloat(raw), okv = Number.isFinite(v) && v >= lo && v <= hi; e.target.classList.toggle('bad', !okv);
      if (!okv) return err(`${nm}: ${lo}–${hi}.`);
      err(); edited();
      if (f === 'min') s.min = Math.round(v * 100) / 100;
      else { s[f] = Math.round(v); if (s.pct2 != null && s.pct2 === s.pct) delete s.pct2; } // a ramp to the same % is flat
      rowInfo(row, s); summary();
    });
    $('#mwSteps', m).addEventListener('change', e => { const f = e.target.dataset.f; if (!FIELD[f]) return; // leaving a field: back to the last good value
      const s = w.steps[+e.target.closest('.mwstep').dataset.i]; e.target.value = s[f] ?? ''; e.target.classList.remove('bad'); err(); });
    $('#mwSteps', m).addEventListener('focusin', e => { const row = e.target.closest('.mwstep'); if (row && sel !== +row.dataset.i) { sel = +row.dataset.i; $('#mwGraph', m).innerHTML = graphSVG(w.steps, { h: 80, mark: sel }); } });
    $('#mwSteps', m).addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (!b) return; const i = +b.closest('.mwstep').dataset.i, a = b.dataset.a, S = w.steps;
      structural(() => {
        if (a === 'up' && i > 0) { [S[i - 1], S[i]] = [S[i], S[i - 1]]; sel = i - 1; }
        if (a === 'down' && i < S.length - 1) { [S[i + 1], S[i]] = [S[i], S[i + 1]]; sel = i + 1; }
        if (a === 'dup' && S.length < LIM.steps) { S.splice(i + 1, 0, { ...S[i] }); sel = i + 1; }
        if (a === 'del' && S.length > 1) { S.splice(i, 1); sel = Math.min(i, S.length - 1); }
      });
      const nb = $(`.mwstep[data-i="${sel}"] button[data-a="${a}"]:not(:disabled)`, m) || $(`.mwstep[data-i="${sel}"] button:not(:disabled)`, m); nb?.focus(); // keep the focus where the hand is (gamepad, keyboard)
    });
    $('#mwAdd', m).onclick = () => structural(() => { const last = w.steps[w.steps.length - 1]; w.steps.push({ min: 5, pct: last && isWork(last) ? 55 : 90, label: last && isWork(last) ? 'Rest' : 'Interval' }); sel = w.steps.length - 1; });
    $('#mwRep', m).onclick = () => {
      const f = +$('#mwRf', m).value - 1, t = +$('#mwRt', m).value - 1, n = +$('#mwRn', m).value;
      if (!(f >= 0 && t >= f && t < w.steps.length)) return err('Repeat: choose the steps by their numbers, from ≤ to.');
      if (!(n >= 2 && n <= LIM.rep)) return err(`Repeat: 2 to ${LIM.rep} times.`);
      if (w.steps.length + (t - f + 1) * (n - 1) > LIM.steps) return err(`At most ${LIM.steps} steps.`);
      structural(() => { w.steps = repeatBlock(w.steps, f, t, n); sel = -1; });
    };
    $('#mwInt', m).oninput = e => { const d = +e.target.value; if (!snap) snap = w.steps.map(s => ({ ...s }));
      w.steps = scaleWork(snap, d); $('#mwIntV', m).textContent = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d) + ' %';
      const keep = document.activeElement; $('#mwSteps', m).innerHTML = w.steps.map(rowHTML).join(''); summary(); keep?.focus?.(); };
    const setName = n => { w.name = n; m.querySelectorAll('.mwchip').forEach(c => c.classList.toggle('on', c.dataset.name === n)); err(); };
    $('#mwName', m).oninput = e => setName(e.target.value);
    $('#mwChips', m).addEventListener('click', e => { const c = e.target.closest('.mwchip'); if (!c) return; $('#mwName', m).value = c.dataset.name; setName(c.dataset.name); });
    const save = async asNew => {
      const name = String(w.name || '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > LIM.name) { $('#mwName', m).focus(); return err(`Name: 1–${LIM.name} characters.`); }
      const btn = $(asNew ? '#mwSaveNew' : '#mwSave', m); btn.disabled = true;
      try { const out = await savePersonal({ ...w, name, id: asNew ? newId() : w.id }); close({ saved: out }); }
      catch (e) { err('Not saved: ' + e.message); btn.disabled = false; }
    };
    $('#mwSave', m).onclick = () => save(false);
    $('#mwSaveNew', m)?.addEventListener('click', () => save(true));
    $('#mwDel', m)?.addEventListener('click', async () => {
      asking = true; const v = await ask({ title: `Delete “${w.name}”?`, text: 'It is removed from your workouts for good.', buttons: [{ label: 'Keep it', value: null }, { label: 'Delete', value: 'del', cls: 'danger' }] }); asking = false;
      if (v !== 'del') return $('#mwDel', m)?.focus();
      try { await deletePersonal(w.id); close({ deleted: w.id }); } catch (e) { err('Not deleted: ' + e.message); } });
    $('#mwCancel', m).onclick = $('#mwClose', m).onclick = () => leave();
    m.addEventListener('click', e => { if (e.target === m) leave(); });
    draw(); $('#mwSave', m).focus(); // the name is filled in already; the pad starts on Save, a keyboard can Tab back
  });
}

/* ---------------- route page ---------------- */
const optText = (w, routeId) => `${esc(w.name)} · ${Math.round(w.steps.reduce((a, s) => a + s.dur, 0) / 60)} min${w.routeId && w.routeId === routeId ? ' · made for this route' : ''}`;
/** the options of the route page's workout choice: free ride, "My workouts" (made for this route first), the standard ones */
export function workoutOptions(routeId) {
  const mine = orderFor(personalList(), routeId).map(p => workoutById(p.id)).filter(Boolean);
  const own = [...mine, ...MY];
  return `<option value="">Free ride (route gradient)</option>
    ${own.length ? `<optgroup label="My workouts">${own.map(w => `<option value="${esc(w.id)}">${w.mine ? '★ ' : ''}${optText(w, routeId)}</option>`).join('')}</optgroup>` : ''}
    <optgroup label="Standard workouts">${WORKOUTS.map(w => `<option value="${w.id}">${optText(w, routeId)}</option>`).join('')}</optgroup>`;
}
/** the "Customise" button and the route fit line on the route page; ctx = { route, state, saveSettings, rerender } */
export function wireRoutePick(root, { route, state, saveSettings, rerender }) {
  const sel = $('#workSel', root), info = $('#mwFitInfo', root), btn = $('#wCustom', root); if (!sel || !btn) return;
  const routeSec = () => Math.round((route.track?.duration || 0) * (state.settings.laps || 1));
  const show = async () => {
    const w = workoutById(sel.value), sec = w ? w.steps.reduce((a, s) => a + s.dur, 0) : 0, rs = routeSec(), up = localOnly();
    info.innerHTML = (w && rs && sec > rs + 60 ? `<p class="mwwarn">⚠ This workout takes ${mins(sec)}, the route about ${mins(rs)}. Customise it or ride more laps.</p>` : '')
      + (up.length ? `<p class="mwup">${up.length} ${up.length === 1 ? 'workout' : 'workouts'} from this browser not in your account yet. <button type="button" class="btn ghost small" id="mwUp">Upload</button></p>` : '');
    const ub = $('#mwUp', info); if (ub) ub.onclick = async () => { ub.disabled = true; await uploadLocal(); rerender(); };
  };
  const mine = $('#wMine', root); if (mine) mine.onclick = () => { location.href = 'profil.html#myworkouts'; };
  sel.addEventListener('change', show); $('#lapSel', root)?.addEventListener('change', show); show();
  btn.onclick = async () => {
    const cur = workoutById(sel.value), own = cur?.personal ? personalById(cur.id) : null;
    const draft = own || (cur ? { ...fromBuiltin(cur), name: '' } : { ...freeTemplate(), name: '' }); // the editor names it: "River Valley VO2 1"
    const res = await openEditor({ draft, saved: !!own, ftp: +state.settings.ftp || 0, route: { id: route.id, name: route.name, sec: routeSec() }, kind: own ? '' : kindOf(cur?.name || '') });
    if (!res) return;
    state.settings.workout = res.saved ? res.saved.id : ''; await saveSettings(); rerender();
  };
}

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
      <div class="mwlist">${list.length ? list.map(w => { const sec = totalSec(w.steps); return `<div class="mwitem" data-id="${esc(w.id)}">
        <div class="mwitop"><b>${esc(w.name)}</b><small>${fmtTime(sec)} · avg ${avgPct(w.steps)} %${w.routeName ? ` · for ${esc(w.routeName)}` : ''}</small></div>
        ${graphSVG(w.steps, { h: 34, cls: 'mwthumb' })}
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
    const edit = async (w, saved) => { const res = await openEditor({ draft: w, saved, ftp: +ctx.ftp() || 0, route: w.routeId ? { id: w.routeId, name: w.routeName || '' } : null }); if (res) draw(); };
    el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const w = personalById(b.dataset.ed); if (w) edit(w, true); });
    el.querySelectorAll('[data-dup]').forEach(b => b.onclick = async () => { const w = personalById(b.dataset.dup); if (!w) return;
      try { await savePersonal({ ...w, id: newId(), name: cut(w.name, LIM.name - 5) + ' copy' }); draw(); } catch (e) { perr('Not saved: ' + e.message); } });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const w = personalById(b.dataset.del); if (!w) return;
      if (await ask({ title: `Delete “${w.name}”?`, text: 'It is removed from your workouts for good.', buttons: [{ label: 'Keep it', value: null }, { label: 'Delete', value: 'del', cls: 'danger' }] }) !== 'del') return b.focus();
      try { await deletePersonal(w.id); draw(); } catch (e) { perr('Not deleted: ' + e.message); } });
    $('#mwNew', el).onclick = () => edit({ ...freeTemplate(), name: '' }, false);
    const ub = $('#mwUpP', el); if (ub) ub.onclick = async () => { ub.disabled = true; await uploadLocal(); draw(); };
  };
  draw();
  if (location.hash === '#myworkouts') $('#myworkouts', el)?.scrollIntoView();
}
