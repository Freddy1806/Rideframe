// RIDEFRAME Kraft (Freddy 15.11.): log strength workouts like the app "Strong". Every set shows what you did last time,
// every exercise has its graph (estimated 1RM, heaviest weight, volume, reps), records are marked, and a finished workout
// can go to Strava as "Krafttraining". Stored in kv 'kraft' (newest first) and, with an account, on the host (account.js syncKraft).
import { db, uid } from './db.js';
import { fmtTime, fmtNum, esc, twoWeeks, weekStat } from './util.js';
import { applyTheme } from './theme.js';
import { CATALOG, nm, e1rm, vol, doneSets, sessVol, setTxt, nSets, kgTxt, stravaText } from './kraftlib.js';

const $ = (s, r = document) => r.querySelector(s);
const el = document.getElementById('kraft');

const GROUP = { Beine: 'Legs', Rücken: 'Back', Brust: 'Chest', Schultern: 'Shoulders', Arme: 'Arms', Rumpf: 'Core', Ganzkörper: 'Full body', Eigene: 'Custom' };

let S = {}, list = [], mine = [], tpls = [], W = null, tab = 'start', rest = null, acc = null;

// ---------------- data ----------------
async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {};
  applyTheme(S, 'kraft');
  list = (await db.kvGet('kraft').catch(() => null)) || [];
  mine = (await db.kvGet('kraftEx').catch(() => null)) || [];
  tpls = (await db.kvGet('kraftTpl').catch(() => null)) || S.kraftTpl || [];
  W = (await db.kvGet('kraftDraft').catch(() => null)) || null;
  try { const a = await import('./account.js'); acc = a.account(); if (acc) { list = await a.syncKraft(); render(); } } catch {}
}
const saveList = () => db.kvSet('kraft', list).catch(() => {});
let draftT = 0;
const saveDraft = () => { clearTimeout(draftT); draftT = setTimeout(() => db.kvSet('kraftDraft', W).catch(() => {}), 300); };
async function saveTpls() { await db.kvSet('kraftTpl', tpls).catch(() => {}); // the templates ride along in the settings, so they reach other devices
  const st = (await db.kvGet('settings').catch(() => null)) || {}; st.kraftTpl = tpls; await db.kvSet('settings', st).catch(() => {});
  import('./account.js').then(a => a.settingsChanged?.(st)).catch(() => {}); }

/** every exercise known: catalogue, own ones, and whatever an older session (other device) used */
function exercises() {
  const m = new Map(CATALOG.map(e => [e.k, e]));
  for (const e of mine) if (!m.has(e.k)) m.set(e.k, { ...e, g: GROUP[e.g] || e.g, own: true });
  for (const s of list) for (const x of s.ex || []) if (!m.has(x.k)) m.set(x.k, { k: x.k, n: x.n, t: x.t, g: 'Custom', own: true });
  return [...m.values()];
}
const exOf = k => exercises().find(e => e.k === k) || { k, n: k, t: 'w', g: '' };

// ---------------- numbers ----------------
/** per session: one point for this exercise (only sessions that have done sets of it), oldest first */
function history(k) {
  const out = [];
  for (const s of list) {
    const x = (s.ex || []).find(y => y.k === k); if (!x) continue;
    const d = x.sets.filter(y => y.done); if (!d.length) continue;
    out.push({ date: s.start || s.date, id: s.id, sets: d, rm: Math.max(0, ...d.map(y => e1rm(+y.kg, +y.r))), kg: Math.max(0, ...d.map(y => +y.kg || 0)),
      reps: Math.max(0, ...d.map(y => +y.r || 0)), sec: Math.max(0, ...d.map(y => +y.s || 0)), vol: vol(d), totalReps: d.reduce((a, y) => a + (+y.r || 0), 0) });
  }
  return out.sort((a, b) => a.date - b.date);
}
function bests(k, without = null) {
  const h = history(k).filter(p => p.id !== without);
  return { rm: Math.max(0, ...h.map(p => p.rm)), kg: Math.max(0, ...h.map(p => p.kg)), reps: Math.max(0, ...h.map(p => p.reps)), sec: Math.max(0, ...h.map(p => p.sec)), vol: Math.max(0, ...h.map(p => p.vol)), n: h.length };
}
const beats = (x, y, b) => b.n && ((x.t === 'w' && e1rm(+y.kg, +y.r) > b.rm + .01) || (x.t === 'bw' && +y.r > b.reps) || (x.t === 'time' && +y.s > b.sec));
/** flags every set that beats the earlier best (y.pr, shown as 🏆 in the history) and counts the exercises with a record */
function markPrs(w) {
  let prs = 0; for (const x of w.ex) { const b = bests(x.k); let hit = false; for (const y of x.sets) { if (beats(x, y, b)) { y.pr = true; hit = true; } else delete y.pr; } if (hit) prs++; }
  if (prs) w.prs = prs; else delete w.prs;
}
/** the sets of the last session that had this exercise ("Vorher" column) */
function prevSets(k, without = null) {
  for (const s of list) { if (s.id === without) continue; const x = (s.ex || []).find(y => y.k === k); if (x?.sets.some(y => y.done)) return x.sets.filter(y => y.done); }
  return [];
}
/** short form for the narrow "Vorher" column: the column heads already say kg / Wdh */
const prevTxt = (t, s) => !s ? '–' : t === 'time' ? `${+s.s || 0} s` : t === 'bw' ? `${+s.kg ? '+' + fmtNum(+s.kg, +s.kg % 1 ? 1 : 0) + ' × ' : ''}${+s.r || 0}` : `${fmtNum(+s.kg || 0, +s.kg % 1 ? 1 : 0)} × ${+s.r || 0}`;
const dayTxt = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// ---------------- screens ----------------
function flash(t) { let f = $('#kflash'); if (!f) { f = document.createElement('div'); f.id = 'kflash'; f.className = 'pflash'; document.body.append(f); } f.textContent = t; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), 3200); }
function sheet(html) {
  const s = document.createElement('div'); s.className = 'psheet'; s.innerHTML = `<div class="psheetin">${html}</div>`;
  s.onclick = e => { if (e.target === s) s.remove(); }; document.body.append(s); return s;
}

