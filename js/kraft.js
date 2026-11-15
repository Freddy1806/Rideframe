// RIDEFRAME Kraft (Freddy 15.11.): log strength workouts like the app "Strong". Every set shows what you did last time,
// every exercise has its graph (estimated 1RM, heaviest weight, volume, reps), records are marked, and a finished workout
// can go to Strava as "Krafttraining". Stored in kv 'kraft' (newest first) and, with an account, on the host (account.js syncKraft).
import { db, uid } from './db.js';
import { fmtTime, fmtNum, esc } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const el = document.getElementById('kraft');
const ACCENTS = { orange: '#ff5a1f', violet: '#8b6cff', lime: '#c6f432', cyan: '#2fd3e0', pink: '#ff4f9a' };

// t: w = weight × reps, bw = body weight (reps, optional extra kg), time = seconds
const CATALOG = [
  ['squat', 'Kniebeugen (Langhantel)', 'w', 'Beine'], ['dead', 'Kreuzheben', 'w', 'Rücken'], ['rdl', 'Rumänisches Kreuzheben', 'w', 'Beine'],
  ['bench', 'Bankdrücken', 'w', 'Brust'], ['incline', 'Schrägbankdrücken (Kurzhantel)', 'w', 'Brust'], ['ohp', 'Schulterdrücken', 'w', 'Schultern'],
  ['row', 'Rudern (Langhantel)', 'w', 'Rücken'], ['lat', 'Latzug', 'w', 'Rücken'], ['cable', 'Rudern am Kabel', 'w', 'Rücken'],
  ['legpress', 'Beinpresse', 'w', 'Beine'], ['lunge', 'Ausfallschritte', 'w', 'Beine'], ['hipthrust', 'Hip Thrust', 'w', 'Beine'],
  ['legcurl', 'Beinbeuger', 'w', 'Beine'], ['legext', 'Beinstrecker', 'w', 'Beine'], ['calf', 'Wadenheben', 'w', 'Beine'],
  ['curl', 'Bizepscurls', 'w', 'Arme'], ['tri', 'Trizepsdrücken (Kabel)', 'w', 'Arme'], ['lateral', 'Seitheben', 'w', 'Schultern'], ['facepull', 'Face Pulls', 'w', 'Schultern'],
  ['pull', 'Klimmzüge', 'bw', 'Rücken'], ['chin', 'Chin-ups', 'bw', 'Rücken'], ['dip', 'Dips', 'bw', 'Brust'], ['push', 'Liegestütze', 'bw', 'Brust'],
  ['situp', 'Sit-ups', 'bw', 'Rumpf'], ['legraise', 'Beinheben hängend', 'bw', 'Rumpf'], ['burpee', 'Burpees', 'bw', 'Ganzkörper'], ['airsquat', 'Kniebeugen ohne Gewicht', 'bw', 'Beine'],
  ['stepup', 'Step-ups', 'bw', 'Beine'], ['plank', 'Plank', 'time', 'Rumpf'], ['sideplank', 'Seitstütz', 'time', 'Rumpf'], ['wallsit', 'Wandsitzen', 'time', 'Beine'],
].map(([k, n, t, g]) => ({ k, n, t, g }));

let S = {}, list = [], mine = [], tpls = [], W = null, tab = 'start', rest = null, acc = null;

// ---------------- data ----------------
async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {};
  document.documentElement.style.setProperty('--accent', ACCENTS[S.accent] || ACCENTS.orange);
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
  for (const e of mine) if (!m.has(e.k)) m.set(e.k, { ...e, own: true });
  for (const s of list) for (const x of s.ex || []) if (!m.has(x.k)) m.set(x.k, { k: x.k, n: x.n, t: x.t, g: 'Eigene', own: true });
  return [...m.values()];
}
const exOf = k => exercises().find(e => e.k === k) || { k, n: k, t: 'w', g: '' };

