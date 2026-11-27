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

/** FTP estimate, compatible shape { w, from } (+ lo, hi, confidence, sources of ftpEvidence): a test in the last `days` days
 *  first (the athlete's own measurement), else the multi-evidence estimate over 90 days; null without maximal-looking efforts */
export function estimateFTP(rides, days = 42, o = {}) {
  const now = o.now ?? Date.now(), since = now - days * DAY, rs = (rides || []).filter(r => r.date >= since && r.date <= now);
  const test = rs.filter(r => r.ftpTest).sort((a, b) => b.date - a.date)[0];
  if (test) return { w: test.ftpTest, from: 'test on ' + new Date(test.date).toLocaleDateString('en-GB'), confidence: 'high', test: true };
  const ev = o.ev !== undefined ? o.ev : ftpEvidence(rides, { ...o, now, days: Math.max(days, 90) }); // o.ev: already worked out (fitness.js profileOf)
  return ev && ev.w ? { w: ev.w, from: ev.from, lo: ev.lo, hi: ev.hi, confidence: ev.confidence, floor: ev.floor, sources: ev.sources, updated: ev.updated } : null;
}

// ---- FTP from every kind of evidence (27.11., owner: "nicht nur an einer Sache … die FTP muss sich immer automatisch anpassen,
// je nachdem, wie die Workouts sind"; the old 95 % of the best 20 min said 197 W to someone riding 13 × 30/15 s at 370 W).
// Over the last `days` (90) days, newer counting more (half weight every 45 days):
//  · the mean-max power of every ride with samples (3, 5, 8, 10, 12, 20, 30, 40, 60 min; 10 s watch samples are spread to
//    seconds); rides without samples give their best5 / best20 fields. Each duration says FTP ≈ P / TYP(d), the typical
//    ratio of a maximal effort of that length to FTP (5 min 1.27 → 0.79 ×, 20 min 1.05 → 0.95 ×, 60 min 1.0), weighted by how
//    well that length predicts FTP (20 min 1.0, 12 min 0.9 … 3 min 0.35). Only the efforts near the top count ("maximal-
//    looking": within 0.9-1.06 × the best candidate of 5 min or longer); a short climb in an easy ride is not an FTP test.
//    Older efforts fade: full for 4 weeks, then down to 0.92 × at 90 days (values and floors alike).
//  · critical power: P = CP + W'/t fitted through those maximal-looking points of 3-20 min (spread ≥ 2 ×, W' 5-35 kJ):
//    FTP ≈ 0.97 × CP.
//  · short-interval sets of a structured workout (ride.ivs, js/ivhistory.js: ≥ 6 completed steps ≤ 90 s at ≥ 105 % FTP,
//    ≥ 3 min on): on-power / 1.3 (30 s), / 1.25 (≤ 60 s), / 1.2; 30/15 s at 370 W → 285 W, weight 0.6 (0.4 below 8 steps).
//  · a fitness test ride (ftpTest): its value, weight 3.
//  Floors, never the estimate, only raise its lower end: every curve point P / TOP(d), the highest ratio a maximal effort of
//  that length has to FTP (60 min 1.0: nobody rides an hour above FTP; 20 min 1.12; 5 min 1.45); the normalized power of
//  rides of 40+ min, also Strava's summaries without samples (np, device watts only; 75+ min / 1.0, 55+ min / 1.03,
//  40+ min / 1.08, only with variability ≤ 1.2); completed threshold steps of 8+ min (several in one ride count as
//  0.85 × their total time).
//  The value = weighted mean of the used candidates, never below the best floor, whole watts; range ± max(3 %, their spread).
//  No value (w null, floor kept) when nothing looks maximal: a test, a set, a hard heart rate (≥ 90 % of max over 8+ min) or a
//  curve where 5-12 min clearly beat the long power (≥ 1.25 × 40-60 min, or ≥ 1.15 × 20 min without long rides).
const DUR = [180, 300, 480, 600, 720, 1200, 1800, 2400, 3600];
const TYP = { 180: 1.38, 300: 1.27, 480: 1.17, 600: 1.13, 720: 1.10, 1200: 1.05, 1800: 1.03, 2400: 1.015, 3600: 1 };
const TOP = { 180: 1.65, 300: 1.45, 480: 1.30, 600: 1.25, 720: 1.21, 1200: 1.12, 1800: 1.08, 2400: 1.05, 3600: 1 };
const WT = { 180: 0.35, 300: 0.6, 480: 0.7, 600: 0.8, 720: 0.9, 1200: 1, 1800: 0.8, 2400: 0.6, 3600: 0.5 };
const lenTxt = s => s >= 3600 ? '60 min' : `${Math.round(s / 60)} min`;
const dTxt = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** an upper-bound ratio for any length (log interpolation of TOP): the floor of a held effort of `sec` seconds is w / topRatio */
export function topRatio(sec) {
  if (sec >= 3600) return 1; if (sec <= 180) return TOP[180];
  const i = DUR.findIndex(d => d >= sec), a = DUR[i - 1], b = DUR[i], f = Math.log(sec / a) / Math.log(b / a); return TOP[a] + (TOP[b] - TOP[a]) * f;
}
/** watts and heart rate per second from samples [t, d, W, km/h, rpm, bpm]; samples further apart than 1.5 s are spread, pauses become 0 */
export function perSecond(samples) {
  const S = samples || [], n = S.length; if (n < 2) return { pw: S.map(s => s[2] || 0), hr: S.map(s => s[5] || 0) };
  const dts = []; for (let i = 1; i < Math.min(n, 301); i++) dts.push(S[i][0] - S[i - 1][0]); dts.sort((a, b) => a - b);
  if (!(dts[dts.length >> 1] > 1.5)) return { pw: S.map(s => s[2] || 0), hr: S.map(s => s[5] || 0) };
  const pw = [], hr = [];
  for (let i = 0; i < n; i++) { const g = i + 1 < n ? Math.max(1, Math.round(S[i + 1][0] - S[i][0])) : 1, k = Math.min(g, 30);
    for (let j = 0; j < k; j++) { pw.push(S[i][2] || 0); hr.push(S[i][5] || 0); } for (let j = k; j < Math.min(g, 630); j++) { pw.push(0); hr.push(0); } }
  return { pw, hr };
}
const bestAt = (pw, sec) => { if (pw.length < sec) return { w: 0, i: -1 }; let s = 0, m = -1, at = -1;
  for (let i = 0; i < pw.length; i++) { s += pw[i]; if (i >= sec) s -= pw[i - sec]; if (i >= sec - 1 && s > m) { m = s; at = i; } } return { w: m / sec, i: at }; };