function render() {
  if (W) return workoutScreen();
  const head = `<header class="ptop"><a class="pback" href="handy.html" title="Back to app">‹</a><div class="pbrand"><b>RIDEFRAME </b><span>Strength</span></div>
    ${acc ? `<span class="ppill on"><i></i>${esc(acc.name)}</span>` : '<button class="ppill" id="kAcc" title="Sign in to have your workouts on all devices"><i></i>Sign in</button>'}</header>
    <nav class="pseg kseg">${[['start', 'Workout'], ['hist', 'History'], ['ex', 'Exercises']].map(([k, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</nav>`;
  el.innerHTML = head + `<main class="kmain">${tab === 'hist' ? histView() : tab === 'ex' ? exView() : startView()}</main>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  const ka = $('#kAcc'); if (ka) ka.onclick = async () => { const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); };
  wireMain();
}

const hm = s => `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`; // week total as h:mm, fits the narrow column
function startView() {
  const { cur: week, prev } = twoWeeks(list, s => s.start || s.date), sum = (l, f) => l.reduce((a, s) => a + f(s), 0);
  const last = []; for (const s of list) if (!last.some(x => x.name === s.name) && last.length < 3) last.push(s);
  return `<section class="kcard kweek"><div class="hwhead"><span class="label">This week</span><span class="wdl">▲▼ vs last week</span></div><div class="kstats">
      ${weekStat(week.length, prev.length, 'Workouts')}${weekStat(sum(week, doneSets), sum(prev, doneSets), 'Sets')}
      ${weekStat(sum(week, sessVol), sum(prev, sessVol), 'Volume', kgTxt)}${weekStat(sum(week, s => s.dur || 0), sum(prev, s => s.dur || 0), 'Time (h)', hm)}</div>
      ${weekBars()}</section>
    <button class="btn kbig" id="kNew">Start empty workout</button>
    <button class="btn ghost kbig kquick" id="kQuick">Quick entry</button>
    ${tpls.length ? `<h3 class="ksec">Templates</h3><div class="kgrid">${tpls.map((t, i) => `<div class="kcard ktpl" data-tpl="${i}"><b>${esc(t.name)}</b><span>${t.ex.map(x => esc(exOf(x.k).n)).join(', ')}</span><button class="kx" data-tdel="${i}" title="Delete template">✕</button></div>`).join('')}</div>` : ''}
    ${last.length ? `<h3 class="ksec">Repeat</h3><div class="kgrid">${last.map(s => `<div class="kcard ktpl" data-again="${s.id}"><b>${esc(s.name)}</b><span>${dayTxt(s.start || s.date)} · ${(s.ex || []).map(x => esc(nm(x))).join(', ')}</span></div>`).join('')}</div>` : ''}
    ${!list.length ? '<p class="hint" style="margin-top:18px">No workouts yet. Start an empty workout, add exercises and tick off each set. Next time you will see what you did last time next to every set.</p>' : ''}`;
}
function weekBars() { // the last 8 weeks: workouts per week, like Strong's dashboard
  const mon = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const now = mon(Date.now()), w = [...Array(8)].map((_, i) => now - (7 - i) * 7 * 864e5), n = w.map(t => list.filter(s => mon(s.start || s.date) === t).length), mx = Math.max(3, ...n);
  return `<div class="label kbarcap">Workouts per week</div><div class="kbars">${n.map((v, i) => `<div><i style="height:${v / mx * 100}%"></i><small>${v || ''}</small><span>${new Date(w[i]).getDate()}/${new Date(w[i]).getMonth() + 1}</span></div>`).join('')}</div>`;
}
function histView() {
  if (!list.length) return '<p class="hint">No workouts saved yet.</p>';
  let mon = '';
  return list.map(s => {
    const m = new Date(s.start || s.date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), h = m !== mon ? `<h3 class="ksec">${m}</h3>` : ''; mon = m;
    return h + `<div class="kcard khist" data-open="${s.id}"><div class="khh"><b>${esc(s.name)}</b><span>${dayTxt(s.start || s.date)}</span></div>
      <div class="khm"><span>⏱ ${fmtTime(s.dur || 0)}</span><span>${kgTxt(sessVol(s))}</span><span>${nSets(doneSets(s))}</span>${s.prs ? `<span class="kpr">🏆 ${s.prs}</span>` : ''}${s.strava ? '<span>Strava ✓</span>' : ''}</div>
      <div class="khx">${(s.ex || []).map(x => { const d = x.sets.filter(y => y.done); if (!d.length) return ''; const best = d.slice().sort((a, b) => e1rm(+b.kg, +b.r) - e1rm(+a.kg, +a.r) || (+b.r || +b.s) - (+a.r || +a.s))[0];
        return `<div><span>${d.length} × ${esc(nm(x))}</span><span>${setTxt(x.t, best)}</span></div>`; }).join('')}</div></div>`;
  }).join('');
}
function exView() {
  const used = new Set(list.flatMap(s => (s.ex || []).map(x => x.k)));
  const all = exercises().sort((a, b) => used.has(b.k) - used.has(a.k) || a.n.localeCompare(b.n, 'en'));
  return `<input class="ksearch" id="kFind" placeholder="Search exercises …" autocomplete="off"><button class="btn ghost" id="kNewEx" style="margin-bottom:8px">+ New exercise</button>
    <div id="kExList">${all.map(e => { const b = used.has(e.k) ? bests(e.k) : null;
      return `<div class="kcard kexrow" data-ex="${e.k}" data-n="${esc(e.n.toLowerCase())}"><div><b>${esc(e.n)}</b><span>${esc(e.g || '')}${b ? ` · done ${b.n}×` : ''}</span></div>
        <span class="kbest">${b ? e.t === 'time' ? b.sec + ' s' : e.t === 'bw' ? b.reps + ' reps' : fmtNum(b.rm, 1) + ' kg' : ''}</span></div>`; }).join('')}</div>`;
}

function wireMain() {
  const on = (s, f) => el.querySelectorAll(s).forEach(b => b.onclick = e => f(b, e));
  on('#kNew', () => begin({ name: defaultName(), ex: [] }));
  on('#kQuick', () => quickSheet());
  on('#kNewEx', async () => { const k = await newExercise($('#kFind')?.value.trim() || ''); if (k) { render(); exSheet(k); } });
  on('[data-tpl]', (b, e) => { if (e.target.dataset.tdel) return; const t = tpls[+b.dataset.tpl]; begin({ name: t.name, ex: t.ex.map(x => ({ k: x.k, n: exOf(x.k).n, t: exOf(x.k).t, sets: fromPrev(x.k, x.n || 3) })) }); });
  on('[data-tdel]', b => { if (!confirm('Delete template?')) return; tpls.splice(+b.dataset.tdel, 1); saveTpls(); render(); });
  on('[data-again]', b => { const s = list.find(x => x.id === b.dataset.again); begin({ name: s.name, ex: s.ex.map(x => ({ k: x.k, n: x.n, t: x.t, sets: fromPrev(x.k, x.sets.filter(y => y.done).length || 3) })) }); });
  on('[data-open]', b => sessionSheet(list.find(x => x.id === b.dataset.open)));
  on('[data-ex]', b => exSheet(b.dataset.ex));
  const f = $('#kFind'); if (f) f.oninput = () => { const q = f.value.trim().toLowerCase(); el.querySelectorAll('.kexrow').forEach(r => r.hidden = q && !r.dataset.n.includes(q)); };
}
const defaultName = () => { const h = new Date().getHours(); return h < 11 ? 'Morning workout' : h < 17 ? 'Midday workout' : 'Evening workout'; };
/** n new empty sets: last time's values show grey in the fields (like Strong); ✓ on an empty field takes them over */
const fromPrev = (k, n) => [...Array(Math.max(1, n))].map(() => ({ kg: '', r: '', s: '', done: false }));

// ---------------- quick entry: say or type what you did, check it, save ----------------
async function quickSheet() {
  const Q = await import('./quick.js'), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const s = sheet(`<div class="label">Quick entry</div>
    <p class="hint">Say or type what you did. You will then see what was understood and confirm it.</p>
    <div class="kqin"><textarea class="ksearch kqt" id="qT" rows="3" placeholder="100 push-ups, 50 pull-ups, trained 45 minutes"></textarea>
      ${SR ? '<button class="kqmic" id="qMic" title="Speak" aria-label="Speak"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>' : ''}</div>
    <div id="qRes"></div>
    <div class="pfoot col"><button class="btn" id="qGo">Read it</button><button class="btn ghost" id="qAi"></button><button class="btn ghost" id="qX">Cancel</button></div>`);
  const T = $('#qT', s), res = $('#qRes', s), go = $('#qGo', s), ai = $('#qAi', s); let R = null, rec = null;
  const aiLabel = () => ai.textContent = Q.aiKey() ? 'Own AI: on' : 'Add your own AI (optional)'; aiLabel();
  $('#qX', s).onclick = () => { try { rec?.stop(); } catch {} s.remove(); };
  ai.onclick = () => aiSheet(Q, aiLabel);
  T.oninput = () => { if (R) { R = null; res.innerHTML = ''; go.textContent = 'Read it'; } };
  if (SR) $('#qMic', s).onclick = e => { const b = e.currentTarget;
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = navigator.language || 'en-GB'; rec.interimResults = true; rec.continuous = true; const base = T.value.trim();
    rec.onresult = ev => { T.value = (base ? base + ', ' : '') + [...ev.results].map(r => r[0].transcript).join(' ').trim(); T.oninput(); };
    rec.onerror = ev => { if (ev.error !== 'aborted' && ev.error !== 'no-speech') flash(ev.error === 'not-allowed' ? 'Microphone not allowed.' : 'Speech not recognised.'); };
    rec.onend = () => { rec = null; b.classList.remove('on'); };
    try { rec.start(); b.classList.add('on'); } catch { rec = null; } };
  const paint = () => {
    const row = (x, i) => { const one = x.total; return `<div class="kqrow"><div><b>${esc(x.n)}</b>${x.neu ? '<i>new exercise</i>' : ''}<span>${nSets(x.sets.length)} · ${setTxt(x.t, x.sets[0])}</span></div>
      ${one ? `<div class="kqstep"><button data-qs="${i}" data-d="-1" aria-label="Fewer sets">−</button><em>${x.sets.length}</em><button data-qs="${i}" data-d="1" aria-label="More sets">+</button></div>` : ''}
      <button class="kx" data-qdel="${i}" title="Remove">✕</button></div>`; };
    res.innerHTML = !R.ex.length ? `<p class="hint kqmiss">I did not find an exercise with a number. Example: “3 x 10 bench press at 80 kg, 2 minutes plank”.</p>` :
      `<div class="olbl">Understood</div>${R.ex.map(row).join('')}
      ${R.ex.some(x => x.total) ? '<p class="hint">A total counts as one set. Use − and + to split it into several sets.</p>' : ''}
      <label class="prow"><span>Duration</span><input id="qDur" type="number" inputmode="numeric" min="0" max="600" value="${R.dur ? Math.round(R.dur / 60) : ''}" placeholder="–"><span>min</span></label>
      ${R.miss.length ? `<p class="hint kqmiss">Not understood:  ${esc(R.miss.join(', '))}</p>` : ''}`;
    go.textContent = R.ex.length ? 'Save' : 'Read it';
    res.querySelectorAll('[data-qdel]').forEach(b => b.onclick = () => { R.ex.splice(+b.dataset.qdel, 1); paint(); });
    res.querySelectorAll('[data-qs]').forEach(b => b.onclick = () => { const x = R.ex[+b.dataset.qs], n = Math.min(20, Math.max(1, x.sets.length + +b.dataset.d)), kg = x.sets[0].kg;
      x.sets = [...Array(n)].map((_, j) => ({ kg, r: Math.floor(x.total / n) + (j < x.total % n ? 1 : 0), s: '', done: true })); paint(); });
    const d = $('#qDur', s); if (d) d.oninput = () => R.dur = Math.max(0, +d.value || 0) * 60;
  };
  go.onclick = async () => {
    if (R?.ex.length) { s.remove(); return quickSave(R, T.value.trim()); }
    const txt = T.value.trim(); if (!txt) return T.focus();
    try { rec?.stop(); } catch {}
    if (Q.aiKey()) { go.disabled = true; go.textContent = 'AI reading …';
      try { R = await Q.aiQuick(txt, exercises()); } catch (e) { flash(e.message + ' Reading it without AI.'); R = null; } go.disabled = false; }
    R ||= Q.parseQuick(txt, exercises());
    for (const x of R.ex) if (x.t === 'bw' && x.sets.length === 1 && +x.sets[0].r > 1) x.total = +x.sets[0].r;
    paint(); if (!R.ex.length) R = null;
  };
  setTimeout(() => T.focus(), 60);
}
async function quickSave(R, said) {
  const dur = R.dur || 0, now = Date.now(); let made = false;
  for (const x of R.ex) { if (x.neu) { const e = { k: 'my_' + uid().slice(0, 8), n: x.n, t: x.t, g: 'Custom' }; mine.push(e); x.k = e.k; made = true; } delete x.neu; delete x.total; }
  if (made) await db.kvSet('kraftEx', mine).catch(() => {});
  const w = { id: uid(), name: defaultName(), start: now - dur * 1000, date: now, dur, quick: true, note: said.slice(0, 300), ex: R.ex };
  markPrs(w);
  list.unshift(w); await saveList(); import('./account.js').then(a => a.pushKraft?.(w)).catch(() => {});
  tab = 'hist'; render(); sessionSheet(w); flash('Logged.'); if (S.autoStrava) toStrava(w);
}
function aiSheet(Q, done) {
  const has = !!Q.aiKey();
  const s = sheet(`<div class="label">Own AI (optional)</div>
    <p class="hint">The app understands simple sentences without AI. With your own Claude key (console.anthropic.com) it also understands free-form sentences. The key stays on this device only. Your sentence then goes straight from here to Anthropic, and the cost runs through your account there.</p>
    <input class="ksearch" id="aK" type="password" autocomplete="off" placeholder="${has ? 'Key is saved' : 'sk-ant-…'}">
    <div class="pfoot col"><button class="btn" id="aOk">Save</button>${has ? '<button class="btn ghost" id="aDel">Remove key</button>' : ''}<button class="btn ghost" id="aX">Cancel</button></div>`);
  $('#aX', s).onclick = () => s.remove();
  $('#aOk', s).onclick = () => { const k = $('#aK', s).value.trim(); if (!k) return $('#aK', s).focus(); Q.setAiKey(k); s.remove(); done(); flash('AI key saved.'); };
  const d = $('#aDel', s); if (d) d.onclick = () => { Q.setAiKey(''); s.remove(); done(); flash('AI key removed.'); };
}

// ---------------- workout ----------------
function begin(w) {
  W = { id: uid(), start: Date.now(), ...w }; saveDraft(); render();
  lockScreen();
}
let wake = null;
async function lockScreen() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && W) lockScreen(); });

function workoutScreen() {
  el.innerHTML = `<header class="ptop"><button class="pback" id="kMin" title="Cancel">✕</button><input class="kname" id="kName" value="${esc(W.name)}">
      <button class="btn ksmall" id="kFin">Finish</button></header>
    <div class="kclock"><span id="kClock">${fmtTime((Date.now() - W.start) / 1000)}</span><span>${kgTxt(sessVol(W))} · ${nSets(doneSets(W))}</span></div>
    <main class="kmain kwork">${W.ex.map((x, i) => exBlock(x, i)).join('')}
      <button class="btn ghost kbig" id="kAdd">+ Add exercise</button>
      <button class="btn ghost ksmall kcancel" id="kDrop">Discard workout</button></main>
    <div class="krest" id="kRest" hidden><div class="krbar"><i id="kRbar"></i></div><button data-rd="-15">−15</button><b id="kRt">0:00</b><button data-rd="15">+15</button><button id="kRskip">Skip</button></div>`;
  wireWork(); paintRest();
}
function exBlock(x, i) {
  const prev = prevSets(x.k), cols = x.t === 'time' ? ['Sec'] : x.t === 'bw' ? ['+kg', 'Reps'] : ['kg', 'Reps'];
  return `<section class="kcard kex" data-i="${i}"><div class="kexh"><button class="kexn" data-chart="${x.k}">${esc(nm(x))}</button><button class="kx" data-xmenu="${i}">⋯</button></div>
    ${x.note ? `<div class="hint">${esc(x.note)}</div>` : ''}
    <div class="kset khead ${x.t}"><span>Set</span><span>Previous</span>${cols.map(c => `<span>${c}</span>`).join('')}<span>✓</span></div>
    ${x.sets.map((s, j) => { const pv = prev[j] || prev[prev.length - 1]; return `<div class="kset ${x.t} ${s.done ? 'done' : ''}" data-j="${j}"><span class="kno${s.done && s.pr ? ' pr' : ''}" data-smenu="${j}">${s.warm ? 'W' : j + 1 - x.sets.slice(0, j).filter(y => y.warm).length}</span>
      <button class="kprev" data-fill="${j}">${prev[j] ? prevTxt(x.t, prev[j]) : '–'}</button>
      ${x.t === 'time' ? `<input inputmode="numeric" data-f="s" value="${s.s ?? ''}" placeholder="${pv?.s ?? ''}">`
        : `<input inputmode="decimal" data-f="kg" value="${s.kg === '' || s.kg == null ? '' : String(s.kg)}" placeholder="${pv ? String(pv.kg ?? '') : ''}"><input inputmode="numeric" data-f="r" value="${s.r ?? ''}" placeholder="${pv?.r ?? ''}">`}
      <button class="kchk" data-chk="${j}">✓</button></div>`; }).join('')}
    <button class="kaddset" data-addset="${i}">+ Add set</button></section>`;
}
function wireWork() {
  $('#kName').onchange = e => { W.name = e.target.value.trim() || defaultName(); saveDraft(); };
  $('#kMin').onclick = () => { if (confirm('Discard workout? The sets will be lost.')) drop(); };
  $('#kDrop').onclick = () => { if (confirm('Discard workout? The sets will be lost.')) drop(); };
  $('#kAdd').onclick = () => pickExercise(k => { const e = exOf(k); W.ex.push({ k, n: e.n, t: e.t, sets: fromPrev(k, Math.max(1, prevSets(k).length || 3)) }); saveDraft(); render(); setTimeout(() => el.querySelector(`.kex[data-i="${W.ex.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); });
  $('#kFin').onclick = finishSheet;
  el.querySelectorAll('.kex').forEach(sec => {
    const x = W.ex[+sec.dataset.i];
    sec.querySelectorAll('.kset[data-j] input').forEach(inp => inp.oninput = () => { const s = x.sets[+inp.closest('.kset').dataset.j], v = inp.value.replace(',', '.'); s[inp.dataset.f] = v === '' ? '' : +v; saveDraft(); });
    sec.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => { const p = prevSets(x.k)[+b.dataset.fill]; if (!p) return; Object.assign(x.sets[+b.dataset.fill], { kg: p.kg, r: p.r, s: p.s }); saveDraft(); render(); });
    sec.querySelectorAll('[data-chk]').forEach(b => b.onclick = () => {
      const j = +b.dataset.chk, s = x.sets[j], row = b.closest('.kset');
      row.querySelectorAll('input').forEach(inp => { if (inp.value === '' && inp.placeholder !== '') { inp.value = inp.placeholder; s[inp.dataset.f] = +inp.placeholder.replace(',', '.'); } }); // empty = same as last time
      if (!s.done && (x.t === 'time' ? !(+s.s > 0) : !(+s.r > 0))) return flash(x.t === 'time' ? 'Enter the seconds first.' : 'Enter the reps first.');
      s.done = !s.done;
      delete s.pr; if (s.done) { if (beats(x, s, bests(x.k))) { s.pr = true; flash('🏆 New record!'); } if (!s.warm) startRest(); }
      saveDraft();
      render();
    });
    sec.querySelector('[data-addset]').onclick = () => { const l = x.sets[x.sets.length - 1]; x.sets.push({ kg: l?.kg ?? '', r: l?.r ?? '', s: l?.s ?? '', done: false }); saveDraft(); render(); };
    sec.querySelectorAll('[data-smenu]').forEach(b => b.onclick = () => setMenu(x, +b.dataset.smenu));
    sec.querySelector('[data-xmenu]').onclick = () => exMenu(+sec.dataset.i);
    sec.querySelector('[data-chart]').onclick = () => exSheet(x.k);
  });
  el.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => { if (rest) { rest.end += +b.dataset.rd * 1000; rest.len += +b.dataset.rd; paintRest(); } });
  $('#kRskip').onclick = () => { rest = null; paintRest(); };
}
function setMenu(x, j) {
  const s = sheet(`<div class="label">Set ${j + 1}</div><div class="pfoot col"><button class="btn ghost" id="mWarm">${x.sets[j].warm ? 'Not a warm-up set' : 'Mark as warm-up set'}</button><button class="btn danger" id="mDel">Delete set</button></div>`);
  $('#mWarm', s).onclick = () => { x.sets[j].warm = !x.sets[j].warm; saveDraft(); s.remove(); render(); };
  $('#mDel', s).onclick = () => { x.sets.splice(j, 1); if (!x.sets.length) x.sets.push({ kg: '', r: '', s: '', done: false }); saveDraft(); s.remove(); render(); };
}
function exMenu(i) {
  const x = W.ex[i], s = sheet(`<div class="label">${esc(nm(x))}</div><div class="pfoot col">
    <button class="btn ghost" id="mUp" ${i ? '' : 'disabled'}>Move up</button><button class="btn ghost" id="mDown" ${i < W.ex.length - 1 ? '' : 'disabled'}>Move down</button>
    <button class="btn ghost" id="mSwap">Swap exercise</button><button class="btn ghost" id="mNote">Note</button><button class="btn danger" id="mDel">Remove exercise</button></div>`);
  const mv = d => { W.ex.splice(i + d, 0, W.ex.splice(i, 1)[0]); saveDraft(); s.remove(); render(); };
  $('#mUp', s).onclick = () => mv(-1); $('#mDown', s).onclick = () => mv(1);
  $('#mSwap', s).onclick = () => { s.remove(); pickExercise(k => { const e = exOf(k); Object.assign(x, { k, n: e.n, t: e.t }); x.sets = fromPrev(k, x.sets.length); saveDraft(); render(); }); };
  $('#mNote', s).onclick = () => { const n = prompt('Note for this exercise', x.note || ''); if (n != null) { x.note = n.trim(); saveDraft(); } s.remove(); render(); };
  $('#mDel', s).onclick = () => { if (x.sets.some(y => y.done) && !confirm('Remove exercise with ticked sets?')) return; W.ex.splice(i, 1); saveDraft(); s.remove(); render(); };
}
/** create your own exercise (Freddy 16.11.: "komische Thai-Übungen anlegen können"): name, kind and muscle group; resolves with its key */
function newExercise(name = '') {
  return new Promise(done => {
    const groups = [...new Set(CATALOG.map(e => e.g).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));
    const s = sheet(`<div class="label">New exercise</div>
      <input class="ksearch" id="nName" placeholder="Name, e.g. Thai kicks on the bag" value="${esc(name)}" autocomplete="off" maxlength="60">
      <div class="olbl">How is it counted?</div><div class="pseg" id="nT">${[['w', 'Weight × reps'], ['bw', 'Bodyweight'], ['time', 'Time']].map(([k, n], i) => `<button data-t="${k}" class="${i ? '' : 'on'}">${n}</button>`).join('')}</div>
      <div class="olbl">Muscle group</div><select id="nG" class="ksearch"><option>Custom</option>${groups.map(g => `<option>${esc(g)}</option>`).join('')}</select>
      <div class="pfoot"><button class="btn ghost" id="nX">Cancel</button><button class="btn" id="nOk">Create</button></div>`);
    let typ = 'w'; const f = $('#nName', s); setTimeout(() => f.focus(), 60);
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { typ = b.dataset.t; s.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); });
    $('#nX', s).onclick = () => { s.remove(); done(null); };
    $('#nOk', s).onclick = async () => { const n = f.value.trim(); if (!n) return f.focus();
      const dup = exercises().find(e => e.n.toLowerCase() === n.toLowerCase()); if (dup) { s.remove(); return done(dup.k); }
      const e = { k: 'my_' + uid().slice(0, 8), n, t: typ, g: $('#nG', s).value || 'Custom' }; mine.push(e); await db.kvSet('kraftEx', mine).catch(() => {}); s.remove(); done(e.k); };
  });
}
function pickExercise(done) {
  const used = new Set(list.flatMap(s => (s.ex || []).map(x => x.k)));
  const all = exercises().sort((a, b) => used.has(b.k) - used.has(a.k) || a.g.localeCompare(b.g, 'en') || a.n.localeCompare(b.n, 'en'));
  const s = sheet(`<div class="label">Add exercise</div><input class="ksearch" id="pFind" placeholder="Search or type a new exercise …" autocomplete="off">
    <div class="kpick">${all.map(e => `<button data-k="${e.k}" data-n="${esc(e.n.toLowerCase())}"><b>${esc(e.n)}</b><small>${esc(e.g || '')}${used.has(e.k) ? ' · done before' : ''}</small></button>`).join('')}</div>
    <button class="btn ghost" id="pMake" style="margin-top:10px">+ New exercise</button>`);
  const f = $('#pFind', s); setTimeout(() => f.focus(), 60);
  f.oninput = () => { const q = f.value.trim().toLowerCase(); let n = 0; s.querySelectorAll('.kpick [data-k]').forEach(b => { b.hidden = q && !b.dataset.n.includes(q); n += !b.hidden; }); };
  s.querySelectorAll('.kpick [data-k]').forEach(b => b.onclick = () => { s.remove(); done(b.dataset.k); });
  $('#pMake', s).onclick = async () => { const n = f.value.trim(); s.remove(); const k = await newExercise(n); if (k) done(k); };
}

