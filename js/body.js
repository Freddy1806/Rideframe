// RIDEFRAME body page (body.html, 25.11., owner: "every morning on the scale … a good layout: list + chart, what is good, what changed").
// Phone first, fine on the desktop. Top: the latest weigh-in big, the trend's change over 7 / 30 days and since the start in plain
// words; a chart (weigh-ins as dots + the trend line, optional goal line, 1 W … All, tap / hover / arrow keys for a value); body
// composition when the scale or an import has it; the weigh-ins by week with edit / delete and "add by hand"; "Was that you?" on top.
// Data: tools/body-api.mjs (signed in). Rules: js/bodylib.js. Area colour: yellow (no other area uses it).
import { db } from './db.js';
import { applyTheme } from './theme.js';
import { nav } from './nav.js';
import { account } from './account.js';
import { trend, changes, changeWords, fmtKg, byWeek, FIELDS, TIPS, RULE, bmiOf, parseCsv, kgOf } from './bodylib.js';
import { api, loadBody, syncWeight, when, SCALE } from './bodycard.js';

const el = document.getElementById('body'), $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const BODY_COLOR = ['#f5d33d', '#8a6d00']; // dark, light
const RANGES = [['w1', '1 W', 7], ['m1', '1 M', 30], ['m3', '3 M', 91], ['y1', '1 Y', 365], ['all', 'All', 0]];
const SRCN = { scale: 'scale', manual: 'entered by hand', import: 'imported' };
let S = {}, D = null, allWeeks = false, range = (() => { try { return localStorage.getItem('rf-body-range') || 'm1'; } catch { return 'm1'; } })(), sel = null, err = '';

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {}; applyTheme(S, null);
  const light = document.documentElement.dataset.theme === 'light'; if (S.oneColor !== true) document.documentElement.style.setProperty('--accent', BODY_COLOR[light ? 1 : 0]);
  if (!account()) { D = null; return; }
  try { D = await loadBody(); err = ''; if (await syncWeight(D.list, D.prefs)) S = (await db.kvGet('settings').catch(() => null)) || S; } catch (e) { err = e.message; D = D || { list: [], prefs: { follow: true }, prompts: [] }; }
}

