// The Today page's top (25.11., owner: "Du musst es komplett neu denken, so wie das Garmin auch macht. Sleep Score, was heute für ein
// Training ansteht … eher so dein Trainingscoach"): the page he opens every morning, in this order:
//   1. How am I today: one readiness value with a word, one sentence why and its inputs as chips (js/readiness.js)
//   2. What is on today: the planned session with Start (js/planlib.js, tools/plan-api.mjs), a rest day, or a quiet suggestion;
//      the week strip Mon-Sun (planned vs done)
//   3. What changed: 2-4 lines from the data (js/insights.js)
// The arrangeable cards follow (js/cards.js). Everything here only reads what the phone has and the account's answers.
import { esc, fmtNum } from './util.js';
import { MODES, icon } from './theme.js';
import { keyOf, nameOf } from './feed.js';
import * as C from './cardlib.js';
import { readiness, suggestion } from './readiness.js';
import { week, startHref, dayKey, monday, addDays, KIND_NAME } from './planlib.js';
import { insights } from './insights.js';
import { health, body, getJSON, svg, IC } from './cards.js';

const DAY = 864e5, $ = (s, r = document) => r.querySelector(s);
const KIND_ICON = { ride: 'ride', run: 'run', strength: 'kraft', rest: 'rest', other: 'other' };
const kindIcon = (k, cls) => k === 'rest' ? `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>` : icon(KIND_ICON[k] === 'kraft' ? 'kraft' : KIND_ICON[k] || 'other', cls);
const kindMode = k => k === 'strength' ? 'kraft' : k === 'ride' ? 'ride' : k === 'run' ? 'run' : 'other';
const fresh = (day, now) => { if (!day) return false; const [y, m, d] = day.split('-').map(Number); return (new Date(now).setHours(0, 0, 0, 0) - new Date(y, m - 1, d).getTime()) / DAY <= 1; }; // today's or yesterday's value

/** the readiness inputs from the account's health answer and the activities: only fresh values, form and yesterday only with recent training */
export function inputsOf(acts, ld, h, now = Date.now()) {
  const x = {}, L = h?.latest || {};
  if (L.bb && fresh(L.bb.day, now)) x.bb = L.bb.v;
  if (L.ss && fresh(L.ss.day, now)) x.sleep = L.ss.v;
  const days = (h?.days || []).filter(d => d.rhr > 0);
  if (days.length && fresh(days[0].day, now)) { const prev = days.slice(1, 8); if (prev.length >= 3) x.rhr = { v: days[0].rhr, avg: prev.reduce((s, d) => s + d.rhr, 0) / prev.length }; }
  if (acts.some(a => now - a.date < 28 * DAY)) {
    const F = C.fitnessSummary(acts, ld, { now }); if (!F.empty) x.form = F.tsb;
    const d0 = new Date(now).setHours(0, 0, 0, 0), y0 = new Date(d0); y0.setDate(y0.getDate() - 1);
    x.load = { y: acts.filter(a => a.date >= y0.getTime() && a.date < d0).reduce((s, a) => s + ld(a), 0), ctl: F.empty ? 0 : F.ctl };
  }
  return x;
}

const greeting = (name, now = new Date()) => { const h = now.getHours(); return `Good ${h < 5 ? 'evening' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}${name ? ', ' + esc(String(name).trim().split(/[\s._@-]+/).find(Boolean) || name) : ''}`; };
const MISS = { bb: ['Body battery', 'from your watch', 'handy.html#settings-watch'], rhr: ['Resting HR', 'from your watch', 'handy.html#settings-watch'], form: ['Form', 'record training', null], load: ['Yesterday', 'record training', null] };

/** the hero: a ring with the value, the word, the sentence, the chips */
export function heroHTML(r, { acc, loading = false } = {}) {
  if (loading) return `<section class="tdhero tdload" aria-busy="true" aria-label="Readiness, loading"><div class="tdring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="tdtrack" cx="60" cy="60" r="52"/></svg></div><div class="tdhw"><span class="cdsk"><i></i><i></i></span></div></section>`;
  const v = r.score, band = v == null ? 'none' : v >= 75 ? 'top' : v >= 55 ? 'ok' : v >= 35 ? 'easy' : 'rest', C2 = 2 * Math.PI * 52;
  const chips = r.parts.map(p => `<li class="tdchip"><span>${esc(p.label)}</span><b>${esc(p.value)}</b></li>`);
  for (const k of r.missing) {
    if (k === 'sleep') { chips.push('<li><button type="button" class="tdchip tdmiss" id="tdSleep" aria-expanded="false"><span>Sleep</span><b>connect</b></button></li>'); continue; }
    if (!MISS[k] || (!acc && (k === 'bb' || k === 'rhr'))) continue;
    const [l, how, href] = MISS[k]; chips.push(`<li>${href ? `<a class="tdchip tdmiss" href="${href}">` : '<span class="tdchip tdmiss">'}<span>${l}</span><b>${how}</b>${href ? '</a>' : '</span>'}</li>`);
  }
  return `<section class="tdhero tdb-${band}" aria-labelledby="tdWord">
    <div class="tdring" role="img" aria-label="${v == null ? 'No readiness value yet' : `Readiness ${v} of 100`}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="tdtrack" cx="60" cy="60" r="52"/>${v == null ? '' : `<circle class="tdarc" cx="60" cy="60" r="52" stroke-dasharray="${(v / 100 * C2).toFixed(1)} ${C2.toFixed(1)}" transform="rotate(-90 60 60)"/>`}</svg>
      <span class="tdnum">${v == null ? '–' : v}</span><span class="tdof">readiness</span></div>
    <div class="tdhw"><h2 id="tdWord">${esc(r.word)}</h2><p class="tdwhy">${esc(r.why)}</p></div>
    <ul class="tdchips" aria-label="What the value is made of">${chips.join('')}</ul>
    <p class="tdsleep" id="tdSleepTxt" hidden>RIDEFRAME has no sleep source yet: the watch app cannot read Garmin's sleep score. Readiness works without it.</p></section>`;
}

