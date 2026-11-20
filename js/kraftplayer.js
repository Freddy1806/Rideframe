// Guided strength workouts on the Strength page (plans: kraftguide.js): the cards on the Workout tab, the intro sheet
// (level, steps, safety note), the full-screen player (get ready, reps, timed holds / negatives, rests, all on timestamps
// so the timers stay right after the phone was in the background), and the summary. The finished run is saved by
// kraft.js like any strength workout (ctx.save). A running run lives in kv 'kraftGuideDraft' and survives a reload.
import { db, uid } from './db.js';
import { fmtTime, esc } from './util.js';
import { PLANS, planOf, buildSteps, planSeconds, stepSec, efforts, sessionsOf, standing, targetsFor, bestsOf, toWorkout } from './kraftguide.js';

const $ = (s, r = document) => r.querySelector(s);
const DRAFT = 'kraftGuideDraft';
const svg = (p, w = 22) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICO = {
  pull: '<path d="M2 4h20"/><path d="M8 4v3.5l3 3M16 4v3.5l-3 3"/><circle cx="12" cy="9.5" r="1.6"/><path d="M12 11.5v5M12 16.5l-2.2 4.5M12 16.5l2.2 4.5"/>',
  push: '<path d="M2 20h20"/><circle cx="18.5" cy="8" r="1.7"/><path d="M16.8 9.6 4 15.5M14 11v9M4 15.5 3 20"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 6l-6 6 6 6"/>', skip: '<path d="M6 6l7 6-7 6zM17 6v12"/>',
  pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 5l12 7-12 7z"/>',
  snd: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>', warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
};
const mins = s => Math.round(s / 60);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

let ctx = null, G = null, P = null, steps = [], root = null, timer = 0, lastSave = 0, sig = '', wake = null, ac = null;

// ---------------- start tab: cards ----------------
/** the "Guided workouts" section for the Workout tab */
export function guideSection(list, draft) {
  return `<h3 class="ksec">Guided workouts</h3><div class="kgcards">${PLANS.map(p => {
    const st = standing(p, sessionsOf(list, p.id)), sec = planSeconds(buildSteps(p, st.lvl, st.tg)), run = draft?.id === p.id;
    return `<button class="kcard kgcard" data-guide="${p.id}"><span class="kgico">${svg(ICO[p.icon], 28)}</span>
      <span class="kgct"><b>${esc(p.name)}</b><small>${run ? '<em>In progress · tap to resume</em>' : `≈ ${mins(sec)} min · Level ${st.lvl}`}</small><span>${esc(p.line)}</span></span><span class="kgchev">›</span></button>`;
  }).join('')}</div>`;
}
export async function loadDraft() { return (await db.kvGet(DRAFT).catch(() => null)) || null; }

/** ctx from kraft.js: { list() → saved sessions, save(w) → saves like any workout, open(w) → shows it in the history, flash(t) } */
export function wireGuide(scope, c) {
  ctx = c;
  scope.querySelectorAll('[data-guide]').forEach(b => b.onclick = async () => {
    const d = await loadDraft();
    if (d && d.id === b.dataset.guide) return openPlayer(d, true);
    openIntro(b.dataset.guide);
  });
}

