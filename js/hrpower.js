// Heart rate vs power (owner 20.11.: "analyse how my heart rate goes up with the watts and make a recovery index from it; I do the
// same interval many times in a row, so compare power to heart rate"). Pure functions, no DOM, no storage (tested in
// tools/hrpower-test.mjs). Input: per-second arrays (t, power, hr) and the workout steps actually ridden
// ([{ start, end, hard, label, target }], ride seconds). The ride keeps its samples ([t, d, W, km/h, rpm, bpm]), so old rides can be
// analysed afterwards (hrpForRide()).
//
// Heart rate cleaning: 0 / missing values and jumps of more than 30 bpm per second (against the last good value) are dropouts; gaps
// of up to 5 s are filled linearly, longer gaps stay empty. A "jump" that lasts longer than 5 s is taken as the new level.
//
// Per hard interval ("rep", hard steps of 20 s and more; warm-up, openers and spins are left out):
//   w / hr: avg power and avg heart rate inside the rep · hr0: heart rate at its start · pk: peak heart rate from the start until
//   20 s after the end (heart rate lags), never into the next hard step · rise = pk − hr0 · EF = w / hr (watts per beat) ·
//   drop = pk − lowest heart rate in the easy part after it (after the peak) · d30 / d60 = pk − heart rate 30 / 60 s after the
//   rep's end, only when the easy part is that long.
// Per set (consecutive reps with the same label stem, target within ±5 W and the same length, e.g. "30 / 15 · set 2"):
//   avg W, avg HR, peak HR · drift: mean HR of the last third of the reps minus the first third (bpm) and the EF change in % ·
//   hrr60 / hrr120: peak of the last rep minus heart rate 60 / 120 s after its end · back: seconds after the last rep's end until
//   the heart rate is under (HR at set start + 10 bpm), if that happens before the next hard step.
// Recovery index 0–100: a transparent heuristic for comparing your own rides with each other, NOT a medical value:
//   index = round(100 × (0.5 a + 0.3 b + 0.2 c) / (sum of the weights present)), each part clamped to 0..1
//   a = HRR60 after the sets, averaged: 10 bpm → 0, 40 bpm → 1
//   b = 1 − drift: EF loss from the first to the last set of the main kind (or the first to the last third of its reps when there
//       is one set): 0 % → 1, 12 % → 0 (a gain counts as 1)
//   c = recovery inside the sets, mean over the reps with a rest after them in the set: short rests (< 60 s):
//       (pk − trough) / (pk − HR at set start), 0 → 0, 0.5 → 1; rests of 60 s and more: the HRR60 scale of a on d60
//   A missing part (no rest after a set, a single interval, no reps with rests) is left out and the weights renormalised. No index
//   with less than 3 min of hard work or when heart rate is missing for more than 20 % of the seconds from 1 min before the first
//   rep to 2 min after the last one: then reason says why.
// The main kind of a ride = the reps of the target and length with the most hard time; "HR at target power" is their mean heart
// rate. compareHrp() puts a ride next to the previous ride of the same workout (main target within ±5 W) and the mean of the last 5.

export const V = 1, HARD_PCT = 88, MIN_REP = 20, PEAK_LAG = 20, GAP = 5, JUMP = 30, MIN_HARD = 180, MAX_MISS = 0.2;
export const W8 = { a: 0.5, b: 0.3, c: 0.2 };
const clamp = x => Math.max(0, Math.min(1, x));
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const r1 = x => Number.isFinite(x) ? Math.round(x * 10) / 10 : null, r0 = x => Number.isFinite(x) ? Math.round(x) : null, r2 = x => Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
export const isPrep = l => /^(warm-?up|opener|spin)/i.test(String(l || '').trim());
/** "30 / 15 · set 2 · 3/13" → "30 / 15 · set 2", "VO2max 1/5" → "VO2max" */
export const stemOf = l => String(l || '').replace(/\s*\d+\s*\/\s*\d+\s*$/, '').replace(/[\s·:–-]+$/, '').trim() || 'Interval';
export const aScale = bpm => clamp((bpm - 10) / 30);
export const bScale = lossPct => clamp(1 - lossPct / 12);
export const cScale = ratio => clamp(ratio / 0.5);

