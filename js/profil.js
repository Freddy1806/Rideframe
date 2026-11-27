// RIDEFRAME profile (profil.html, Freddy 16.11.): one place for the athlete: picture, the own numbers, fitness over ALL
// sports, estimates (FTP, VO2max), bests, totals and points. Like the Strava profile, with more data. Also the settings
// that belong to the person (weight, FTP, heart rate) and the export of all data.
import { db } from './db.js';
import { fmtNum, esc } from './util.js';
import { icon, applyTheme, MODES } from './theme.js';
import { profileOf, loadOf, pmcAll, vo2, streak, bests, totals } from './fitness.js';
import { nav } from './nav.js';
import { collapse } from './actimport.js';

const el = document.getElementById('profil'), $ = (s, r = document) => r.querySelector(s);
let S = {}, acts = [], kraft = [], acc = null, pic = null;

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {}; applyTheme(S, null);
  const rides = (await db.all('rides').catch(() => [])).filter(r => r.routeId !== 'demo' && !r.unsaved && r.date);
  kraft = ((await db.kvGet('kraft').catch(() => null)) || []).map(k => ({ ...k, kraft: true, date: k.start || k.date }));
  acts = collapse([...rides, ...kraft]).sort((a, b) => a.date - b.date);
  pic = await db.kvGet('profilePic').catch(() => null);
  try { acc = (await import('./account.js')).account(); } catch {}
}
async function save(patch) { const st = (await db.kvGet('settings').catch(() => null)) || {}; Object.assign(st, patch); Object.assign(S, patch); await db.kvSet('settings', st).catch(() => {});
  import('./account.js').then(a => a.settingsChanged?.(st)).catch(() => {}); }

const paceT = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const formTxt = v => v > 15 ? 'very fresh' : v > 5 ? 'fresh' : v > -10 ? 'training' : v > -25 ? 'tired' : 'very tired';
const level = p => { const L = [[0, 'Beginner'], [500, 'Active'], [2000, 'Fit'], [5000, 'Strong'], [10000, 'Very strong'], [20000, 'Elite']]; let i = 0; while (i < L.length - 1 && p >= L[i + 1][0]) i++; return { name: L[i][1], next: L[i + 1]?.[0] || null, from: L[i][0] }; };

