// One training load for every activity (Freddy 16.11.: profile statistics like Strava, "nur noch mehr Daten"; Fable review:
// fitness must not count runs, rides without a power meter and strength as zero). 100 points = one hour at threshold.
// Source per activity, best first: watts (TSS) -> heart rate (share of heart-rate reserve) -> running pace against the
// own threshold pace -> duration with a fixed factor. Pure functions; profil.js draws them.
import { normPower, best, estimateFTP } from './stats.js';
import { e1rm } from './kraftlib.js';
import { groupOf, famOf } from './sports.js';

const DAY = 864e5;
const dayKey = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const sportOf = a => a.kraft ? 'kraft' : a.sportType ? groupOf(a.sportType) : a.routeId === 'run' || a.sport === 'run' ? 'run' : a.routeId === 'outdoor' ? 'ride' : a.routeId === 'pure' ? 'trainer' : 'world';
/** cycling of any kind (outdoor, indoor, virtual, imported): the only activities FTP, power bests and "longest ride" look at */
export const isBike = a => !a.kraft && famOf(sportOf(a)) === 'bike';
const col = (a, i) => (a.samples || []).map(s => s[i] || 0);
const share = v => v.length ? v.filter(x => x > 0).length / v.length : 0;
const mean = v => { const p = v.filter(x => x > 0); return p.length ? p.reduce((x, y) => x + y, 0) / p.length : 0; };

/** the athlete's numbers with sensible fallbacks; est = what we derive from the data */
export function profileOf(S = {}, acts = []) {
  const rides = acts.filter(isBike), runs = acts.filter(a => sportOf(a) === 'run');
  const hrSeen = Math.max(0, ...acts.filter(a => !a.kraft).map(a => Math.max(+a.maxHr || 0, ...col(a, 5))));
  const thr = runs.filter(r => r.duration >= 900 && r.distance > 1500).map(r => r.distance / r.duration); // m/s of every run of 15+ min
  return { kg: S.riderKg || 75, ftp: S.ftp || 0, hrMax: S.hrMax || (hrSeen > 120 ? hrSeen : 0), hrRest: S.hrRest || 60,
    runThr: thr.length ? Math.max(...thr) * 0.97 : 0, ftpEst: estimateFTP(rides.filter(r => (r.samples || []).length >= 120).sort((a, b) => a.date - b.date)) || null, hrSeen };
}

const PER_H = { run: 60, walk: 25, other: 35 }; // points per hour without watts, heart rate or pace (45 = steady endurance)
/** { pts, src } for one activity; src = 'Watt' | 'Puls' | 'Pace' | 'Dauer' */
export function loadOf(a, P) {
  const h = (a.kraft ? a.dur || 0 : a.duration || 0) / 3600; if (h <= 0) return { pts: 0, src: 'duration' };
  if (a.kraft) return { pts: h * 45, src: 'duration' };
  const pw = col(a, 2), hr = col(a, 5);
  if (P.ftp && share(pw) > 0.5) { const np = normPower(pw), f = np / P.ftp; return { pts: pw.length * np * f / (P.ftp * 3600) * 100, src: 'power' }; }
  if (P.ftp && a.np > 0) { const f = a.np / P.ftp; return { pts: h * f * f * 100, src: 'power' }; }
  if (P.hrMax && share(hr) > 0.5) { const r = Math.max(0, (mean(hr) - P.hrRest) / (P.hrMax - P.hrRest)), f = Math.min(1.25, r / 0.85); return { pts: h * f * f * 100, src: 'heart rate' }; }
  if (P.hrMax && a.avgHr > 0 && !(a.samples || []).length) { const r = Math.max(0, (a.avgHr - P.hrRest) / (P.hrMax - P.hrRest)), f = Math.min(1.25, r / 0.85); return { pts: h * f * f * 100, src: 'heart rate' }; } // imported / manual: the average only
  if (sportOf(a) === 'run' && P.runThr && a.distance > 0) { const f = Math.min(1.2, a.distance / a.duration / P.runThr); return { pts: h * f * f * 100, src: 'pace' }; }
  return { pts: h * (PER_H[sportOf(a)] || 45), src: 'duration' };
}

/** fitness (42 d), fatigue (7 d) and form per day over all sports */
export function pmcAll(acts, P, days = 90) { return pmcLoads(acts.map(a => [a.date, loadOf(a, P).pts]), days); }
/** the same from [date, points] pairs (the server keeps the points of big ride files cached: tools/coachdata.mjs) */
export function pmcLoads(loads, days = 90) {
  const load = new Map(); for (const [t, p] of loads) { const k = dayKey(t); load.set(k, (load.get(k) || 0) + p); }
  const end = dayKey(Date.now()), first = loads.length ? Math.min(...loads.map(([t]) => dayKey(t)), end - days * DAY) : end - days * DAY;
  const out = []; let ctl = 0, atl = 0;
  for (let t = first; t <= end; t += DAY) { const l = load.get(t) || 0, tsb = ctl - atl; ctl += (l - ctl) / 42; atl += (l - atl) / 7; if (t > end - days * DAY) out.push({ t, load: l, ctl, atl, tsb }); }
  return out;
}