/** heart rate cleaning on a per-second array (NaN / 0 = no value): returns a new array, NaN where nothing could be filled */
export function cleanHr(raw) {
  const n = raw.length, out = new Array(n).fill(NaN); let last = NaN, lastI = -1e9, rej = 0;
  for (let i = 0; i < n; i++) {
    const v = raw[i]; if (!(v > 0)) continue;
    if (Number.isFinite(last) && i - lastI <= GAP + 1 && Math.abs(v - last) > JUMP * (i - lastI) && rej < GAP) { rej++; continue; }
    out[i] = v; last = v; lastI = i; rej = 0;
  }
  let p = -1;
  for (let i = 0; i < n; i++) if (Number.isFinite(out[i])) {
    if (p >= 0 && i - p > 1 && i - p - 1 <= GAP) for (let k = p + 1; k < i; k++) out[k] = out[p] + (out[i] - out[p]) * (k - p) / (i - p);
    p = i;
  }
  return out;
}

/** the analysis of one ride. o: { t, power, hr, steps } → { v, ok, reason?, index?, parts, sets, reps, main, hard, miss } */
export function analyse({ t = [], power = [], hr = [], steps = [] } = {}) {
  const empty = reason => ({ v: V, ok: false, reason, parts: {}, sets: [], reps: [] });
  if (!t.length) return empty('No recorded data');
  const T0 = Math.round(Math.min(...t)), T1 = Math.round(Math.max(...t)), n = T1 - T0 + 1;
  const P = new Array(n).fill(NaN), raw = new Array(n).fill(NaN);
  t.forEach((x, i) => { const k = Math.round(x) - T0; P[k] = +power[i] || 0; raw[k] = +hr[i] || 0; });
  if (!raw.some(x => x > 0)) return empty('No heart rate: ride with a heart rate strap to see how your heart answers the watts');
  const H = cleanHr(raw);
  const I = s => Math.round(s) - T0; // ride second → index; a sample at t covers (t − 1, t]
  const ok = k => k >= 0 && k < n && Number.isFinite(H[k]);
  const at = s => { const k = I(s); for (let d = 0; d <= 3; d++) { if (ok(k - d)) return H[k - d]; if (ok(k + d)) return H[k + d]; } return NaN; };
  const range = (a, b, A = H) => { const o = []; for (let k = Math.max(0, I(a) + 1); k <= Math.min(n - 1, I(b)); k++) if (Number.isFinite(A[k])) o.push(A[k]); return o; };
  const argMax = (a, b) => { let m = -Infinity, mi = -1; for (let k = Math.max(0, I(a) + 1); k <= Math.min(n - 1, I(b)); k++) if (ok(k) && H[k] > m) { m = H[k]; mi = k; } return mi < 0 ? null : { v: m, s: mi + T0 }; };
  const argMin = (a, b) => { let m = Infinity, mi = -1; for (let k = Math.max(0, I(a) + 1); k <= Math.min(n - 1, I(b)); k++) if (ok(k) && H[k] < m) { m = H[k]; mi = k; } return mi < 0 ? null : { v: m, s: mi + T0 }; };
  const end = T1, allHard = steps.filter(s => s.hard && s.start < end).sort((x, y) => x.start - y.start);
  const nextHard = b => allHard.find(s => s.start >= b - 0.5)?.start ?? end;

  // ---- reps ----
  const reps = [];
  for (const st of allHard) {
    const a = st.start, b = Math.min(st.end, end), dur = st.end - st.start;
    if (dur < MIN_REP || isPrep(st.label) || b - a < Math.max(MIN_REP, 0.8 * dur)) continue;
    const rEnd = Math.min(nextHard(st.end), end), hs = range(a, b), ps = range(a, b, P);
    const rep = { label: st.label || '', stem: stemOf(st.label), target: Math.round(st.target || 0), dur, a, b, rest: Math.max(0, rEnd - b), rEnd, w: mean(ps), hr: NaN };
    if (hs.length >= 0.5 * (b - a)) {
      rep.hr = mean(hs); rep.hr0 = at(a);
      const pk = argMax(a, Math.min(b + PEAK_LAG, rEnd)); rep.pk = pk.v; rep.pkS = pk.s; rep.rise = rep.pk - (Number.isFinite(rep.hr0) ? rep.hr0 : hs[0]);
      rep.ef = rep.w / rep.hr;
      const tr = rEnd > Math.max(b, pk.s) ? argMin(Math.max(b, pk.s), rEnd) : null; rep.drop = tr ? rep.pk - tr.v : NaN; rep.trough = tr ? tr.v : NaN;
      for (const x of [30, 60]) rep['d' + x] = rep.rest >= x ? rep.pk - at(b + x) : NaN;
    }
    reps.push(rep);
  }
  const withHr = reps.filter(r => Number.isFinite(r.hr));
  // ---- sets ----
  const sets = [];
  for (const r of reps) {
    const s = sets[sets.length - 1], p = s?.reps[s.reps.length - 1];
    if (s && p.stem === r.stem && Math.abs(p.target - r.target) <= 5 && Math.abs(p.dur - r.dur) <= 2) s.reps.push(r); else sets.push({ reps: [r] });
  }
  for (const s of sets) {
    const R = s.reps.filter(r => Number.isFinite(r.hr)), L = s.reps[s.reps.length - 1];
    Object.assign(s, { label: s.reps[0].stem, n: s.reps.length, target: Math.round(mean(s.reps.map(r => r.target))), dur: s.reps[0].dur,
      w: mean(s.reps.flatMap(r => range(r.a, r.b, P))), hr: mean(s.reps.flatMap(r => range(r.a, r.b))), pk: R.length ? Math.max(...R.map(r => r.pk)) : NaN,
      hr0: Number.isFinite(s.reps[0].hr0) ? s.reps[0].hr0 : NaN });
    if (R.length >= 2) {
      const k = Math.max(1, Math.floor(R.length / 3)), f = R.slice(0, k), l = R.slice(-k);
      const ef = g => mean(g.flatMap(r => range(r.a, r.b, P))) / mean(g.flatMap(r => range(r.a, r.b)));
      s.drift = mean(l.flatMap(r => range(r.a, r.b))) - mean(f.flatMap(r => range(r.a, r.b)));
      s.driftEf = (ef(l) - ef(f)) / ef(f) * 100;
    }
    if (Number.isFinite(L.hr)) {
      for (const x of [60, 120]) s['hrr' + x] = L.rest >= x ? L.pk - at(L.b + x) : NaN;
      if (Number.isFinite(s.hr0)) { const lim = s.hr0 + 10; for (let q = Math.max(0, I(L.b) + 1); q <= Math.min(n - 1, I(L.rEnd)); q++) if (ok(q) && H[q] < lim) { s.back = q + T0 - L.b; break; } }
    }
  }
  // ---- the main kind: target / length with the most hard time ----
  const fam = new Map();
  for (const r of withHr) { const key = [...fam.keys()].find(k => Math.abs(k.target - r.target) <= 5 && Math.abs(k.dur - r.dur) <= 2) || { target: r.target, dur: r.dur }; (fam.get(key) || fam.set(key, []).get(key)).push(r); }
  const mk = [...fam.entries()].sort((x, y) => y[1].length * y[0].dur - x[1].length * x[0].dur)[0];
  let main = null;
  if (mk) { const R = mk[1], hrs = R.flatMap(r => range(r.a, r.b)), ws = R.flatMap(r => range(r.a, r.b, P)), mSets = sets.filter(s => s.reps.some(r => R.includes(r)));
    const h60 = mSets.map(s => s.hrr60).filter(Number.isFinite);
    main = { tg: mk[0].target, d: mk[0].dur, n: R.length, w: r0(mean(ws)), hr: r0(mean(hrs)), ef: r2(mean(ws) / mean(hrs)), r60: h60.length ? r0(mean(h60)) : null }; }

  // ---- index ----
  const hard = withHr.reduce((x, r) => x + (r.b - r.a), 0);
  const out = { v: V, ok: false, hard: Math.round(hard), parts: {}, sets, reps, main };
  if (!reps.length) return { ...out, reason: 'No hard intervals of 20 s or more in this ride' };
  if (!withHr.length) return { ...out, reason: 'No heart rate during the intervals' };
  const span0 = Math.max(T0, reps[0].a - 60), span1 = Math.min(T1, reps[reps.length - 1].b + 120);
  let miss = 0; for (let s = span0 + 1; s <= span1; s++) if (!ok(I(s))) miss++;
  out.miss = Math.round(miss / Math.max(1, span1 - span0) * 100);
  if (miss / Math.max(1, span1 - span0) > MAX_MISS) return { ...out, reason: `Heart rate missing for ${out.miss} % of the time: no index` };
  if (hard < MIN_HARD) return { ...out, reason: 'Less than 3 minutes of hard intervals: no index' };
  const parts = {};
  const h60 = sets.map(s => s.hrr60).filter(Number.isFinite);
  if (h60.length) parts.a = { v: aScale(mean(h60)), val: mean(h60) };
  const mainSets = sets.filter(s => s.reps.some(r => mk[1].includes(r)));
  const efOf = g => mean(g.flatMap(r => range(r.a, r.b, P))) / mean(g.flatMap(r => range(r.a, r.b)));
  if (mainSets.length >= 2) { const f = mainSets[0].reps.filter(r => Number.isFinite(r.hr)), l = mainSets[mainSets.length - 1].reps.filter(r => Number.isFinite(r.hr)); const loss = (efOf(f) - efOf(l)) / efOf(f) * 100; parts.b = { v: bScale(loss), val: loss, by: 'sets' }; }
  else if (mainSets.length === 1) { const R = mainSets[0].reps.filter(r => Number.isFinite(r.hr)); if (R.length >= 3) { const k = Math.floor(R.length / 3), loss = (efOf(R.slice(0, k)) - efOf(R.slice(-k))) / efOf(R.slice(0, k)) * 100; parts.b = { v: bScale(loss), val: loss, by: 'reps' }; } }
  const cv = [], cr = [], cl = [];
  for (const s of sets) s.reps.slice(0, -1).forEach(r => {
    if (!Number.isFinite(r.hr)) return;
    if (r.rest >= 60) { if (Number.isFinite(r.d60)) { cv.push(aScale(r.d60)); cl.push(r.d60); } }
    else if (Number.isFinite(r.drop) && Number.isFinite(s.hr0) && r.pk - s.hr0 > 0) { const q = r.drop / (r.pk - s.hr0); cv.push(cScale(q)); cr.push(q); }
  });
  if (cv.length) parts.c = { v: mean(cv), val: cr.length >= cl.length ? mean(cr) : mean(cl), kind: cr.length >= cl.length ? 'float' : 'hrr60' };
  const keys = Object.keys(parts); if (!keys.length) return { ...out, reason: 'No rest after the intervals to measure recovery: no index' };
  const wsum = keys.reduce((x, k) => x + W8[k], 0);
  for (const k of keys) parts[k].w = W8[k] / wsum;
  return { ...out, ok: true, parts, index: Math.round(100 * keys.reduce((x, k) => x + parts[k].w * parts[k].v, 0)) };
}