// ---------------- numbers ----------------
const e1rm = (kg, r) => kg > 0 && r > 0 ? (r === 1 ? kg : kg * (1 + r / 30)) : 0; // Epley, like Strong
const vol = sets => sets.filter(s => s.done).reduce((a, s) => a + (+s.kg || 0) * (+s.r || 0), 0);
const doneSets = s => (s.ex || []).reduce((a, x) => a + x.sets.filter(y => y.done).length, 0);
const sessVol = s => (s.ex || []).reduce((a, x) => a + vol(x.sets), 0);
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
/** the sets of the last session that had this exercise ("Vorher" column) */
function prevSets(k, without = null) {
  for (const s of list) { if (s.id === without) continue; const x = (s.ex || []).find(y => y.k === k); if (x?.sets.some(y => y.done)) return x.sets.filter(y => y.done); }
  return [];
}
/** short form for the narrow "Vorher" column: the column heads already say kg / Wdh */
const prevTxt = (t, s) => !s ? '–' : t === 'time' ? `${+s.s || 0} s` : t === 'bw' ? `${+s.kg ? '+' + fmtNum(+s.kg, +s.kg % 1 ? 1 : 0) + ' × ' : ''}${+s.r || 0}` : `${fmtNum(+s.kg || 0, +s.kg % 1 ? 1 : 0)} × ${+s.r || 0}`;
const setTxt = (t, s) => !s ? '–' : t === 'time' ? `${+s.s || 0} s` : t === 'bw' ? `${+s.kg ? '+' + fmtNum(+s.kg, 1) + ' kg × ' : ''}${+s.r || 0} Wdh` : `${fmtNum(+s.kg || 0, 1)} kg × ${+s.r || 0}`;
const kgTxt = v => v >= 1000 ? fmtNum(v / 1000, 1) + ' t' : fmtNum(v) + ' kg';
const dayTxt = t => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

// ---------------- screens ----------------
function flash(t) { let f = $('#kflash'); if (!f) { f = document.createElement('div'); f.id = 'kflash'; f.className = 'pflash'; document.body.append(f); } f.textContent = t; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), 3200); }
function sheet(html) {
  const s = document.createElement('div'); s.className = 'psheet'; s.innerHTML = `<div class="psheetin">${html}</div>`;
  s.onclick = e => { if (e.target === s) s.remove(); }; document.body.append(s); return s;
}