// 27.11. (owner: "totally overloaded, it overwhelms me"): the header, four key numbers in one row, the FTP estimate in one line, then short
// rows that open the rest: Personal data, Records & bests, Totals, Settings, Export. "My workouts" and the builder live on Workouts now.
let extra = { vo2w: null, kg: null }; // the watch's VO2max and the newest weigh-in (signed in)
const estSrc = est => { const l = Array.isArray(est?.sources) ? est.sources.map(x => typeof x === 'string' ? x : x?.label || x?.what || x?.from || '').filter(Boolean).slice(0, 3) : []; return l; };
function render() {
  const P = profileOf(S, acts), V = vo2(acts, P), pts = Math.round(acts.reduce((a, x) => a + loadOf(x, P).pts, 0)), lv = level(pts), st = streak(acts);
  const kg = extra.kg || S.riderKg || null, ftp = +S.ftp || 0, est = P.ftpEst, vo = extra.vo2w || (V.bike || V.run ? Math.round(Math.max(V.bike?.v || 0, V.run?.v || 0)) : null);
  const key = (v, u, l, sub = '') => `<div class="fkey"><b>${v}${u && v !== '–' ? `<small>${u}</small>` : ''}</b><span>${l}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const link = (k, ic, b, sm, id = '') => `<button type="button" class="hrow hlink frow2" data-open="${k}"${id ? ` id="${id}"` : ''}>${icon(ic, 'rico')}<div><b>${b}</b><small>${sm}</small></div><i>›</i></button>`;
  const src = estSrc(est);
  el.innerHTML = `<header class="ptop"><div class="pbrand"><b>RIDEFRAME </b><span>Profile</span></div>
      <a class="pgear" href="handy.html#settings" title="Settings" aria-label="Settings">${icon('gear', 'gico')}</a></header>
    <section class="fhead"><button class="favatar" id="fPic" title="Change profile picture" aria-label="Change profile picture">${pic ? `<img src="${pic}" alt="">` : `<span>${esc((acc?.name || S.name || '?').slice(0, 1).toUpperCase())}</span>`}</button>
      <div><h1>${esc(acc?.name || S.name || 'Your profile')}</h1><p>${lv.name} · ${fmtNum(pts)} points${st ? ` · ${st} ${st === 1 ? 'week' : 'weeks'} active` : ''}</p>
      ${lv.next ? `<div class="fbar" role="img" aria-label="${fmtNum(lv.next - pts)} points to the next level"><i style="width:${Math.min(100, (pts - lv.from) / (lv.next - lv.from) * 100)}%"></i></div>` : ''}</div></section>
    <input type="file" id="fFile" accept="image/*" hidden>
    <section class="fkeys" aria-label="Key numbers">${key(ftp ? ftp : '–', ' W', 'FTP', ftp && kg ? `${fmtNum(ftp / kg, 2)} W/kg` : '')}${key(vo ?? '–', '', 'VO2max', vo ? (extra.vo2w ? 'watch' : 'estimate') : '')}${key(kg ? fmtNum(kg, 1) : '–', ' kg', 'Weight', extra.kg ? 'weigh-in' : kg ? 'profile' : '')}${key(P.hrMax || '–', '', 'Max HR', S.hrMax ? 'entered' : P.hrMax ? 'measured' : '')}</section>
    ${est && est.w !== ftp ? `<div class="fsug"><span><b>Estimated FTP ${est.w} W</b>${src.length ? `<small>based on ${src.map(esc).join(', ')}</small>` : ''}</span><button class="btn ghost ksmall" id="fFtp">Apply</button></div>` : ''}
    <nav class="flinks" aria-label="Profile">
      ${link('personal', 'user', 'Personal data', 'Weight, FTP, heart rate', 'fSet')}
      ${link('records', 'chart', 'Records &amp; bests', 'Power, run times, lifts, VO2max')}
      ${link('totals', 'list', 'Totals', 'Fitness, hours and kilometres per sport')}
      <a class="hrow hlink frow2" href="handy.html#settings">${icon('gear', 'rico')}<div><b>Settings</b><small>Appearance, Strava, watch, scale, coach</small></div><i>›</i></a>
      <button type="button" class="hrow hlink frow2" id="fExport">${icon('other', 'rico')}<div><b>Export</b><small>All your data as one file</small></div><i>›</i></button></nav>`;
  $('#fPic').onclick = () => $('#fFile').click();
  $('#fFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; pic = await shrink(f).catch(() => null); if (pic) { await db.kvSet('profilePic', pic).catch(() => {}); render(); } };
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => ({ personal: dataSheet, records: recordsSheet, totals: totalsSheet })[b.dataset.open]());
  const fb = $('#fFtp'); if (fb) fb.onclick = async () => { await save({ ftp: est.w }); render(); };
  $('#fExport').onclick = exportAll;
}
const sheet = (id, html) => { document.getElementById(id)?.remove(); const s = document.createElement('div'); s.className = 'psheet'; s.id = id; s.innerHTML = `<div class="psheetin">${html}<div class="pfoot"><button class="btn" data-ok>Done</button></div></div>`;
  s.onclick = e => { if (e.target === s || e.target.closest('[data-ok]')) s.remove(); }; document.body.append(s); return s; };
const row = (l, v, s = '') => `<div class="prow2"><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
function recordsSheet() {
  const P = profileOf(S, acts), V = vo2(acts, P), B = bests(acts), d = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  sheet('fRecSheet', `<div class="label">Records &amp; bests</div><section class="fest">
    ${row('Best 20 min power', B.p20 ? `${Math.round(B.p20)} W` : '–')}${row('Best 5 min power', B.p5 ? `${Math.round(B.p5)} W` : '–')}${row('Longest ride', B.longest ? `${fmtNum(B.longest.distance / 1000, 1)} km` : '–', B.longest ? d(B.longest.date) : '')}
    ${[1, 5, 10].map(n => row(`Run ${n} km`, B.run[n] ? paceT(B.run[n].t) : '–', B.run[n] ? d(B.run[n].date) : '')).join('')}
    ${row('Threshold pace', P.runThr ? `≈ ${paceT(1000 / P.runThr)} /km` : '–')}
    ${row('VO2max bike', extra.vo2b ? `${extra.vo2b} watch` : V.bike ? `≈ ${fmtNum(V.bike.v, 0)}` : '–', V.bike ? `estimate from ${esc(V.bike.from)}` : '')}${row('VO2max run', extra.vo2r ? `${extra.vo2r} watch` : V.run ? `≈ ${fmtNum(V.run.v, 0)}` : '–', V.run ? `estimate from ${esc(V.run.from)}` : '')}
    ${B.lifts.map(([n, v]) => row(esc(n), `${fmtNum(v, 1)} kg`, 'estimated 1RM')).join('')}${row('Strength records', B.prs ? `🏆 ${B.prs}` : '–')}</section>
    <a class="hall" href="statistik.html">All stats: weeks, intervals, heart rate vs power ›</a>`);
}
function totalsSheet() {
  const P = profileOf(S, acts), pm = pmcAll(acts, P, 90), now = pm[pm.length - 1] || { ctl: 0, atl: 0, tsb: 0 }, ago = pm[Math.max(0, pm.length - 29)] || now, T = totals(acts);
  const stat = (v, l, s = '') => `<div><b>${v}</b><small>${l}</small>${s ? `<em class="wd">${s}</em>` : ''}</div>`;
  const hrs = s => fmtNum(s / 3600, s >= 36000 ? 0 : 1) + ' h';
  sheet('fTotSheet', `<div class="label">Totals</div>
    <div class="kstats k3">${stat(fmtNum(now.ctl, 0), 'Fitness', `${now.ctl - ago.ctl >= 0 ? '▲ +' : '▼ −'}${fmtNum(Math.abs(now.ctl - ago.ctl), 0)} in 4 weeks`)}${stat(fmtNum(now.atl, 0), 'Fatigue', '7 days')}${stat((now.tsb > 0 ? '+' : '') + fmtNum(now.tsb, 0), 'Form', formTxt(now.tsb))}</div>
    ${pmChart(pm)}
    <section class="fest">${Object.entries(T).sort((a, b) => b[1].sec - a[1].sec).map(([k, t]) => row(esc(MODES[k]?.name || k), hrs(t.sec), `${t.n}×${t.m ? ` · ${fmtNum(t.m / 1000, 0)} km` : ''}${t.gain ? ` · ${fmtNum(t.gain)} m climb` : ''}`)).join('') || '<p class="hint">Nothing recorded yet.</p>'}</section>`);
}
/** fitness (line) and form (bars up/down) of the last 90 days */
function pmChart(pm) {
  if (pm.length < 2 || !pm.some(p => p.load > 0)) return '<p class="hint">After your first sessions you will see your fitness trend here.</p>';
  const W = 320, H = 96, hi = Math.max(10, ...pm.map(p => Math.max(p.ctl, p.atl))), x = i => i / (pm.length - 1) * W, y = v => H - 4 - v / hi * (H - 12);
  const line = k => pm.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  return `<svg class="kchart fpm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fitness and fatigue, 90 days"><path d="${line('atl')}" class="fatl"/><path d="${line('ctl')}" class="kline"/></svg>
    <div class="fleg"><span><i class="l1"></i>Fitness</span><span><i class="l2"></i>Fatigue</span><span>last 90 days</span></div>`;
}
/** picture -> square 256 px JPEG data URL (stays on this device) */
function shrink(file) { return new Promise((ok, no) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 256; const s = Math.min(im.width, im.height);
  c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 256, 256); URL.revokeObjectURL(im.src); ok(c.toDataURL('image/jpeg', .85)); }; im.onerror = no; im.src = URL.createObjectURL(file); }); }