const meanOf = a => { const p = a.filter(x => x > 0); return p.length ? p.reduce((x, y) => x + y, 0) / p.length : 0; };
const MM = new WeakMap();
/** one ride's mean-max watts per DUR with the mean heart rate in that window, NP, average, highest plausible HR; kept per samples array */
function rideMM(samples) {
  let v = MM.get(samples); if (v) return v;
  const { pw, hr } = perSecond(samples), on = pw.filter(x => x > 0).length, hasP = pw.length >= 120 && on >= 0.3 * pw.length;
  v = { hasP, len: pw.length, mm: [], np: 0, avg: 0, hrTop: Math.max(0, ...hr.slice(0, 2e4).filter(x => x < 230)) };
  if (hasP) { v.np = normPower(pw); v.avg = pw.reduce((a, b) => a + b, 0) / pw.length;
    for (const d of DUR) { const b = bestAt(pw, d); if (b.w > 0) v.mm.push([d, b.w, meanOf(hr.slice(b.i - d + 1, b.i + 1))]); } }
  MM.set(samples, v); return v;
}

/** FTP from all the evidence of the last `days` days -> null (nothing at all) or
 *  { w (null when nothing looks maximal), lo, hi, floor, confidence: 'low' | 'medium' | 'high', from, sources, updated, span, curve }
 *  sources: [{ k, kind: 'estimate' | 'floor', w (the FTP it implies), label, date, weight, used, note? }], best first
 *  o: { now, days = 90, hrMax } */
