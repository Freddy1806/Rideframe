// Settings → Devices → Watch (18.11., step 1 of the watch concept): everything the watch shows is set up here and kept with
// the account (PUT /api/watch/config, tools/watch-api.mjs): the data pages for run and ride with a live round preview, the
// switches, the workouts for strength and the other sports for "More". A local copy (kv 'watchCfg') keeps edits made
// offline; they are sent the next time this opens. The watch loads the config at its next start.
import { db } from './db.js';
import { account } from './account.js';
// the account's Strava connection for the watch's segments (tools/watch-feed.mjs linkStrava): this phone's Strava key, when it has one
const stravaHdr = () => { try { const k = localStorage.getItem('rf_strava_key'); return k ? { 'X-Strava-Key': k } : {}; } catch { return {}; } };
import { CATALOG } from './kraftlib.js';
import { STRAVA } from './sports.js';
import { MODES, icon } from './theme.js';
import { FIELDS, MORE, TOP, LIM, MAX_PAGES, MAX_FIELDS, MAX_WORKOUTS, MAX_ITEMS, TRAINER_PAGES, TRAINER_DEF, defaults, validate, labelOf } from './watchfields.js';
import { FACES, tint, drawPage, pageDots, recRing, paintFace } from './watchdraw.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const TABS = [['run', 'Run'], ['ride', 'Ride'], ['trainer', 'Trainer'], ['kraft', 'Strength'], ['more', 'More']];
const SLOTS = { 1: ['Full screen'], 2: ['Top', 'Bottom'], 3: ['Top · big', 'Bottom left', 'Bottom right'], 4: ['Top · big', 'Middle left', 'Middle right', 'Bottom'] };
const GROUP = { Beine: 'Legs', Rücken: 'Back', Brust: 'Chest', Schultern: 'Shoulders', Arme: 'Arms', Rumpf: 'Core', Ganzkörper: 'Full body', Eigene: 'Custom' };
const mmss = s => s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
const clampN = (v, [lo, hi], step = 1) => Math.min(hi, Math.max(lo, Math.round((+v || 0) / step) * step));

let C = null, st = { at: 0, dirty: false }, tab = 'run', pg = 0, face = Math.max(0, FACES.findIndex(f => f.id === 'fenix8solar47mm')), msg = '', bad = false, saveT = 0, exList = [];

async function api(method, body) { // own fetch: a 401 here must not sign the phone out (account.js does that)
  const r = await fetch('/api/watch/config', { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-RF-Token': account()?.token || '', ...stravaHdr() }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server is not answering.'), { status: r.status }); return j;
}
const keep = () => db.kvSet('watchCfg', { cfg: C, at: st.at, dirty: st.dirty }).catch(() => {});
/** a change: kept on the phone right away, sent after a short pause (several taps = one save) */
function changed() { st.dirty = true; keep(); msg = 'Saving …'; bad = false; status(); clearTimeout(saveT); saveT = setTimeout(save, 700); }
async function save() {
  clearTimeout(saveT); if (!st.dirty) return;
  const v = validate(C); if (v.error) { msg = v.error; bad = true; return status(); }
  try { const r = await api('PUT', C); st = { at: r.at, dirty: false }; msg = 'Saved ✓ The watch loads it at its next start.'; bad = false; }
  catch (e) { msg = e.status === 401 ? 'Sign in again to save.' : e.status ? e.message : 'Offline: kept on this phone, sent next time.'; bad = true; }
  keep(); status();
}
async function load() {
  const L = await db.kvGet('watchCfg').catch(() => null);
  C = L && validate(L.cfg).cfg || defaults(); st = { at: L?.at || 0, dirty: !!L?.dirty };
  exList = await exercises();
  if (st.dirty) { msg = 'Sending changes made offline …'; return save(); }
  try { const r = await api('GET'); C = r.config; st = { at: r.at, dirty: false }; keep(); msg = r.stored ? 'Saved ✓' : 'Defaults. Changes are saved automatically.'; bad = false; }
  catch (e) { msg = e.status === 401 ? 'Sign in again to load your watch setup.' : 'Offline: showing the copy on this phone.'; bad = !!e.status; }
}
/** every exercise of the app: catalogue, own ones (kv 'kraftEx' and the settings), whatever a session used; then the top 20 */
async function exercises() {
  const S = (await db.kvGet('settings').catch(() => null)) || {}, own = [...((await db.kvGet('kraftEx').catch(() => null)) || []), ...(S.kraftEx || [])];
  const m = new Map(CATALOG.map(e => [e.k, { k: e.k, n: e.n, t: e.t, g: e.g }]));
  for (const e of own) if (e?.k && !m.has(e.k)) m.set(e.k, { k: e.k, n: e.n || e.k, t: e.t || 'w', g: 'Custom', own: true });
  for (const w of (await db.kvGet('kraft').catch(() => null)) || []) for (const x of w.ex || []) if (x?.k && !m.has(x.k)) m.set(x.k, { k: x.k, n: x.n || x.k, t: x.t || 'w', g: 'Custom', own: true }); // done on another device
  for (const e of TOP) if (!m.has(e.id)) m.set(e.id, { k: e.id, n: e.n, t: e.t, g: 'Other' });
  return [...m.values()];
}
const exOf = k => exList.find(e => e.k === k) || { k, n: k, t: 'w', g: '' };