/** the stored, compact form (rec.hrp): numbers rounded, reps as [set, W, HR, peak, rise, drop, d60] */
export function compact(r) {
  if (!r) return null;
  const P = {}; for (const [k, p] of Object.entries(r.parts || {})) P[k] = { v: r2(p.v), val: r1(p.val), w: r2(p.w), ...(p.by ? { by: p.by } : {}), ...(p.kind ? { kind: p.kind } : {}) };
  return { v: V, ok: !!r.ok, ...(r.reason ? { reason: r.reason } : {}), ...(r.ok ? { index: r.index } : {}), parts: P, hard: r.hard || 0, ...(r.miss != null ? { miss: r.miss } : {}), main: r.main || null,
    sets: (r.sets || []).map(s => ({ l: s.label, n: s.n, tg: s.target, d: s.dur, w: r0(s.w), hr: r0(s.hr), pk: r0(s.pk), hr0: r0(s.hr0), dr: r1(s.drift), de: r1(s.driftEf), r60: r0(s.hrr60), r120: r0(s.hrr120), back: r0(s.back) })),
    reps: (r.reps || []).map(x => [(r.sets || []).findIndex(s => s.reps.includes(x)), r0(x.w), r0(x.hr), r0(x.pk), r0(x.rise), r0(x.drop), r0(x.d60)]) };
}