const dt = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
function render() {
  if (!account()) {
    el.innerHTML = `${head()}<section class="bempty"><span class="bcico big" aria-hidden="true">${SCALE}</span><h2>Your weight, every morning</h2>
      <p>Sign in to keep your weigh-ins: from the bathroom scale automatically, or entered by hand. Only you see them.</p><button class="btn" id="bIn">Sign in</button></section>`;
    $('#bIn').onclick = signIn; wireHead(); return;
  }
  const list = D.list, P = D.prefs, last = list[list.length - 1], c = changes(list);
  const ask = (D.prompts || []).map(p => `<div class="bq" data-q="${p.id}"><div><b>Was that you?</b><span>${fmtKg(p.kg)} kg · ${esc(when(p.t))}</span></div>
    <div class="bqb"><button class="btn ksmall" data-yes="${p.id}">Yes, me</button><button class="btn ghost ksmall" data-no="${p.id}">No</button></div></div>`).join('');
  // the trend's change: one decimal (it is an average, not a reading), arrow + a word, never "good" or "bad"
  const stat = (d, label) => { const w = changeWords(d), flat = d == null || Math.abs(d) < 0.15;
    return `<div class="bst" role="group" aria-label="${esc(label)}: ${esc(w.text)}"><b class="${w.cls}" aria-hidden="true">${w.arrow ? `<em>${w.arrow}</em>` : ''}${d == null ? '–' : flat ? '±0' : Math.abs(d).toFixed(1)}<small>${flat ? '' : ' kg'}</small></b><small aria-hidden="true">${label}</small><span aria-hidden="true">${esc(d == null ? 'not enough data' : flat ? 'about the same' : d < 0 ? 'down' : 'up')}</span></div>`; };
  const bmi = last && bmiOf(last.kg, P.heightCm), goal = P.goalKg && last ? last.kg - P.goalKg : null;
  el.innerHTML = `${head()}${err ? `<p class="phint perr" role="alert">${esc(err)}</p>` : ''}
    ${ask ? `<section class="bask" aria-label="Weigh-ins to confirm">${ask}<p class="phint">The scale is shared and this weigh-in was not clearly anyone's, so everyone in the household is asked. Your answer is private: nobody sees whose it became.</p></section>` : ''}
    ${last ? `<section class="bhero"><div class="bhl"><span class="label">Latest</span><div class="bbig">${fmtKg(last.kg)}<small> kg</small></div>
        <p class="bmeta">${esc(dt(last.t))} · ${esc(SRCN[last.src] || last.src)}</p></div>
      <div class="bhr"><div><small>Trend</small><b>${c.now.toFixed(1)} kg</b></div>${bmi ? `<div><small>BMI</small><b>${bmi.toFixed(1)}</b></div>` : ''}${goal != null ? `<div><small>Goal ${fmtKg(P.goalKg)}</small><b>${Math.abs(goal) < 0.05 ? 'reached' : `${fmtKg(Math.abs(goal), 1)} kg ${goal > 0 ? 'above' : 'below'}`}</b></div>` : ''}</div></section>
      <section class="kstats k3 bstats" aria-label="Change of the trend">${stat(c.d7, '7 days')}${stat(c.d30, '30 days')}${stat(c.start, 'since ' + new Date(c.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(new Date(c.since).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }).replace('Sept', 'Sep'))}</section>
      <section class="kcard bchart"><div class="pseg bseg" role="group" aria-label="Range">${RANGES.map(([k, l]) => `<button data-r="${k}" class="${range === k ? 'on' : ''}" aria-pressed="${range === k}">${l}</button>`).join('')}</div>
        <div id="bChart"></div><p class="bread" id="bRead" aria-live="polite"></p>
        <div class="fleg bleg"><span><i class="ldot"></i>Weigh-in</span><span><i class="ltr"></i>Trend</span>${P.goalKg ? '<span><i class="lgoal"></i>Goal</span>' : ''}</div></section>
      <div id="bComp"></div>`
    : `<section class="bempty"><span class="bcico big" aria-hidden="true">${SCALE}</span><h2>No weigh-ins yet</h2>
      <p>Step on the scale (once it is set up in Settings → Bathroom scale) or add your weight by hand. After a few mornings you see your trend here.</p>
      <div class="scbtns"><button class="btn" id="bAdd0">Add by hand</button><button class="btn ghost" id="bScale0">Set up the scale</button></div></section>`}
    <details class="kcard btips"><summary>How to weigh for a clean trend</summary><ul>${TIPS.map(t => `<li>${esc(t)}</li>`).join('')}</ul><p class="phint">${esc(RULE)}</p></details>
    ${list.length ? `<div class="bhead"><h3 class="ksec">Weigh-ins</h3><button class="btn ghost ksmall" id="bAdd">+ Add by hand</button></div>
      <section class="blist">${byWeek(list).slice(0, allWeeks ? Infinity : 6).map(g => `<div class="bweek"><div class="bwk"><span>Week of ${new Date(g.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(g.week).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}</span><span>avg ${g.avg.toFixed(1)} kg</span></div>
        ${g.list.map(m => `<button class="brow" data-id="${m.id}"><span class="bd">${esc(new Date(m.t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }))}<small>${new Date(m.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small></span>
          <span class="bk">${fmtKg(m.kg)} <small>kg</small></span><span class="bs">${esc(SRCN[m.src] || m.src)}${m.fatPct ? ` · ${m.fatPct} % fat` : ''}${m.note ? ` · ${esc(m.note)}` : ''}</span><i aria-hidden="true">›</i></button>`).join('')}</div>`).join('')}${!allWeeks && byWeek(list).length > 6 ? `<button class="btn ghost" id="bMore">Show all ${byWeek(list).length} weeks</button>` : ''}</section>` : ''}`;
  wireHead();
  el.querySelectorAll('[data-yes],[data-no]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api('/api/body/prompts/' + (b.dataset.yes || b.dataset.no), { method: 'POST', body: JSON.stringify({ mine: !!b.dataset.yes }) }); } catch (e) { err = e.message; } await load(); render(); });
  el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { range = b.dataset.r; sel = null; try { localStorage.setItem('rf-body-range', range); } catch {} render(); });
  el.querySelectorAll('.brow').forEach(b => b.onclick = () => editSheet(list.find(m => m.id === b.dataset.id)));
  for (const id of ['#bAdd', '#bAdd0']) $(id)?.addEventListener('click', () => editSheet(null));
  $('#bScale0')?.addEventListener('click', () => settingsSheet(true));
  $('#bMore')?.addEventListener('click', () => { allWeeks = true; render(); });
  if (last) { drawChart(); comp(); }
}
const head = () => `<header class="ptop"><a class="pback" href="handy.html" title="Back" aria-label="Back">‹</a><div class="pbrand"><b>RIDEFRAME </b><span>Body</span></div>
  <button class="pgear" id="bSet" title="Settings" aria-label="Body settings">${'<svg class="gico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>'}</button></header>`;
const wireHead = () => { $('#bSet').onclick = () => settingsSheet(false); };
const signIn = async () => { const a = await import('./account.js'); await a.accountModal({ settings: S }, async () => { await load(); render(); }); };

/* ---- the chart: own SVG (like the profile's fitness chart), measured to the card so text stays text-sized ---- */
function drawChart() {
  const box = $('#bChart'); if (!box) return;
  const list = D.list, now = Date.now(), days = RANGES.find(r => r[0] === range)[2], from = days ? now - days * 864e5 : list[0].t - 864e5 / 2;
  const pts = list.filter(m => m.t >= from), tr = trend(list), trIn = tr.filter(p => p.t >= from), before = [...tr].reverse().find(p => p.t < from);
  const W = Math.max(260, Math.round(box.clientWidth || 320)), H = W < 520 ? 200 : 260, L = 38, R = 10, T = 12, B = 24;
  const goal = D.prefs.goalKg, vals = [...pts.map(m => m.kg), ...trIn.map(p => p.trend), ...(before ? [before.trend] : [])];
  if (!vals.length) { box.innerHTML = `<p class="phint bnone">No weigh-ins in this range. Pick a longer one.</p>`; $('#bRead').textContent = ''; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals); if (goal && goal > lo - 3 && goal < hi + 3) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
  const span = Math.max(1, hi - lo), step = [0.2, 0.5, 1, 2, 5, 10, 20].find(s => span / s <= 5) || 50; lo = Math.floor((lo - span * .08) / step) * step; hi = Math.ceil((hi + span * .08) / step) * step;
  const x = t => L + (t - from) / (now - from) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const ticks = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const xt = [], n = W < 400 ? 3 : 5; for (let i = 0; i <= n; i++) xt.push(from + (now - from) * i / n);
  const fmtD = t => new Date(t).toLocaleDateString('en-GB', days && days <= 31 ? { day: 'numeric', month: 'short' } : { month: 'short', year: '2-digit' });
  const line = [...(before ? [{ t: from, trend: before.trend }] : []), ...trIn].map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.trend).toFixed(1)}`).join('');
  const firsts = new Set(tr.map(p => p.id)), outs = new Set(tr.filter(p => p.out).map(p => p.id)), r = pts.length > 120 ? 2 : 3;
  const c = changes(list), sum = `Weight chart, ${RANGES.find(q => q[0] === range)[1]}: ${pts.length} weigh-ins from ${fmtKg(Math.min(...pts.map(m => m.kg)))} to ${fmtKg(Math.max(...pts.map(m => m.kg)))} kg, trend now ${fmtKg(c.now, 1)} kg.`;
  box.innerHTML = `<svg class="kchart bsvg" id="bSvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0" aria-label="${esc(sum)} Use the arrow keys to read single weigh-ins.">
    ${ticks.map(v => `<line class="kgrid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${step < 1 ? v.toFixed(1) : Math.round(v)}</text>`).join('')}
    ${xt.map((t, i) => `<text x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}">${fmtD(t)}</text>`).join('')}
    ${goal && goal >= lo && goal <= hi ? `<line class="bgoal" x1="${L}" x2="${W - R}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"/>` : ''}
    ${pts.map(m => `<circle class="bpt${firsts.has(m.id) ? '' : ' bextra'}${outs.has(m.id) ? ' bout' : ''}" cx="${x(m.t).toFixed(1)}" cy="${y(m.kg).toFixed(1)}" r="${r}"/>`).join('')}
    <path class="kline btr" d="${line}"/><g id="bSel"></g></svg>`;
  const svg = $('#bSvg'), read = $('#bRead');
  const show = m => { sel = m?.id || null; const g = $('#bSel'); if (!m) { g.innerHTML = ''; read.textContent = 'Tap the chart for a single weigh-in.'; return; }
    const tv = [...tr].reverse().find(p => p.t <= m.t + 1)?.trend;
    g.innerHTML = `<line class="bcur" x1="${x(m.t).toFixed(1)}" x2="${x(m.t).toFixed(1)}" y1="${T}" y2="${H - B}"/><circle class="bselpt" cx="${x(m.t).toFixed(1)}" cy="${y(m.kg).toFixed(1)}" r="${r + 3}"/>`;
    read.innerHTML = `<b>${fmtKg(m.kg)} kg</b> · ${esc(dt(m.t))}${tv != null ? ` · trend ${tv.toFixed(1)} kg` : ''}${outs.has(m.id) ? ' · left out of the trend (far from it)' : !firsts.has(m.id) ? ' · not the first of the day' : ''}`; };
  const near = ev => { const b = svg.getBoundingClientRect(), px = (ev.clientX - b.left) * W / b.width; let best = null, bd = Infinity; for (const m of pts) { const d = Math.abs(x(m.t) - px); if (d < bd) { bd = d; best = m; } } return best; };
  svg.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') show(near(e)); });
  svg.addEventListener('pointerdown', e => show(near(e)));
  svg.addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const i = pts.findIndex(m => m.id === sel);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? pts.length - 1 : i < 0 ? pts.length - 1 : Math.max(0, Math.min(pts.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1))); show(pts[j]); });
  show(pts.find(m => m.id === sel) || null);
}
/** body composition: one small card per value the scale (or an import) reported, latest + a mini line */
function comp() {
  const box = $('#bComp'); if (!box) return;
  const ks = Object.keys(FIELDS).filter(k => D.list.some(m => m[k] != null)); if (!ks.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<h3 class="ksec">Body composition</h3><p class="phint">As the scale or your import reported it. Impedance needs bare feet.</p><div class="bcomp">${ks.map(k => {
    const f = FIELDS[k], l = D.list.filter(m => m[k] != null), lastM = l[l.length - 1], vs = l.slice(-60).map(m => m[k]), lo = Math.min(...vs), hi = Math.max(...vs), w = 120, h = 34;
    const path = vs.length > 1 ? vs.map((v, i) => `${i ? 'L' : 'M'}${(i / (vs.length - 1) * w).toFixed(1)},${(3 + (hi - v) / ((hi - lo) || 1) * (h - 6)).toFixed(1)}`).join('') : '';
    return `<div class="kcard bcc"><span class="label">${f.n}</span><b>${lastM[k].toFixed(f.d)}<small> ${f.u}</small></b><small>${esc(when(lastM.t))}</small>${path ? `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" vector-effect="non-scaling-stroke"/></svg>` : ''}</div>`; }).join('')}</div>`;
}

