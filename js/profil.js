// RIDEFRAME profile (profil.html, Freddy 16.11.): one place for the athlete: picture, the own numbers, fitness over ALL
// sports, estimates (FTP, VO2max), bests, totals and points. Like the Strava profile, with more data. Also the settings
// that belong to the person (weight, FTP, heart rate) and the export of all data.
import { db } from './db.js';
import { fmtTime, fmtNum, esc, twoWeeks } from './util.js';
import { MODES, icon, applyTheme } from './theme.js';
import { profileOf, loadOf, pmcAll, vo2, runBests, totals, streak, sportOf } from './fitness.js';

const el = document.getElementById('profil'), $ = (s, r = document) => r.querySelector(s);
let S = {}, acts = [], kraft = [], acc = null, pic = null;

async function load() {
  S = (await db.kvGet('settings').catch(() => null)) || {}; applyTheme(S, null);
  const rides = (await db.all('rides').catch(() => [])).filter(r => r.routeId !== 'demo' && !r.unsaved && r.date);
  kraft = ((await db.kvGet('kraft').catch(() => null)) || []).map(k => ({ ...k, kraft: true, date: k.start || k.date }));
  acts = [...rides, ...kraft].sort((a, b) => a.date - b.date);
  pic = await db.kvGet('profilePic').catch(() => null);
  try { acc = (await import('./account.js')).account(); } catch {}
}
async function save(patch) { const st = (await db.kvGet('settings').catch(() => null)) || {}; Object.assign(st, patch); Object.assign(S, patch); await db.kvSet('settings', st).catch(() => {});
  import('./account.js').then(a => a.settingsChanged?.(st)).catch(() => {}); }

const paceT = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const hrs = s => s >= 36000 ? fmtNum(s / 3600, 0) + ' h' : fmtNum(s / 3600, 1) + ' h';
const formTxt = v => v > 15 ? 'sehr frisch' : v > 5 ? 'frisch' : v > -10 ? 'im Training' : v > -25 ? 'müde' : 'sehr müde';
const level = p => { const L = [[0, 'Einsteiger'], [500, 'Aktiv'], [2000, 'Fit'], [5000, 'Stark'], [10000, 'Sehr stark'], [20000, 'Elite']]; let i = 0; while (i < L.length - 1 && p >= L[i + 1][0]) i++; return { name: L[i][1], next: L[i + 1]?.[0] || null, from: L[i][0] }; };