// ---------------- intro sheet ----------------
export function openIntro(id, c = ctx) {
  ctx = c; const p = planOf(id); if (!p) return;
  const sess = sessionsOf(ctx.list(), id), st = standing(p, sess);
  let lvl = st.lvl;
  const s = document.createElement('div'); s.className = 'psheet kgsheet';
  s.innerHTML = `<div class="psheetin"><div class="kgih"><span class="kgico">${svg(ICO[p.icon], 28)}</span><div><div class="label">Guided workout</div><h2 class="display kgih2">${esc(p.name).replace(/-/g, '\u2011')}</h2></div></div>
    <div class="kgmeta" id="giMeta"></div>
    <div class="olbl">You need</div><div class="kgneed">${p.need.map(n => `<span>${esc(n)}</span>`).join('')}</div>
    <div class="olbl">Level</div><div class="pseg kglv">${p.levels.map(L => `<button data-lv="${L.n}"><b>${L.n}</b><span>${esc(L.tag)}</span></button>`).join('')}</div>
    <p class="kglvhow" id="giHow"></p>
    <div class="olbl">Steps</div><ol class="kgsteps" id="giSteps"></ol>
    <p class="kgsafe">${svg(ICO.warn, 16)}<span>Stop if your elbow or shoulder hurts. Train this at most every other day.</span></p>
    <div class="pfoot col"><button class="btn" id="giGo">Start</button><button class="btn ghost" id="giX">Not now</button></div></div>`;
  s.onclick = e => { if (e.target === s) s.remove(); };
  document.body.append(s);
  const paint = () => {
    const tg = targetsFor(p, sess, lvl), st2 = buildSteps(p, lvl, tg), L = p.levels[lvl - 1];
    s.querySelectorAll('[data-lv]').forEach(b => b.classList.toggle('on', +b.dataset.lv === lvl));
    $('#giHow', s).innerHTML = `<b>${esc(L.name)}.</b> ${esc(L.how)}`;
    $('#giMeta', s).innerHTML = `<span><b>≈ ${mins(planSeconds(st2))}</b> min</span><span><b>${efforts(st2).length}</b> sets</span><span>Level <b>${lvl}</b></span>`;
    $('#giSteps', s).innerHTML = p.blocks.map((b, bi) => {
      const mine = st2.filter(x => x.n != null && st2.find(e => e.n === x.n && e.block === bi)), sec = mine.reduce((a, x) => a + stepSec(x), 0);
      const what = b.kind === 'reps' ? `${b.sets} × ${b.reps} reps` : `${b.rounds} rounds · left, then right · ${b.kind === 'hold' ? tg.hold : tg.neg} s ${b.kind === 'hold' ? 'hold' : 'lowering'}`;
      return `<li><i>${bi + 1}</i><div><b>${esc(b.name)}</b><span>${what} · ${b.rest} s rest</span></div><em>${fmtTime(sec)}</em></li>`;
    }).join('');
  };
  s.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { lvl = +b.dataset.lv; paint(); });
  $('#giX', s).onclick = () => s.remove();
  $('#giGo', s).onclick = () => { s.remove(); unlockAudio(); start(p, lvl, targetsFor(p, sess, lvl)); };
  paint();
}

// ---------------- the run ----------------
function start(p, lvl, tg) {
  const now = Date.now();
  openPlayer({ id: p.id, lvl, tg, wid: uid(), start: now, i: 0, t0: now, paused: 0, pauseMs: 0, res: {}, rep: {}, add: {}, seen: now }, false);
}
const tNow = () => G.paused || Date.now();
const total = () => Math.max(0, (tNow() - G.start - G.pauseMs) / 1000);
const stepEl = () => Math.max(0, (tNow() - G.t0) / 1000);
const lenOf = i => steps[i].kind === 'ready' || steps[i].kind === 'rest' ? steps[i].sec + (G.add[i] || 0) : 0;
function save(force) { if (!G) return; G.seen = Date.now(); if (force || G.seen - lastSave > 2000) { lastSave = G.seen; db.kvSet(DRAFT, G).catch(() => {}); } }

/** opens the player for a run; resumed = from a draft (after a reload it starts paused at the last moment seen) */
export function openPlayer(d, resumed, c = ctx) {
  ctx = c || ctx; G = d; P = planOf(G.id); if (!P) { db.kvDel(DRAFT).catch(() => {}); return; }
  G.add ||= {}; G.res ||= {}; G.rep ||= {};
  steps = buildSteps(P, G.lvl, G.tg);
  if (resumed && !G.paused) G.paused = Math.max(G.t0, G.seen || Date.now());
  root?.remove(); root = document.createElement('div'); root.className = 'kgp'; root.id = 'kgPlayer'; document.body.append(root);
  document.documentElement.classList.add('kgopen');
  lockScreen(); render(); save(true);
  clearInterval(timer); timer = setInterval(tick, 100);
}
function close() {
  clearInterval(timer); timer = 0; root?.remove(); root = null; G = null; document.documentElement.classList.remove('kgopen');
  try { wake?.release(); } catch {} wake = null;
}
async function lockScreen() { try { if (G && document.visibilityState === 'visible') wake = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (G && document.visibilityState === 'visible') { lockScreen(); tick(); } });