/** the row in Settings → Watch: signed in it opens the editor; signed out one line says what can be set up here after signing in
 *  (23.11.: the owner did not find it; the start page also has it once a watch is paired, js/handy.js) */
export function cfgRow(box) {
  if (!box) return;
  if (!account()) { box.innerHTML = '<p class="phint" id="wcSignedOut">After signing in, you set up the watch screens (data fields per sport) and workouts here.</p>'; return; }
  box.innerHTML = `<button class="hrow hlink wcrow" id="wcOpen">${icon('watch', 'rico')}<div><b>Watch screens & workouts</b><small>Data fields per sport, workouts, more sports</small></div><i>›</i></button>`;
  $('#wcOpen', box).onclick = () => openEditor();
}

/* ---- the editor sheet ---- */
let sh = null;
export async function openEditor(first = 'run') {
  tab = first; pg = 0; msg = 'Loading …'; bad = false;
  sh = document.createElement('div'); sh.className = 'psheet'; sh.id = 'wcSheet'; document.body.append(sh);
  sh.innerHTML = `<div class="psheetin wcfg"><div class="label">Watch</div>
    <div class="pseg wctabs" role="tablist">${TABS.map(([k, l]) => `<button data-tab="${k}" role="tab">${l}</button>`).join('')}</div>
    <div id="wcBody" class="wcbody"></div>
    <p class="phint" id="wcState" role="status"></p>
    <div class="pfoot"><button class="btn" id="wcDone">Done</button></div></div>`;
  const close = () => { save(); sh.remove(); sh = null; };
  sh.onclick = e => { if (e.target === sh) close(); }; $('#wcDone', sh).onclick = close;
  sh.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; pg = 0; draw(); $('.psheetin', sh).scrollTop = 0; });
  C = defaults(); draw(); await load(); if (sh) draw();
}
function status() { const p = sh && $('#wcState', sh); if (p) { p.textContent = msg; p.classList.toggle('perr', bad); p.classList.toggle('wcok', /✓/.test(msg)); } }
function draw() {
  if (!sh) return;
  sh.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
  const m = MODES.world; // the watch stays orange (the main colour), whatever the phone's mode colours are
  sh.style.setProperty('--accent', document.documentElement.dataset.theme === 'light' ? m.light : m.color); // the sport's own colour, like on the watch
  const body = $('#wcBody', sh);
  if (tab === 'run' || tab === 'ride') sportTab(body, tab); else if (tab === 'trainer') trainerTab(body); else if (tab === 'kraft') strengthTab(body); else moreTab(body);
  status();
}

const tintSub = p => { const a = sh && sh.style.getPropertyValue('--accent'); if (a) p.style.setProperty('--accent', a); }; // the sheets on top keep the sport's colour