/** what is on today: the entries of today with Start, a rest day, or a suggestion; then the week strip */
export function planHTML({ entries = null, acts = [], r = null, form = null, acc = null, today = dayKey(Date.now()), msg = '' } = {}) {
  const T = (entries || []).filter(e => e.day === today), actDays = new Map(); for (const a of acts) { const k = dayKey(a.date); actDays.set(k, (actDays.get(k) || 0) + 1); }
  const doneAct = e => e.done && acts.find(a => String(a.id) === String(e.done) || 'watch-' + a.watch === e.done);
  const entry = (e, first) => { const href = startHref(e), d = doneAct(e), m = kindMode(e.kind);
    return `<div class="tdplan${e.done ? ' tddone' : ''}" style="--mc:${MODES[m].color};--mcl:${MODES[m].light}">
      <span class="tdpi">${kindIcon(e.kind, 'tdpico')}</span><div class="tdpt"><b>${esc(e.title)}</b><small>${[KIND_NAME[e.kind], e.minutes ? `${e.minutes} min` : '', e.by === 'coach' ? 'from your coach' : ''].filter(Boolean).join(' · ')}</small>${e.note ? `<p>${esc(e.note)}</p>` : ''}</div>
      ${e.done ? `<a class="tdok" href="${d ? 'aktivitaeten.html?open=' + encodeURIComponent(keyOf(d)) : 'aktivitaeten.html'}">${svg('<path d="m5 12 5 5 9-10"/>')}Done</a>` : e.kind === 'rest' ? '' : href ? `<a class="btn ${first ? '' : 'ghost '}tdstart" href="${href}">Start</a>` : ''}</div>`; };
  let body;
  if (!acc) { const s = suggestion(r, form); body = `<div class="tdempty"><p><b>Plan your week</b>Sign in to keep a training plan: from you, or from your coach through the Claude connector.</p></div>${sugHTML(s, false)}`; }
  else if (entries == null) body = '<div class="tdempty"><span class="cdsk"><i></i></span></div>';
  else if (!T.length) { const s = suggestion(r, form); body = `<div class="tdempty"><p><b>Nothing planned today</b>${s.kind === 'rest' ? 'Your readiness suggests a rest day.' : 'A quiet suggestion from your readiness and form:'}</p></div>${sugHTML(s, true)}`; }
  else if (T.every(e => e.kind === 'rest')) body = `<div class="tdplan tdrest"><span class="tdpi">${kindIcon('rest', 'tdpico')}</span><div class="tdpt"><b>${esc(T[0].title === 'Rest day' ? 'Rest day' : T[0].title)}</b><small>Recovery is part of the plan.${T[0].note ? ' ' + esc(T[0].note) : ''}</small></div></div>`;
  else { const open = T.filter(e => e.kind !== 'rest'); const first = open.find(e => !e.done); body = open.map(e => entry(e, e === first)).join(''); }
  const W = week(today, entries || [], actDays, today);
  const strip = `<ol class="tdweek" aria-label="This week">${W.map(d => { const dn = new Date(...d.day.split('-').map((v, i) => i === 1 ? v - 1 : +v));
    const planned = d.entries.filter(e => e.kind !== 'rest'), rest = d.entries.some(e => e.kind === 'rest'), done = planned.filter(e => e.done).length;
    const state = planned.length ? (done >= planned.length ? 'done' : d.past ? 'missed' : 'planned') : rest ? 'rest' : d.acts ? 'extra' : '';
    const say = [planned.length ? `${planned.length} planned${done ? `, ${done} done` : ''}` : '', rest ? 'rest day' : '', !planned.length && d.acts ? `${d.acts} done` : ''].filter(Boolean).join(', ') || 'nothing';
    return `<li><a href="training.html?day=${d.day}" class="tdday${d.today ? ' now' : ''}${d.past ? ' past' : ''}" aria-label="${dn.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}: ${say}"${d.today ? ' aria-current="date"' : ''}>
      <small>${dn.toLocaleDateString('en-GB', { weekday: 'narrow' })}</small><b>${dn.getDate()}</b><i class="tddot ${state}" aria-hidden="true"></i></a></li>`; }).join('')}</ol>`;
  return `<section class="tdtoday" aria-labelledby="tdTodayH"><div class="tdh"><h2 class="label" id="tdTodayH">Today</h2><a class="tdlink" href="training.html">Plan ›</a></div>${body}${msg ? `<p class="phint" role="status">${esc(msg)}</p>` : ''}${strip}</section>`;
}
function sugHTML(s, canPlan) {
  if (s.kind === 'rest') return `<div class="tdsug"><div><b>Rest day</b><small>${esc(s.why)}</small></div>${canPlan ? '<button type="button" class="btn ghost ksmall" id="tdPlanIt">Plan it</button>' : ''}</div>`;
  return `<div class="tdsug"><div><b>${esc(s.title)}${s.minutes ? ` · ${s.minutes} min` : ''}</b><small>${esc(s.why)}</small></div>${canPlan ? `<div class="tdsugb"><button type="button" class="btn ghost ksmall" id="tdPlanIt">Plan it</button><a class="btn ghost ksmall" href="training.html?day=${dayKey(Date.now())}&add=1">Plan something</a></div>` : ''}</div>`;
}
export function whatHTML(list) {
  if (!list.length) return '';
  return `<section class="tdwhat" aria-labelledby="tdWhatH"><h2 class="label" id="tdWhatH">What changed</h2><ul>${list.map(i => `<li><a href="${i.href}" class="tdins tdi-${i.k}"><span>${esc(i.text)}</span><i aria-hidden="true">›</i></a></li>`).join('')}</ul></section>`;
}