function go(i, t0 = Date.now()) { G.i = Math.max(0, Math.min(steps.length - 1, i)); G.t0 = t0; sig = ''; save(true); render(); }
/** get-ready and rest steps end on their own; after the background several can be over at once (efforts wait for Done) */
function catchUp(now) {
  let moved = false;
  for (;;) {
    const s = steps[G.i], len = lenOf(G.i);
    if (!len || now - G.t0 < len * 1000 || G.i >= steps.length - 1) break;
    const late = now - G.t0 - len * 1000;
    if (late < 1500) s.kind === 'ready' ? signal('go') : signal('restEnd');
    G.t0 += len * 1000; G.i++; moved = true;
  }
  if (moved) { sig = ''; save(true); render(); }
}
function tick() {
  if (!G || !root) return;
  if (!G.paused) catchUp(Date.now());
  paint(); save(false);
}

// ---------------- sound and vibration ----------------
const soundOn = () => { try { return localStorage.getItem('rfGuideSound') !== '0'; } catch { return true; } };
function unlockAudio() { try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); ac.resume?.(); } catch {} }
function beep(f = 660, d = .12, v = .07) {
  if (!soundOn()) return; unlockAudio(); if (!ac) return;
  try { const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime; o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + .02); } catch {}
}
const buzz = p => { try { navigator.vibrate?.(p); } catch {} };
function signal(k) {
  if (k === 'tick') { beep(660, .1); buzz(40); }
  else if (k === 'go') { beep(990, .28, .09); buzz(180); }
  else if (k === 'restEnd') { beep(880, .22, .08); buzz([90, 60, 90]); }
  else if (k === 'target') { beep(1180, .2, .08); beep(1480, .3, .06); buzz([60, 40, 140]); }
}