/* -- run / ride: pages, fields, preview, switches -- */
const faceSeg = () => `<div class="pseg wcface" role="group" aria-label="Watch">${FACES.map((f, i) => `<button data-face="${i}" class="${face === i ? 'on' : ''}">${f.name}</button>`).join('')}</div>`;
const preview = () => `<figure class="wcprev"><canvas id="wcCv" aria-label="Watch preview"></canvas></figure>`;
function paintPrev(body, sp, fields, n = 1, i = 0) {
  const cv = $('#wcCv', body), f = FACES[face]; if (!cv) return; const dpr = f.mip ? 1 : Math.min(3, window.devicePixelRatio || 1);
  cv.width = cv.height = f.S * dpr; cv.classList.toggle('mip', f.mip); cv.dataset.fields = fields.join(',');
  paintFace(cv.getContext('2d'), f, dpr, (g, S, Cf) => { const c = tint(Cf, sp); drawPage(g, S, c, sp, fields); recRing(g, S, c, true); pageDots(g, S, c, n, i); });
}
function sportTab(body, sp) {
  const s = C.sports[sp], P = s.pages; pg = Math.min(pg, P.length - 1); const page = P[pg], F = FIELDS[sp], km = sp === 'run' ? '1 km' : '5 km';
  body.innerHTML = `${preview()}${faceSeg()}
    <div class="wcpages" role="tablist" aria-label="Pages">${P.map((_, i) => `<button data-pg="${i}" class="${i === pg ? 'on' : ''}">Page ${i + 1}</button>`).join('')}
      ${P.length < MAX_PAGES ? '<button data-addpg class="wcadd">+ Page</button>' : ''}${s.map ? '<span class="wcfixed">Route</span>' : ''}</div>
    <h3 class="ksec">Page ${pg + 1}: ${page.fields.length} ${page.fields.length === 1 ? 'field' : 'fields'}</h3>
    <div class="wcfields">${page.fields.map((k, i) => `<div class="wcf"><button class="wcslot" data-slot="${i}"><small>${SLOTS[page.fields.length][i]}</small><b>${esc(F[k].l)}</b>${F[k].u ? `<span>${esc(F[k].u)}</span>` : ''}<i>›</i></button>
      ${page.fields.length > 1 ? `<button class="wcx" data-rm="${i}" aria-label="Remove ${esc(F[k].l)}">×</button>` : ''}</div>`).join('')}</div>
    <div class="wcrowbtns">${page.fields.length < MAX_FIELDS ? '<button class="btn ghost ksmall" id="wcAddF">+ Field</button>' : ''}${P.length > 1 ? `<button class="btn ghost ksmall" id="wcDelPg">Remove page ${pg + 1}</button>` : ''}</div>
    <h3 class="ksec">During the ${sp === 'run' ? 'run' : 'ride'}</h3>
    ${[['map', 'Route page', 'Line, next turn and distance left'], ['segWarn', 'Segment alert', 'Warning before, live gap to your PR'], ['autoLap', 'Auto lap', `Every ${km}`], ['autoPause', 'Auto pause', 'Stops the clock while standing'], ['vibrate', 'Vibration', 'For laps, segments and alerts']]
      .map(([k, l, h]) => `<label class="prow wcsw"><span><b>${l}</b><small>${h}</small></span><input type="checkbox" class="toggle" data-sw="${k}" ${s[k] ? 'checked' : ''}></label>`).join('')}`;
  paintPrev(body, sp, page.fields, P.length + (s.map ? 1 : 0), pg);
  body.querySelectorAll('[data-face]').forEach(b => b.onclick = () => { face = +b.dataset.face; draw(); });
  body.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { pg = +b.dataset.pg; draw(); });
  const add = $('[data-addpg]', body); if (add) add.onclick = () => { const used = new Set(P.flatMap(p => p.fields)), free = Object.keys(F).filter(k => !used.has(k)); // a new page starts with values not shown yet
    P.push({ fields: (free.length >= 3 ? free : Object.keys(F)).slice(0, 3) }); pg = P.length - 1; changed(); draw(); };
  const del = $('#wcDelPg', body); if (del) del.onclick = () => { P.splice(pg, 1); pg = Math.max(0, pg - 1); changed(); draw(); };
  const af = $('#wcAddF', body); if (af) af.onclick = () => fieldPicker(sp, page, page.fields.length);
  body.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => fieldPicker(sp, page, +b.dataset.slot));
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { page.fields.splice(+b.dataset.rm, 1); changed(); draw(); });
  body.querySelectorAll('[data-sw]').forEach(i => i.onchange = () => { s[i.dataset.sw] = i.checked; changed(); draw(); });
}
/** pick the value for slot i (i = length: a new field); a value already on the page swaps places */
function fieldPicker(sp, page, i) {
  const F = FIELDS[sp], cur = page.fields[i], p = document.createElement('div'); p.className = 'psheet'; p.id = 'wcPick';
  p.innerHTML = `<div class="psheetin"><div class="label">${i < page.fields.length ? `${SLOTS[page.fields.length][i]}: choose value` : 'Add a field'}</div>
    <div class="ppick wcpick">${Object.entries(F).map(([k, f]) => `<button data-f="${k}" class="${k === cur ? 'on' : ''}"><b>${esc(f.l)}</b><small>${f.u ? esc(f.u) + ' · ' : ''}${esc(f.demo)}</small></button>`).join('')}</div>
    <div class="pfoot"><button class="btn ghost" id="wcPickX">Cancel</button></div></div>`;
  document.body.append(p); tintSub(p); p.onclick = e => { if (e.target === p) p.remove(); }; $('#wcPickX', p).onclick = () => p.remove();
  p.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { const k = b.dataset.f, at = page.fields.indexOf(k);
    if (i >= page.fields.length) { if (at < 0) page.fields.push(k); } else if (at >= 0) { page.fields[at] = page.fields[i]; page.fields[i] = k; } else page.fields[i] = k;
    p.remove(); changed(); draw(); });
}

