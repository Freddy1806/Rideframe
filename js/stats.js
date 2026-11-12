// Training statistics like on Strava / TrainingPeaks (Freddy 12.11.): fitness, fatigue and form from the training load of
// every ride, the power curve, an FTP estimate per week and the weekly volume. Pure functions over the saved rides
// (per-second samples [t, d, watts, km/h, rpm, bpm]); the Training tab draws them.

const DAY = 864e5;
const power = r => (r.samples || []).map(s => s[2] || 0);

/** normalized power: 30 s rolling average, 4th power mean */
export function normPower(pw) {
  if (pw.length < 30) return pw.length ? pw.reduce((a, b) => a + b, 0) / pw.length : 0;
  let s = 0, n = 0, acc = 0; for (let i = 0; i < pw.length; i++) { s += pw[i]; if (i >= 30) s -= pw[i - 30]; if (i >= 29) { acc += (s / 30) ** 4; n++; } }
  return (acc / n) ** 0.25;
}
/** best average over `sec` seconds (sliding window) */
export function best(pw, sec) {
  if (pw.length < sec) return 0; let s = 0, m = 0;
  for (let i = 0; i < pw.length; i++) { s += pw[i]; if (i >= sec) s -= pw[i - sec]; if (i >= sec - 1 && s > m) m = s; }
  return m / sec;
}
/** training stress of one ride (100 = one hour at FTP) */
export function tss(r, ftp) {
  const pw = power(r); if (!pw.length || !ftp) return 0;
  const np = normPower(pw), ifac = np / ftp; return (pw.length * np * ifac) / (ftp * 3600) * 100;
}

/** rides that count: real samples, at least 2 minutes, not ridden with the arrow keys */
export function usable(rides) { return (rides || []).filter(r => r.samples?.length >= 120 && !r.unsaved && r.date).sort((a, b) => a.date - b.date); }

const dayKey = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const monday = t => { const d = new Date(dayKey(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };

/** fitness (CTL, 42 d), fatigue (ATL, 7 d) and form (TSB) per day for the last `days` days */
export function pmc(rides, ftp, days = 90) {
  const load = new Map(); for (const r of rides) { const k = dayKey(r.date); load.set(k, (load.get(k) || 0) + tss(r, ftp)); }
  const end = dayKey(Date.now()), first = rides.length ? Math.min(dayKey(rides[0].date), end - days * DAY) : end - days * DAY;
  const out = []; let ctl = 0, atl = 0;
  for (let t = first; t <= end; t += DAY) { const l = load.get(t) || 0; const tsb = ctl - atl; ctl += (l - ctl) / 42; atl += (l - atl) / 7; if (t > end - days * DAY) out.push({ t, load: l, ctl, atl, tsb }); }
  return out;
}

/** power curve: best watts for each duration, over all rides and over the last `recent` days */
export const CURVE = [[5, '5 s'], [15, '15 s'], [60, '1 min'], [300, '5 min'], [600, '10 min'], [1200, '20 min'], [3600, '60 min']];
export function powerCurve(rides, recent = 42) {
  const since = Date.now() - recent * DAY, all = {}, now = {}, when = {};
  for (const r of rides) { const pw = power(r);
    for (const [s] of CURVE) { const b = best(pw, s); if (b > (all[s] || 0)) { all[s] = b; when[s] = r.date; } if (r.date >= since && b > (now[s] || 0)) now[s] = b; } }
  return CURVE.map(([s, label]) => ({ s, label, all: Math.round(all[s] || 0), now: Math.round(now[s] || 0), date: when[s] }));
}

/** per week (Monday) for the last `weeks`: hours, km, Hm, rides, training load and the FTP estimate (95 % of the best 20 min, or a test) */
export function weekly(rides, ftp, weeks = 12) {
  const start = monday(Date.now()) - (weeks - 1) * 7 * DAY, out = [];
  for (let k = 0; k < weeks; k++) out.push({ t: start + k * 7 * DAY, h: 0, km: 0, hm: 0, n: 0, load: 0, eftp: 0 });
  for (const r of rides) { const i = Math.floor((monday(r.date) - start) / (7 * DAY)); const w = out[i]; if (!w) continue;
    w.h += (r.duration || 0) / 3600; w.km += (r.distance || 0) / 1000; w.hm += r.gain || 0; w.n++; w.load += tss(r, ftp);
    const pw = power(r); w.eftp = Math.max(w.eftp, best(pw, 1200) * 0.95, r.ftpTest || 0); }
  return out;
}

/** FTP estimate from the last `days` days: tests first, else 95 % of the best 20 minutes */
export function estimateFTP(rides, days = 42) {
  const since = Date.now() - days * DAY, rs = rides.filter(r => r.date >= since);
  const test = rs.filter(r => r.ftpTest).sort((a, b) => b.date - a.date)[0];
  if (test) return { w: test.ftpTest, from: 'Test vom ' + new Date(test.date).toLocaleDateString('de-DE') };
  const b = Math.max(0, ...rs.map(r => best(power(r), 1200))); return b ? { w: Math.round(b * 0.95), from: '95 % deiner besten 20 min' } : null;
}

/** the result of a fitness test ride: ramp = 75 % of the best minute, 20-min test = 95 % of the best 20 minutes */
export function testResult(id, samples) {
  const pw = (samples || []).map(s => s[2] || 0);
  if (id === 'ramp') { const b = best(pw, 60); return b ? Math.round(b * 0.75) : 0; }
  if (id === 'ftp20') { const b = best(pw, 1200); return b ? Math.round(b * 0.95) : 0; }
  return 0;
}