// ---------------- the player ----------------
const effortOf = n => steps.find(s => s.n === n && s.kind !== 'ready' && s.kind !== 'rest');
const nEff = () => efforts(steps).length;
function nextTxt() {
  const s = steps[G.i], e = effortOf(s.n + 1);
  return [s.kind === 'rest' ? 'Up next' : 'Then', e ? effTxt(e) : 'Finish · summary'];
}
const effTxt = e => e.kind === 'reps' ? `${e.label} · ${e.reps} reps` : `${cap(e.title)} · ${e.label} ${e.target} s`;
function render() {
  if (!root || !G) return;
  const s = steps[G.i], e = s.kind === 'ready' || s.kind === 'rest' ? effortOf(s.kind === 'rest' ? s.n + 1 : s.n) : s, kind = s.kind;
  const head = kind === 'rest' ? restHead(s) : `<div class="kglabel">${kind === 'ready' ? 'Get ready · ' : ''}${esc(e.label)}${e.side ? ` · Round ${e.round} of ${e.of}` : ''}</div>
      <h1 class="kgtitle">${esc(e.title)}</h1><p class="kgwhat">${esc(e.what)}</p><p class="kgcue">${esc(e.how ? e.how + ' ' : '')}${esc(e.cue)}</p>`;
  const act = kind === 'ready' ? `<button class="btn ghost kga1" data-a="skip">Start now</button>`
    : kind === 'reps' ? `<div class="kgreps"><button class="kgpm" data-a="rm" aria-label="One rep less">−</button><button class="btn kga1" data-a="done">${svg(ICO.check, 20)}Done</button><button class="kgpm" data-a="rp" aria-label="One rep more">+</button></div>`
    : kind === 'rest' ? `<div class="kgreps"><button class="btn ghost kga2" data-a="more">+15 s</button><button class="btn kga2" data-a="skip">Skip rest</button></div>`
    : `<button class="btn kga1" data-a="done">${svg(ICO.check, 20)}Done${kind === 'hold' ? ' · let go' : ' · at the bottom'}</button>`;
  const [nl, nt] = nextTxt();
  root.dataset.kind = kind; root.classList.toggle('paused', !!G.paused);
  root.innerHTML = `<div class="kgbar"><i id="kgBar"></i></div>
    <header class="kgtop"><button class="kgib" data-a="close" aria-label="Close" title="Close">${svg(ICO.x)}</button>
      <div class="kgpos"><span>Step <b id="kgStep">${(e?.n ?? s.n) + 1}</b> / ${nEff()}</span><span id="kgTime">${fmtTime(total())}</span></div>
      <button class="kgib" data-a="sound" aria-label="Sound" aria-pressed="${soundOn()}" title="Sound">${svg(soundOn() ? ICO.snd : ICO.mute)}</button></header>
    <section class="kghead">${head}</section>
    <div class="kgring"><div class="kgrs"><svg viewBox="0 0 200 200"><circle class="kgtrack" cx="100" cy="100" r="88"/><circle class="kgarc" id="kgArc" cx="100" cy="100" r="88" pathLength="1000"/></svg>
      <div class="kgnum"><small id="kgPre"></small><b id="kgNum"></b><small id="kgSub"></small></div></div></div>
    <div class="kgact">${act}</div>
    <div class="kgnext"><span>${nl}</span><b>${esc(nt)}</b></div>
    <nav class="kgnav"><button data-a="back">${svg(ICO.back)}<span>Back</span></button><button data-a="pause" class="kgpp">${svg(G.paused ? ICO.play : ICO.pause)}<span>${G.paused ? 'Resume' : 'Pause'}</span></button><button data-a="next">${svg(ICO.skip)}<span>Skip</span></button></nav>
    ${G.paused ? `<button class="kgpaused" data-a="pause"><b>Paused</b><span>${svg(ICO.play, 18)} Tap to resume</span></button>` : ''}`;
  root.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act2(b.dataset.a));
  paint();
}
function restHead(s) {
  const e = effortOf(s.n), v = G.res[s.n];
  const rec = v == null ? '<span class="kgrec0">Skipped</span>' : `<span class="kgrecv"><button class="kgpm sm" data-a="cm" aria-label="Less">−</button><b>${v}${e.kind === 'reps' ? ' reps' : ' s'}</b><button class="kgpm sm" data-a="cp" aria-label="More">+</button></span>`;
  return `<div class="kglabel">${v == null ? 'Set skipped' : 'Set done'}</div><h1 class="kgtitle">REST</h1>
    <div class="kgrec"><span>${esc(e.side ? `${cap(e.title)} · ${e.label}` : `${e.label} · ${cap(e.title)}`)}</span>${rec}</div>
    <p class="kgcue">Shake out the arms. The next set starts by itself.</p>`;
}
function paint() {
  if (!root || !G) return;
  const s = steps[G.i], el = stepEl(), arc = $('#kgArc', root), num = $('#kgNum', root), sub = $('#kgSub', root), pre = $('#kgPre', root);
  let frac = 1;
  if (s.kind === 'ready' || s.kind === 'rest') {
    const len = lenOf(G.i), left = Math.max(0, len - el), sec = Math.ceil(left - 1e-6);
    frac = left / len; num.textContent = s.kind === 'rest' ? fmtTime(sec) : sec; sub.textContent = s.kind === 'rest' ? 'rest' : 'get ready'; pre.textContent = '';
    if (!G.paused && sec >= 1 && sec <= 3 && sig !== G.i + ':' + sec) { sig = G.i + ':' + sec; signal('tick'); }
  } else if (s.kind === 'reps') {
    const r = G.rep[s.n] ?? s.reps; num.textContent = r; sub.textContent = r === 1 ? 'rep' : 'reps'; pre.textContent = r === s.reps ? 'target' : `target ${s.reps}`;
  } else {
    const t = Math.floor(el); frac = Math.min(1, el / s.target); num.textContent = t; pre.textContent = s.kind === 'neg' ? 'lowering' : 'holding';
    const over = el >= s.target; sub.textContent = over ? `target ${s.target} s ✓` : `of ${s.target} s`;
    root.classList.toggle('over', over);
    if (over && !G.paused && sig !== G.i + ':t') { sig = G.i + ':t'; if (el - s.target < 1.5) signal('target'); }
  }
  if (s.kind !== 'hold' && s.kind !== 'neg') root.classList.remove('over');
  arc.style.strokeDashoffset = String(1000 * (1 - Math.max(0, Math.min(1, frac))));
  const T = $('#kgTime', root); if (T) T.textContent = fmtTime(total());
  const all = planSeconds(steps), done = steps.slice(0, G.i).reduce((a, x, i) => a + stepSec(x) + (G.add[i] || 0), 0) + Math.min(el, stepSec(s) + (G.add[G.i] || 0));
  const bar = $('#kgBar', root); if (bar) bar.style.width = Math.min(100, done / all * 100) + '%';
}
function act2(a) {
  const s = steps[G.i];
  if (a === 'close') return closeSheet();
  if (a === 'sound') { try { localStorage.setItem('rfGuideSound', soundOn() ? '0' : '1'); } catch {} if (soundOn()) { unlockAudio(); beep(880, .1); } return render(); }
  if (a === 'pause') { if (G.paused) { const d = Date.now() - G.paused; G.t0 += d; G.pauseMs += d; G.paused = 0; unlockAudio(); } else G.paused = Date.now(); save(true); return render(); }
  if (G.paused && a !== 'back' && a !== 'next') { const d = Date.now() - G.paused; G.t0 += d; G.pauseMs += d; G.paused = 0; } // any action goes on
  if (a === 'rm' || a === 'rp') { G.rep[s.n] = Math.max(0, Math.min(99, (G.rep[s.n] ?? s.reps) + (a === 'rp' ? 1 : -1))); save(true); return paint(); }
  if (a === 'cm' || a === 'cp') { const v = G.res[s.n]; if (v == null) return; G.res[s.n] = Math.max(0, Math.min(999, v + (a === 'cp' ? 1 : -1))); save(true); return render(); }
  if (a === 'more') { G.add[G.i] = (G.add[G.i] || 0) + 15; save(true); return paint(); }
  if (a === 'done') {
    G.res[s.n] = s.kind === 'reps' ? (G.rep[s.n] ?? s.reps) : Math.floor(stepEl());
    buzz(60);
    if (G.i >= steps.length - 1) return finish();
    return go(G.i + 1);
  }
  if (a === 'skip' || a === 'next') {
    if (s.kind !== 'ready' && s.kind !== 'rest') delete G.res[s.n];
    if (G.i >= steps.length - 1) return finish();
    if (G.paused) G.paused = Date.now();
    return go(G.i + 1, G.paused || Date.now());
  }
  if (a === 'back') {
    // from a rest: redo the effort just done; from a get-ready or an effort: the previous effort
    const n = s.kind === 'rest' ? s.n : s.n - 1, i = steps.findIndex(x => x.kind === 'ready' && x.n === Math.max(0, n));
    if (G.paused) G.paused = Date.now();
    return go(i, G.paused || Date.now());
  }
}
function closeSheet() {
  const any = Object.keys(G.res).length;
  const m = document.createElement('div'); m.className = 'psheet kgclose';
  m.innerHTML = `<div class="psheetin"><div class="label">Guided workout</div><h2 class="display kgih2" style="margin:8px 0 6px">End workout?</h2>
    <p class="hint">${any ? `${any} ${any === 1 ? 'set is' : 'sets are'} done.` : 'No set done yet.'}</p>
    <div class="pfoot col"><button class="btn" id="kcKeep">Keep going</button>${any ? '<button class="btn ghost" id="kcSave">Finish and save</button>' : ''}<button class="btn danger" id="kcDrop">Discard</button></div></div>`;
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.append(m);
  $('#kcKeep', m).onclick = () => m.remove();
  const sv = $('#kcSave', m); if (sv) sv.onclick = () => { m.remove(); finish(); };
  $('#kcDrop', m).onclick = () => { m.remove(); db.kvDel(DRAFT).catch(() => {}); close(); ctx?.refresh?.(); };
}

