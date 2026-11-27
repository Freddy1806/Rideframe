// The week planner (27.11., owner: Today's training is led by the plan; the Training page is gone). Two sheets on the Today page:
//   openWeek: Monday to Sunday of a week, each day with its planned sessions (tap = change) and a "+" (add); ‹ › for the weeks around
//   openDay:  one day: pick the sport, then a workout (own first, coach, standard; js/workoutsources.js) or a free entry with minutes;
//             an existing entry can be changed, moved to another day, marked not done or removed
// Data: the plan API (tools/plan-api.mjs, js/planlib.js). The coach can write the same plan through the Claude connector.
import { esc } from './util.js';
import { MODES, icon } from './theme.js';
import { KIND_NAME, dayKey, dayMs, monday, addDays } from './planlib.js';
import { loadSources, GROUP_NAME } from './workoutsources.js';

const $ = (s, r) => r.querySelector(s);
const SPORTS = [['ride', 'Cycling', 'ride'], ['run', 'Running', 'run'], ['strength', 'Strength', 'kraft'], ['rest', 'Rest day', null], ['other', 'Other', 'other']];
const MOON = '<svg class="mico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
const kindMode = k => k === 'strength' ? 'kraft' : k === 'ride' ? 'ride' : k === 'run' ? 'run' : 'other';
const mcs = k => k === 'rest' ? '--mc:var(--rd);--mcl:var(--rd)' : `--mc:${MODES[kindMode(k)].color};--mcl:${MODES[kindMode(k)].light}`;
const kIcon = (k, cls = 'mico') => k === 'rest' ? MOON.replace('mico', cls) : icon(kindMode(k) === 'kraft' ? 'kraft' : kindMode(k), cls);
const dayLong = d => new Date(dayMs(d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

async function api(acc, m, url, b) {
  const r = await fetch(url, { method: m, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-RF-Token': acc?.token || '' }, ...(b ? { body: JSON.stringify(b) } : {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Not saved. Check your connection.'); return j;
}
export const loadWeek = (acc, m0) => api(acc, 'GET', `/api/account/plan?from=${m0}&to=${addDays(m0, 6)}`).then(j => j.entries || []);
let SRC = null; // the workout lists, once per page
const sources = (acc, S) => SRC ||= loadSources({ acc, S }).catch(() => ({ ride: [], run: [], strength: [] }));

function sheetEl(id) { document.getElementById(id)?.remove(); const s = document.createElement('div'); s.className = 'psheet'; s.id = id; document.body.append(s); return s; }

/** the week: o = { acc, S, day (any day of the week), onChange(), signIn() } */
export function openWeek(o) {
  const s = sheetEl('wpSheet'), today = dayKey(Date.now());
  let wk = monday(o.day || today), entries = null, err = '';
  const label = () => wk === monday(today) ? 'This week' : wk === addDays(monday(today), 7) ? 'Next week' : wk === addDays(monday(today), -7) ? 'Last week'
    : `${new Date(dayMs(wk)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(dayMs(addDays(wk, 6))).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const close = () => s.remove();
  const draw = () => {
    const days = [...Array(7)].map((_, i) => addDays(wk, i));
    s.innerHTML = `<div class="psheetin wp" role="dialog" aria-modal="true" aria-labelledby="wpT">
      <div class="wphead"><button type="button" class="wpnav" id="wpPrev" aria-label="Previous week">‹</button><div><div class="label">Plan your week</div><h2 id="wpT">${label()}</h2></div><button type="button" class="wpnav" id="wpNext" aria-label="Next week">›</button></div>
      ${!o.acc ? `<p class="phint">Sign in to keep a plan: from you, or from your coach through the Claude connector.</p><button class="btn" id="wpIn">Sign in</button>`
      : `${err ? `<p class="phint perr" role="alert">${esc(err)}</p>` : ''}<ol class="wpdays">${days.map(d => { const E = (entries || []).filter(e => e.day === d);
        return `<li class="wpday${d === today ? ' now' : ''}${d < today ? ' past' : ''}" id="wp-${d}"><div class="wpdn"><b>${d === today ? 'Today' : new Date(dayMs(d)).toLocaleDateString('en-GB', { weekday: 'short' })}</b><small>${new Date(dayMs(d)).getDate()}</small></div>
          <div class="wpents">${entries == null ? '<span class="cdsk"><i></i></span>' : E.length ? E.map(e => `<button type="button" class="wpent${e.done ? ' done' : ''}" data-e="${esc(e.id)}" style="${mcs(e.kind)}">${kIcon(e.kind, 'wpico')}<span><b>${esc(e.title)}</b><small>${[e.minutes ? e.minutes + ' min' : KIND_NAME[e.kind], e.done ? 'done ✓' : '', e.by === 'coach' ? 'coach' : ''].filter(Boolean).join(' · ')}</small></span></button>`).join('') : `<span class="wpfree">${d < today ? '–' : 'Free'}</span>`}</div>
          <button type="button" class="wpadd" data-add="${d}" aria-label="Plan a session on ${esc(dayLong(d))}">${icon('plus', 'wpplus')}</button></li>`; }).join('')}</ol>
        <a class="wpclaude" href="handy.html#settings-coach">or ask Claude to plan your week ›</a>`}
      <div class="pfoot"><button class="btn" id="wpOk">Done</button></div></div>`;
    $('#wpOk', s).onclick = close;
    $('#wpPrev', s).onclick = () => go(addDays(wk, -7)); $('#wpNext', s).onclick = () => go(addDays(wk, 7));
    $('#wpIn', s)?.addEventListener('click', () => { close(); o.signIn?.(); });
    $('.wpclaude', s)?.addEventListener('click', close);
    s.querySelectorAll('[data-add]').forEach(b => b.onclick = () => openDay({ ...o, day: b.dataset.add, onChange: () => { reload(); o.onChange?.(); } }));
    s.querySelectorAll('[data-e]').forEach(b => b.onclick = () => openDay({ ...o, entry: entries.find(e => e.id === b.dataset.e), onChange: () => { reload(); o.onChange?.(); } }));
  };
  const reload = async () => { if (!o.acc) return draw(); try { entries = await loadWeek(o.acc, wk); err = ''; } catch (e) { entries = entries || []; err = e.message; } if (s.isConnected) draw(); };
  const go = w => { wk = w; entries = null; draw(); reload(); };
  s.onclick = e => { if (e.target === s) close(); };
  draw(); reload();
  if (o.day && o.day !== today) setTimeout(() => document.getElementById('wp-' + o.day)?.scrollIntoView({ block: 'nearest' }), 400);
  return s;
}

/** one day: o = { acc, S, day, entry?, kind?, onChange() } */
export function openDay(o) {
  const e = o.entry || null, s = sheetEl('wdSheet');
  let day = e?.day || o.day || dayKey(Date.now()), kind = e?.kind || o.kind || null, err = '', busy = false, list = null;
  const close = () => s.remove();
  const done = () => { close(); o.onChange?.(); };
  const save = async b => { if (busy) return; busy = true; err = '';
    try { if (e) await api(o.acc, 'PUT', '/api/account/plan/' + e.id, { day, kind, ...b }); else await api(o.acc, 'POST', '/api/account/plan', { day, kind, ...b }); busy = false; done(); }
    catch (x) { busy = false; err = x.message; draw(); } };
  const draw = () => {
    const src = list?.[kind === 'strength' ? 'strength' : kind] || [];
    const rows = kind && kind !== 'rest' && kind !== 'other' ? (list == null ? '<span class="cdsk"><i></i><i></i></span>' : src.length ? src.map((w, i) => {
      const head = i === 0 || src[i - 1].group !== w.group ? `<h3 class="ksec wdg">${GROUP_NAME[w.group]}</h3>` : '';
      return `${head}<button type="button" class="wdw${e?.ref === w.id || (!e?.ref && e?.title === w.name) ? ' on' : ''}" data-w="${i}" style="${mcs(kind)}"><span class="wdwt"><b>${esc(w.name)}</b><small>${[w.min ? w.min + ' min' : '', w.what && !w.shape ? esc(w.what) : ''].filter(Boolean).join(' · ')}</small></span>${w.shape ? `<span class="wdshape">${w.shape}</span>` : ''}</button>`; }).join('')
      : `<p class="phint">${kind === 'run' ? 'No run workouts yet. Build one on the Workouts page, or plan a free run below.' : kind === 'strength' ? 'No strength workouts yet. Build one on the Workouts page, or plan a free session below.' : 'No workouts.'}</p>`) : '';
    s.innerHTML = `<div class="psheetin wd" role="dialog" aria-modal="true" aria-labelledby="wdT">
      <div class="label" id="wdT">${e ? 'Planned session' : 'Plan a session'}</div>
      <label class="trf wdday"><span>Day</span><input id="wdDay" type="date" value="${esc(day)}"></label>
      <div class="wdsports" role="radiogroup" aria-label="Sport">${SPORTS.map(([k, n]) => `<button type="button" role="radio" aria-checked="${kind === k}" class="wdsp${kind === k ? ' on' : ''}" data-k="${k}" style="${mcs(k)}">${kIcon(k, 'wdico')}<span>${n}</span></button>`).join('')}</div>
      ${!kind ? '<p class="phint">Pick the sport first.</p>' : kind === 'rest' ? `<button class="btn" id="wdRest">${e?.kind === 'rest' ? 'Keep as rest day' : 'Plan a rest day'}</button>` : `
      ${rows ? `<div class="wdlist">${rows}</div>` : ''}
      <h3 class="ksec wdg">Free ${kind === 'ride' ? 'ride' : kind === 'run' ? 'run' : kind === 'strength' ? 'session' : 'entry'}</h3>
      <div class="wdfree"><label class="trf"><span>Title</span><input id="wdTitle" type="text" maxlength="60" value="${esc(e && !e.ref ? e.title : '')}" placeholder="${esc(KIND_NAME[kind])}"></label>
        <label class="trf wdmin"><span>Minutes</span><input id="wdMin" type="number" inputmode="numeric" min="1" max="600" value="${e && !e.ref ? e.minutes ?? '' : ''}" placeholder="60"></label></div>
      <button class="btn ghost" id="wdFree">${e ? 'Save as free entry' : 'Plan free entry'}</button>`}
      ${err ? `<p class="phint perr" role="alert">${esc(err)}</p>` : ''}
      <div class="pfoot">${e ? `<button class="btn ghost" id="wdDel">Remove</button>${e.done ? '<button class="btn ghost" id="wdUndo">Not done</button>' : ''}` : ''}<button class="btn ghost" id="wdX">Close</button></div></div>`;
    $('#wdDay', s).onchange = ev => { if (Number.isFinite(dayMs(ev.target.value))) day = ev.target.value; };
    s.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; err = ''; draw(); });
    $('#wdRest', s)?.addEventListener('click', () => save({ title: 'Rest day', minutes: null, ref: null }));
    s.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { const w = src[+b.dataset.w]; save({ title: w.name.slice(0, 60), minutes: w.min || null, ref: w.group === 'tpl' ? null : w.id }); });
    $('#wdFree', s)?.addEventListener('click', () => { const mn = +$('#wdMin', s).value; save({ title: $('#wdTitle', s).value.trim() || KIND_NAME[kind], minutes: mn >= 1 ? Math.round(mn) : null, ref: null }); });
    $('#wdX', s).onclick = close;
    $('#wdDel', s)?.addEventListener('click', async () => { if (!confirm('Remove this planned session?')) return; try { await api(o.acc, 'DELETE', '/api/account/plan/' + e.id); done(); } catch (x) { err = x.message; draw(); } });
    $('#wdUndo', s)?.addEventListener('click', async () => { try { await api(o.acc, 'POST', `/api/account/plan/${e.id}/done`, { activity: null }); done(); } catch (x) { err = x.message; draw(); } });
  };
  s.onclick = ev => { if (ev.target === s) close(); };
  draw(); sources(o.acc, o.S || {}).then(l => { list = l; if (s.isConnected) draw(); });
  return s;
}