/** fills the three blocks; ctx as js/cards.js mountOverview (acts, P, S, acc); boxes: { hero, plan, what } */
export function mountToday(B, ctx) {
  ctx.ld ||= C.loads(ctx.P);
  const now = Date.now(), today = dayKey(now), st = { h: undefined, entries: null, msg: '', r: null, form: null };
  if (B.hello) B.hello.innerHTML = `<span class="label">${new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span><h1>${greeting(ctx.acc?.name)}</h1>`;
  const drawHero = () => {
    const x = inputsOf(ctx.acts, ctx.ld, st.h, now); st.r = readiness(x); st.form = x.form ?? null;
    B.hero.innerHTML = heroHTML(st.r, { acc: ctx.acc });
    const sl = $('#tdSleep', B.hero); if (sl) sl.onclick = () => { const t = $('#tdSleepTxt', B.hero); t.hidden = !t.hidden; sl.setAttribute('aria-expanded', String(!t.hidden)); };
  };
  const drawPlan = () => {
    B.plan.innerHTML = planHTML({ entries: st.entries, acts: ctx.acts, r: st.r, form: st.form, acc: ctx.acc, today, msg: st.msg });
    const pi = $('#tdPlanIt', B.plan); if (pi) pi.onclick = async () => { const s = suggestion(st.r, st.form); pi.disabled = true;
      try { const j = await send('POST', '/api/account/plan', { day: today, kind: s.kind === 'other' ? 'other' : s.kind, title: s.title, ...(s.minutes ? { minutes: s.minutes } : {}) }); st.entries = [...(st.entries || []), j.entry]; st.msg = ''; }
      catch (e) { st.msg = e.message || 'Not saved. Check your connection.'; } drawPlan(); };
  };
  const send = async (m, url, b) => { const r = await fetch(url, { method: m, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-RF-Token': ctx.acc?.token || '' }, body: JSON.stringify(b) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Not saved.'); return j; };
  if (ctx.acc) { B.hero.innerHTML = heroHTML(null, { loading: true });
    Promise.race([health(ctx), new Promise(ok => setTimeout(() => ok(null), 4000))]).then(h => { st.h = h; }, () => { st.h = null; }).then(() => { drawHero(); drawPlan(); });
    const m0 = monday(today); getJSON('plan', `/api/account/plan?from=${m0}&to=${addDays(m0, 6)}`, ctx.acc, 0).then(j => { st.entries = j.entries || []; }, () => { st.entries = []; st.msg = 'The plan could not be loaded right now.'; }).then(() => { if (st.r) drawPlan(); });
  } else drawHero();
  drawPlan();
  // what changed: from the activities right away, with the weight once the account answers
  const what = async () => {
    const last = ctx.acts[0], fit = C.fitnessSummary(ctx.acts, ctx.ld), recs = C.recentRecords(ctx.acts);
    const L = last ? { name: nameOf(last), href: 'aktivitaeten.html?open=' + encodeURIComponent(keyOf(last)) } : null;
    const draw = b => { if (B.what.isConnected) B.what.innerHTML = whatHTML(insights({ acts: ctx.acts, body: b, fit, recs, last: L, now })); };
    draw(null); if (ctx.acc) { try { draw(await body(ctx)); } catch {} }
  };
  setTimeout(what, 0);
}