function render() {
  if (W) return workoutScreen();
  const head = `<header class="ptop"><a class="pback" href="handy.html" title="Zur App">‹</a><div class="pbrand"><b>RIDEFRAME </b><span>Kraft</span></div>
    ${acc ? `<span class="ppill on"><i></i>${esc(acc.name)}</span>` : '<span class="ppill" title="In der App anmelden, dann sind die Workouts auf allen Geräten"><i></i>Nur hier</span>'}</header>
    <nav class="pseg kseg">${[['start', 'Training'], ['hist', 'Verlauf'], ['ex', 'Übungen']].map(([k, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</nav>`;
  el.innerHTML = head + `<main class="kmain">${tab === 'hist' ? histView() : tab === 'ex' ? exView() : startView()}</main>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  wireMain();
}

const hm = s => `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`; // week total as h:mm, fits the narrow column
function startView() {
  const wk = Date.now() - 7 * 864e5, week = list.filter(s => (s.start || s.date) > wk);
  const last = []; for (const s of list) if (!last.some(x => x.name === s.name) && last.length < 3) last.push(s);
  return `<section class="kcard kweek"><div class="label">Letzte 7 Tage</div><div class="kstats">
      <div><b>${week.length}</b><small>Workouts</small></div><div><b>${week.reduce((a, s) => a + doneSets(s), 0)}</b><small>Sätze</small></div>
      <div><b>${kgTxt(week.reduce((a, s) => a + sessVol(s), 0))}</b><small>Volumen</small></div><div><b>${hm(week.reduce((a, s) => a + (s.dur || 0), 0))}</b><small>Stunden</small></div></div>
      ${weekBars()}</section>
    <button class="btn kbig" id="kNew">Leeres Workout starten</button>
    ${tpls.length ? `<h3 class="ksec">Vorlagen</h3><div class="kgrid">${tpls.map((t, i) => `<div class="kcard ktpl" data-tpl="${i}"><b>${esc(t.name)}</b><span>${t.ex.map(x => esc(exOf(x.k).n)).join(', ')}</span><button class="kx" data-tdel="${i}" title="Vorlage löschen">✕</button></div>`).join('')}</div>` : ''}
    ${last.length ? `<h3 class="ksec">Wie letztes Mal</h3><div class="kgrid">${last.map(s => `<div class="kcard ktpl" data-again="${s.id}"><b>${esc(s.name)}</b><span>${dayTxt(s.start || s.date)} · ${(s.ex || []).map(x => esc(x.n)).join(', ')}</span></div>`).join('')}</div>` : ''}
    ${!list.length ? '<p class="hint" style="margin-top:18px">Noch keine Workouts. Starte ein leeres Workout, füge Übungen hinzu und hake jeden Satz ab. Beim nächsten Mal siehst du neben jedem Satz, was du letztes Mal geschafft hast.</p>' : ''}`;
}
function weekBars() { // the last 8 weeks: workouts per week, like Strong's dashboard
  const mon = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const now = mon(Date.now()), w = [...Array(8)].map((_, i) => now - (7 - i) * 7 * 864e5), n = w.map(t => list.filter(s => mon(s.start || s.date) === t).length), mx = Math.max(3, ...n);
  return `<div class="kbars">${n.map((v, i) => `<div><i style="height:${v / mx * 100}%"></i><small>${v || ''}</small><span>${new Date(w[i]).getDate()}.${new Date(w[i]).getMonth() + 1}.</span></div>`).join('')}</div>`;
}
function histView() {
  if (!list.length) return '<p class="hint">Noch keine Workouts gespeichert.</p>';
  let mon = '';
  return list.map(s => {
    const m = new Date(s.start || s.date).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }), h = m !== mon ? `<h3 class="ksec">${m}</h3>` : ''; mon = m;
    return h + `<div class="kcard khist" data-open="${s.id}"><div class="khh"><b>${esc(s.name)}</b><span>${dayTxt(s.start || s.date)}</span></div>
      <div class="khm"><span>⏱ ${fmtTime(s.dur || 0)}</span><span>${kgTxt(sessVol(s))}</span><span>${doneSets(s)} Sätze</span>${s.prs ? `<span class="kpr">🏆 ${s.prs}</span>` : ''}${s.strava ? '<span>Strava ✓</span>' : ''}</div>
      <div class="khx">${(s.ex || []).map(x => { const d = x.sets.filter(y => y.done); if (!d.length) return ''; const best = d.slice().sort((a, b) => e1rm(+b.kg, +b.r) - e1rm(+a.kg, +a.r) || (+b.r || +b.s) - (+a.r || +a.s))[0];
        return `<div><span>${d.length} × ${esc(x.n)}</span><span>${setTxt(x.t, best)}</span></div>`; }).join('')}</div></div>`;
  }).join('');
}
function exView() {
  const used = new Set(list.flatMap(s => (s.ex || []).map(x => x.k)));
  const all = exercises().sort((a, b) => used.has(b.k) - used.has(a.k) || a.n.localeCompare(b.n, 'de'));
  return `<input class="ksearch" id="kFind" placeholder="Übung suchen …" autocomplete="off">
    <div id="kExList">${all.map(e => { const b = used.has(e.k) ? bests(e.k) : null;
      return `<div class="kcard kexrow" data-ex="${e.k}" data-n="${esc(e.n.toLowerCase())}"><div><b>${esc(e.n)}</b><span>${esc(e.g || '')}${b ? ` · ${b.n}× gemacht` : ''}</span></div>
        <span class="kbest">${b ? e.t === 'time' ? b.sec + ' s' : e.t === 'bw' ? b.reps + ' Wdh' : fmtNum(b.rm, 1) + ' kg' : ''}</span></div>`; }).join('')}</div>`;
}

function wireMain() {
  const on = (s, f) => el.querySelectorAll(s).forEach(b => b.onclick = e => f(b, e));
  on('#kNew', () => begin({ name: defaultName(), ex: [] }));
  on('[data-tpl]', (b, e) => { if (e.target.dataset.tdel) return; const t = tpls[+b.dataset.tpl]; begin({ name: t.name, ex: t.ex.map(x => ({ k: x.k, n: exOf(x.k).n, t: exOf(x.k).t, sets: fromPrev(x.k, x.n || 3) })) }); });
  on('[data-tdel]', b => { if (!confirm('Vorlage löschen?')) return; tpls.splice(+b.dataset.tdel, 1); saveTpls(); render(); });
  on('[data-again]', b => { const s = list.find(x => x.id === b.dataset.again); begin({ name: s.name, ex: s.ex.map(x => ({ k: x.k, n: x.n, t: x.t, sets: fromPrev(x.k, x.sets.filter(y => y.done).length || 3) })) }); });
  on('[data-open]', b => sessionSheet(list.find(x => x.id === b.dataset.open)));
  on('[data-ex]', b => exSheet(b.dataset.ex));
  const f = $('#kFind'); if (f) f.oninput = () => { const q = f.value.trim().toLowerCase(); el.querySelectorAll('.kexrow').forEach(r => r.hidden = q && !r.dataset.n.includes(q)); };
}
const defaultName = () => { const h = new Date().getHours(); return h < 11 ? 'Morgen-Workout' : h < 17 ? 'Mittags-Workout' : 'Abend-Workout'; };
/** n new empty sets: last time's values show grey in the fields (like Strong); ✓ on an empty field takes them over */
const fromPrev = (k, n) => [...Array(Math.max(1, n))].map(() => ({ kg: '', r: '', s: '', done: false }));

// ---------------- workout ----------------
function begin(w) {
  W = { id: uid(), start: Date.now(), ...w }; saveDraft(); render();
  lockScreen();
}
let wake = null;
async function lockScreen() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && W) lockScreen(); });

function workoutScreen() {
  el.innerHTML = `<header class="ptop"><button class="pback" id="kMin" title="Abbrechen">✕</button><input class="kname" id="kName" value="${esc(W.name)}">
      <button class="btn ksmall" id="kFin">Fertig</button></header>
    <div class="kclock"><span id="kClock">${fmtTime((Date.now() - W.start) / 1000)}</span><span>${kgTxt(sessVol(W))} · ${doneSets(W)} Sätze</span></div>
    <main class="kmain kwork">${W.ex.map((x, i) => exBlock(x, i)).join('')}
      <button class="btn ghost kbig" id="kAdd">+ Übung hinzufügen</button>
      <button class="btn ghost ksmall kcancel" id="kDrop">Workout verwerfen</button></main>
    <div class="krest" id="kRest" hidden><div class="krbar"><i id="kRbar"></i></div><button data-rd="-15">−15</button><b id="kRt">0:00</b><button data-rd="15">+15</button><button id="kRskip">Weiter</button></div>`;
  wireWork(); paintRest();
}
function exBlock(x, i) {
  const prev = prevSets(x.k), cols = x.t === 'time' ? ['Sek'] : x.t === 'bw' ? ['+kg', 'Wdh'] : ['kg', 'Wdh'];
  return `<section class="kcard kex" data-i="${i}"><div class="kexh"><button class="kexn" data-chart="${x.k}">${esc(x.n)}</button><button class="kx" data-xmenu="${i}">⋯</button></div>
    ${x.note ? `<div class="hint">${esc(x.note)}</div>` : ''}
    <div class="kset khead ${x.t}"><span>Satz</span><span>Vorher</span>${cols.map(c => `<span>${c}</span>`).join('')}<span>✓</span></div>
    ${x.sets.map((s, j) => { const pv = prev[j] || prev[prev.length - 1]; return `<div class="kset ${x.t} ${s.done ? 'done' : ''}" data-j="${j}"><span class="kno" data-smenu="${j}">${s.warm ? 'W' : j + 1 - x.sets.slice(0, j).filter(y => y.warm).length}</span>
      <button class="kprev" data-fill="${j}">${prev[j] ? prevTxt(x.t, prev[j]) : '–'}</button>
      ${x.t === 'time' ? `<input inputmode="numeric" data-f="s" value="${s.s ?? ''}" placeholder="${pv?.s ?? ''}">`
        : `<input inputmode="decimal" data-f="kg" value="${s.kg === '' || s.kg == null ? '' : String(s.kg).replace('.', ',')}" placeholder="${pv ? String(pv.kg ?? '').replace('.', ',') : ''}"><input inputmode="numeric" data-f="r" value="${s.r ?? ''}" placeholder="${pv?.r ?? ''}">`}
      <button class="kchk" data-chk="${j}">✓</button></div>`; }).join('')}
    <button class="kaddset" data-addset="${i}">+ Satz${prev.length ? '' : ''}</button></section>`;
}
function wireWork() {
  $('#kName').onchange = e => { W.name = e.target.value.trim() || defaultName(); saveDraft(); };
  $('#kMin').onclick = () => { if (confirm('Workout verwerfen? Die Sätze gehen verloren.')) drop(); };
  $('#kDrop').onclick = () => { if (confirm('Workout verwerfen? Die Sätze gehen verloren.')) drop(); };
  $('#kAdd').onclick = () => pickExercise(k => { const e = exOf(k); W.ex.push({ k, n: e.n, t: e.t, sets: fromPrev(k, Math.max(1, prevSets(k).length || 3)) }); saveDraft(); render(); setTimeout(() => el.querySelector(`.kex[data-i="${W.ex.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); });
  $('#kFin').onclick = finishSheet;
  el.querySelectorAll('.kex').forEach(sec => {
    const x = W.ex[+sec.dataset.i];
    sec.querySelectorAll('.kset[data-j] input').forEach(inp => inp.oninput = () => { const s = x.sets[+inp.closest('.kset').dataset.j], v = inp.value.replace(',', '.'); s[inp.dataset.f] = v === '' ? '' : +v; saveDraft(); });
    sec.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => { const p = prevSets(x.k)[+b.dataset.fill]; if (!p) return; Object.assign(x.sets[+b.dataset.fill], { kg: p.kg, r: p.r, s: p.s }); saveDraft(); render(); });
    sec.querySelectorAll('[data-chk]').forEach(b => b.onclick = () => {
      const j = +b.dataset.chk, s = x.sets[j], row = b.closest('.kset');
      row.querySelectorAll('input').forEach(inp => { if (inp.value === '' && inp.placeholder !== '') { inp.value = inp.placeholder; s[inp.dataset.f] = +inp.placeholder.replace(',', '.'); } }); // empty = same as last time
      if (!s.done && (x.t === 'time' ? !(+s.s > 0) : !(+s.r > 0))) return flash(x.t === 'time' ? 'Erst die Sekunden eintragen.' : 'Erst die Wiederholungen eintragen.');
      s.done = !s.done; saveDraft();
      if (s.done) { const b0 = bests(x.k), rm = e1rm(+s.kg, +s.r); if (b0.n && ((x.t === 'w' && rm > b0.rm + .01) || (x.t === 'bw' && +s.r > b0.reps) || (x.t === 'time' && +s.s > b0.sec))) flash('🏆 Neuer Rekord!'); if (!s.warm) startRest(); }
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
  const s = sheet(`<div class="label">Satz ${j + 1}</div><div class="pfoot col"><button class="btn ghost" id="mWarm">${x.sets[j].warm ? 'Kein Aufwärmsatz' : 'Als Aufwärmsatz markieren'}</button><button class="btn danger" id="mDel">Satz löschen</button></div>`);
  $('#mWarm', s).onclick = () => { x.sets[j].warm = !x.sets[j].warm; saveDraft(); s.remove(); render(); };
  $('#mDel', s).onclick = () => { x.sets.splice(j, 1); if (!x.sets.length) x.sets.push({ kg: '', r: '', s: '', done: false }); saveDraft(); s.remove(); render(); };
}
function exMenu(i) {
  const x = W.ex[i], s = sheet(`<div class="label">${esc(x.n)}</div><div class="pfoot col">
    <button class="btn ghost" id="mUp" ${i ? '' : 'disabled'}>Nach oben</button><button class="btn ghost" id="mDown" ${i < W.ex.length - 1 ? '' : 'disabled'}>Nach unten</button>
    <button class="btn ghost" id="mSwap">Übung tauschen</button><button class="btn ghost" id="mNote">Notiz</button><button class="btn danger" id="mDel">Übung entfernen</button></div>`);
  const mv = d => { W.ex.splice(i + d, 0, W.ex.splice(i, 1)[0]); saveDraft(); s.remove(); render(); };
  $('#mUp', s).onclick = () => mv(-1); $('#mDown', s).onclick = () => mv(1);
  $('#mSwap', s).onclick = () => { s.remove(); pickExercise(k => { const e = exOf(k); Object.assign(x, { k, n: e.n, t: e.t }); x.sets = fromPrev(k, x.sets.length); saveDraft(); render(); }); };
  $('#mNote', s).onclick = () => { const n = prompt('Notiz zur Übung', x.note || ''); if (n != null) { x.note = n.trim(); saveDraft(); } s.remove(); render(); };
  $('#mDel', s).onclick = () => { if (x.sets.some(y => y.done) && !confirm('Übung mit abgehakten Sätzen entfernen?')) return; W.ex.splice(i, 1); saveDraft(); s.remove(); render(); };
}
function pickExercise(done) {
  const used = new Set(list.flatMap(s => (s.ex || []).map(x => x.k)));
  const all = exercises().sort((a, b) => used.has(b.k) - used.has(a.k) || a.g.localeCompare(b.g, 'de') || a.n.localeCompare(b.n, 'de'));
  const s = sheet(`<div class="label">Übung hinzufügen</div><input class="ksearch" id="pFind" placeholder="Suchen oder neue Übung eintippen …" autocomplete="off">
    <div class="kpick">${all.map(e => `<button data-k="${e.k}" data-n="${esc(e.n.toLowerCase())}"><b>${esc(e.n)}</b><small>${esc(e.g || '')}${used.has(e.k) ? ' · schon gemacht' : ''}</small></button>`).join('')}</div>
    <div id="pNew" hidden class="knew"><div class="label">Neue Übung</div><div class="pseg">${[['w', 'Gewicht'], ['bw', 'Körpergewicht'], ['time', 'Zeit']].map(([k, n], i) => `<button data-t="${k}" class="${i ? '' : 'on'}">${n}</button>`).join('')}</div><button class="btn" id="pMake">Anlegen</button></div>`);
  const f = $('#pFind', s); setTimeout(() => f.focus(), 60);
  let typ = 'w';
  s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { typ = b.dataset.t; s.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); });
  f.oninput = () => { const q = f.value.trim().toLowerCase(); let n = 0; s.querySelectorAll('.kpick [data-k]').forEach(b => { b.hidden = q && !b.dataset.n.includes(q); n += !b.hidden; }); $('#pNew', s).hidden = !q || s.querySelector(`.kpick [data-n="${CSS.escape(q)}"]`); };
  s.querySelectorAll('.kpick [data-k]').forEach(b => b.onclick = () => { s.remove(); done(b.dataset.k); });
  $('#pMake', s).onclick = () => { const n = f.value.trim(); if (!n) return; const e = { k: 'my_' + uid().slice(0, 8), n, t: typ, g: 'Eigene' }; mine.push(e); db.kvSet('kraftEx', mine).catch(() => {}); s.remove(); done(e.k); };
}

// rest timer: starts after every checked set; vibrates at the end (no sound)
function startRest() { const len = +S.kraftRest || 90; rest = { end: Date.now() + len * 1000, len }; paintRest(); }
function paintRest() {
  const r = $('#kRest'); if (!r) return;
  if (!rest) { r.hidden = true; return; }
  const left = Math.ceil((rest.end - Date.now()) / 1000);
  if (left <= 0) { rest = null; r.hidden = true; try { navigator.vibrate?.([300, 120, 300]); } catch {} flash('Pause vorbei · nächster Satz'); return; }
  r.hidden = false; $('#kRt').textContent = fmtTime(left); $('#kRbar').style.width = Math.max(0, left / rest.len * 100) + '%';
}
setInterval(() => { if (!W) return; const c = $('#kClock'); if (c) c.textContent = fmtTime((Date.now() - W.start) / 1000); paintRest(); }, 500);

function drop() { W = null; rest = null; db.kvDel('kraftDraft').catch(() => {}); try { wake?.release(); } catch {} tab = 'start'; render(); }

function finishSheet() {
  const sets = doneSets(W);
  if (!sets) return flash('Noch kein Satz abgehakt.');
  const open = W.ex.reduce((a, x) => a + x.sets.filter(y => !y.done).length, 0);
  const s = sheet(`<div class="label">Workout beenden</div><h2 class="display" style="font-size:30px;margin:8px 0 12px">${esc(W.name)}</h2>
    <div class="psum"><div><span>Dauer</span><b>${fmtTime((Date.now() - W.start) / 1000)}</b></div><div><span>Sätze</span><b>${sets}</b></div><div><span>Volumen</span><b>${kgTxt(sessVol(W))}</b></div></div>
    ${open ? `<p class="hint" style="margin-top:10px">${open} ${open === 1 ? 'Satz ist' : 'Sätze sind'} nicht abgehakt und ${open === 1 ? 'wird' : 'werden'} nicht gespeichert.</p>` : ''}
    <label class="prow" style="margin-top:10px">Als Vorlage merken<input id="fTpl" type="checkbox" class="toggle" ${tpls.some(t => t.name === W.name) ? '' : ''}></label>
    <div class="pfoot col"><button class="btn" id="fSave">Speichern</button><button class="btn ghost" id="fStrava">Speichern + Strava</button><button class="btn ghost" id="fBack">Weiter trainieren</button></div>`);
  $('#fBack', s).onclick = () => s.remove();
  const save = async () => {
    const w = { ...W, date: Date.now(), dur: Math.round((Date.now() - W.start) / 1000), ex: W.ex.map(x => ({ ...x, sets: x.sets.filter(y => y.done).map(({ done, ...y }) => ({ ...y, done: true })) })).filter(x => x.sets.length) };
    let prs = 0; for (const x of w.ex) { const b = bests(x.k); if (!b.n) continue; for (const y of x.sets) if ((x.t === 'w' && e1rm(+y.kg, +y.r) > b.rm + .01) || (x.t === 'bw' && +y.r > b.reps) || (x.t === 'time' && +y.s > b.sec)) { prs++; break; } }
    if (prs) w.prs = prs;
    if ($('#fTpl', s).checked) { tpls = tpls.filter(t => t.name !== w.name); tpls.unshift({ name: w.name, ex: w.ex.map(x => ({ k: x.k, n: x.sets.length })) }); saveTpls(); }
    list.unshift(w); await saveList(); import('./account.js').then(a => a.pushKraft?.(w)).catch(() => {});
    W = null; rest = null; db.kvDel('kraftDraft').catch(() => {}); try { wake?.release(); } catch {}
    return w;
  };
  $('#fSave', s).onclick = async () => { const w = await save(); s.remove(); tab = 'hist'; render(); sessionSheet(w); };
  $('#fStrava', s).onclick = async e => { e.target.disabled = true; const w = await save(); s.remove(); tab = 'hist'; render(); await toStrava(w); };
}

function stravaText(w) {
  return w.ex.map(x => { const d = x.sets.filter(y => !y.warm); const same = d.every(y => setTxt(x.t, y) === setTxt(x.t, d[0]));
    return `${x.n}: ${same ? `${d.length} × ${setTxt(x.t, d[0])}` : d.map(y => setTxt(x.t, y)).join(', ')}`; }).join('\n')
    + `\n\n${doneSets(w)} Sätze · ${kgTxt(sessVol(w))} Volumen${w.prs ? ` · 🏆 ${w.prs} ${w.prs === 1 ? 'Rekord' : 'Rekorde'}` : ''}\nAufgezeichnet mit RIDEFRAME Kraft.`;
}
async function toStrava(w) {
  const { stravaStatus, stravaConnect, stravaStrength } = await import('./stravaup.js');
  const st = await stravaStatus();
  if (!st.configured) { try { await navigator.clipboard.writeText(stravaText(w)); } catch {} flash('Strava ist auf diesem Server nicht eingerichtet. Text ist kopiert.'); return; }
  try {
    if (!st.connected && !(await stravaConnect())) throw new Error('Nicht mit Strava verbunden.');
    flash('Wird an Strava geschickt …');
    const url = await stravaStrength({ id: w.id, name: w.name, start: w.start, dur: w.dur, description: stravaText(w) });
    w.strava = url; await saveList(); import('./account.js').then(a => a.pushKraft?.(w)).catch(() => {});
    flash('Auf Strava ✓'); render(); window.open(url, '_blank');
  } catch (e) { flash(e.message || String(e)); }
}

function sessionSheet(w) {
  if (!w) return;
  const s = sheet(`<div class="label">${dayTxt(w.start || w.date)} · ${new Date(w.start || w.date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
    <h2 class="display" style="font-size:30px;margin:8px 0 12px">${esc(w.name)}</h2>
    <div class="psum"><div><span>Dauer</span><b>${fmtTime(w.dur || 0)}</b></div><div><span>Sätze</span><b>${doneSets(w)}</b></div><div><span>Volumen</span><b>${kgTxt(sessVol(w))}</b></div>${w.prs ? `<div><span>Rekorde</span><b>🏆 ${w.prs}</b></div>` : ''}</div>
    ${(w.ex || []).map(x => `<div class="kdet"><b data-chart="${x.k}">${esc(x.n)} ›</b>${x.sets.map((y, j) => `<div><span>${y.warm ? 'W' : j + 1}</span><span>${setTxt(x.t, y)}</span><span>${x.t === 'w' ? fmtNum(e1rm(+y.kg, +y.r), 1) + ' kg 1RM' : ''}</span></div>`).join('')}</div>`).join('')}
    <div class="pfoot col"><button class="btn" id="dAgain">Nochmal machen</button>${w.strava ? `<a class="btn ghost" href="${esc(w.strava)}" target="_blank">Auf Strava ansehen</a>` : '<button class="btn ghost" id="dStrava">Zu Strava hochladen</button>'}
      <button class="btn danger" id="dDel">Löschen</button></div>`);
  s.querySelectorAll('[data-chart]').forEach(b => b.onclick = () => exSheet(b.dataset.chart));
  $('#dAgain', s).onclick = () => { s.remove(); begin({ name: w.name, ex: w.ex.map(x => ({ k: x.k, n: x.n, t: x.t, sets: fromPrev(x.k, x.sets.length) })) }); };
  const st = $('#dStrava', s); if (st) st.onclick = async () => { st.disabled = true; await toStrava(w); s.remove(); };
  $('#dDel', s).onclick = async () => {
    if (!confirm('Workout endgültig löschen?')) return;
    try { const a = await import('./account.js'); await a.deleteKraftRemote?.(w.id); }
    catch { const g = (await db.kvGet('kraftGone').catch(() => null)) || []; g.push(w.id); await db.kvSet('kraftGone', g).catch(() => {}); } // offline: delete on the next sync
    list = list.filter(x => x.id !== w.id); await saveList(); s.remove(); render();
  };
}

// ---------------- exercise graph ----------------
function exSheet(k) {
  const e = exOf(k), h = history(k), b = bests(k);
  const metrics = e.t === 'w' ? [['rm', '1RM (geschätzt)', 'kg'], ['kg', 'Gewicht', 'kg'], ['vol', 'Volumen', 'kg'], ['reps', 'Wdh', '']]
    : e.t === 'bw' ? [['reps', 'Meiste Wdh', ''], ['totalReps', 'Wdh gesamt', ''], ['kg', 'Zusatz-kg', 'kg']] : [['sec', 'Längste Zeit', 's']];
  let m = metrics[0][0];
  const s = sheet(`<div class="label">${esc(e.g || 'Übung')}</div><h2 class="display" style="font-size:28px;margin:8px 0 12px">${esc(e.n)}</h2>
    ${h.length ? `<div class="pseg kmseg" style="grid-template-columns:repeat(${metrics.length},1fr)">${metrics.map(([k2, n]) => `<button data-m="${k2}">${n}</button>`).join('')}</div><div id="kChart"></div>
    <div class="psum">${e.t === 'w' ? `<div><span>Bestes 1RM</span><b>${fmtNum(b.rm, 1)} kg</b></div><div><span>Schwerstes</span><b>${fmtNum(b.kg, 1)} kg</b></div><div><span>Bestes Volumen</span><b>${kgTxt(b.vol)}</b></div>` : e.t === 'bw' ? `<div><span>Meiste Wdh</span><b>${b.reps}</b></div>` : `<div><span>Längste Zeit</span><b>${b.sec} s</b></div>`}<div><span>Gemacht</span><b>${b.n}×</b></div></div>
    <div class="label" style="margin:14px 0 6px">Verlauf</div><div class="kdet">${h.slice().reverse().slice(0, 30).map(p => `<div><span>${dayTxt(p.date)}</span><span>${p.sets.map(y => setTxt(e.t, y)).join(' · ')}</span></div>`).join('')}</div>`
    : '<p class="hint">Noch keine Sätze mit dieser Übung. Nach dem ersten Workout siehst du hier deinen Verlauf als Kurve.</p>'}`);
  const draw = () => { s.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === m)); const mm = metrics.find(x => x[0] === m); $('#kChart', s).innerHTML = chart(h.map(p => [p.date, p[m]]), mm[2]); };
  s.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { m = x.dataset.m; draw(); });
  if (h.length) draw();
}
function chart(pts, unit) {
  pts = pts.filter(p => p[1] > 0);
  if (!pts.length) return '<p class="hint">Keine Werte.</p>';
  const W0 = 320, H = 150, L = 34, R = 10, T = 12, B = 22, t0 = pts[0][0], t1 = pts[pts.length - 1][0], span = Math.max(1, t1 - t0);
  let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])); if (hi - lo < 1) { lo -= 1; hi += 1; } const pad = (hi - lo) * .12; lo = Math.max(0, lo - pad); hi += pad;
  const x = t => pts.length === 1 ? (L + W0 - R) / 2 : L + (t - t0) / span * (W0 - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(''), best = Math.max(...pts.map(p => p[1]));
  const lab = v => fmtNum(v, v < 20 && unit === 'kg' ? 1 : 0), cap = v => fmtNum(v, unit === 'kg' && v < 1000 ? 1 : 0), d = t => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
  return `<svg class="kchart" viewBox="0 0 ${W0} ${H}" role="img" aria-label="Verlauf">
    ${[hi, (hi + lo) / 2, lo].map(v => `<line x1="${L}" x2="${W0 - R}" y1="${y(v)}" y2="${y(v)}" class="kgrid"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${lab(v)}</text>`).join('')}
    <path d="${path}" class="kline"/>${pts.map(p => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="${p[1] === best ? 4.5 : 3}" class="${p[1] === best ? 'kdotb' : 'kdot'}"/>`).join('')}
    <text x="${L}" y="${H - 5}">${d(t0)}</text><text x="${W0 - R}" y="${H - 5}" text-anchor="end">${d(t1)}</text></svg>
    <div class="kchartcap">Letztes Mal <b>${cap(pts[pts.length - 1][1])} ${unit}</b> · Bestwert <b>${cap(best)} ${unit}</b></div>`;
}

window.addEventListener('beforeunload', () => { if (W) db.kvSet('kraftDraft', W).catch(() => {}); });
await load();
render();
if (W) flash('Dein offenes Workout läuft weiter.');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