// ---------- from a saved ride ----------
const pctOf = (st, ftp) => st.watts ? st.watts / (ftp || 250) * 100 : st.pct;
/** the ridden steps of a workout: t0 = ride second it started, targets = { [start second]: watts } (the tuned targets of rec.ivs) */
export function stepsOf(workout, { t0 = 0, ftp = 250, elapsed = Infinity, targets = {} } = {}) {
  const out = []; let s = t0;
  for (const st of workout?.steps || []) {
    const a = s; s += st.dur; if (a >= elapsed) break;
    const pct = pctOf(st, ftp), avg = st.pct2 != null ? (pct + st.pct2) / 2 : pct;
    const plan = st.watts || Math.round(avg / 100 * ftp), tuned = targets[Math.round(a)]; // ivhistory's target = round(round(%) × FTP) + the rider's offset
    out.push({ start: a, end: s, hard: pct >= HARD_PCT, label: st.label || '', target: tuned == null ? plan : st.watts ? st.watts + tuned - Math.round(Math.round(avg) / 100 * ftp) : tuned });
  }
  return out;
}
/** analysis of a saved ride (its samples, its workout definition); o.t0 when known (live ride), else from the first saved interval */
export function hrpForRide(rec, workout, o = {}) {
  const sm = rec?.samples; if (!sm?.length || !workout?.steps?.length) return null;
  const ftp = o.ftp || rec.ivs?.find(x => x.ftp)?.ftp || 250;
  let t0 = o.t0;
  if (t0 == null) {
    const first = rec.ivs?.find(x => x.at != null), k = workout.steps.findIndex(st => pctOf(st, ftp) >= HARD_PCT);
    t0 = first && k >= 0 ? Math.max(0, first.at - workout.steps.slice(0, k).reduce((x, st) => x + st.dur, 0)) : 0;
  }
  const targets = {}; for (const iv of rec.ivs || []) if (iv.at != null && iv.target) targets[iv.at] = iv.target;
  const steps = stepsOf(workout, { t0, ftp, elapsed: rec.duration || Infinity, targets });
  return compact(analyse({ t: sm.map(x => x[0]), power: sm.map(x => x[2]), hr: sm.map(x => x[5]), steps }));
}
/** stored or computed now (old rides keep their samples); null when the ride had no workout */
export function hrpOf(rec, workoutById) {
  if (rec?.hrp?.v === V) return rec.hrp;
  if (!rec?.workoutId || !rec.samples?.length || !workoutById) return null;
  return hrpForRide(rec, workoutById(rec.workoutId));
}