/** form (fitness minus fatigue) in words, like the profile page and the coach's data say it */
export const formWords = v => v > 15 ? 'very fresh' : v > 5 ? 'fresh' : v > -10 ? 'training' : v > -25 ? 'tired' : 'very tired';

/** VO2max estimates, always with a range: bike from the best 5 minutes, run from the best effort (Daniels) */
export function vo2(acts, P, days = 180) {
  const since = Date.now() - days * DAY, rec = acts.filter(a => !a.kraft && a.date > since);
  const p5 = Math.max(0, ...rec.filter(isBike).map(a => a.best5 || best(col(a, 2), 300)));
  const bike = p5 > 0 ? { v: 10.8 * p5 / P.kg + 7, pm: 4, from: `${Math.round(p5)} W over 5 min` } : null;
  let run = null;
  for (const a of rec.filter(a => sportOf(a) === 'run' && a.distance >= 1500 && a.duration >= 360)) {
    const efforts = [[a.distance, a.duration]]; const k = a.kmSplits || [];
    for (const n of [3, 5, 10]) for (let i = 0; i + n <= k.length; i++) efforts.push([n * 1000, k.slice(i, i + n).reduce((x, y) => x + y, 0)]);
    for (const [d, t] of efforts) { const tm = t / 60, v = d / tm, c = -4.6 + 0.182258 * v + 0.000104 * v * v, pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * tm) + 0.2989558 * Math.exp(-0.1932605 * tm), x = c / pct;
      if (tm >= 6 && (!run || x > run.v)) run = { v: x, pm: 4, from: `${(d / 1000).toFixed(1)} km in ${Math.floor(tm)}:${String(Math.round(t % 60)).padStart(2, '0')}` }; }
  }
  return { bike, run };
}

/** best running times over 1, 5 and 10 km from the km splits */
export function runBests(acts) {
  const out = {}; for (const a of acts.filter(a => sportOf(a) === 'run')) { const k = a.kmSplits || [];
    for (const n of [1, 5, 10]) for (let i = 0; i + n <= k.length; i++) { const t = k.slice(i, i + n).reduce((x, y) => x + y, 0); if (!out[n] || t < out[n].t) out[n] = { t, date: a.date }; } }
  return out;
}

/** totals per sport: count, seconds, metres */
export function totals(acts) {
  const o = {}; for (const a of acts) { const k = sportOf(a), x = (o[k] ||= { n: 0, sec: 0, m: 0, gain: 0 }); x.n++; x.sec += a.kraft ? a.dur || 0 : a.duration || 0; x.m += a.distance || 0; x.gain += a.gain || 0; }
  return o;
}
/** weeks in a row (ending with this one or the last) with at least `min` active days */
export function streak(acts, min = 3) {
  const wk = t => { const d = new Date(dayKey(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }, days = new Map();
  for (const a of acts) { const w = wk(a.date); (days.get(w) || days.set(w, new Set()).get(w)).add(dayKey(a.date)); }
  let w = new Date(wk(Date.now())), n = 0; if ((days.get(w.getTime())?.size || 0) < min) w.setDate(w.getDate() - 7);
  while ((days.get(w.getTime())?.size || 0) >= min) { n++; w.setDate(w.getDate() - 7); }
  return n;
}
/** the bests over all sports for the stats page: watts (20 / 5 min), longest ride, run times, strength records and the top lifts (estimated 1RM) */
export function bests(acts) {
  const bike = acts.filter(isBike), kr = acts.filter(a => a.kraft), lifts = new Map();
  for (const k of kr) for (const x of k.ex || []) if (x.t === 'w') for (const y of x.sets || []) if (y.done) { const v = e1rm(+y.kg, +y.r); if (v > (lifts.get(x.n) || 0)) lifts.set(x.n, v); }
  return { p20: Math.max(0, ...bike.map(a => a.best20 || 0)), p5: Math.max(0, ...bike.map(a => a.best5 || 0)), longest: bike.slice().sort((a, b) => b.distance - a.distance)[0] || null,
    run: runBests(acts), prs: kr.reduce((a, k) => a + (k.prs || 0), 0), lifts: [...lifts].sort((a, b) => b[1] - a[1]).slice(0, 3) };
}
