// The numbers behind the overview's cards (25.11., js/cards.js). Pure functions over the activities the phone already has
// (js/feed.js loadActs: rides of every sport and strength sessions, newest first) and the account's answers (body, health).
// No formulas of their own: training load, fitness, VO2max and the run bests are js/fitness.js, strength js/kraftlib.js,
// weeks js/util.js, the resting heart rate against its 7 days js/healthcard.js; here they are only summed up per card.
import { loadOf, pmcLoads, sportOf, isBike, vo2, runBests, formWords } from './fitness.js';
import { e1rm, nm, doneSets, sessVol } from './kraftlib.js';
import { weekStart } from './util.js';

const DAY = 864e5;
export const durOf = a => a.kraft ? a.dur || 0 : a.duration || 0;
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const back = (t, n) => { const d = new Date(t); d.setDate(d.getDate() - n); return d.getTime(); }; // n calendar days back (summer time safe)
const sum = (l, ld) => ({ n: l.length, sec: l.reduce((s, a) => s + durOf(a), 0), m: l.reduce((s, a) => s + (a.distance || 0), 0), pts: Math.round(l.reduce((s, a) => s + ld(a), 0)) });
/** the load points of one activity (js/fitness.js loadOf), remembered per activity: several cards ask for the same one */
export function loads(P) { const m = new WeakMap(); return a => { let v = m.get(a); if (v == null) { v = loadOf(a, P).pts; m.set(a, v); } return v; }; }

/** today, this week (Mon-Sun) and last week: sessions, seconds, metres, load points; ld = loads(P) */
export function weekSummary(acts, ld, now = Date.now()) {
  const w0 = weekStart(now), w1 = back(w0, 7), d0 = dayStart(now);
  const cur = acts.filter(a => a.date >= w0 && a.date <= now + DAY), prev = acts.filter(a => a.date >= w1 && a.date < w0);
  return { empty: !acts.length, today: sum(acts.filter(a => a.date >= d0 && a.date <= now + DAY), ld), cur: sum(cur, ld), prev: sum(prev, ld) };
}

/** fitness, fatigue and form now, the change over 4 weeks and the last `days` days as a series (for the small line) */
export function fitnessSummary(acts, ld, { days = 42, now = Date.now() } = {}) {
  if (!acts.length) return { empty: true };
  const pm = pmcLoads(acts.map(a => [a.date, ld(a)]), Math.max(days, 29)), t = pm[pm.length - 1], ago = pm[Math.max(0, pm.length - 29)];
  return { empty: !pm.some(p => p.load > 0), ctl: t.ctl, atl: t.atl, tsb: t.tsb, words: formWords(t.tsb), d28: t.ctl - ago.ctl,
    series: pm.slice(-days).map(p => ({ t: p.t, ctl: p.ctl, atl: p.atl })), now };
}

/** the last n days (today last): per day the load points per sport, [{ t, total, parts: [{ sport, pts }] }] */
export function loadDays(acts, ld, { n = 7, now = Date.now() } = {}) {
  const d0 = dayStart(now), out = [];
  for (let i = n - 1; i >= 0; i--) { const t = back(d0, i), t1 = back(d0, i - 1), by = new Map();
    for (const a of acts) if (a.date >= t && a.date < t1) { const s = sportOf(a); by.set(s, (by.get(s) || 0) + ld(a)); }
    const parts = [...by].map(([sport, pts]) => ({ sport, pts })).sort((x, y) => y.pts - x.pts);
    out.push({ t, total: parts.reduce((s, p) => s + p.pts, 0), parts }); }
  return { empty: !acts.length, days: out, total: Math.round(out.reduce((s, d) => s + d.total, 0)) };
}

/** strength: the last session, sets this week against last week, the newest records (sets marked as a record, one per exercise) */
export function strengthSummary(acts, { now = Date.now(), n = 3 } = {}) {
  const k = acts.filter(a => a.kraft).sort((a, b) => b.date - a.date); if (!k.length) return { empty: true };
  const w0 = weekStart(now), w1 = back(w0, 7), sets = l => l.reduce((s, a) => s + doneSets(a), 0), recs = [], seen = new Set();
  for (const a of k) for (const x of a.ex || []) for (const y of x.sets || []) if (y.pr && y.done !== false && !seen.has(x.k || x.n) && recs.length < n) {
    seen.add(x.k || x.n); recs.push({ t: a.date, name: nm(x), type: x.t, kg: +y.kg || 0, r: +y.r || 0, s: +y.s || 0, e1rm: x.t === 'w' ? e1rm(+y.kg, +y.r) : 0 }); }
  const last = k[0];
  return { empty: false, last: { id: last.id, name: last.name || 'Workout', t: last.date, sec: last.dur || 0, sets: doneSets(last), kg: sessVol(last), prs: last.prs || 0 },
    setsWeek: sets(k.filter(a => a.date >= w0)), setsPrev: sets(k.filter(a => a.date >= w1 && a.date < w0)), sessionsWeek: k.filter(a => a.date >= w0).length, records: recs };
}

