// RIDEFRAME Workouts (workouts.html, 27.11., owner: the Training page "kann komplett weg"; "My workouts" and the builder out of the
// Profile: one home). Three sport tiles, Cycling, Running, Strength, each with its workouts (own first, then coach, then standard) as
// compact rows with their shape and minutes, and "+ New workout":
//   Cycling:  the workout builder (js/wbuilder.js via js/myworkouts-ui.js); Start = the indoor trainer (pure.html?workout=<id>)
//   Running:  the small run builder (js/runworkouts.js: minutes and effort); Start = the run recorder (outdoor.html?sport=run)
//   Strength: signed in the watch's workout editor (exercises × sets × reps, js/watchcfg.js), else the Strength page; Start = kraft.html
// A row opens the workout: its shape, what it is, Start, plan it for a day, and edit / duplicate / delete for your own.
import { db } from './db.js';
import { esc } from './util.js';
import { MODES, icon, applyTheme } from './theme.js';
import { nav } from './nav.js';
import { loadSources, GROUP_NAME } from './workoutsources.js';
import { dayKey } from './planlib.js';

const el = document.getElementById('workouts'), $ = (s, r = document) => r.querySelector(s);
const SPORT = {
  ride: { name: 'Cycling', ic: 'ride', col: 'var(--accent)', sub: 'Indoor trainer workouts' },
  run: { name: 'Running', ic: 'run', col: MODES.run.color, sub: 'Intervals and runs by minutes' },
  strength: { name: 'Strength', ic: 'kraft', col: 'var(--a-kraft, #ff4f9a)', sub: 'Sets, reps and weights' },
};
const KIND = { ride: 'ride', run: 'run', strength: 'strength' };
let S = {}, acc = null, L = { ride: [], run: [], strength: [] }, open = { ride: false, run: false, strength: false }, msg = '';

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {}; applyTheme(S, null);
  try { acc = (await import('./account.js')).account(); } catch { acc = null; }
  L = await loadSources({ acc, S });
}
const SHOW = 3; // standard workouts shown before "All …"
function rows(k) {
  const l = L[k], own = l.filter(w => w.group !== 'std'), std = l.filter(w => w.group === 'std'), shown = open[k] ? l : [...own, ...std.slice(0, SHOW)];
  const row = w => { const i = l.indexOf(w); return `<button type="button" class="wkr" data-s="${k}" data-i="${i}"><span class="wkrt"><b>${w.group === 'own' ? '<i class="wkstar" aria-label="Mine">★</i> ' : ''}${esc(w.name)}</b>
    <small>${[w.min ? `${w.min} min` : '', w.group !== 'own' ? GROUP_NAME[w.group] : '', !w.shape && w.what ? esc(w.what) : ''].filter(Boolean).join(' · ')}</small></span>${w.shape ? `<span class="wkshape">${w.shape}</span>` : ''}<i class="wkgo" aria-hidden="true">›</i></button>`; };
  const empty = k === 'ride' ? '' : k === 'run' ? '<p class="wkempty">No run workouts yet. Build intervals or a tempo run by minutes.</p>'
    : `<p class="wkempty">${acc ? 'No strength workouts yet. Build one with exercises, sets and reps: it runs here and on your watch.' : 'Start an empty workout on the Strength page and save it as a template.'}</p>`;
  return `${l.length ? `<div class="wkl">${shown.map(row).join('')}</div>` : empty}${std.length > SHOW ? `<button type="button" class="wkmore" data-more="${k}">${open[k] ? 'Fewer' : `All ${std.length} standard workouts`}</button>` : ''}`;
}
function render() {
  const up = L.ride.length ? localOnlyN : 0;
  el.innerHTML = `<header class="ptop"><div class="pbrand"><b>RIDEFRAME </b><span>Workouts</span></div></header>
    ${msg ? `<p class="phint" role="status">${esc(msg)}</p>` : ''}
    ${Object.entries(SPORT).map(([k, s]) => `<section class="wkt" id="wk-${k}" style="--wc:${s.col}" aria-labelledby="wkH-${k}">
      <div class="wkth"><span class="wkti" aria-hidden="true">${icon(s.ic, 'wkico')}</span><div><h2 id="wkH-${k}">${s.name}</h2><small>${L[k].length ? `${L[k].length} workout${L[k].length === 1 ? '' : 's'}` : s.sub}</small></div>
        <button type="button" class="btn ksmall wknew" data-new="${k}" aria-label="New ${s.name.toLowerCase()} workout">${icon('plus', 'wkplus')}New</button></div>
      ${k === 'ride' && up ? `<div class="wkup"><span>${up} workout${up === 1 ? '' : 's'} from this browser not in your account yet</span><button type="button" class="btn ghost ksmall" id="wkUp">Upload</button></div>` : ''}
      ${rows(k)}
      ${k === 'strength' ? '<a class="wklink" href="kraft.html">Strength page: guided plans, history, records ›</a>' : ''}</section>`).join('')}`;
  el.querySelectorAll('[data-more]').forEach(b => b.onclick = () => { open[b.dataset.more] = !open[b.dataset.more]; render(); });
  el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => detail(b.dataset.s, L[b.dataset.s][+b.dataset.i]));
  el.querySelectorAll('[data-new]').forEach(b => b.onclick = () => create(b.dataset.new));
  $('#wkUp', el)?.addEventListener('click', async () => { const m = await import('./myworkouts-store.js'); const n = await m.uploadLocal(); msg = `${n} uploaded ✓`; await reload(); });
}
let localOnlyN = 0;
async function reload() { await load(); try { localOnlyN = (await import('./myworkouts-store.js')).localOnly().length; } catch { localOnlyN = 0; } render(); }