// rest timer: starts after every checked set; vibrates at the end (no sound)
function startRest() { const len = +S.kraftRest || 90; rest = { end: Date.now() + len * 1000, len }; paintRest(); }
function paintRest() {
  const r = $('#kRest'); if (!r) return;
  if (!rest) { r.hidden = true; return; }
  const left = Math.ceil((rest.end - Date.now()) / 1000);
  if (left <= 0) { rest = null; r.hidden = true; try { navigator.vibrate?.([300, 120, 300]); } catch {} flash('Rest over · next set'); return; }
  r.hidden = false; $('#kRt').textContent = fmtTime(left); $('#kRbar').style.width = Math.max(0, left / rest.len * 100) + '%';
}
setInterval(() => { if (!W) return; const c = $('#kClock'); if (c) c.textContent = fmtTime((Date.now() - W.start) / 1000); paintRest(); }, 500);

function drop() { W = null; rest = null; db.kvDel('kraftDraft').catch(() => {}); try { wake?.release(); } catch {} tab = 'start'; render(); }

function finishSheet() {
  const sets = doneSets(W);
  if (!sets) return flash('No set ticked yet.');
  const open = W.ex.reduce((a, x) => a + x.sets.filter(y => !y.done).length, 0);
  const s = sheet(`<div class="label">Finish workout</div><h2 class="display" style="font-size:30px;margin:8px 0 12px">${esc(W.name)}</h2>
    <div class="psum"><div><span>Time</span><b>${fmtTime((Date.now() - W.start) / 1000)}</b></div><div><span>Sets</span><b>${sets}</b></div><div><span>Volume</span><b>${kgTxt(sessVol(W))}</b></div></div>
    ${open ? `<p class="hint" style="margin-top:10px">${open} ${open === 1 ? 'set is' : 'sets are'} not ticked and will not be saved.</p>` : ''}
    <label class="prow" style="margin-top:10px">Save as template<input id="fTpl" type="checkbox" class="toggle" ${tpls.some(t => t.name === W.name) ? '' : ''}></label>
    <div class="pfoot col"><button class="btn" id="fSave">Save</button><button class="btn ghost" id="fStrava">Save + Strava</button><button class="btn ghost" id="fBack">Resume</button></div>`);
  $('#fBack', s).onclick = () => s.remove();
  const save = async () => {
    const w = { ...W, date: Date.now(), dur: Math.round((Date.now() - W.start) / 1000), ex: W.ex.map(x => ({ ...x, sets: x.sets.filter(y => y.done).map(({ done, ...y }) => ({ ...y, done: true })) })).filter(x => x.sets.length) };
    markPrs(w);
    if ($('#fTpl', s).checked) { tpls = tpls.filter(t => t.name !== w.name); tpls.unshift({ name: w.name, ex: w.ex.map(x => ({ k: x.k, n: x.sets.length })) }); saveTpls(); }
    list.unshift(w); await saveList(); import('./account.js').then(a => a.pushKraft?.(w)).catch(() => {});
    W = null; rest = null; db.kvDel('kraftDraft').catch(() => {}); try { wake?.release(); } catch {}
    return w;
  };
  if (S.autoStrava) { $('#fSave', s).textContent = 'Save + Strava'; $('#fStrava', s).hidden = true; }
  $('#fSave', s).onclick = async () => { if (S.autoStrava) return $('#fStrava', s).click(); const w = await save(); s.remove(); tab = 'hist'; render(); sessionSheet(w); };
  $('#fStrava', s).onclick = async e => { e.target.disabled = true; const w = await save(); s.remove(); tab = 'hist'; render(); await toStrava(w); };
}