export function ftpEvidence(rides, o = {}) {
  const now = o.now ?? Date.now(), days = o.days || 90, since = now - days * DAY, rw = t => 0.5 ** (Math.max(0, now - t) / DAY / 45);
  const fade = t => 1 - 0.08 * Math.max(0, (now - t) / DAY - 28) / 62; // an effort of the last 4 weeks counts fully, at 90 days 8 % less
  const curve = {}, cand = [], floors = [], hrs = []; let maxHr = +o.hrMax || 0, oldest = Infinity, n = 0;
  const up = (d, w, date, hr = 0) => { if (w > 0 && (!curve[d] || w * fade(date) > curve[d].w * fade(curve[d].date))) curve[d] = { w, date, hr }; };
  const rs = (rides || []).filter(r => r && !r.kraft && r.date > since && r.date <= now);
  for (const r of rs) {
    const M = r.samples?.length >= 120 ? rideMM(r.samples) : null, hasP = !!M?.hasP;
    if (!hasP && !(r.best5 > 0) && !(r.best20 > 0) && !(r.np > 0) && !(r.ftpTest > 0) && !r.ivs) continue;
    n++; oldest = Math.min(oldest, r.date); if (!o.hrMax) maxHr = Math.max(maxHr, M?.hrTop || 0, +r.maxHr || 0);
    if (hasP) for (const [d, w, h] of M.mm) { up(d, w, r.date, h); if (h > 0 && d >= 480) hrs.push({ d, h, w, date: r.date }); }
    else { if (r.best5 > 0) up(300, +r.best5, r.date); if (r.best20 > 0) up(1200, +r.best20, r.date); }
    // normalized power of a long ride: a floor (Strava's weighted average watts are device watts only, js/actimport.js)
    const dur = r.duration || M?.len || 0, np = hasP ? M.np : +r.np || 0, avg = hasP ? M.avg : +r.avgPower || 0, vi = avg > 0 ? np / avg : null;
    if (np > 0 && dur >= 2400 && (vi == null || vi <= 1.2)) { const div = (dur >= 4500 ? 1 : dur >= 3300 ? 1.03 : 1.08) * (vi == null ? 1.02 : 1);
      floors.push({ k: hasP ? 'np' : 'np-summary', w: np / div * fade(r.date), label: `${Math.round(np)} W normalized over ${Math.round(dur / 60)} min${hasP ? '' : ' (summary)'}`, date: r.date }); }
    if (r.ftpTest > 0) cand.push({ k: 'test', w: +r.ftpTest, label: `fitness test ${Math.round(r.ftpTest)} W`, date: r.date, weight: 3 * rw(r.date), always: true });
    // a structured workout's completed steps (ride.ivs): short-interval sets and threshold steps
    const iv = (r.ivs || []).filter(x => x && x.w > 0 && x.t > 0 && !x.part && (!x.target || x.w >= 0.97 * x.target));
    const sh = iv.filter(x => x.t <= 90 && (x.pct || 0) >= 105), on = sh.reduce((s, x) => s + x.t, 0);
    if (sh.length >= 6 && on >= 180) { const w = sh.reduce((s, x) => s + x.w * x.t, 0) / on, len = on / sh.length, div = len <= 35 ? 1.3 : len <= 60 ? 1.25 : 1.2;
      cand.push({ k: 'set', w: w / div * fade(r.date), label: `${sh.length} × ${Math.round(len)} s set at ${Math.round(w)} W`, date: r.date, weight: (sh.length >= 8 ? 0.6 : 0.4) * rw(r.date), always: true }); }
    const th = iv.filter(x => x.t >= 480 && (x.pct || 0) >= 85 && (x.pct || 0) <= 110), tt = th.reduce((s, x) => s + x.t, 0);
    if (th.length) { const w = th.reduce((s, x) => s + x.w * x.t, 0) / tt, eff = Math.min(3600, th.length > 1 ? tt * 0.85 : tt);
      floors.push({ k: 'steps', w: w / topRatio(eff) * fade(r.date), label: `${th.length} × ${Math.round(tt / th.length / 60)} min at ${Math.round(w)} W`, date: r.date }); }
  }
  if (!n) return null;
  const P = d => curve[d]?.w || 0;
  for (const d of DUR) if (P(d)) { const c = curve[d];
    cand.push({ k: 'p' + d / 60, d, w: c.w / TYP[d] * fade(c.date), label: `${lenTxt(d)} best ${Math.round(c.w)} W`, date: c.date, weight: WT[d] * rw(c.date) });
    floors.push({ k: 'p' + d / 60, d, w: c.w / TOP[d] * fade(c.date), label: `${lenTxt(d)} best ${Math.round(c.w)} W`, date: c.date }); }
  // maximal-looking at all?
  const ref = P(3600) || P(2400), hrHard = maxHr >= 150 ? hrs.find(x => x.h >= 0.9 * maxHr) : null;
  const shapeHard = ref ? [300, 480, 600, 720].some(d => P(d) >= 1.25 * ref) : P(1200) > 0 && [300, 480].some(d => P(d) >= 1.15 * P(1200));
  const maxish = cand.some(c => c.always) || !!hrHard || shapeHard;
  // the used candidates: near the top of the duration candidates of 5+ min (and sets / tests)
  const top = Math.max(0, ...cand.filter(c => c.always || c.d >= 300).map(c => c.w));
  for (const c of cand) c.used = maxish && (c.always || (c.w >= 0.9 * top && c.w <= 1.06 * top));
  const pts = cand.filter(c => c.used && c.d >= 180 && c.d <= 1200);
  if (pts.length >= 2 && pts[pts.length - 1].d / pts[0].d >= 2) { // critical power: least squares of work = CP × t + W'
    const xs = pts.map(c => c.d), ys = pts.map(c => P(c.d) * c.d), mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    const cp = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0), wp = my - cp * mx;
    if (cp > 0 && wp >= 5000 && wp <= 35000) cand.push({ k: 'cp', w: 0.97 * cp, label: `critical power ${Math.round(cp)} W (W′ ${Math.round(wp / 1000)} kJ)`, date: Math.max(...pts.map(c => c.date)), weight: 1 * Math.max(...pts.map(c => rw(c.date))), used: true, cp, wp });
  }
  const U = cand.filter(c => c.used), sw = U.reduce((s, c) => s + c.weight, 0);
  const fl = floors.slice().sort((a, b) => b.w - a.w)[0] || null, floor = fl ? Math.round(fl.w) : 0;
  let w = null, lo = floor || null, hi = null, confidence = 'low', sd = 0;
  if (U.length && sw > 0) {
    const m = U.reduce((s, c) => s + c.w * c.weight, 0) / sw; sd = Math.sqrt(U.reduce((s, c) => s + c.weight * (c.w - m) ** 2, 0) / sw);
    w = Math.round(Math.max(m, floor)); const half = Math.max(0.03 * w, sd);
    lo = Math.max(floor, Math.round(w - half)); hi = Math.round(w + half);
    const long = U.some(c => c.k === 'test' || c.d >= 600 || c.k === 'cp');
    confidence = sw >= 2.5 && sd <= 0.04 * w && long && (hrHard || U.some(c => c.always) || U.length >= 4) ? 'high' : sw >= 1.2 && long ? 'medium' : 'low';
  }
  const sources = [...cand.map(c => ({ k: c.k, kind: 'estimate', w: Math.round(c.w), label: c.label, date: c.date, weight: Math.round(c.weight * 100) / 100, used: !!c.used })),
    ...floors.filter(f => f.w >= 0.9 * (fl?.w || 0)).map(f => ({ k: f.k, kind: 'floor', w: Math.round(f.w), label: f.label, date: f.date, weight: 0, used: f === fl, note: `at least ${Math.round(f.w)} W` }))]
    .sort((a, b) => (b.used - a.used) || (b.weight - a.weight) || (b.w - a.w));
  const rank = s => ({ test: 0, set: 1, cp: 2 })[s.k] ?? 3, said = sources.filter(s => s.used && s.kind === 'estimate').sort((a, b) => rank(a) - rank(b) || b.weight - a.weight).slice(0, 3);
  const from = w ? said.map(s => `${s.label} (${dTxt(s.date)})`).join(' · ') + (fl && w === floor ? ` · at least ${floor} W from ${fl.label}` : '') : fl ? `at least ${floor} W: ${fl.label} (${dTxt(fl.date)})` : '';
  const used = sources.filter(s => s.used);
  return { w, lo, hi, floor: floor || null, confidence: w ? confidence : 'none', from, sources, updated: used.length ? Math.max(...used.map(s => s.date)) : null,
    span: Math.round((now - oldest) / DAY), curve: Object.fromEntries(DUR.filter(d => P(d)).map(d => [d, Math.round(P(d))])), maxish: !!maxish };
}