/* -- strength: the workouts for the watch -- */
const sets = w => w.items.reduce((a, x) => a + x.sets, 0);
function strengthTab(body) {
  body.innerHTML = `<p class="phint wclead">Workouts for the watch: it guides you set by set with the weight, reps and rest. Saving is sending: the watch loads them at its next start.</p>
    <div class="wclist">${C.workouts.length ? C.workouts.map((w, i) => `<button class="hrow hlink wcw" data-w="${i}"><div><b>${esc(w.name)}</b><small>${w.items.length} ${w.items.length === 1 ? 'exercise' : 'exercises'} · ${sets(w)} sets</small></div><i>›</i></button>`).join('')
      : '<p class="phint">No workouts yet. On the watch you can always train free: recent exercises first, then the 20 standard ones.</p>'}</div>
    ${C.workouts.length < MAX_WORKOUTS ? '<button class="btn ghost" id="wcNewW">New workout</button>' : `<p class="phint">Up to ${MAX_WORKOUTS} workouts.</p>`}`;
  body.querySelectorAll('[data-w]').forEach(b => b.onclick = () => workoutSheet(C.workouts[+b.dataset.w]));
  const nw = $('#wcNewW', body); if (nw) nw.onclick = () => { const w = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: `Workout ${C.workouts.length + 1}`, items: [] }; C.workouts.push(w); changed(); draw(); workoutSheet(w, true); };
}
function workoutSheet(w, fresh = false) {
  const p = document.createElement('div'); p.className = 'psheet'; p.id = 'wcWork'; document.body.append(p); tintSub(p);
  const done = () => { p.remove(); draw(); };
  const paint = () => {
    p.innerHTML = `<div class="psheetin"><div class="label">Workout</div>
      <label class="wcname"><span>Name</span><input type="text" id="wcWName" maxlength="40" value="${esc(w.name)}" autocomplete="off"></label>
      <div class="wcitems">${w.items.map((it, i) => { const e = exOf(it.ex); return `<div class="wci"><span class="wcno">${i + 1}</span><button class="wcit" data-it="${i}"><b>${esc(e.n)}</b><small>${itemTxt(it, e)}</small></button>
        <span class="wcmv"><button data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button><button data-dn="${i}" aria-label="Move down" ${i < w.items.length - 1 ? '' : 'disabled'}>↓</button><button data-del="${i}" aria-label="Remove">×</button></span></div>`; }).join('')
        || '<p class="phint">Add the exercises in the order you train them.</p>'}</div>
      ${w.items.length < MAX_ITEMS ? '<button class="btn ghost" id="wcAddEx">+ Exercise</button>' : `<p class="phint">Up to ${MAX_ITEMS} exercises.</p>`}
      <div class="pfoot"><button class="btn danger" id="wcWDel">Delete</button><button class="btn" id="wcWOk">Done</button></div></div>`;
    const nm = $('#wcWName', p); nm.oninput = () => { const v = nm.value.replace(/[<>]/g, '').trim(); if (v) { w.name = v.slice(0, 40); changed(); } };
    if (fresh) { fresh = false; nm.select?.(); }
    p.querySelectorAll('[data-it]').forEach(b => b.onclick = () => itemSheet(w.items[+b.dataset.it], paint));
    p.querySelectorAll('[data-up],[data-dn]').forEach(b => b.onclick = () => { const i = +(b.dataset.up ?? b.dataset.dn), j = b.dataset.up != null ? i - 1 : i + 1; [w.items[i], w.items[j]] = [w.items[j], w.items[i]]; changed(); paint(); });
    p.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { w.items.splice(+b.dataset.del, 1); changed(); paint(); });
    const add = $('#wcAddEx', p); if (add) add.onclick = () => exPicker(k => { const e = exOf(k), it = { ex: k, sets: 3, reps: e.t === 'time' ? 60 : e.t === 'bw' ? 10 : 8, kg: e.t === 'w' ? 20 : 0, rest: e.t === 'time' ? 60 : 90 }; w.items.push(it); changed(); paint(); itemSheet(it, paint); });
    $('#wcWDel', p).onclick = () => { if (!confirm(`Delete "${w.name}"?`)) return; C.workouts.splice(C.workouts.indexOf(w), 1); changed(); done(); };
    $('#wcWOk', p).onclick = done;
  };
  p.onclick = e => { if (e.target === p) done(); }; paint();
}
const itemTxt = (it, e) => `${it.sets} × ${e.t === 'time' ? mmss(it.reps) : it.reps + ' reps'}${it.kg ? ` · ${it.kg} kg` : e.t === 'bw' ? ' · body weight' : ''} · rest ${mmss(it.rest)}`;
function itemSheet(it, back) {
  const e = exOf(it.ex), p = document.createElement('div'); p.className = 'psheet'; p.id = 'wcItem'; document.body.append(p); tintSub(p);
  const row = (k, l, v, lim, step) => `<label class="prow wcnum"><span>${l}</span><input type="number" inputmode="${step < 1 ? 'decimal' : 'numeric'}" data-n="${k}" min="${lim[0]}" max="${lim[1]}" step="${step}" value="${v}"></label>`;
  p.innerHTML = `<div class="psheetin"><div class="label">${esc(e.n)}</div>
    ${row('sets', 'Sets', it.sets, LIM.sets, 1)}${row('reps', e.t === 'time' ? 'Seconds' : 'Reps', it.reps, e.t === 'time' ? [5, 100] : LIM.reps, e.t === 'time' ? 5 : 1)}
    ${e.t === 'time' ? '' : row('kg', e.t === 'bw' ? 'Extra kg' : 'Weight kg', it.kg, LIM.kg, .25)}
    <label class="prow wcnum"><span>Rest</span><select data-n="rest">${[0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 420, 600].map(s => `<option value="${s}" ${s === it.rest ? 'selected' : ''}>${s ? mmss(s) : 'none'}</option>`).join('')}</select></label>
    <p class="phint">The watch suggests these numbers for every set; you can still change them there.</p>
    <div class="pfoot"><button class="btn" id="wcItOk">Done</button></div></div>`;
  const ok = () => { p.querySelectorAll('[data-n]').forEach(i => { const k = i.dataset.n; it[k] = k === 'kg' ? clampN(i.value, LIM.kg, .25) : k === 'reps' && e.t === 'time' ? clampN(i.value, [5, 100], 5) : clampN(i.value, LIM[k]); }); changed(); p.remove(); back(); };
  p.querySelectorAll('[data-n]').forEach(i => i.onchange = () => {}); $('#wcItOk', p).onclick = ok; p.onclick = ev => { if (ev.target === p) ok(); };
}
function exPicker(pick) {
  const p = document.createElement('div'); p.className = 'psheet'; p.id = 'wcEx'; document.body.append(p); tintSub(p);
  const groups = [...new Set(exList.map(e => e.own ? 'Your exercises' : GROUP[e.g] || e.g))].sort((a, b) => (b === 'Your exercises') - (a === 'Your exercises'));
  p.innerHTML = `<div class="psheetin"><div class="label">Add exercise</div><input type="search" class="wcsearch" id="wcQ" placeholder="Search" autocomplete="off" aria-label="Search exercises">
    <div class="wcexl">${groups.map(g => `<h3 class="ksec" data-g>${esc(g)}</h3>${exList.filter(e => (e.own ? 'Your exercises' : GROUP[e.g] || e.g) === g).map(e => `<button class="wcex" data-ex="${esc(e.k)}" data-q="${esc(e.n.toLowerCase())}"><b>${esc(e.n)}</b><small>${e.t === 'time' ? 'time' : e.t === 'bw' ? 'body weight' : 'weight'}</small></button>`).join('')}`).join('')}</div>
    <div class="pfoot"><button class="btn ghost" id="wcExX">Cancel</button></div></div>`;
  const q = $('#wcQ', p); q.oninput = () => { const t = q.value.trim().toLowerCase(); p.querySelectorAll('[data-q]').forEach(b => b.hidden = !!t && !b.dataset.q.includes(t)); p.querySelectorAll('[data-g]').forEach(h => { let n = h.nextElementSibling, any = false; while (n && !n.matches('[data-g]')) { any ||= !n.hidden; n = n.nextElementSibling; } h.hidden = !any; }); };
  p.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { p.remove(); pick(b.dataset.ex); });
  $('#wcExX', p).onclick = () => p.remove(); p.onclick = e => { if (e.target === p) p.remove(); };
}

