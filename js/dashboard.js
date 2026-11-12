// Training dashboard on top of "Fahrten & Rekorde" (Freddy 12.11.: "statistiken genau wie bei strava"): FTP and fitness at a
// glance, fitness/fatigue/form over 90 days, the power curve, weekly volume, the FTP trend, the fitness tests and a
// clean-up for junk rides. Numbers from js/stats.js; charts are plain SVG with a hover title on every point/bar.
import { usable, pmc, powerCurve, weekly, estimateFTP } from './stats.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = v => Math.round(v || 0).toLocaleString('de-DE');
const n1 = v => (v || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dshort = t => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
let W = 640; const PAD = { l: 38, r: 10, t: 10, b: 22 };

/** rides that are junk: under 3 minutes or (almost) no distance */
export const junkRides = rides => (rides || []).filter(r => (r.duration || 0) < 180 || (r.distance || 0) < 100);

function axisY(lo, hi, h, fmt = n0) {
  const step = niceStep((hi - lo) / 4), out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const y = PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (h - PAD.t - PAD.b);
    out.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" class="${v === 0 ? 'zero' : 'grid'}"/><text x="${PAD.l - 6}" y="${y + 4}" class="ax" text-anchor="end">${fmt(v)}</text>`);
  }
  return out.join('');
}
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x || 1)), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
const sx = (i, n) => PAD.l + (n <= 1 ? 0 : i / (n - 1)) * (W - PAD.l - PAD.r);
const path = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