async function toStrava(w) {
  const { stravaStatus, stravaConnect, stravaStrength } = await import('./stravaup.js');
  const st = await stravaStatus();
  if (!st.configured) { try { await navigator.clipboard.writeText(stravaText(w)); } catch {} flash('Strava is not set up on this server. Text copied.'); return; }
  try {
    if (!st.connected && !(await stravaConnect())) throw new Error('Not connected to Strava.');
    flash('Sending to Strava …');
    const url = await stravaStrength({ id: w.id, name: w.name, start: w.start, dur: w.dur, description: stravaText(w) });
    w.strava = url; await saveList(); import('./account.js').then(a => a.pushKraft?.(w)).catch(() => {});
    flash('On Strava ✓'); render(); window.open(url, '_blank');
  } catch (e) { flash(e.message || String(e)); }
}

function sessionSheet(w) {
  if (!w) return;
  const s = sheet(`<div class="label">${dayTxt(w.start || w.date)} · ${new Date(w.start || w.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
    <h2 class="display" style="font-size:30px;margin:8px 0 12px">${esc(w.name)}</h2>
    <div class="psum"><div><span>Time</span><b>${fmtTime(w.dur || 0)}</b></div><div><span>Sets</span><b>${doneSets(w)}</b></div><div><span>Volume</span><b>${kgTxt(sessVol(w))}</b></div>${w.prs ? `<div><span>Records</span><b>🏆 ${w.prs}</b></div>` : ''}</div>
    ${(w.ex || []).map(x => `<div class="kdet"><b data-chart="${x.k}">${esc(nm(x))} ›</b>${x.sets.map((y, j) => `<div><span>${y.warm ? 'W' : j + 1}</span><span>${setTxt(x.t, y)}${y.pr ? ' 🏆' : ''}</span><span>${x.t === 'w' ? fmtNum(e1rm(+y.kg, +y.r), 1) + ' kg 1RM' : ''}</span></div>`).join('')}</div>`).join('')}
    <div class="pfoot col"><button class="btn" id="dAgain">Do it again</button>${w.strava ? `<a class="btn ghost" href="${esc(w.strava)}" target="_blank">View on Strava</a>` : '<button class="btn ghost" id="dStrava">Upload to Strava</button>'}
      <button class="btn danger" id="dDel">Delete</button></div>`);
  s.querySelectorAll('[data-chart]').forEach(b => b.onclick = () => exSheet(b.dataset.chart));
  $('#dAgain', s).onclick = () => { s.remove(); begin({ name: w.name, ex: w.ex.map(x => ({ k: x.k, n: x.n, t: x.t, sets: fromPrev(x.k, x.sets.length) })) }); };
  const st = $('#dStrava', s); if (st) st.onclick = async () => { st.disabled = true; await toStrava(w); s.remove(); };
  $('#dDel', s).onclick = async () => {
    if (!confirm('Delete this workout for good?')) return;
    try { const a = await import('./account.js'); await a.deleteKraftRemote?.(w.id); }
    catch { const g = (await db.kvGet('kraftGone').catch(() => null)) || []; g.push(w.id); await db.kvSet('kraftGone', g).catch(() => {}); } // offline: delete on the next sync
    list = list.filter(x => x.id !== w.id); await saveList(); s.remove(); render();
  };
}