/* -- 28.11.: the indoor trainer's pages on the watch: Target always first (the overview), the others on / off and in order (config "trainer") -- */
function trainerTab(body) {
  const on = (C.trainer && Array.isArray(C.trainer.pages) ? C.trainer.pages : TRAINER_DEF).filter(k => TRAINER_PAGES[k]), off = TRAINER_DEF.filter(k => !on.includes(k));
  const set = l => { C.trainer = { pages: l }; changed(); draw(); };
  const row = (k, i) => { const [l, h] = TRAINER_PAGES[k], at = on.indexOf(k);
    return `<div class="wctp${at < 0 ? ' wcoff' : ''}" data-tp="${k}"><label class="prow wcsw"><span><b>${esc(l)}</b><small>${esc(h)}</small></span><input type="checkbox" class="toggle" data-tpon="${k}" ${at >= 0 ? 'checked' : ''} aria-label="${esc(l)} page"></label>
      ${at >= 0 ? `<div class="wctpmv"><button class="wcx" data-tpup="${k}" ${at === 0 ? 'disabled' : ''} aria-label="Move ${esc(l)} up">↑</button><button class="wcx" data-tpdn="${k}" ${at === on.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(l)} down">↓</button></div>` : ''}</div>`; };
  body.innerHTML = `<p class="phint wclead">The pages of an indoor trainer ride. UP / DOWN (or a swipe) goes to the next page; held UP / DOWN changes the target on any page.</p>
    <h3 class="ksec">Pages, in this order <span class="wccount">${on.length + 1} of ${TRAINER_DEF.length + 1}</span></h3>
    <div class="wctp wcfix"><label class="prow wcsw"><span><b>Target</b><small>Always first: time left in the step, target and actual watts, heart rate, cadence, − / +</small></span><span class="wcfixed">Always on</span></label></div>
    ${on.map(row).join('')}${off.map(row).join('')}`;
  body.querySelectorAll('[data-tpon]').forEach(i => i.onchange = () => { const k = i.dataset.tpon; set(i.checked ? [...on, k] : on.filter(x => x !== k)); });
  const mv = (k, d) => { const l = on.slice(), a = l.indexOf(k), b = a + d; if (a < 0 || b < 0 || b >= l.length) return; [l[a], l[b]] = [l[b], l[a]]; set(l); };
  body.querySelectorAll('[data-tpup]').forEach(b => b.onclick = () => mv(b.dataset.tpup, -1));
  body.querySelectorAll('[data-tpdn]').forEach(b => b.onclick = () => mv(b.dataset.tpdn, 1));
}

/* -- more: the other sports on the watch, one fixed screen -- */
function moreTab(body) {
  const groups = [...new Set(MORE.map(t => STRAVA[t][0]))];
  body.innerHTML = `${preview()}${faceSeg()}
    <p class="phint wclead">One screen for all of them: heart rate big, time, clock and calories.</p>
    <h3 class="ksec">On the watch under More <span class="wccount">${C.more.length} of ${MORE.length}</span></h3>
    ${groups.map(g => `<div class="wcgrp"><h4>${esc(MODES[g]?.name || g)}</h4>${MORE.filter(t => STRAVA[t][0] === g).map(t => `<label class="prow wcsp"><span>${esc(labelOf(t))}</span><input type="checkbox" class="toggle" data-sp="${t}" ${C.more.includes(t) ? 'checked' : ''}></label>`).join('')}</div>`).join('')}`;
  paintPrev(body, 'other', C.sports.other.pages[0].fields);
  body.querySelectorAll('[data-face]').forEach(b => b.onclick = () => { face = +b.dataset.face; draw(); });
  body.querySelectorAll('[data-sp]').forEach(i => i.onchange = () => { const t = i.dataset.sp; C.more = i.checked ? MORE.filter(x => x === t || C.more.includes(x)) : C.more.filter(x => x !== t); changed(); $('.wccount', body).textContent = `${C.more.length} of ${MORE.length}`; });
}
export const _test = { get C() { return C; }, save }; // for the UI test (tools/watchcfg-ui.cjs)