function dataSheet() {
  const s = document.createElement('div'); s.className = 'psheet'; document.body.append(s);
  const f = (id, l, v, u, ph = '') => `<label class="prow"><span>${l}</span><input id="${id}" type="number" inputmode="decimal" value="${v ?? ''}" placeholder="${ph}"><span>${u}</span></label>`;
  s.id = 'fDataSheet';
  s.innerHTML = `<div class="psheetin"><div class="label">Personal data</div><p class="hint">Used for zones, target watts, calories and fitness. Weight follows your weigh-ins.</p>
    ${f('dKg', 'Weight', S.riderKg || '', 'kg', '75')}${f('dFtp', 'FTP', S.ftp || '', 'W', 'e.g. 250')}${f('dMax', 'Max HR', S.hrMax || '', '', 'auto')}${f('dRest', 'Resting HR', S.hrRest || '', '', '60')}
    <div class="pfoot"><button class="btn ghost" id="dX">Cancel</button><button class="btn" id="dOk">Save</button></div></div>`;
  const n = (id, lo, hi) => { const v = +$(id, s).value; return v >= lo && v <= hi ? v : undefined; };
  $('#dX', s).onclick = () => s.remove(); s.onclick = e => { if (e.target === s) s.remove(); };
  $('#dOk', s).onclick = async () => { const p = { riderKg: n('#dKg', 30, 200), ftp: n('#dFtp', 60, 600), hrMax: n('#dMax', 120, 230), hrRest: n('#dRest', 30, 110) };
    for (const k in p) if (p[k] === undefined) delete p[k]; await save(p); s.remove(); render(); };
}
async function exportAll() {
  const out = { exported: new Date().toISOString(), app: 'RIDEFRAME', settings: S, rides: await db.all('rides').catch(() => []), kraft: (await db.kvGet('kraft').catch(() => null)) || [], kraftExercises: (await db.kvGet('kraftEx').catch(() => null)) || [] };
  const body = await import('./bodycard.js').then(m => m.exportBody()).catch(() => null); if (body) out.body = body; // 25.11.: weigh-ins from the account (tools/body-api.mjs)
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); a.download = `RIDEFRAME_Daten_${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
await load(); render(); nav('profile');
if (acc) { // the watch's VO2max and the newest weigh-in for the key numbers
  const get = u => fetch(u, { cache: 'no-store', headers: { 'X-RF-Token': acc.token || '' } }).then(r => r.ok ? r.json() : null).catch(() => null);
  Promise.all([get('/api/account/health?days=8'), get('/api/body?from=' + Math.floor(Date.now() - 400 * 864e5))]).then(([h, b]) => {
    const L = h?.latest || {}, last = (b?.list || []).reduce((a, m) => !a || m.t > a.t ? m : a, null);
    extra = { vo2r: L.v2r?.v || null, vo2b: L.v2b?.v || null, vo2w: Math.max(L.v2r?.v || 0, L.v2b?.v || 0) || null, kg: last?.kg || null }; render(); });
}