// ---------------- the end ----------------
async function finish() {
  if (G.paused) { G.pauseMs += Date.now() - G.paused; G.paused = 0; }
  G.dur = total();
  const prevAll = sessionsOf(ctx.list(), P.id), w = toWorkout(P, G, steps, G.res);
  const plan = P, g = { ...G }, st = steps;
  if (!w.ex.length) { db.kvDel(DRAFT).catch(() => {}); close(); return; }
  await ctx.save(w);
  await db.kvDel(DRAFT).catch(() => {});
  clearInterval(timer); timer = 0; G = null;
  summary(plan, g, st, w, prevAll);
}
function summary(p, g, st, w, prevAll) {
  const prev = prevAll[0], b = bestsOf(p, w), pb = prev ? bestsOf(p, prev) : null, now = standing(p, [w, ...prevAll]), L = p.levels[g.lvl - 1];
  const cell = (k, side) => { const v = b[k][side]; if (!v) return '<td><b>–</b></td>'; const d = pb && pb[k][side] ? v - pb[k][side] : null;
    return `<td><b>${v} s</b>${d == null ? '' : `<small class="kdelta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} s</small>`}</td>`; };
  const done = Object.keys(g.res).length;
  const msg = now.up ? `<div class="kglvup">${svg(ICO.up, 20)}<div><b>Level up earned</b><span>Two strong sessions in a row. Next time: <i>Level ${now.lvl} · ${esc(p.levels[now.lvl - 1].name)}</i></span></div></div>`
    : now.real ? `<div class="kglvup">${svg(ICO.up, 20)}<div><b>Top targets reached</b><span>${esc(p.real)}</span></div></div>`
    : g.lvl === 3 && (now.tg.hold > g.tg.hold || now.tg.neg > g.tg.neg) ? `<div class="kglvup">${svg(ICO.up, 20)}<div><b>Targets go up</b><span>Next time: hold ${now.tg.hold} s, negative ${now.tg.neg} s</span></div></div>` : '';
  root.dataset.kind = 'sum'; root.classList.remove('paused', 'over');
  root.innerHTML = `<div class="kgsum">
    <div class="kgsumh"><span class="kgok">${svg(ICO.check, 30)}</span><div class="label">Workout complete</div><h1 class="display">${esc(p.name).replace(/-/g, '\u2011')}</h1><p>Level ${g.lvl} · ${esc(L.name)}</p></div>
    <div class="psum kgsumst"><div><span>Total time</span><b>${fmtTime(w.dur)}</b></div><div><span>Sets</span><b>${done}<small> / ${efforts(st).length}</small></b></div></div>
    <table class="kgtab"><thead><tr><th></th><th>Left</th><th>Right</th></tr></thead><tbody>
      <tr><th>Best hold</th>${cell('hold', 'L')}${cell('hold', 'R')}</tr><tr><th>Best negative</th>${cell('neg', 'L')}${cell('neg', 'R')}</tr></tbody></table>
    <p class="kgcmp">${prev ? `Compared with ${new Date(prev.start || prev.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (Level ${prev.guide?.lvl || 1})` : 'Your first session. Next time you will see the difference here.'}</p>
    ${msg}
    <div class="kgsumf"><button class="btn kbig" id="kgDone">Done</button><p class="kgsaved">Saved to your history.</p></div></div>`;
  $('#kgDone', root).onclick = () => { close(); ctx?.open?.(w); };
}