/** the newest bests over all sports, newest first: every time a ride beat the 20 / 5 min power or the longest ride before it, a run
 *  the 1 / 5 / 10 km time before it, and the strength sets marked as a record; [{ t, sport, what, value, act }] */
export function recentRecords(acts, { n = 4 } = {}) {
  const out = [], old = acts.slice().sort((a, b) => a.date - b.date), hi = { p20: 0, p5: 0, far: 0 }, run = {};
  for (const a of old) {
    if (a.kraft) { for (const x of a.ex || []) { const y = (x.sets || []).filter(s => s.pr && s.done !== false).sort((p, q) => e1rm(+q.kg, +q.r) - e1rm(+p.kg, +p.r) || (+q.r - +p.r))[0];
      if (y) out.push({ t: a.date, sport: 'kraft', what: nm(x), value: x.t === 'time' ? `${+y.s || 0} s` : x.t === 'bw' ? `${+y.kg ? `+${+y.kg} kg × ` : ''}${+y.r || 0} reps` : `${+y.kg || 0} kg × ${+y.r || 0}`, act: a }); } continue; }
    if (isBike(a)) {
      if (a.best20 > hi.p20) { hi.p20 = a.best20; out.push({ t: a.date, sport: sportOf(a), what: 'Best 20 min power', value: `${Math.round(a.best20)} W`, act: a }); }
      if (a.best5 > hi.p5) { hi.p5 = a.best5; out.push({ t: a.date, sport: sportOf(a), what: 'Best 5 min power', value: `${Math.round(a.best5)} W`, act: a }); }
      if (a.distance > hi.far && a.distance >= 20000) { hi.far = a.distance; out.push({ t: a.date, sport: sportOf(a), what: 'Longest ride', value: `${Math.round(a.distance / 100) / 10} km`, act: a }); }
    } else if (sportOf(a) === 'run') { const b = runBests([a]);
      for (const k of [1, 5, 10]) if (b[k] && (!run[k] || b[k].t < run[k])) { run[k] = b[k].t; out.push({ t: a.date, sport: 'run', what: `Fastest ${k} km`, value: `${Math.floor(b[k].t / 60)}:${String(Math.round(b[k].t % 60)).padStart(2, '0')}`, act: a }); } }
  }
  const l = out.sort((a, b) => b.t - a.t), seen = new Set(), pick = [];
  for (const r of l) { const k = r.sport + r.what; if (seen.has(k)) continue; seen.add(k); pick.push(r); if (pick.length >= n) break; } // the newest of each kind
  return { empty: !pick.length, list: pick };
}

/** VO2max: the app's estimates (bike, run; js/fitness.js vo2) and the watch's own values (health latest v2b / v2r), each with its source */
export function vo2Summary(acts, P, health) {
  const V = acts.length ? vo2(acts, P) : { bike: null, run: null }, L = health?.latest || {};
  const app = k => V[k] ? { v: Math.round(V[k].v), pm: V[k].pm, from: V[k].from } : null, watch = k => L[k] ? { v: L[k].v, day: L[k].day } : null;
  const o = { bike: { app: app('bike'), watch: watch('v2b') }, run: { app: app('run'), watch: watch('v2r') } };
  o.empty = !o.bike.app && !o.bike.watch && !o.run.app && !o.run.watch;
  return o;
}

/** FTP: the set value, the estimate from the rides, and W/kg from the newest weigh-in (else the profile weight) */
export function ftpSummary(S, P, body) {
  const list = body?.list || [], last = list.reduce((a, m) => !a || m.t > a.t ? m : a, null), kg = last ? last.kg : S?.riderKg || null;
  const ftp = +S?.ftp || 0, est = P?.ftpEst || null;
  return { empty: !ftp && !est, ftp: ftp || null, est, kg, kgFrom: last ? 'weigh-in' : S?.riderKg ? 'profile' : null, wkg: ftp && kg ? Math.round(ftp / kg * 100) / 100 : est && kg ? Math.round(est.w / kg * 100) / 100 : null, wkgOf: ftp ? 'ftp' : est ? 'estimate' : null };
}

/** one value of the watch's recovery data (GET /api/account/health) with the days it was there: { v, day, series: [{ day, v }] oldest first } */
export function healthValue(health, k, n = 7) {
  const days = (health?.days || []).filter(d => d[k] != null), L = health?.latest?.[k];
  if (!L) return { empty: true };
  return { empty: false, v: L.v, day: L.day, series: days.slice(0, n).reverse().map(d => ({ day: d.day, v: d[k] })) };
}