// ---------------- exercise graph ----------------
function exSheet(k) {
  const e = exOf(k), h = history(k), b = bests(k);
  const metrics = e.t === 'w' ? [['rm', '1RM', 'kg'], ['kg', 'Weight', 'kg'], ['vol', 'Volume', 'kg'], ['reps', 'Reps', '']]
    : e.t === 'bw' ? [['reps', 'Most reps', ''], ['totalReps', 'Total reps', ''], ['kg', 'Extra kg', 'kg']] : [['sec', 'Longest', 's']];
  let m = metrics[0][0];
  const s = sheet(`<div class="label">${esc(e.g || 'Exercise')}</div><h2 class="display" style="font-size:28px;margin:8px 0 12px">${esc(e.n)}</h2>
    ${h.length ? `<div class="pseg kmseg" style="grid-template-columns:repeat(${metrics.length},1fr)">${metrics.map(([k2, n]) => `<button data-m="${k2}">${n}</button>`).join('')}</div><div id="kChart"></div>
    <div class="psum">${e.t === 'w' ? `<div><span>Best 1RM</span><b>${fmtNum(b.rm, 1)} kg</b></div><div><span>Heaviest</span><b>${fmtNum(b.kg, 1)} kg</b></div><div><span>Best volume</span><b>${kgTxt(b.vol)}</b></div>` : e.t === 'bw' ? `<div><span>Most reps</span><b>${b.reps}</b></div>` : `<div><span>Longest</span><b>${b.sec} s</b></div>`}<div><span>Done</span><b>${b.n}×</b></div></div>
    ${progress(e, h)}
    <div class="label" style="margin:14px 0 6px">History</div><div class="kdet">${h.slice().reverse().slice(0, 30).map(p => `<div><span>${dayTxt(p.date)}</span><span>${p.sets.map(y => setTxt(e.t, y)).join(' · ')}</span></div>`).join('')}</div>`
    : '<p class="hint">No sets with this exercise yet. After your first workout you will see your progress here as a curve.</p>'}`);
  const draw = () => { s.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === m)); const mm = metrics.find(x => x[0] === m); $('#kChart', s).innerHTML = chart(h.map(p => [p.date, p[m]]), mm[2]); };
  s.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { m = x.dataset.m; draw(); });
  if (h.length) draw();
}
/** how the exercise developed: since the first time, over the last 4 weeks, and how often (Freddy 16.11.: "zu jeder Übung sehen, wie man sich verbessert hat") */
function progress(e, h) {
  const key = e.t === 'w' ? 'rm' : e.t === 'bw' ? 'reps' : 'sec', unit = e.t === 'w' ? 'kg' : e.t === 'bw' ? 'reps' : 's', pts = h.filter(p => p[key] > 0);
  if (pts.length < 2) return '<p class="hint" style="margin-top:10px">After the second time you will see here how much you have improved.</p>';
  const first = pts[0][key], last = pts[pts.length - 1][key], t4 = Date.now() - 28 * 864e5, before = pts.filter(p => p.date < t4), base4 = before.length ? before[before.length - 1][key] : null;
  const diff = (a, b) => { const d = b - a, pc = a ? d / a * 100 : 0, cls = d > 0 ? 'up' : d < 0 ? 'down' : ''; return `<b class="kdelta ${cls}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmtNum(Math.abs(d), unit === 'kg' ? 1 : 0)} ${unit}</b><small>${d > 0 ? '+' : d < 0 ? '−' : ''}${fmtNum(Math.abs(pc), 0)} %</small>`; };
  const weeks = Math.max(1, (pts[pts.length - 1].date - pts[0].date) / (7 * 864e5)), n4 = pts.filter(p => p.date >= t4).length;
  return `<div class="label" style="margin:14px 0 6px">Progress${e.t === 'w' ? ' (estimated 1RM)' : ''}</div><div class="psum kprog">
    <div><span>Since the first time</span>${diff(first, last)}</div>
    <div><span>Last 4 weeks</span>${base4 != null ? diff(base4, last) : '<b>–</b><small>too new yet</small>'}</div>
    <div><span>Sessions</span><b>${pts.length}</b><small>${n4} in 4 weeks · ${fmtNum(pts.length / weeks, 1)} per week</small></div></div>`;
}
function chart(pts, unit) {
  pts = pts.filter(p => p[1] > 0);
  if (!pts.length) return '<p class="hint">No values.</p>';
  const W0 = 320, H = 150, L = 34, R = 10, T = 12, B = 22, t0 = pts[0][0], t1 = pts[pts.length - 1][0], span = Math.max(1, t1 - t0);
  let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])); if (hi - lo < 1) { lo -= 1; hi += 1; } const pad = (hi - lo) * .12; lo = Math.max(0, lo - pad); hi += pad;
  const x = t => pts.length === 1 ? (L + W0 - R) / 2 : L + (t - t0) / span * (W0 - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(''), best = Math.max(...pts.map(p => p[1]));
  const lab = v => fmtNum(v, v < 20 && unit === 'kg' ? 1 : 0), cap = v => fmtNum(v, unit === 'kg' && v < 1000 ? 1 : 0), d = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric' });
  return `<svg class="kchart" viewBox="0 0 ${W0} ${H}" role="img" aria-label="History">
    ${[hi, (hi + lo) / 2, lo].map(v => `<line x1="${L}" x2="${W0 - R}" y1="${y(v)}" y2="${y(v)}" class="kgrid"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${lab(v)}</text>`).join('')}
    <path d="${path}" class="kline"/>${pts.map(p => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="${p[1] === best ? 4.5 : 3}" class="${p[1] === best ? 'kdotb' : 'kdot'}"/>`).join('')}
    <text x="${L}" y="${H - 5}">${d(t0)}</text><text x="${W0 - R}" y="${H - 5}" text-anchor="end">${d(t1)}</text></svg>
    <div class="kchartcap">Last time <b>${cap(pts[pts.length - 1][1])} ${unit}</b></div>`;
}

window.addEventListener('beforeunload', () => { if (W) db.kvSet('kraftDraft', W).catch(() => {}); });
await load();
render();
if (W) flash('Your open workout is still running.');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