/** fitness (accent) + fatigue (dashed) over 90 days, form as bars below */
function pmcSVG(days) {
  const h = 200, n = days.length, hi = Math.max(20, ...days.map(d => Math.max(d.ctl, d.atl))) * 1.1;
  const y = v => PAD.t + (1 - v / hi) * (h - PAD.t - PAD.b);
  const ticks = days.map((d, i) => [d, i]).filter(([d]) => new Date(d.t).getDate() === 1).map(([d, i]) => `<text x="${sx(i, n)}" y="${h - 6}" class="ax" text-anchor="middle">${new Date(d.t).toLocaleDateString('de-DE', { month: 'short' })}</text>`).join('');
  const hit = days.map((d, i) => `<rect x="${sx(i, n) - W / n / 2}" y="${PAD.t}" width="${W / n}" height="${h - PAD.t - PAD.b}" class="hit"><title>${dshort(d.t)} · Fitness ${n0(d.ctl)} · Ermüdung ${n0(d.atl)} · Form ${n0(d.tsb)}${d.load ? ` · Belastung ${n0(d.load)}` : ''}</title></rect>`).join('');
  // form: same unit, own small chart under it (no second axis)
  const fh = 140, fm = Math.max(10, ...days.map(d => Math.abs(d.tsb))) * 1.1, fy = v => PAD.t + (1 - (v + fm) / (2 * fm)) * (fh - PAD.t - PAD.b);
  const bw = Math.max(1.5, (W - PAD.l - PAD.r) / n - 1.5);
  const form = days.map((d, i) => { const a = fy(0), b = fy(d.tsb); return `<rect x="${sx(i, n) - bw / 2}" y="${Math.min(a, b)}" width="${bw}" height="${Math.max(1, Math.abs(b - a))}" class="${d.tsb >= 0 ? 'fpos' : 'fneg'}"><title>${dshort(d.t)} · Form ${n0(d.tsb)}</title></rect>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${h}" class="dchart" role="img" aria-label="Fitness und Ermüdung, 90 Tage">${axisY(0, hi, h)}
      <path d="${path(days.map((d, i) => [sx(i, n), y(d.atl)]))}" class="l2"/><path d="${path(days.map((d, i) => [sx(i, n), y(d.ctl)]))}" class="l1"/>${ticks}${hit}</svg>
    <div class="dsub">Form (Fitness minus Ermüdung): über 0 frisch, unter 0 müde</div>
    <svg viewBox="0 0 ${W} ${fh}" class="dchart" role="img" aria-label="Form, 90 Tage">${axisY(-fm, fm, fh)}${form}</svg>`;
}

/** best watts per duration: all time (dashed) vs the last 6 weeks (accent) */
function curveSVG(cv) {
  const h = 200, n = cv.length, hi = Math.max(100, ...cv.map(c => c.all)) * 1.1, y = v => PAD.t + (1 - v / hi) * (h - PAD.t - PAD.b);
  const all = cv.filter(c => c.all).map(c => [sx(cv.indexOf(c), n), y(c.all)]), now = cv.filter(c => c.now).map(c => [sx(cv.indexOf(c), n), y(c.now)]);
  const dots = cv.map((c, i) => `${c.all ? `<circle cx="${sx(i, n)}" cy="${y(c.all)}" r="4" class="d2"/>` : ''}${c.now ? `<circle cx="${sx(i, n)}" cy="${y(c.now)}" r="4" class="d1"/>` : ''}
      <rect x="${sx(i, n) - 30}" y="${PAD.t}" width="60" height="${h - PAD.t - PAD.b}" class="hit"><title>${c.label}: Bestwert ${c.all ? n0(c.all) + ' W' + (c.date ? ' (' + new Date(c.date).toLocaleDateString('de-DE') + ')' : '') : '–'} · letzte 6 Wochen ${c.now ? n0(c.now) + ' W' : '–'}</title></rect>
      <text x="${sx(i, n)}" y="${h - 6}" class="ax" text-anchor="middle">${c.label}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${h}" class="dchart" role="img" aria-label="Leistungskurve">${axisY(0, hi, h)}<path d="${path(all)}" class="l2"/><path d="${path(now)}" class="l1"/>${dots}</svg>`;
}

/** weekly hours as bars, the FTP estimate per week as dots underneath */
function weeksSVG(wk, ftp) {
  const h = 170, n = wk.length, hi = Math.max(2, ...wk.map(w => w.h)) * 1.15, y = v => PAD.t + (1 - v / hi) * (h - PAD.t - PAD.b);
  const bw = (W - PAD.l - PAD.r) / n - 6;
  const bars = wk.map((w, i) => { const x = PAD.l + i * (W - PAD.l - PAD.r) / n + 3;
    return `${w.h ? `<path d="M${x},${y(0)}V${y(w.h) + 4}q0,-4 4,-4h${bw - 8}q4,0 4,4V${y(0)}Z" class="bar"/>` : ''}
      <rect x="${x}" y="${PAD.t}" width="${bw}" height="${h - PAD.t - PAD.b}" class="hit"><title>Woche ab ${dshort(w.t)}: ${n1(w.h)} h · ${n0(w.km)} km · ${n0(w.hm)} Hm · ${w.n} ${w.n === 1 ? 'Fahrt' : 'Fahrten'} · Belastung ${n0(w.load)}</title></rect>
      ${i % 2 === n % 2 ? '' : `<text x="${x + bw / 2}" y="${h - 6}" class="ax" text-anchor="middle">${dshort(w.t)}</text>`}`; }).join('');
  // FTP trend: own chart (watts, not hours)
  const fw = wk.filter(w => w.eftp > 0), fh = 120;
  let trend = '<div class="dsub">FTP-Schätzung pro Woche: noch keine Fahrt mit 20 Minuten am Stück</div>';
  if (fw.length) {
    const vals = [...fw.map(w => w.eftp), ftp || 0].filter(Boolean), lo = Math.min(...vals) * 0.9, hi2 = Math.max(...vals) * 1.05, fy = v => PAD.t + (1 - (v - lo) / (hi2 - lo || 1)) * (fh - PAD.t - PAD.b);
    const cx = i => PAD.l + (i + 0.5) * (W - PAD.l - PAD.r) / n;
    const pts = wk.map((w, i) => w.eftp > 0 ? [cx(i), fy(w.eftp)] : null).filter(Boolean);
    trend = `<div class="dsub">FTP-Schätzung pro Woche (95 % der besten 20 min oder Test)${ftp ? ` · Linie: eingestellte FTP ${ftp} W` : ''}</div>
      <svg viewBox="0 0 ${W} ${fh}" class="dchart" role="img" aria-label="FTP-Schätzung pro Woche">${axisY(lo, hi2, fh)}
      ${ftp ? `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${fy(ftp)}" y2="${fy(ftp)}" class="ref"/>` : ''}<path d="${path(pts)}" class="l1"/>
      ${wk.map((w, i) => w.eftp > 0 ? `<circle cx="${cx(i)}" cy="${fy(w.eftp)}" r="4" class="d1"/><rect x="${cx(i) - 20}" y="${PAD.t}" width="40" height="${fh - PAD.t - PAD.b}" class="hit"><title>Woche ab ${dshort(w.t)}: ${n0(w.eftp)} W</title></rect>` : '').join('')}</svg>`;
  }
  return `<svg viewBox="0 0 ${W} ${h}" class="dchart" role="img" aria-label="Stunden pro Woche">${axisY(0, hi, h, v => n1(v).replace(',0', '') + ' h')}${bars}</svg>${trend}`;
}

const formWord = tsb => tsb > 15 ? 'sehr frisch, Zeit für etwas Hartes' : tsb > 5 ? 'frisch' : tsb > -10 ? 'ausgeglichen' : tsb > -30 ? 'im Training, gut belastet' : 'sehr müde, Pause einplanen';

/** the dashboard HTML (inserted above the record tiles) */
export function dashboardHTML(allRides, settings) {
  const rides = usable(allRides), ftp = settings.ftp || 0, junk = junkRides(allRides);
  const clean = junk.length ? `<div class="djunk"><span>${junk.length} ${junk.length === 1 ? 'kurzer Versuch' : 'kurze Versuche'} (unter 3 min oder fast 0 km)</span><button class="btn ghost small" id="dJunk">Alle löschen</button></div>` : '';
  const tests = `<div class="dtest"><div><div class="label">Fitnesstest</div><p>Misst deine FTP neu. Danach kannst du den Wert mit einem Klick übernehmen, alle Ziel-Watt passen sich an.</p>
      ${(() => { const t = allRides.filter(r => r.ftpTest).sort((a, b) => b.date - a.date)[0]; return t ? `<p class="dim">Letzter Test: ${new Date(t.date).toLocaleDateString('de-DE')} · ${t.ftpTest} W</p>` : ''; })()}</div>
      <div class="dbtns"><button class="btn small" data-test="ramp">Rampentest · ca. 25 min</button><button class="btn ghost small" data-test="ftp20">20-min-Test · ca. 60 min</button></div></div>`;
  if (!rides.length) return `<div class="dash">${tests}${clean}<div class="empty">Noch keine Fahrt mit Wattwerten. Nach der ersten Fahrt siehst du hier Fitness, Form und deine Leistungskurve.</div></div>`;
  const days = pmc(rides, ftp || 200), today = days[days.length - 1], wkAgo = days[days.length - 8] || days[0];
  const cv = powerCurve(rides), wk = weekly(rides, ftp || 200), est = estimateFTP(rides), thisWk = wk[wk.length - 1];
  const dCtl = today.ctl - wkAgo.ctl;
  return `<div class="dash">
    <div class="records dtiles">
      <div class="record"><div class="label">FTP</div><div class="v">${ftp || '–'}<small>W</small></div><div class="s">${est ? `Geschätzt ${est.w} W · ${esc(est.from)}${ftp && Math.abs(est.w - ftp) >= 5 ? ` <button class="btn ghost small" id="dFtp" data-w="${est.w}">${est.w} W übernehmen</button>` : ''}` : 'Fahre 20 min am Stück oder mach einen Test'}${settings.riderKg && ftp ? ` · ${n1(ftp / settings.riderKg)} W/kg` : ''}</div></div>
      <div class="record"><div class="label">Fitness</div><div class="v">${n0(today.ctl)}</div><div class="s">${dCtl >= 0.5 ? '+' + n0(dCtl) : dCtl <= -0.5 ? '−' + n0(-dCtl) : '±0'} in 7 Tagen · Schnitt der Belastung über 6 Wochen</div></div>
      <div class="record"><div class="label">Form</div><div class="v">${today.tsb > 0.5 ? '+' : ''}${n0(today.tsb)}</div><div class="s">${formWord(today.tsb)} · Ermüdung ${n0(today.atl)}</div></div>
      <div class="record"><div class="label">Diese Woche</div><div class="v">${n1(thisWk.h)}<small>h</small></div><div class="s">${n0(thisWk.km)} km · ${n0(thisWk.hm)} Hm · ${thisWk.n} ${thisWk.n === 1 ? 'Fahrt' : 'Fahrten'} · Belastung ${n0(thisWk.load)}</div></div>
    </div>
    <div class="dgrid">
      <div class="dcard wide"><div class="dhead"><h3>Fitness &amp; Ermüdung</h3><div class="dleg"><span class="k1"></span>Fitness (6 Wochen)<span class="k2"></span>Ermüdung (7 Tage)</div></div>${(W = 1240, pmcSVG(days))}</div>
      <div class="dcard"><div class="dhead"><h3>Leistungskurve</h3><div class="dleg"><span class="k1"></span>letzte 6 Wochen<span class="k2"></span>Bestwert</div></div>${(W = 640, curveSVG(cv))}
        <table class="table dtab"><tr>${cv.map(c => `<th class="label">${c.label}</th>`).join('')}</tr><tr>${cv.map(c => `<td>${c.all ? n0(c.all) : '–'}</td>`).join('')}</tr>${settings.riderKg ? `<tr>${cv.map(c => `<td class="dim">${c.all ? n1(c.all / settings.riderKg) : '–'}</td>`).join('')}</tr>` : ''}</table></div>
      <div class="dcard"><div class="dhead"><h3>Stunden pro Woche</h3><div class="dleg">12 Wochen</div></div>${(W = 640, weeksSVG(wk, ftp))}</div>
    </div>
    ${tests}${clean}</div>`;
}

/** buttons: take over the FTP estimate, start a test, delete the junk */
export function wireDashboard(main, { state, saveSettings, startTest, deleteRides, rerender, toast }) {
  main.querySelector('#dFtp')?.addEventListener('click', async e => { const w = +e.currentTarget.dataset.w; if (!confirm(`FTP von ${state.settings.ftp} W auf ${w} W ändern?`)) return; state.settings.ftp = w; await saveSettings(); toast(`FTP jetzt ${w} W`); rerender(); });
  main.querySelectorAll('[data-test]').forEach(b => b.onclick = () => startTest(b.dataset.test));
  main.querySelector('#dJunk')?.addEventListener('click', async () => {
    const j = junkRides(state.rides); if (!j.length) return;
    if (!confirm(`${j.length} kurze ${j.length === 1 ? 'Fahrt' : 'Fahrten'} endgültig löschen?\n\n` + j.slice(0, 12).map(r => `${new Date(r.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · ${Math.round((r.duration || 0) / 60)} min · ${((r.distance || 0) / 1000).toFixed(1)} km`).join('\n') + (j.length > 12 ? `\n… und ${j.length - 12} weitere` : ''))) return;
    await deleteRides(j); rerender();
  });
}