/* ---- add / edit one weigh-in ---- */
function editSheet(m) {
  const s = document.createElement('div'); s.className = 'psheet'; document.body.append(s);
  const t = m ? m.t : Date.now(), local = new Date(t - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  s.innerHTML = `<div class="psheetin" role="dialog" aria-label="${m ? 'Edit weigh-in' : 'Add a weigh-in'}"><div class="label">${m ? 'Weigh-in' : 'Add by hand'}</div>
    <label class="prow"><span>Weight</span><input id="eKg" type="number" inputmode="decimal" step="0.05" min="20" max="300" value="${m ? m.kg : D.list.length ? D.list[D.list.length - 1].kg : ''}" placeholder="kg"><span>kg</span></label>
    <label class="bfield"><span>Date and time</span><input id="eT" type="datetime-local" value="${local}"></label>
    <label class="prow"><span>Body fat <small>(optional)</small></span><input id="eFat" type="number" inputmode="decimal" step="0.1" value="${m?.fatPct ?? ''}"><span>%</span></label>
    <label class="bfield"><span>Note <small>(optional)</small></span><input id="eNote" type="text" maxlength="200" value="${esc(m?.note || '')}"></label>
    ${m ? `<p class="phint">${esc(SRCN[m.src] || m.src)}${m.impedance ? ` · impedance ${m.impedance} Ω` : ''}${m.hr ? ` · heart rate ${m.hr}` : ''}</p>` : ''}
    <p class="phint perr" id="eErr" role="alert"></p>
    <div class="pfoot">${m ? '<button class="btn ghost" id="eDel">Delete</button>' : '<button class="btn ghost" id="eX">Cancel</button>'}<button class="btn" id="eOk">Save</button></div></div>`;
  const close = () => s.remove(); s.onclick = e => { if (e.target === s) close(); }; $('#eX', s)?.addEventListener('click', close);
  $('#eOk', s).onclick = async () => {
    const b = { kg: kgOf($('#eKg', s).value), t: new Date($('#eT', s).value).getTime(), fatPct: $('#eFat', s).value || null, note: $('#eNote', s).value };
    try { await api('/api/body' + (m ? '/' + m.id : ''), { method: m ? 'PUT' : 'POST', body: JSON.stringify(b) }); close(); await load(); render(); } catch (e) { $('#eErr', s).textContent = e.message; } };
  $('#eDel', s)?.addEventListener('click', async () => { if (!confirm('Delete this weigh-in?')) return; try { await api('/api/body/' + m.id, { method: 'DELETE' }); close(); await load(); render(); } catch (e) { $('#eErr', s).textContent = e.message; } });
  $('#eKg', s).focus();
}

/* ---- settings: goal, height, profile weight, the scale, import ---- */
function settingsSheet(toScale) {
  const s = document.createElement('div'); s.className = 'psheet'; s.id = 'bSheet'; document.body.append(s);
  const P = D?.prefs || { follow: true };
  s.innerHTML = `<div class="psheetin"><div class="label">Body settings</div>
    ${account() ? `<label class="prow"><span>Goal weight <small>(optional)</small></span><input id="sGoal" type="number" inputmode="decimal" step="0.5" value="${P.goalKg ?? ''}"><span>kg</span></label>
    <label class="prow"><span>Height <small>(for BMI)</small></span><input id="sH" type="number" inputmode="numeric" value="${P.heightCm ?? ''}"><span>cm</span></label>
    <label class="prow"><span>Profile weight follows my weigh-ins<small class="bsub">Used for W/kg, calories and the climbing speed.</small></span><input id="sF" type="checkbox" class="toggle" ${P.follow !== false ? 'checked' : ''}></label>
    <p class="phint perr" id="sErr" role="alert"></p>` : ''}
    <h3 class="ksec" id="sScaleH">Bathroom scale</h3><div id="sScale"></div>
    ${account() ? `<h3 class="ksec">Import</h3><p class="phint">A CSV file with date and weight, e.g. the EufyLife export (Me → Data → Export All Data). Repeats are merged.</p>
    <label class="btn ghost bfile">Choose CSV file<input id="sCsv" type="file" accept=".csv,text/csv,text/plain" hidden></label><p class="phint" id="sImp" role="status"></p>` : ''}
    <div class="pfoot"><button class="btn" id="sOk">Done</button></div></div>`;
  const close = async () => { s.remove(); await load(); render(); };
  s.onclick = e => { if (e.target === s) close(); }; $('#sOk', s).onclick = close;
  const put = async b => { try { const r = await api('/api/body/prefs', { method: 'PUT', body: JSON.stringify(b) }); D.prefs = r.prefs; $('#sErr', s).textContent = ''; } catch (e) { $('#sErr', s).textContent = e.message; } };
  $('#sGoal', s)?.addEventListener('change', e => put({ goalKg: e.target.value === '' ? '' : +e.target.value }));
  $('#sH', s)?.addEventListener('change', e => put({ heightCm: e.target.value === '' ? '' : +e.target.value }));
  $('#sF', s)?.addEventListener('change', e => put({ follow: e.target.checked }));
  $('#sCsv', s)?.addEventListener('change', async e => { const f = e.target.files[0], out = $('#sImp', s); if (!f) return; out.textContent = 'Reading …';
    try { const p = parseCsv(await f.text()); if (!p.rows.length) throw new Error('No rows with a date and a weight found.');
      let added = 0, merged = 0, skipped = p.skipped; for (let i = 0; i < p.rows.length; i += 5000) { const r = await api('/api/body/import', { method: 'POST', body: JSON.stringify({ rows: p.rows.slice(i, i + 5000) }) }); added += r.added; merged += r.merged; skipped += r.skipped; }
      out.textContent = `Imported ${added} weigh-in${added === 1 ? '' : 's'} ✓${merged ? ` (${merged} already there)` : ''}${skipped ? ` · ${skipped} row${skipped === 1 ? '' : 's'} skipped` : ''}${p.lb ? ' · converted from lb' : ''}`; }
    catch (x) { out.textContent = x.message; } e.target.value = ''; });
  import('./scaleset.js').then(m => { m.scaleSection($('#sScale', s), { signIn: () => { s.remove(); signIn(); } }); if (toScale) $('#sScaleH', s).scrollIntoView({ block: 'start' }); });
}

await load(); render(); nav('');
if (location.hash === '#scale') settingsSheet(true);
let rw = 0; addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(() => { if (D?.list?.length) drawChart(); }, 150); });
document.addEventListener('visibilitychange', async () => { if (!document.hidden && account()) { await load(); render(); } }); // back in the morning: the new weigh-in
