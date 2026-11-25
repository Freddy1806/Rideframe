// RIDEFRAME profile (profil.html, Freddy 16.11.): one place for the athlete: picture, the own numbers, fitness over ALL
// sports, estimates (FTP, VO2max), bests, totals and points. Like the Strava profile, with more data. Also the settings
// that belong to the person (weight, FTP, heart rate) and the export of all data.
import { db } from './db.js';
import { fmtNum, esc } from './util.js';
import { icon, applyTheme } from './theme.js';
import { profileOf, loadOf, pmcAll, vo2, streak } from './fitness.js';
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

function render() {
  const P = profileOf(S, acts), pm = pmcAll(acts, P, 90), now = pm[pm.length - 1] || { ctl: 0, atl: 0, tsb: 0 }, ago = pm[Math.max(0, pm.length - 29)] || now;
  const V = vo2(acts, P), pts = Math.round(acts.reduce((a, x) => a + loadOf(x, P).pts, 0)), lv = level(pts);
  const src = {}; for (const a of acts.slice(-30)) { const s = loadOf(a, P).src; src[s] = (src[s] || 0) + 1; }
  const st = streak(acts);
  const stat = (v, l, s = '') => `<div><b>${v}</b><small>${l}</small>${s ? `<em class="wd">${s}</em>` : ''}</div>`;
  const row = (l, v, s = '') => `<div class="prow2"><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  el.innerHTML = `<header class="ptop"><div class="pbrand"><b>RIDEFRAME </b><span>Profile</span></div>
      <button class="pgear" id="fSet" title="My data" aria-label="My data">${icon('gear', 'gico')}</button></header>
    <section class="fhead"><button class="favatar" id="fPic" title="Change profile picture">${pic ? `<img src="${pic}" alt="">` : `<span>${esc((acc?.name || S.name || '?').slice(0, 1).toUpperCase())}</span>`}</button>
      <div><h1>${esc(acc?.name || S.name || 'Your profile')}</h1><p>${lv.name} · ${fmtNum(pts)} points${st ? ` · active ${st} ${st === 1 ? 'week' : 'weeks'} in a row` : ''}</p>
      ${lv.next ? `<div class="fbar"><i style="width:${Math.min(100, (pts - lv.from) / (lv.next - lv.from) * 100)}%"></i></div><small>${fmtNum(lv.next - pts)} points to the next level</small>` : ''}</div></section>
    <input type="file" id="fFile" accept="image/*" hidden>

    <section class="hweek"><div class="hwhead"><span class="label">Fitness across all sports</span><span class="wdl">42 days</span></div>
      <div class="kstats k3">${stat(fmtNum(now.ctl, 0), 'Fitness', `${now.ctl - ago.ctl >= 0 ? '▲ +' : '▼ −'}${fmtNum(Math.abs(now.ctl - ago.ctl), 0)} in 4 weeks`)}${stat(fmtNum(now.atl, 0), 'Fatigue', '7 days')}${stat((now.tsb > 0 ? '+' : '') + fmtNum(now.tsb, 0), 'Form', formTxt(now.tsb))}</div>
      ${pmChart(pm)}
      <p class="hint">Every session counts: 100 points = one hour at threshold. Calculated from power, else heart rate, else pace, else duration${Object.keys(src).length ? ` (recently:  ${Object.entries(src).map(([k, n]) => `${n}× ${k}`).join(', ')})` : ''}.</p></section>

    <h3 class="ksec">Estimates</h3>
    <section class="kcard fest">
      ${row('FTP', S.ftp ? `${S.ftp} W` : '–', S.ftp ? `${fmtNum(S.ftp / P.kg, 1)} W/kg` : 'not set yet')}
      ${P.ftpEst && P.ftpEst.w !== S.ftp ? `<div class="fsug"><span>Estimate from your rides: <b>${P.ftpEst.w} W</b> (${esc(P.ftpEst.from)})</span><button class="btn ghost ksmall" id="fFtp">Apply</button></div>` : ''}
      ${row('VO2max bike', V.bike ? `≈ ${fmtNum(V.bike.v, 0)}` : '–', V.bike ? `±${V.bike.pm} · from ${V.bike.from}` : 'needs 5 min with power data')}
      ${row('VO2max run', V.run ? `≈ ${fmtNum(V.run.v, 0)}` : '–', V.run ? `±${V.run.pm} · from ${V.run.from}` : 'needs a run of 6 min or more')}
      ${row('Threshold pace', P.runThr ? `≈ ${paceT(1000 / P.runThr)} min/km` : '–', P.runThr ? 'from your runs of 15 min or more' : '')}
      ${row('Max HR', P.hrMax ? `${P.hrMax}` : '–', S.hrMax ? 'entered' : P.hrMax ? 'highest measured' : 'no HR strap yet')}
      <p class="hint">Estimates from your own data, not a lab test. The more hard sessions, the more accurate.</p></section>

    <div id="mwProf"></div>
    <a class="hrow hlink slink" href="statistik.html" style="--mc:var(--accent);--mcl:var(--accent)">${icon('chart', 'rico')}<div><b>Bests, totals, weeks</b><small>All your numbers on the Stats page</small></div><i>›</i></a>
    <div class="pfoot col" style="margin-top:8px"><button class="btn ghost" id="fExport">Export all my data</button></div>`;
  $('#fPic').onclick = () => $('#fFile').click();
  $('#fFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; pic = await shrink(f).catch(() => null); if (pic) { await db.kvSet('profilePic', pic).catch(() => {}); render(); } };
  $('#fSet').onclick = dataSheet;
  const fb = $('#fFtp'); if (fb) fb.onclick = async () => { await save({ ftp: P.ftpEst.w }); render(); };
  $('#fExport').onclick = exportAll;
  import('./myworkouts-ui.js').then(m => m.profileSection($('#mwProf'), { ftp: () => S.ftp, hrMax: () => S.hrMax || 0, setFtp: async v => { await save({ ftp: v }); render(); } })).catch(() => {}); // personal workouts + FTP (js/myworkouts-ui.js)
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
  s.innerHTML = `<div class="psheetin"><div class="label">My data</div><p class="hint">These values apply everywhere in the app: zones, target watts, calories and the fitness calculation.</p>
    ${f('dKg', 'Weight', S.riderKg || '', 'kg', '75')}${f('dFtp', 'FTP', S.ftp || '', 'W', 'e.g. 250')}${f('dMax', 'Max HR', S.hrMax || '', '', 'auto')}${f('dRest', 'Resting HR', S.hrRest || '', '', '60')}
    <div class="pfoot"><button class="btn ghost" id="dX">Cancel</button><button class="btn" id="dOk">Save</button></div></div>`;
  const n = (id, lo, hi) => { const v = +$(id, s).value; return v >= lo && v <= hi ? v : undefined; };
  $('#dX', s).onclick = () => s.remove(); s.onclick = e => { if (e.target === s) s.remove(); };
  $('#dOk', s).onclick = async () => { const p = { riderKg: n('#dKg', 30, 200), ftp: n('#dFtp', 60, 600), hrMax: n('#dMax', 120, 230), hrRest: n('#dRest', 30, 110) };
    for (const k in p) if (p[k] === undefined) delete p[k]; await save(p); s.remove(); render(); };
}
async function exportAll() {
  const out = { exported: new Date().toISOString(), app: 'RIDEFRAME', settings: S, rides: await db.all('rides').catch(() => []), kraft: (await db.kvGet('kraft').catch(() => null)) || [], kraftExercises: (await db.kvGet('kraftEx').catch(() => null)) || [] };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); a.download = `RIDEFRAME_Daten_${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
await load(); render(); nav('profile');