// ---------- across rides ----------
const sgn = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}`;
const day = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** today's ride against the earlier rides of the same workout with the same main target (±5 W):
 *  { prev: { date }, n, lines: [{ k, text, d, good, avg5 }] } or null. list = [{ date, workoutId, hrp }] */
export function compareHrp(cur, list) {
  const m = cur?.hrp?.main; if (!m || !cur.workoutId) return null;
  const old = (list || []).filter(r => r !== cur && r.id !== cur.id && r.workoutId === cur.workoutId && r.date < cur.date && r.hrp?.main && Math.abs(r.hrp.main.tg - m.tg) <= 5 && Math.abs(r.hrp.main.d - m.d) <= 2)
    .sort((a, b) => b.date - a.date);
  if (!old.length) return null;
  const p = old[0], last5 = old.slice(0, 5), avg = f => { const v = last5.map(f).filter(x => Number.isFinite(x)); return v.length ? mean(v) : null; };
  const lines = [], good = (d, higherBetter) => d === 0 ? null : (d > 0) === higherBetter;
  const pm = p.hrp.main;
  if (m.hr && pm.hr) { const d = m.hr - pm.hr; lines.push({ k: 'hr', text: `HR at ${m.tg} W: ${m.hr} bpm (${sgn(d)} vs last time)`, d, good: good(d, false), avg5: r0(avg(r => r.hrp.main.hr)) }); }
  if (m.ef && pm.ef) { const d = Math.round((m.ef - pm.ef) / pm.ef * 100); lines.push({ k: 'ef', text: `EF ${m.ef.toFixed(2)} W/beat (${sgn(d)} %)`, d, good: good(d, true), avg5: r2(avg(r => r.hrp.main.ef)) }); }
  if (m.r60 != null && pm.r60 != null) { const d = m.r60 - pm.r60; lines.push({ k: 'r60', text: `HRR60 ${m.r60} bpm (${sgn(d)})`, d, good: good(d, true), avg5: r0(avg(r => r.hrp.main.r60 ?? NaN)) }); }
  if (cur.hrp.ok && p.hrp.ok) { const d = cur.hrp.index - p.hrp.index; lines.push({ k: 'idx', text: `Recovery index ${cur.hrp.index} (last ${p.hrp.index})`, d, good: good(d, true), avg5: r0(avg(r => r.hrp.ok ? r.hrp.index : NaN)) }); }
  return { prev: { date: p.date, day: day(p.date) }, n: old.length, lines };
}
/** the rides of one workout with an analysis, oldest first: [{ date, id, index, hr, tg, ef, r60 }] */
export function trend(list, workoutId) {
  return (list || []).filter(r => r.workoutId === workoutId && r.hrp?.main).sort((a, b) => a.date - b.date)
    .map(r => ({ id: r.id, date: r.date, index: r.hrp.ok ? r.hrp.index : null, hr: r.hrp.main.hr, tg: r.hrp.main.tg, ef: r.hrp.main.ef, r60: r.hrp.main.r60 }));
}
