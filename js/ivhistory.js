// Interval history (owner 17.11.: "six months ago I rode my VO2max intervals like this, today like that"). Pure functions,
// no DOM, no storage (tested in tools/ivhistory-test.mjs):
// · intervalRecords(): one record per hard workout step from what was actually RIDDEN (the samples), never from the plan:
//   avg / max W, avg / max heart rate (only with a strap), avg cadence; the plan (% FTP, FTP, tuned target) only as context
// · kindOf(): a stable key so like is compared with like (built-in workout + step name + length, or for own workouts the
//   zone + length bucket)
// · sessions(): every saved ride's intervals grouped by kind, one session per ride and kind
// · compare(): this ride against the last session of the same kind ("Last time (12 Oct): avg 281 W · today 288 W (+7 W) …")
// Samples are [t s, d m, watts, km/h, rpm, bpm]. Old rides only carry { name, t, w } per interval: they still count.

export const HARD_PCT = 88;
const stemOf = l => String(l || '').replace(/\s*\d+\s*\/\s*\d+$/, '').replace(/\s+\d+$/, '').trim() || 'Interval';
const slug = s => stemOf(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'iv';
/** zones by % FTP of a hard step */
export const ZONE = [[95, 'ss', 'Sweet Spot'], [106, 'thr', 'Threshold'], [121, 'vo2', 'VO2max'], [Infinity, 'ana', 'Anaerobic']];
export const zoneOf = pct => ZONE.find(([lim]) => pct < lim) || ZONE[ZONE.length - 1];
/** a length bucket so 4:50 and 5:00 compare: 15 s steps under 1 min, whole minutes under 10, 5 min above */
export const bucket = s => s < 60 ? Math.max(15, Math.round(s / 15) * 15) : s < 600 ? Math.round(s / 60) * 60 : Math.round(s / 300) * 300;
export const durText = s => s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s / 60} min`;
const avgPct = st => st.pct2 != null ? (st.pct + st.pct2) / 2 : st.pct;
/** warm-up blocks and openers are hard steps too (laps in the file), but no training to compare over months */
export const isPrep = name => /^(warm-?up|opener|spin)/i.test(stemOf(name));

/** the kind of one hard step: { kind, label } (label e.g. "VO2max 5 min") */
export function kindOf(step, workout) {
  const pct = Math.round(avgPct(step)), mine = !!workout?.mine || /^my_/.test(workout?.id || '');
  if (!mine && workout?.id) return { kind: `${workout.id}:${slug(step.label)}:${step.dur}`, label: `${stemOf(step.label)} ${durText(step.dur)}` };
  const z = zoneOf(pct), b = bucket(step.dur);
  return { kind: `z:${z[1]}:${b}`, label: `${z[2]} ${durText(b)}` };
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
/** the interval records of one ride. o: { workout, samples, elapsed, ftp, stepAdj: [[W·s, s] per step], kg } */
export function intervalRecords({ workout, samples = [], elapsed = Infinity, ftp = 0, stepAdj = [], kg = 0, t0 = 0 }) { // t0: the ride second the workout started (chosen mid-ride)
  const out = []; if (!workout?.steps) return out;
  let s = t0, n = 0;
  workout.steps.forEach((st, k) => {
    const a = s, b = Math.min(s + st.dur, elapsed); s += st.dur;
    if (st.pct < HARD_PCT || b - a < 5) return;
    const sm = samples.filter(x => x[0] > a && x[0] <= b); if (!sm.length) return;
    const ps = sm.map(x => x[2] || 0), hr = sm.map(x => x[5] || 0).filter(x => x > 0), cad = sm.map(x => x[4] || 0).filter(x => x > 0);
    const label = st.label || st.name || 'Interval', name = /\d/.test(label) ? (++n, label) : `${label} ${++n}`;
    const sa = stepAdj[k], adj = sa?.[1] ? Math.round(sa[0] / sa[1]) : 0, pct = Math.round(avgPct(st));
    const base = Math.round(pct / 100 * (ftp || 0)), target = !st.free && st.pct >= HARD_PCT && adj ? Math.max(50, base + adj) : base;
    const { kind, label: kl } = kindOf(st, workout);
    out.push({ name, t: Math.round(b - a), w: Math.round(mean(ps)), wMax: Math.round(Math.max(...ps)),
      hr: hr.length ? Math.round(mean(hr)) : undefined, hrMax: hr.length ? Math.max(...hr) : undefined, cad: cad.length ? Math.round(mean(cad)) : undefined,
      at: Math.round(a), dur: st.dur, pct, ftp: ftp || undefined, target: target || undefined, kg: kg || undefined, kind, kl,
      ...(b - a < st.dur - 5 ? { part: true } : {}) }); // part: the ride ended inside it
  });
  return out;
}

/** kind of an interval of an old ride ({ name, t, w } only): from its workout's steps when we know them, else name + length */
export function legacyKind(rec, iv, workout) {
  if (iv.kind) return { kind: iv.kind, label: iv.kl || stemOf(iv.name) };
  if (!rec.workoutId) return null; // climbs of a free ride: no interval kind
  const st = workout?.steps?.find(x => x.pct >= HARD_PCT && (x.label === iv.name || stemOf(x.label) === stemOf(iv.name)) && Math.abs(x.dur - iv.t) <= 5)
    || workout?.steps?.find(x => x.pct >= HARD_PCT && stemOf(x.label) === stemOf(iv.name));
  if (st) return kindOf(st, workout);
  if (/^my_/.test(rec.workoutId)) return null; // own workout deleted or changed: we cannot say what it was
  return { kind: `${rec.workoutId}:${slug(iv.name)}:${iv.t}`, label: `${stemOf(iv.name)} ${durText(iv.t)}` };
}

const wavg = (list, f) => { let a = 0, t = 0; for (const x of list) { const v = x[f]; if (v > 0) { a += v * (x.t || 1); t += x.t || 1; } } return t ? Math.round(a / t) : undefined; };
const maxOf = (list, f) => { const v = list.map(x => x[f]).filter(x => x > 0); return v.length ? Math.max(...v) : undefined; };

/** all kinds over all rides: [{ kind, label, workout, sessions: [{ rideId, date, n, t, w, wMax, hr, hrMax, cad, ftp, pct, kg, wkg, ivs }] (oldest first),
 *  best, latest }], the kind ridden last first. o.workoutById(id) helps old rides; o.kg = weight when a ride did not save one */
export function sessions(rides, o = {}) {
  const by = new Map();
  for (const r of rides || []) {
    if (!r?.ivs?.length || !r.date || r.unsaved) continue;
    const wk = r.workoutId && o.workoutById ? o.workoutById(r.workoutId) : null, per = new Map();
    for (const iv of r.ivs) {
      if (iv.part || isPrep(iv.name) || !(iv.w > 0)) continue;
      const k = legacyKind(r, iv, wk); if (!k) continue;
      (per.get(k.kind) || per.set(k.kind, { ...k, ivs: [] }).get(k.kind)).ivs.push(iv);
    }
    for (const [kind, g] of per) {
      const ivs = g.ivs, w = wavg(ivs, 'w'), kg = ivs.find(x => x.kg)?.kg || o.kg || 0;
      const s = { rideId: r.id, date: r.date, workout: r.workout || '', n: ivs.length, t: ivs.reduce((a, x) => a + (x.t || 0), 0), w, wMax: maxOf(ivs, 'wMax'),
        hr: wavg(ivs, 'hr'), hrMax: maxOf(ivs, 'hrMax'), cad: wavg(ivs, 'cad'), ftp: ivs.find(x => x.ftp)?.ftp, pct: ivs.find(x => x.pct)?.pct, kg: kg || undefined,
        wkg: kg && w ? Math.round(w / kg * 100) / 100 : undefined, ivs };
      const e = by.get(kind) || by.set(kind, { kind, label: g.label, workout: r.workout || '', sessions: [] }).get(kind);
      e.sessions.push(s);
    }
  }
  const out = [...by.values()];
  for (const e of out) {
    e.sessions.sort((a, b) => a.date - b.date);
    e.latest = e.sessions[e.sessions.length - 1];
    e.best = e.sessions.reduce((m, s) => !m || s.w > m.w ? s : m, null);
    e.workout = e.latest.workout || e.workout;
  }
  return out.sort((a, b) => b.latest.date - a.latest.date);
}

const day = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const sgn = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}`;
/** this ride against the last earlier session of each kind it has: [{ kind, label, now, prev, dw, dhr, line }] (prev null: first time) */
export function compare(rec, rides, o = {}) {
  if (!rec?.ivs?.length) return [];
  const all = sessions([...(rides || []).filter(r => r.id !== rec.id), rec], o);
  const out = [];
  for (const e of all) {
    const now = e.sessions.find(s => s.rideId === rec.id); if (!now) continue;
    const prev = e.sessions.filter(s => s.rideId !== rec.id && s.date < rec.date).pop() || null;
    const dw = prev ? now.w - prev.w : null, dhr = prev && prev.hr && now.hr ? now.hr - prev.hr : null;
    out.push({ kind: e.kind, label: e.label, now, prev, dw, dhr, line: compareLine(now, prev) });
  }
  // in the order the intervals were ridden
  const first = k => rec.ivs.findIndex(iv => iv.kind === k);
  return out.sort((a, b) => first(a.kind) - first(b.kind));
}
/** "Last time (12 Oct): avg 281 W · today 288 W (+7 W), HR 168 → 165" */
export function compareLine(now, prev) {
  if (!prev) return `First time: avg ${now.w} W${now.hr ? ` · HR ${now.hr}` : ''}`;
  const hr = prev.hr && now.hr ? `, HR ${prev.hr} → ${now.hr}` : '';
  return `Last time (${day(prev.date)}): avg ${prev.w} W · today ${now.w} W (${sgn(now.w - prev.w)} W)${hr}`;
}
