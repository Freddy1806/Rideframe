// RIDEFRAME Stats (statistik.html, UX review 16.11.): the numbers over all sports in one place: this week against the last,
// the last 8 weeks as stacked bars per sport, totals per sport and the bests. No maths of its own: fitness.js (load,
// totals, bests) and util.js (weeks). Fitness / fatigue / form and the estimates stay on the profile, linked from here.
import { fmtNum, esc, twoWeeks, weekStat, weekStart } from './util.js';
import { MODES, icon, applyTheme } from './theme.js';
import { loadOf, totals, bests, sportOf } from './fitness.js';
import { loadActs, durOf, hm, ORDER } from './feed.js';
import { nav } from './nav.js';

const el = document.getElementById('stat');
let D = null, by = 'time';
const mc = m => `--mc:${MODES[m].color};--mcl:${MODES[m].light}`;
const paceT = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const hrs = s => s >= 36000 ? fmtNum(s / 3600, 0) + ' h' : fmtNum(s / 3600, 1) + ' h';

function render() {
  const { acts, P } = D, pts = l => Math.round(l.reduce((a, x) => a + loadOf(x, P).pts, 0)), sec = l => l.reduce((a, x) => a + durOf(x), 0), km = l => Math.round(l.reduce((a, x) => a + (x.distance || 0), 0) / 1000);
  const W2 = twoWeeks(acts), T = totals(acts), B = bests(acts), hmS = s => hm(s).slice(0, -2); // h:mm without the unit, the label says it
  const row = (l, v, s = '') => `<div class="prow2"><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  el.innerHTML = `<header class="ptop"><div class="pbrand"><b>RIDEFRAME </b><span>Stats</span></div></header>
    ${!acts.length ? `<div class="fempty"><p class="hint">No activities yet. After your first ride, run or workout your numbers show up here.</p><a class="btn" href="handy.html">Go to Home</a></div>` : `
    <section class="hweek"><div class="hwhead"><span class="label">This week</span><span class="wdl">▲▼ vs last week</span></div><div class="kstats">
      ${weekStat(W2.cur.length, W2.prev.length, 'Sessions')}${weekStat(sec(W2.cur), sec(W2.prev), 'Time (h)', hmS)}${weekStat(km(W2.cur), km(W2.prev), 'km')}${weekStat(pts(W2.cur), pts(W2.prev), 'Points')}</div></section>

    <section class="hweek"><div class="hwhead"><span class="label">Last 8 weeks</span></div>
      <div class="pseg sseg">${[['time', 'Time'], ['load', 'Load']].map(([k, l]) => `<button data-by="${k}" class="${by === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${weekBars(acts, P)}</section>

    <h3 class="ksec">Totals</h3>
    <section class="ftot">${ORDER.filter(m => T[m]).map(m => { const t = T[m]; return `<a class="ftrow" href="aktivitaeten.html?f=${m}" style="${mc(m)}">${icon(m, 'rico')}<div><b>${MODES[m].name}</b>
      <small>${t.n}× · ${hrs(t.sec)}${t.m ? ` · ${fmtNum(t.m / 1000, 0)} km` : ''}${t.gain ? ` · ${fmtNum(t.gain)} m climb` : ''}</small></div><i>›</i></a>`; }).join('')}</section>

    <h3 class="ksec">Bests</h3>
    <section class="kcard fest">
      ${row('Best 20 min power', B.p20 ? `${Math.round(B.p20)} W` : '–')}${row('Best 5 min power', B.p5 ? `${Math.round(B.p5)} W` : '–')}${row('Longest ride', B.longest ? `${fmtNum(B.longest.distance / 1000, 1)} km` : '–', B.longest ? new Date(B.longest.date).toLocaleDateString('en-GB') : '')}
      ${[1, 5, 10].map(n => row(`Run ${n} km`, B.run[n] ? paceT(B.run[n].t) + (B.run[n].t >= 3600 ? '' : ' min') : '–', B.run[n] ? new Date(B.run[n].date).toLocaleDateString('en-GB') : '')).join('')}
      ${row('Strength records', B.prs ? `🏆 ${B.prs}` : '–', 'sets that beat the earlier best')}
      ${B.lifts.map(([n, v]) => row(esc(n), `${fmtNum(v, 1)} kg`, 'estimated 1RM')).join('')}</section>

    <h3 class="ksec">Intervals over time</h3>
    <section class="kcard ivcard" id="ivHist"></section>

    <a class="hrow hlink slink" href="profil.html" style="--mc:var(--accent);--mcl:var(--accent)">${icon('user', 'rico')}<div><b>Fitness, fatigue &amp; form</b><small>Trend and estimates on your profile</small></div><i>›</i></a>`}`;
  el.querySelectorAll('[data-by]').forEach(b => b.onclick = () => { by = b.dataset.by; render(); });
  const iv = el.querySelector('#ivHist'); if (iv) import('./ivview.js').then(m => m.mountIvHistory(iv, D.acts.filter(a => a.ivs?.length), { kg: D.S.riderKg })).catch(() => {});
}
/** the last 8 weeks (Mon–Sun), one stacked bar each: time or load points per sport */
function weekBars(acts, P) {
  const w0 = weekStart(Date.now()), weeks = [...Array(8)].map((_, i) => { const d = new Date(w0); d.setDate(d.getDate() - (7 - i) * 7); return d.getTime(); });
  const val = a => by === 'time' ? durOf(a) / 3600 : loadOf(a, P).pts;
  const v = weeks.map(w => { const o = {}; for (const a of acts) if (weekStart(a.date) === w) o[sportOf(a)] = (o[sportOf(a)] || 0) + val(a); return o; });
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0), mx = Math.max(by === 'time' ? 1 : 50, ...v.map(sum)), used = ORDER.filter(m => v.some(o => o[m]));
  return `<div class="sbars" role="img" aria-label="${by === 'time' ? 'Hours' : 'Load points'} per week">${v.map((o, i) => { const t = sum(o), d = new Date(weeks[i]);
      return `<div><small>${t ? (by === 'time' ? fmtNum(t, t < 10 ? 1 : 0) : fmtNum(t)) : ''}</small><span style="height:${t / mx * 100}%">${ORDER.filter(m => o[m]).map(m => `<i style="${mc(m)};flex-grow:${o[m]}"></i>`).join('')}</span><em>${d.getDate()}/${d.getMonth() + 1}</em></div>`; }).join('')}</div>
    <div class="fleg sleg">${used.map(m => `<span style="${mc(m)}"><i></i>${MODES[m].short}</span>`).join('')}<span>${by === 'time' ? 'hours' : 'points'} per week</span></div>`;
}

D = await loadActs(); D.acts.sort((a, b) => a.date - b.date); // oldest first, like the profile
applyTheme(D.S, null); nav('stats'); render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
