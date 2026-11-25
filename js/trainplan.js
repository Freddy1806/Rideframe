// RIDEFRAME Training (training.html, 25.11., the bottom bar's second tab): the week's plan (js/planlib.js, tools/plan-api.mjs:
// add, change, move, delete, done), recording (every start choice of the old start page), and the workouts: ride workouts
// (js/workouts.js, opened in the indoor trainer pure.html?workout=) and the watch's strength workouts (kraft.html?watch=).
// ?day=YYYY-MM-DD opens that day's week (the Today page's week strip), &add=1 the "Plan a session" sheet for it.
import { db } from './db.js';
import { esc } from './util.js';
import { MODES, icon, applyTheme } from './theme.js';
import { nav } from './nav.js';
import { loadActs, keyOf } from './feed.js';
import { KINDS, KIND_NAME, dayKey, dayMs, monday, addDays, startHref } from './planlib.js';

const el = document.getElementById('training'), $ = (s, r = document) => r.querySelector(s);
const q = new URLSearchParams(location.search), today = dayKey(Date.now());
let S = {}, acc = null, D = { acts: [] }, wk = monday(Number.isFinite(dayMs(q.get('day'))) ? q.get('day') : today), entries = null, msg = '', rideW = [], watchW = [];
const KM = { ride: 'ride', run: 'run', strength: 'kraft', rest: 'trainer', other: 'other' };
const mcs = m => S.oneColor !== true ? `--mc:${MODES[m].color};--mcl:${MODES[m].light}` : '--mc:var(--accent);--mcl:var(--accent)';
const dayName = d => new Date(dayMs(d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

async function api(m, url, b) {
  const r = await fetch(url, { method: m, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-RF-Token': acc?.token || '' }, ...(b ? { body: JSON.stringify(b) } : {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Server is not answering.'); return j;
}
async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {}; applyTheme(S, null);
  try { acc = (await import('./account.js')).account(); } catch {}
  D = await loadActs().catch(() => ({ acts: [] }));
  try { const W = await import('./workouts.js'); W.setMyWorkouts(S.myWorkouts); await (await import('./myworkouts-store.js')).loadPersonal().catch(() => {});
    rideW = W.allWorkouts().map(w => ({ id: w.id, name: w.name, min: Math.round(W.workoutDuration(w) / 60), mine: !!(w.mine || w.personal) })); } catch { rideW = []; }
}
async function loadPlan() {
  if (!acc) { entries = []; return; }
  try { entries = (await api('GET', `/api/account/plan?from=${wk}&to=${addDays(wk, 6)}`)).entries; msg = ''; } catch (e) { entries = entries || []; msg = e.message; }
}
async function loadWatch() {
  if (!acc) return; try { const r = await fetch('/api/watch/config', { cache: 'no-store', headers: { 'X-RF-Token': acc.token || '' } }); if (r.ok) { watchW = ((await r.json()).config?.workouts || []).filter(w => w.items?.length).map(w => ({ id: w.id, name: w.name, n: w.items.length })); render(); } } catch {}
}

function render() {
  const days = [...Array(7)].map((_, i) => addDays(wk, i)), wEnd = addDays(wk, 6), thisWeek = wk === monday(today);
  const label = thisWeek ? 'This week' : wk === addDays(monday(today), 7) ? 'Next week' : wk === addDays(monday(today), -7) ? 'Last week' : `${new Date(dayMs(wk)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(dayMs(wEnd)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const acts = new Map(); for (const a of D.acts) { const k = dayKey(a.date); if (k >= wk && k <= wEnd) (acts.get(k) || acts.set(k, []).get(k)).push(a); }
  const row = e => { const m = KM[e.kind], h = !e.done && e.kind !== 'rest' && e.day >= today ? startHref(e) : null;
    return `<div class="trent${e.done ? ' done' : ''}" style="${mcs(m === 'trainer' ? 'trainer' : m)}"><button type="button" class="trentb" data-e="${esc(e.id)}">${e.kind === 'rest' ? '<span class="trrest" aria-hidden="true">–</span>' : icon(m, 'rico')}
      <span><b>${esc(e.title)}</b><small>${[KIND_NAME[e.kind], e.minutes ? e.minutes + ' min' : '', e.done ? 'done ✓' : '', e.by === 'coach' ? 'from your coach' : ''].filter(Boolean).join(' · ')}</small></span></button>${h ? `<a class="btn ksmall trgo" href="${h}">Start</a>` : ''}</div>`; };
  el.innerHTML = `<header class="ptop"><div class="pbrand"><b>RIDEFRAME </b><span>Training</span></div></header>
    <section class="trplan" aria-labelledby="trPlanH"><div class="trwk"><button type="button" class="trnav" id="trPrev" aria-label="Previous week">‹</button><h2 id="trPlanH">${label}</h2><button type="button" class="trnav" id="trNext" aria-label="Next week">›</button></div>
      ${!acc ? `<div class="tdempty"><p><b>Plan your training</b>Sign in to keep a plan for every day: rides, runs, strength and rest days. Your coach can plan with you through the Claude connector.</p><button class="btn ksmall" id="trIn">Sign in</button></div>`
      : `${msg ? `<p class="phint perr" role="alert">${esc(msg)}</p>` : ''}<ol class="trdays">${days.map(d => { const E = (entries || []).filter(e => e.day === d), A = (acts.get(d) || []).filter(a => !E.some(e => String(e.done) === String(a.id)));
        return `<li class="trday${d === today ? ' now' : ''}${d < today ? ' past' : ''}" id="d-${d}"><div class="trdh"><b>${d === today ? 'Today' : esc(new Date(dayMs(d)).toLocaleDateString('en-GB', { weekday: 'long' }))}</b><small>${new Date(dayMs(d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
          <button type="button" class="tradd" data-add="${d}" aria-label="Plan a session on ${esc(dayName(d))}">＋</button></div>
          ${E.map(row).join('')}${A.map(a => `<a class="trextra" href="aktivitaeten.html?open=${encodeURIComponent(keyOf(a))}">${icon(a.kraft ? 'kraft' : 'other', 'trxi')}<span>Done without a plan: ${esc(a.kraft ? a.name || 'Workout' : a.workout || a.routeName || 'Activity')}</span></a>`).join('')}
          ${!E.length && !A.length ? `<p class="trnone">${d < today ? 'Nothing' : 'Free'}</p>` : ''}</li>`; }).join('')}</ol>`}</section>
    <section aria-labelledby="trRecH"><h2 class="ksec" id="trRecH">Record now</h2><div class="trrec">${['ride', 'run', 'trainer', 'world', 'kraft'].map(m => `<a class="hrow hlink" href="${MODES[m].href}" style="${mcs(m)}">${icon(m, 'rico')}<div><b>${MODES[m].name}</b></div><i>›</i></a>`).join('')}
      <a class="hrow hlink" href="remote.html?auto" style="--mc:var(--accent);--mcl:var(--accent)">${icon('trainer', 'rico')}<div><b>Remote</b><small>Control RIDEFRAME on your laptop with this phone</small></div><i>›</i></a></div></section>
    <section aria-labelledby="trWH"><h2 class="ksec" id="trWH">Ride workouts</h2>
      ${rideW.filter(w => w.mine).slice(0, 6).map(w => `<a class="hrow hlink" href="pure.html?workout=${encodeURIComponent(w.id)}" style="${mcs('trainer')}">${icon('trainer', 'rico')}<div><b>${esc(w.name)}</b><small>${w.min} min · indoor trainer</small></div><i>›</i></a>`).join('')}
      <a class="hall" href="pure.html?workout=">${rideW.some(w => w.mine) ? 'All workouts · build a new one ›' : 'Build your own workout or pick a standard one ›'}</a></section>
    <section aria-labelledby="trSH"><h2 class="ksec" id="trSH">Strength</h2>
      ${watchW.map(w => `<a class="hrow hlink" href="kraft.html?watch=${encodeURIComponent(w.id)}" style="${mcs('kraft')}">${icon('kraft', 'rico')}<div><b>${esc(w.name)}</b><small>${w.n} exercises · watch workout</small></div><i>›</i></a>`).join('')}
      <a class="hall" href="kraft.html">Strength page: templates, history, records ›</a>${acc ? '<button type="button" class="hall trwbtn" id="trWcfg">Watch screens &amp; workouts ›</button>' : ''}</section>`;
  $('#trPrev', el).onclick = () => go(addDays(wk, -7)); $('#trNext', el).onclick = () => go(addDays(wk, 7));
  $('#trIn', el)?.addEventListener('click', async () => { const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); await loadPlan(); render(); loadWatch(); }); });
  $('#trWcfg', el)?.addEventListener('click', () => import('./watchcfg.js').then(m => m.openEditor('kraft')));
  el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => sheet(null, b.dataset.add));
  el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => sheet(entries.find(e => e.id === b.dataset.e)));
}
async function go(w) { wk = w; const u = new URL(location.href); u.searchParams.set('day', w); u.searchParams.delete('add'); history.replaceState(null, '', u); entries = null; render(); await loadPlan(); render(); }

/** add or change one entry */
function sheet(e, day = e?.day) {
  const s = document.createElement('div'); s.className = 'psheet'; s.id = 'trSheet'; document.body.append(s);
  let kind = e?.kind || 'ride', err = '';
  const opts = () => kind === 'ride' ? rideW : kind === 'strength' ? watchW : [];
  const draw = () => {
    const o = opts();
    s.innerHTML = `<div class="psheetin" role="dialog" aria-modal="true" aria-labelledby="trSt"><div class="label" id="trSt">${e ? 'Planned session' : 'Plan a session'}</div>
      <label class="trf"><span>Day</span><input id="trDay" type="date" value="${esc(day)}"></label>
      <div class="pseg trkinds" role="radiogroup" aria-label="Kind">${KINDS.map(k => `<button type="button" role="radio" data-k="${k}" aria-checked="${kind === k}" class="${kind === k ? 'on' : ''}">${KIND_NAME[k].replace(' day', '')}</button>`).join('')}</div>
      <label class="trf"><span>Title</span><input id="trTitle" type="text" maxlength="60" value="${esc(e?.title || '')}" placeholder="${esc(KIND_NAME[kind])}"></label>
      ${kind !== 'rest' ? `<label class="trf"><span>Minutes <small>(optional)</small></span><input id="trMin" type="number" inputmode="numeric" min="1" max="600" value="${e?.minutes ?? ''}"></label>` : ''}
      ${o.length ? `<label class="trf"><span>${kind === 'ride' ? 'Ride workout' : 'Watch workout'} <small>(Start opens it)</small></span><select id="trRef"><option value="">${kind === 'ride' ? 'None: just ride' : 'None: free session'}</option>${o.map(w => `<option value="${esc(w.id)}" ${e?.ref === w.id ? 'selected' : ''}>${esc(w.name)}${w.min ? ` · ${w.min} min` : ''}</option>`).join('')}</select></label>` : ''}
      <label class="trf"><span>Note <small>(optional)</small></span><textarea id="trNote" maxlength="300" rows="2">${esc(e?.note || '')}</textarea></label>
      ${err ? `<p class="phint perr" role="alert">${esc(err)}</p>` : ''}
      ${e && e.kind !== 'rest' ? `<p class="phint">${e.done ? 'Done ✓, matched with an activity of that day.' : 'Marked done by itself when an activity of that day and kind is saved.'}</p>` : ''}
      <div class="pfoot">${e ? `<button class="btn ghost" id="trDel">Delete</button>${e.done ? '<button class="btn ghost" id="trUndo">Not done</button>' : ''}` : '<button class="btn ghost" id="trX">Cancel</button>'}<button class="btn" id="trOk">${e ? 'Save' : 'Plan it'}</button></div></div>`;
    s.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { day = $('#trDay', s).value || day; const t = $('#trTitle', s).value; kind = b.dataset.k; draw(); $('#trTitle', s).value = t; s.querySelector(`[data-k="${kind}"]`).focus(); });
    $('#trX', s)?.addEventListener('click', () => s.remove());
    $('#trDel', s)?.addEventListener('click', async () => { if (!confirm('Delete this planned session?')) return; try { await api('DELETE', '/api/account/plan/' + e.id); s.remove(); await loadPlan(); render(); } catch (x) { err = x.message; draw(); } });
    $('#trUndo', s)?.addEventListener('click', async () => { try { await api('POST', `/api/account/plan/${e.id}/done`, { activity: null }); s.remove(); await loadPlan(); render(); } catch (x) { err = x.message; draw(); } });
    $('#trOk', s).onclick = async () => {
      const mn = $('#trMin', s)?.value, ref = $('#trRef', s)?.value, b = { day: $('#trDay', s).value, kind, title: $('#trTitle', s).value.trim() || KIND_NAME[kind], minutes: mn ? Math.round(+mn) : null, note: $('#trNote', s).value.trim() || null, ref: ref || null };
      if (kind === 'rest') b.minutes = null; if (!e) { for (const k of ['minutes', 'note', 'ref']) if (b[k] == null) delete b[k]; }
      try { if (e) await api('PUT', '/api/account/plan/' + e.id, b); else await api('POST', '/api/account/plan', b); s.remove(); if (monday(b.day) !== wk) return go(monday(b.day)); await loadPlan(); render(); $(`#d-${b.day}`)?.scrollIntoView({ block: 'nearest' }); }
      catch (x) { err = x.message; draw(); }
    };
  };
  s.onclick = ev => { if (ev.target === s) s.remove(); }; draw(); $('#trTitle', s)?.focus();
}

await load(); await loadPlan(); render(); nav('training'); loadWatch();
if (q.get('add') && acc) sheet(null, Number.isFinite(dayMs(q.get('day'))) ? q.get('day') : today);
else if (q.get('day')) document.getElementById('d-' + q.get('day'))?.scrollIntoView({ block: 'center' });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