function render() {
  const P = profileOf(S, acts), pm = pmcAll(acts, P, 90), now = pm[pm.length - 1] || { ctl: 0, atl: 0, tsb: 0 }, ago = pm[Math.max(0, pm.length - 29)] || now;
  const V = vo2(acts, P), RB = runBests(acts), T = totals(acts), pts = Math.round(acts.reduce((a, x) => a + loadOf(x, P).pts, 0)), lv = level(pts);
  const W2 = twoWeeks(acts), wp = l => Math.round(l.reduce((a, x) => a + loadOf(x, P).pts, 0)), src = {}; for (const a of acts.slice(-30)) { const s = loadOf(a, P).src; src[s] = (src[s] || 0) + 1; }
  const best20 = Math.max(0, ...acts.filter(a => !a.kraft).map(a => a.best20 || 0)), longest = acts.filter(a => !a.kraft && sportOf(a) !== 'run').sort((a, b) => b.distance - a.distance)[0];
  const e1 = (kg, r) => kg > 0 && r > 0 ? (r === 1 ? kg : kg * (1 + r / 30)) : 0, lifts = new Map();
  for (const k of kraft) for (const x of k.ex || []) if (x.t === 'w') for (const y of x.sets || []) if (y.done) { const v = e1(+y.kg, +y.r); if (v > (lifts.get(x.n) || 0)) lifts.set(x.n, v); }
  const top = [...lifts].sort((a, b) => b[1] - a[1]).slice(0, 3), st = streak(acts);
  const stat = (v, l, s = '') => `<div><b>${v}</b><small>${l}</small>${s ? `<em class="wd">${s}</em>` : ''}</div>`;
  const row = (l, v, s = '') => `<div class="prow2"><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  el.innerHTML = `<header class="ptop"><a class="pback" href="handy.html" title="Zur App">‹</a><div class="pbrand"><b>RIDEFRAME </b><span>Profil</span></div>
      <button class="pgear" id="fSet" title="Meine Daten">${icon('gear', 'gico')}</button></header>
    <section class="fhead"><button class="favatar" id="fPic" title="Profilbild ändern">${pic ? `<img src="${pic}" alt="">` : `<span>${esc((acc?.name || S.name || '?').slice(0, 1).toUpperCase())}</span>`}</button>
      <div><h1>${esc(acc?.name || S.name || 'Dein Profil')}</h1><p>${lv.name} · ${fmtNum(pts)} Punkte${st ? ` · ${st} ${st === 1 ? 'Woche' : 'Wochen'} in Folge aktiv` : ''}</p>
      ${lv.next ? `<div class="fbar"><i style="width:${Math.min(100, (pts - lv.from) / (lv.next - lv.from) * 100)}%"></i></div><small>noch ${fmtNum(lv.next - pts)} Punkte bis zur nächsten Stufe</small>` : ''}</div></section>
    <input type="file" id="fFile" accept="image/*" hidden>

    <section class="hweek"><div class="hwhead"><span class="label">Fitness über alle Sportarten</span><span class="wdl">42 Tage</span></div>
      <div class="kstats k3">${stat(fmtNum(now.ctl, 0), 'Fitness', `${now.ctl - ago.ctl >= 0 ? '▲ +' : '▼ −'}${fmtNum(Math.abs(now.ctl - ago.ctl), 0)} in 4 Wochen`)}${stat(fmtNum(now.atl, 0), 'Ermüdung', '7 Tage')}${stat((now.tsb > 0 ? '+' : '') + fmtNum(now.tsb, 0), 'Form', formTxt(now.tsb))}</div>
      ${pmChart(pm)}
      <p class="hint">Jede Einheit zählt: 100 Punkte = eine Stunde an der Schwelle. Berechnet aus Watt, sonst Puls, sonst Pace, sonst Dauer${Object.keys(src).length ? ` (zuletzt: ${Object.entries(src).map(([k, n]) => `${n}× ${k}`).join(', ')})` : ''}.</p></section>

    <section class="hweek"><div class="hwhead"><span class="label">Diese Woche</span><span class="wdl">Vorwoche: ${wp(W2.prev)} Punkte</span></div>
      <div class="kstats k3">${stat(wp(W2.cur), 'Punkte')}${stat(W2.cur.length, 'Einheiten', `Vorwoche ${W2.prev.length}`)}${stat(hrs(W2.cur.reduce((a, x) => a + (x.kraft ? x.dur || 0 : x.duration || 0), 0)), 'Zeit')}</div></section>

    <h3 class="ksec">Schätzwerte</h3>
    <section class="kcard fest">
      ${row('FTP', S.ftp ? `${S.ftp} W` : '–', S.ftp ? `${fmtNum(S.ftp / P.kg, 1)} W/kg` : 'noch nicht eingetragen')}
      ${P.ftpEst && P.ftpEst.w !== S.ftp ? `<div class="fsug"><span>Schätzung aus deinen Fahrten: <b>${P.ftpEst.w} W</b> (${esc(P.ftpEst.from)})</span><button class="btn ghost ksmall" id="fFtp">Übernehmen</button></div>` : ''}
      ${row('VO2max Rad', V.bike ? `≈ ${fmtNum(V.bike.v, 0)}` : '–', V.bike ? `±${V.bike.pm} · aus ${V.bike.from}` : 'braucht 5 min mit Wattmessung')}
      ${row('VO2max Laufen', V.run ? `≈ ${fmtNum(V.run.v, 0)}` : '–', V.run ? `±${V.run.pm} · aus ${V.run.from}` : 'braucht einen Lauf ab 6 min')}
      ${row('Schwellen-Pace', P.runThr ? `≈ ${paceT(1000 / P.runThr)} min/km` : '–', P.runThr ? 'aus deinen Läufen ab 15 min' : '')}
      ${row('Max-Puls', P.hrMax ? `${P.hrMax}` : '–', S.hrMax ? 'eingetragen' : P.hrMax ? 'höchster gemessener Wert' : 'noch kein Pulsgurt')}
      <p class="hint">Schätzungen aus deinen eigenen Daten, keine Labormessung. Je mehr harte Einheiten, desto genauer.</p></section>

    <h3 class="ksec">Bestwerte</h3>
    <section class="kcard fest">
      ${row('Beste 20 min', best20 ? `${Math.round(best20)} W` : '–')}${row('Längste Fahrt', longest ? `${fmtNum(longest.distance / 1000, 1)} km` : '–')}
      ${[1, 5, 10].map(n => row(`Laufen ${n} km`, RB[n] ? paceT(RB[n].t) + (RB[n].t >= 3600 ? '' : ' min') : '–', RB[n] ? new Date(RB[n].date).toLocaleDateString('de-DE') : '')).join('')}
      ${top.map(([n, v]) => row(esc(n), `${fmtNum(v, 1)} kg`, 'geschätztes 1RM')).join('')}</section>

    <h3 class="ksec">Gesamt</h3>
    <section class="ftot">${['ride', 'run', 'trainer', 'world', 'kraft'].map(m => { const t = T[m]; return `<a class="ftrow" href="${MODES[m].href}" style="--mc:${MODES[m].color};--mcl:${MODES[m].light}">${icon(m, 'rico')}<div><b>${MODES[m].name}</b>
      <small>${t ? `${t.n}× · ${hrs(t.sec)}${t.m ? ` · ${fmtNum(t.m / 1000, 0)} km` : ''}${t.gain ? ` · ${fmtNum(t.gain)} m Anstieg` : ''}` : 'noch nichts'}</small></div></a>`; }).join('')}</section>
    <div class="pfoot col" style="margin-top:8px"><button class="btn ghost" id="fExport">Alle meine Daten exportieren</button></div>`;
  $('#fPic').onclick = () => $('#fFile').click();
  $('#fFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; pic = await shrink(f).catch(() => null); if (pic) { await db.kvSet('profilePic', pic).catch(() => {}); render(); } };
  $('#fSet').onclick = dataSheet;
  const fb = $('#fFtp'); if (fb) fb.onclick = async () => { await save({ ftp: P.ftpEst.w }); render(); };
  $('#fExport').onclick = exportAll;
}
/** fitness (line) and form (bars up/down) of the last 90 days */
function pmChart(pm) {
  if (pm.length < 2 || !pm.some(p => p.load > 0)) return '<p class="hint">Nach den ersten Einheiten siehst du hier deinen Fitness-Verlauf.</p>';
  const W = 320, H = 96, hi = Math.max(10, ...pm.map(p => Math.max(p.ctl, p.atl))), x = i => i / (pm.length - 1) * W, y = v => H - 4 - v / hi * (H - 12);
  const line = k => pm.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  return `<svg class="kchart fpm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fitness und Ermüdung, 90 Tage"><path d="${line('atl')}" class="fatl"/><path d="${line('ctl')}" class="kline"/></svg>
    <div class="fleg"><span><i class="l1"></i>Fitness</span><span><i class="l2"></i>Ermüdung</span><span>letzte 90 Tage</span></div>`;
}
/** picture -> square 256 px JPEG data URL (stays on this device) */
function shrink(file) { return new Promise((ok, no) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 256; const s = Math.min(im.width, im.height);
  c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 256, 256); URL.revokeObjectURL(im.src); ok(c.toDataURL('image/jpeg', .85)); }; im.onerror = no; im.src = URL.createObjectURL(file); }); }
function dataSheet() {
  const s = document.createElement('div'); s.className = 'psheet'; document.body.append(s);
  const f = (id, l, v, u, ph = '') => `<label class="prow"><span>${l}</span><input id="${id}" type="number" inputmode="decimal" value="${v ?? ''}" placeholder="${ph}"><span>${u}</span></label>`;
  s.innerHTML = `<div class="psheetin"><div class="label">Meine Daten</div><p class="hint">Diese Werte gelten überall in der App: Zonen, Ziel-Watt, Kalorien und die Fitness-Berechnung.</p>
    ${f('dKg', 'Gewicht', S.riderKg || '', 'kg', '75')}${f('dFtp', 'FTP', S.ftp || '', 'W', 'z. B. 250')}${f('dMax', 'Max-Puls', S.hrMax || '', '', 'automatisch')}${f('dRest', 'Ruhepuls', S.hrRest || '', '', '60')}
    <div class="pfoot"><button class="btn ghost" id="dX">Abbrechen</button><button class="btn" id="dOk">Speichern</button></div></div>`;
  const n = (id, lo, hi) => { const v = +$(id, s).value; return v >= lo && v <= hi ? v : undefined; };
  $('#dX', s).onclick = () => s.remove(); s.onclick = e => { if (e.target === s) s.remove(); };
  $('#dOk', s).onclick = async () => { const p = { riderKg: n('#dKg', 30, 200), ftp: n('#dFtp', 60, 600), hrMax: n('#dMax', 120, 230), hrRest: n('#dRest', 30, 110) };
    for (const k in p) if (p[k] === undefined) delete p[k]; await save(p); s.remove(); render(); };
}
async function exportAll() {
  const out = { exported: new Date().toISOString(), app: 'RIDEFRAME', settings: S, rides: await db.all('rides').catch(() => []), kraft: (await db.kvGet('kraft').catch(() => null)) || [], kraftExercises: (await db.kvGet('kraftEx').catch(() => null)) || [] };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); a.download = `RIDEFRAME_Daten_${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
await load(); render();