/** the automatic FTP step (not wired: the page decides): null or { from, to, reason }
 *  up: as soon as the evidence is medium or high and at least 3 W above, at most 8 % at once;
 *  down: only when nothing of the last 6 weeks supports the current value (no source implying ≥ 97 % of it), the evidence covers
 *  6+ weeks, the current value is above its range, and then slowly: at most 4 % at once, never below the floor. */
export function ftpUpdate(cur, ev, o = {}) {
  const now = o.now ?? Date.now(); cur = +cur || 0;
  if (!ev || !ev.w || !['medium', 'high'].includes(ev.confidence)) return null;
  const top = (ev.sources || []).filter(s => s.used && s.kind === 'estimate').slice(0, 2).map(s => s.label).join(' and ');
  if (!cur) return { from: null, to: ev.w, reason: `First estimate from your rides: ${top || ev.from}.` };
  const d = ev.w - cur; if (Math.abs(d) < 3) return null;
  if (d > 0) { const to = Math.min(ev.w, Math.round(cur * 1.08)); return to - cur >= 3 ? { from: cur, to, reason: `Your rides show more: ${top || ev.from} point to ${ev.w} W.` } : null; }
  const recent = (ev.sources || []).some(s => s.w >= 0.97 * cur && s.date >= now - 42 * DAY);
  if (recent || (ev.span || 0) < 42 || (ev.hi && ev.hi >= cur)) return null;
  const to = Math.max(ev.w, ev.floor || 0, Math.round(cur * 0.96)); if (cur - to < 3) return null;
  return { from: cur, to, reason: `No ride in the last 6 weeks backs ${cur} W any more; your recent best efforts point to ${ev.w} W.` };
}

/** the result of a fitness test ride: ramp = 75 % of the best minute, 20-min test = 95 % of the best 20 minutes */
export function testResult(id, samples) {
  const pw = (samples || []).map(s => s[2] || 0);
  if (id === 'ramp') { const b = best(pw, 60); return b ? Math.round(b * 0.75) : 0; }
  if (id === 'ftp20') { const b = best(pw, 1200); return b ? Math.round(b * 0.95) : 0; }
  return 0;
}