/* ---- new and edit ---- */
async function rideEditor(draft, saved) {
  const m = await import('./myworkouts-ui.js'); const r = await m.openEditor({ draft, saved, ftp: +S.ftp || 0, hrMax: +S.hrMax || 0 }); if (r) await reload(); return r;
}
async function create(k) {
  if (k === 'ride') { const M = await import('./myworkouts.js'); return rideEditor({ ...M.newWorkout2(), name: '' }, false); }
  if (k === 'run') { const R = await import('./runworkouts.js'); const r = await R.openRunBuilder({ hrMax: +S.hrMax || 0 }); if (r) await reload(); return; }
  if (!acc) { location.href = 'kraft.html'; return; }
  const W = await import('./watchcfg.js'); await W.openEditor('kraft');
  const sh = document.getElementById('wcSheet'); if (sh) new MutationObserver((_, o) => { if (!sh.isConnected) { o.disconnect(); reload(); } }).observe(document.body, { childList: true });
}

/* ---- one workout: shape, what, Start, plan it, edit ---- */
function detail(k, w) {
  if (!w) return;
  document.getElementById('wkSheet')?.remove();
  const s = document.createElement('div'); s.className = 'psheet'; s.id = 'wkSheet'; s.style.setProperty('--wc', SPORT[k].col); document.body.append(s);
  const own = w.group === 'own', personal = k === 'ride' && own && w.w.personal, builtin = k === 'ride' && !own;
  let err = '';
  const draw = () => {
    s.innerHTML = `<div class="psheetin wkd" role="dialog" aria-modal="true" aria-labelledby="wkdT"><div class="label">${SPORT[k].name} · ${GROUP_NAME[w.group]}${w.min ? ` · ${w.min} min` : ''}</div>
      <h2 id="wkdT">${esc(w.name)}</h2>
      ${w.shape ? `<div class="wkdshape">${w.shape.replace(/height="?\d+"?/, '')}</div>` : ''}
      ${w.what ? `<p class="wkdwhat">${esc(w.what)}</p>` : ''}
      <a class="btn wkstart" href="${esc(w.href)}">Start${k === 'ride' ? ' on the indoor trainer' : k === 'run' ? ' a run' : ''}</a>
      ${acc ? `<div class="wkplan"><label class="trf"><span>Plan it for</span><input type="date" id="wkDay" value="${dayKey(Date.now())}"></label><button type="button" class="btn ghost" id="wkPlan">Plan</button></div>` : '<p class="phint">Sign in to plan it for a day.</p>'}
      ${err ? `<p class="phint perr" role="alert">${esc(err)}</p>` : ''}
      <div class="pfoot">${personal || k === 'run' ? '<button class="btn ghost" id="wkEdit">Edit</button><button class="btn ghost" id="wkDup">Duplicate</button><button class="btn ghost" id="wkDel">Delete</button>' : ''}
        ${builtin ? '<button class="btn ghost" id="wkCust">Customise</button>' : ''}${k === 'strength' && w.group === 'watch' ? '<button class="btn ghost" id="wkWatch">Edit</button>' : ''}<button class="btn ghost" id="wkX">Close</button></div></div>`;
    const close = () => s.remove();
    $('#wkX', s).onclick = close;
    $('#wkPlan', s)?.addEventListener('click', async () => { const b = $('#wkPlan', s); b.disabled = true;
      try { const r = await fetch('/api/account/plan', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-RF-Token': acc.token || '' },
          body: JSON.stringify({ day: $('#wkDay', s).value, kind: KIND[k], title: w.name.slice(0, 60), ...(w.min ? { minutes: w.min } : {}), ...(w.group !== 'tpl' ? { ref: w.id } : {}) }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Not saved.'); b.textContent = 'Planned ✓'; }
      catch (e) { err = e.message; draw(); } });
    $('#wkEdit', s)?.addEventListener('click', async () => { close();
      if (k === 'run') { const R = await import('./runworkouts.js'); const r = await R.openRunBuilder({ draft: w.w, hrMax: +S.hrMax || 0 }); if (r) await reload(); return; }
      const st = await import('./myworkouts-store.js'); const p = st.personalById(w.id); if (p) rideEditor(p, true); });
    $('#wkDup', s)?.addEventListener('click', async () => {
      try { if (k === 'run') { const R = await import('./runworkouts.js'); await R.saveRun({ ...w.w, id: R.newRunId(), name: (w.name + ' copy').slice(0, 40) }); }
        else { const st = await import('./myworkouts-store.js'), M = await import('./myworkouts.js'); const p = st.personalById(w.id); await st.savePersonal({ ...p, id: M.newId(), name: (p.name.slice(0, 35)) + ' copy' }); }
        close(); await reload(); } catch (e) { err = e.message; draw(); } });
    $('#wkDel', s)?.addEventListener('click', async () => { const { ask } = await import('./myworkouts-ui.js');
      if (await ask({ title: `Delete “${w.name}”?`, text: 'It is removed from your workouts for good.', buttons: [{ label: 'Keep it', value: null }, { label: 'Delete', value: 'del', cls: 'danger' }] }) !== 'del') return;
      try { if (k === 'run') await (await import('./runworkouts.js')).deleteRun(w.id); else await (await import('./myworkouts-store.js')).deletePersonal(w.id);
        close(); await reload(); } catch (e) { err = 'Not deleted: ' + e.message; draw(); } });
    $('#wkCust', s)?.addEventListener('click', async () => { close(); const M = await import('./myworkouts.js'); rideEditor(M.fromBuiltin2(w.w), false); });
    $('#wkWatch', s)?.addEventListener('click', () => { close(); create('strength'); });
  };
  s.onclick = e => { if (e.target === s) s.remove(); }; draw();
}

await reload(); nav('workouts');
const h = location.hash.slice(1); if (SPORT[h]) document.getElementById('wk-' + h)?.scrollIntoView({ block: 'start' });
if (location.hash === '#myworkouts') document.getElementById('wk-ride')?.scrollIntoView({ block: 'start' });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
