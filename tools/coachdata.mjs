// What the coach sees (25.11., Freddy: "RIDEFRAME is the one place where all my data comes together, and Claude is my coach who sees
// all of it"): the read-only views behind the Claude connector's get_profile, list_activities, get_activity, get_fitness and get_weight
// (tools/mcp-api.mjs). Every function takes the account's id and reads only that account's files (users/<id>/…).
// Numbers come from the browser's own pure modules (js/fitness.js, js/actimport.js, js/bodylib.js, js/watchfields.js), never from
// formulas of their own. Ride files can be big (per-second samples): a light copy of each (no samples, no track) is cached per file
// and modification time, and the training points of a file are cached per athlete profile, so the full file is read once.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { shared } from './accounts-api.mjs';
import * as F from '../js/fitness.js';
import { collapse, startOf } from '../js/actimport.js';
import { labelOf, famOf } from '../js/sports.js';
import { changes, FIELDS as BODY_FIELDS, bmiOf } from '../js/bodylib.js';
import { compOf, compSeries, asKg, ready as compReady, MODEL as COMP_MODEL, ageAt } from '../js/bodycomp.js';
import { ZONES as HR_ZONES } from '../js/watchfields.js';

const { readJSON, userDir } = shared;
const DAY = 864e5;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const pad = n => String(n).padStart(2, '0');
/** local date and time of the server (the host runs in the owner's time zone): "2026-11-25 07:12" */
export const when = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dateOf = t => when(t).slice(0, 10);
/** "YYYY-MM-DD" -> local midnight in ms, or NaN */
export const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '')); if (!m) return NaN; const d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getMonth() === +m[2] - 1 ? d.getTime() : NaN; };

/* ---- the light copy of one ride / strength file ---- */
const cache = new Map(); // file -> { m, a (light record), pts: Map(profile key -> { pts, src }) }
const HEAVY = ['samples', 'track', 'polyline', 'stravaSegs', 'segs', 'ergTarget', 'lapMarks', 'manLaps'];
function lighten(r, fp, kraft) {
  if (!r || typeof r !== 'object' || !r.id) return null;
  if (kraft) return { ...r, kraft: true, date: +(r.start || r.date) || 0, _fp: fp };
  const s = Array.isArray(r.samples) ? r.samples : [], hr = s.map(x => +x?.[5] || 0).filter(v => v > 0);
  const a = { _fp: fp, _n: s.length, _hrSeen: Math.max(+r.maxHr || 0, ...hr.slice(0, 1e5)), _hrAvg: hr.length ? Math.round(hr.reduce((x, y) => x + y, 0) / hr.length) : 0 };
  for (const [k, v] of Object.entries(r)) if (!HEAVY.includes(k)) a[k] = v;
  return a;
}
async function lightDir(d, kraft) {
  const out = [];
  for (const f of (await readdir(d).catch(() => [])).filter(x => x.endsWith('.json'))) {
    const fp = join(d, f), st = await stat(fp).catch(() => null); if (!st) continue;
    let c = cache.get(fp); if (!c || c.m !== st.mtimeMs) { c = { m: st.mtimeMs, a: lighten(await readJSON(fp, null), fp, kraft), pts: new Map() }; cache.set(fp, c); if (cache.size > 50000) cache.clear(); }
    if (c.a) out.push(c.a);
  }
  return out;
}
/** every activity of the account like the phone's feed has them (js/feed.js loadActs): rides (all sports) and strength sessions,
 *  demo and unsaved ones left out, a watch record and its Strava / phone twin as one (collapse); newest first */
export async function activities(uid) {
  const dir = userDir(uid);
  const rides = (await lightDir(join(dir, 'rides'), false)).filter(r => r.routeId !== 'demo' && !r.unsaved && r.date);
  const kraft = (await lightDir(join(dir, 'kraft'), true)).filter(k => k.date > 0);
  return collapse([...rides, ...kraft]).sort((a, b) => b.date - a.date);
}
/** the light record with its samples back (the merged numbers of a twin stay) */
const full = async a => { if (!(a._n > 0)) return a; const r = await readJSON(a._fp, null); return Array.isArray(r?.samples) ? { ...a, samples: r.samples } : a; };
export const settingsOf = async uid => (await readJSON(join(userDir(uid), 'settings.json'), null))?.settings || {};

/** the athlete profile of js/fitness.js profileOf: the highest heart rate seen and the FTP estimate need the samples (bike rides of the last 42 days only) */
const profiles = new Map(); // uid -> { sig, P }: the samples of the recent rides are read again only when a file or the settings changed
export async function profile(uid, acts, S) {
  const sig = JSON.stringify([S.ftp, S.hrMax, S.hrRest, S.riderKg, dateOf(Date.now()), acts.map(a => a._fp + ':' + (cache.get(a._fp)?.m || 0)).join()]), c = profiles.get(uid);
  if (c && c.sig === sig) return c.P;
  const P = await profile0(acts, S); profiles.set(uid, { sig, P }); if (profiles.size > 500) profiles.clear(); return P;
}
async function profile0(acts, S) {
  const since = Date.now() - 42 * DAY, inP = [];
  for (const a of acts) inP.push(F.isBike(a) && a.date > since && a._n >= 120 ? await full(a) : { ...a, maxHr: a._hrSeen || a.maxHr });
  return F.profileOf(S, inP.sort((x, y) => x.date - y.date));
}
const pkey = P => [P.ftp, P.hrMax, P.hrRest, r2(P.runThr)].join('|');
/** js/fitness.js loadOf of one activity; a file with samples is read once per profile */
export async function loadOf(a, P) {
  if (!(a._n > 0)) return F.loadOf(a, P);
  const c = cache.get(a._fp), k = pkey(P); if (c?.pts.has(k)) return c.pts.get(k);
  const v = F.loadOf(await full(a), P); if (c) { if (c.pts.size > 4) c.pts.clear(); c.pts.set(k, v); } return v;
}

/* ---- compact rows ---- */
export function kindOf(a) {
  if (a.kraft) return { type: 'strength' };
  const g = F.sportOf(a), fam = famOf(g), type = fam === 'bike' ? 'ride' : g === 'run' ? 'run' : 'other';
  const indoor = g === 'trainer' || g === 'world' || /^Virtual/.test(a.sportType || '') || a.outdoor === false, outdoor = !indoor && (a.outdoor === true || a.routeId === 'outdoor' || a.routeId === 'run');
  return { type, ...(indoor ? { env: 'indoor' } : outdoor ? { env: 'outdoor' } : {}), sport: a.sportType ? labelOf(a.sportType) : g === 'run' ? 'Run' : g === 'trainer' ? 'Indoor trainer' : g === 'world' ? 'Virtual ride (RIDEFRAME world)' : 'Ride' };
}
const SRCN = { strava: 'Strava import', watch: 'Garmin watch (RIDEFRAME app)', manual: 'entered by hand', file: 'file import' };
const nameOf = a => a.kraft ? a.name || 'Workout' : a.workout || a.routeName || kindOf(a).sport;
/** one activity as a short row; L = { pts, src } */
export function row(a, L) {
  const k = kindOf(a), o = { id: String(a.id), ...k, name: String(nameOf(a)).slice(0, 80), start: when(a.kraft ? a.date : startOf(a)) };
  const put = (key, v, f = Math.round) => { if (+v > 0) o[key] = f(+v); };
  if (a.kraft) { put('minutes', (a.dur || 0) / 60); const sets = (a.ex || []).reduce((n, x) => n + (x.sets || []).filter(y => y.done && !y.warm).length, 0); if (sets) o.sets = sets; }
  else { put('minutes', (a.duration || 0) / 60); if (a.elapsed > a.duration + 60) put('elapsed_minutes', a.elapsed / 60); put('distance_km', (a.distance || 0) / 1000, v => r2(v)); put('climb_m', a.gain);
    put('avg_power', a.avgPower); put('max_power', a.maxPower); put('np', a.np); }
  put('avg_hr', a.avgHr || a._hrAvg); put('max_hr', a._hrSeen || a.maxHr); put('kcal', a.kcal);
  if (L) { o.load = Math.round(L.pts); o.load_from = L.src; }
  o.source = SRCN[a.source] || 'RIDEFRAME'; if (a.stravaId || a.strava) o.on_strava = true;
  if (a.prs) o.records = a.prs;
  return o;
}

/** list_activities: newest first, filtered; { total, rows } */
export async function listActivities(uid, { from = null, to = null, type = null, limit = 20 } = {}) {
  const acts = await activities(uid), S = await settingsOf(uid), P = await profile(uid, acts, S);
  const hit = acts.filter(a => (from == null || a.date >= from) && (to == null || a.date < to) && (!type || kindOf(a).type === type));
  const rows = []; for (const a of hit.slice(0, limit)) rows.push(row(a, await loadOf(a, P)));
  return { total: hit.length, rows, empty: !acts.length };
}

/** get_activity: one activity with laps, intervals, splits and bests where stored, and a small series (at most 60 points) */
export async function getActivity(uid, id) {
  const acts = await activities(uid), a = acts.find(x => String(x.id) === id) || acts.find(x => x.watch && 'watch-' + x.watch === id);
  if (!a) return null;
  const S = await settingsOf(uid), P = await profile(uid, acts, S), r = await full(a), o = row(a, await loadOf(a, P));
  if (a.kraft) {
    o.exercises = (a.ex || []).map(x => { const t = x.t === 'time' ? 'time' : x.t === 'bw' ? 'bodyweight' : 'weight';
      return { exercise: x.k, name: x.n || x.k, type: t, sets: (x.sets || []).filter(y => y && y.done !== false && !y.warm).map(y => t === 'time' ? { seconds: +y.s || 0 } : t === 'bodyweight' ? (+y.kg ? { reps: +y.r || 0, extra_kg: +y.kg } : { reps: +y.r || 0 }) : { kg: +y.kg || 0, reps: +y.r || 0, ...(y.pr ? { record: true } : {}) }) }; }).filter(x => x.sets.length);
    if (a.note) o.note = String(a.note).slice(0, 500);
    return o;
  }
  if (a.avgCad) o.avg_cadence = a.avgCad; if (a.kj) o.work_kj = a.kj; if (a.maxSpeed) o.max_kmh = a.maxSpeed;
  if (a.duration && a.distance) o.avg_kmh = r1(a.distance / a.duration * 3.6);
  if (a.ftpTest) o.ftp_test_result_w = a.ftpTest;
  if (a.note) o.note = String(a.note).slice(0, 500);
  const best = {}; if (a.best5 > 0) best.power_5min_w = Math.round(a.best5); if (a.best20 > 0) best.power_20min_w = Math.round(a.best20);
  const k = Array.isArray(a.kmSplits) ? a.kmSplits.filter(v => v > 0) : [];
  if (k.length) { o.km_splits_s = k.slice(0, 100).map(Math.round); const rb = F.runBests([a]);
    for (const n of [1, 5, 10]) if (rb[n]) best[`run_${n}km_s`] = Math.round(rb[n].t); }
  if (Object.keys(best).length) o.bests = best;
  const laps = (Array.isArray(a.laps) ? a.laps : []).filter(l => l && l.t > 0);
  if (laps.length > 1) o.laps = laps.slice(0, 60).map(l => ({ seconds: Math.round(l.t), ...(l.d ? { km: r2(l.d / 1000) } : {}), ...(l.w ? { avg_power: Math.round(l.w) } : {}), ...(l.hr ? { avg_hr: Math.round(l.hr) } : {}) }));
  else if (a.nLaps > 1) o.lap_count = a.nLaps;
  const ivs = (Array.isArray(a.ivs) ? a.ivs : []).filter(x => x && x.t > 0);
  if (ivs.length) o.intervals = ivs.slice(0, 60).map(x => ({ name: String(x.name || x.kind || 'Interval').slice(0, 40), seconds: Math.round(x.t), ...(x.target ? { target_w: Math.round(x.target) } : {}), ...(x.w ? { avg_power: Math.round(x.w) } : {}), ...(x.wMax ? { max_power: Math.round(x.wMax) } : {}), ...(x.hr ? { avg_hr: Math.round(x.hr) } : {}) }));
  const s = Array.isArray(r.samples) ? r.samples : [];
  if (s.length >= 60) { // a small series: n equal slices, the mean of each (no raw seconds)
    const n = Math.min(60, Math.floor(s.length / 30)), per = s.length / n, cols = [[2, 'power'], [5, 'hr'], [3, 'kmh'], [4, 'cadence']].filter(([i]) => s.some(x => +x?.[i] > 0));
    const pts = []; for (let i = 0; i < n; i++) { const sl = s.slice(Math.floor(i * per), Math.floor((i + 1) * per)), p = [Math.round((+sl[0]?.[0] || i * per) / 60 * 10) / 10];
      for (const [c] of cols) { const v = sl.map(x => +x?.[c] || 0).filter(v => v > 0); p.push(v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length) : null); } pts.push(p); }
    o.series = { columns: ['minute', ...cols.map(([, l]) => l)], every_s: Math.round(per), points: pts };
  }
  return o;
}

/* ---- fitness: js/fitness.js over all sports, like the profile page ---- */
const formWord = F.formWords; // the profile page's words (js/fitness.js, the same as js/profil.js formTxt)
const mon = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
export async function fitness(uid, weeks = 8) {
  const acts = await activities(uid), S = await settingsOf(uid), P = await profile(uid, acts, S), loads = [];
  for (const a of acts) loads.push([a.date, (await loadOf(a, P)).pts]);
  const pm = F.pmcLoads(loads, 90), now = pm[pm.length - 1], at = n => pm[Math.max(0, pm.length - 1 - n)];
  const since = Date.now() - 180 * DAY, vin = [];
  for (const a of acts) vin.push(a.date > since && F.isBike(a) && !(a.best5 > 0) && a._n >= 300 ? await full(a) : a);
  const V = F.vo2(vin, P), w0 = mon(Date.now()), wk = [];
  for (let i = 0; i < weeks; i++) {
    const t0 = mon(w0 - i * 7 * DAY + DAY / 2), t1 = i ? mon(w0 - (i - 1) * 7 * DAY + DAY / 2) : Infinity, l = acts.filter(a => a.date >= t0 && a.date < t1);
    const T = F.totals(l), by = {}; let pts = 0; for (const a of l) pts += (await loadOf(a, P)).pts;
    for (const [g, x] of Object.entries(T)) by[g === 'kraft' ? 'strength' : g] = { sessions: x.n, hours: r1(x.sec / 3600), ...(x.m > 0 ? { km: r1(x.m / 1000) } : {}) };
    wk.push({ week_of: dateOf(t0), sessions: l.length, hours: r1(l.reduce((s, a) => s + (a.kraft ? a.dur || 0 : a.duration || 0), 0) / 3600), km: r1(l.reduce((s, a) => s + (a.distance || 0), 0) / 1000),
      climb_m: Math.round(l.reduce((s, a) => s + (a.gain || 0), 0)), load: Math.round(pts), by_sport: by });
  }
  const vo = x => x ? { value: Math.round(x.v), plus_minus: x.pm, from: x.from } : null;
  return { empty: !acts.length,
    today: now ? { fitness: Math.round(now.ctl), fatigue: Math.round(now.atl), form: Math.round(now.tsb), form_words: formWord(now.tsb) } : null,
    fitness_change: now ? { d7: Math.round(now.ctl - at(7).ctl), d28: Math.round(now.ctl - at(28).ctl) } : null,
    last_14_days: pm.slice(-14).map(d => ({ date: dateOf(d.t), load: Math.round(d.load), fitness: Math.round(d.ctl), fatigue: Math.round(d.atl), form: Math.round(d.tsb) })),
    vo2max_estimate: { bike: vo(V.bike), run: vo(V.run) },
    ftp: { setting_w: S.ftp || null, estimate_w: P.ftpEst?.w || null, ...(P.ftpEst ? { estimate_from: P.ftpEst.from } : {}) },
    threshold_pace_min_km: P.runThr ? (x => `${Math.floor(x / 60)}:${pad(Math.round(x % 60))}`)(1000 / P.runThr) : null,
    weeks: wk, streak_weeks: F.streak(acts),
    method: 'Load points per session: 100 = one hour at threshold, from power, else heart rate, else pace, else duration (strength 45 per hour). Fitness = 42-day average load, fatigue = 7-day, form = fitness minus fatigue. VO2max: estimates from the user\'s own rides / runs, not a lab test.' };
}

/* ---- profile ---- */
export async function bodyOf(uid) { const f = await readJSON(join(userDir(uid), 'body.json'), null); return { list: Array.isArray(f?.list) ? f.list : [], prefs: f?.prefs || {} }; }
export async function athlete(uid, name) {
  const S = await settingsOf(uid), acts = await activities(uid), P = await profile(uid, acts, S), B = await bodyOf(uid);
  const last = B.list.reduce((a, m) => !a || m.t > a.t ? m : a, null), C = changes(B.list), h = B.prefs.heightCm >= 100 ? Math.round(B.prefs.heightCm) : null;
  const kg = last ? last.kg : S.riderKg || null, hrMax = P.hrMax || null;
  return { name, units: 'metric: kg, km, m, W, bpm, min/km',
    ftp_w: S.ftp || null, ...(P.ftpEst ? { ftp_estimate_w: P.ftpEst.w } : {}), ...(S.ftp && kg ? { w_per_kg: r2(S.ftp / kg) } : {}),
    max_hr: hrMax, max_hr_from: S.hrMax ? 'entered' : hrMax ? 'highest measured' : null, resting_hr_setting: S.hrRest || null,
    hr_zones: hrMax ? [0, ...HR_ZONES, 1].slice(1).map((z, i, b) => ({ zone: i + 1, from_bpm: i ? Math.ceil(HR_ZONES[i - 1] * hrMax) : 0, to_bpm: i < 4 ? Math.ceil(z * hrMax) - 1 : hrMax })) : null,
    hr_zones_rule: 'the watch\'s zones: % of max HR, Z1 below 60, Z2 60-70, Z3 70-80, Z4 80-90, Z5 above 90',
    weight_kg: kg, weight_from: last ? `weigh-in ${when(last.t)}` : S.riderKg ? 'profile setting' : null, weight_trend_kg: C.now != null ? r2(C.now) : null,
    goal_weight_kg: B.prefs.goalKg >= 20 ? B.prefs.goalKg : null, height_cm: h, ...(h && kg ? { bmi: bmiOf(kg, h) } : {}),
    strength_rest_s: Math.min(600, Math.max(15, +S.kraftRest || 90)),
    sex: B.prefs.sex === 'm' ? 'male' : B.prefs.sex === 'f' ? 'female' : null, birth_year: B.prefs.birthYear >= 1900 ? B.prefs.birthYear : null,
    ...(B.prefs.birthYear >= 1900 ? { age_years: ageAt(B.prefs.birthYear) } : {}),
    ...(B.prefs.sex && B.prefs.birthYear ? {} : { not_stored: 'sex and birth year are optional (Body settings, used only for the body-fat estimate); not entered' }) };
}

/* ---- weight ---- */
export async function weight(uid, { days = 90, limit = 60 } = {}) {
  const B = await bodyOf(uid), S = await settingsOf(uid), list = [...B.list].sort((a, b) => b.t - a.t), C = changes(B.list), since = Date.now() - days * DAY;
  const last = list[0] || null, goal = B.prefs.goalKg >= 20 ? B.prefs.goalKg : null, h = B.prefs.heightCm >= 100 ? Math.round(B.prefs.heightCm) : null;
  // fat_pct etc. = what the scale's app reported (an import); est_* = our own estimate from the scale's impedance (js/bodycomp.js)
  const m = x => { const o = { at: when(x.t), kg: x.kg }; for (const k of Object.keys(BODY_FIELDS)) if (x[k] != null && k !== 'impedance') o[{ fatPct: 'fat_pct', musclePct: 'muscle_pct', waterPct: 'water_pct', boneKg: 'bone_kg', bmi: 'bmi', hr: 'hr' }[k] || k] = x[k];
    if (x.impedance) o.impedance_ohm = x.impedance; const c = compOf(x, B.prefs);
    if (c) Object.assign(o, { est_body_fat_pct: c.fatPct, est_fat_mass_kg: c.fatKg, est_lean_mass_kg: c.leanKg, est_body_water_kg: c.waterKg, est_body_water_pct: c.waterPct });
    o.source = x.src; return o; };
  const inR = list.filter(x => x.t >= since), ser = compSeries(B.list, B.prefs), lc = ser[ser.length - 1], fc = ser.length ? changes(asKg(ser, 'fatPct')) : null;
  const composition = lc ? { at: when(lc.t), est_body_fat_pct: lc.fatPct, est_fat_mass_kg: lc.fatKg, est_lean_mass_kg: lc.leanKg, est_body_water_kg: lc.waterKg, est_body_water_pct: lc.waterPct,
      est_body_fat_trend_pct: fc?.now != null ? r1(fc.now) : null, est_body_fat_change_30d_pct_points: fc?.d30 != null ? r1(fc.d30) : null, count_with_impedance: ser.length,
      method: `Estimate from the scale's foot-to-foot impedance with ${COMP_MODEL.cite}. Expect about ±4-5 body-fat points for one person; the trend over weeks is far more reliable than one value, and hydration moves single days.` }
    : B.list.some(x => x.impedance) && !compReady(B.prefs) ? { missing: 'The scale measured impedance, but height, sex and birth year are needed for the estimate (Body settings).' } : null;
  return { empty: !list.length, latest: last ? m(last) : null, composition, trend_kg: C.now != null ? r2(C.now) : null,
    change_7d_kg: C.d7 != null ? r2(C.d7) : null, change_30d_kg: C.d30 != null ? r2(C.d30) : null,
    goal_kg: goal, to_goal_kg: goal && C.now != null ? r2(goal - C.now) : null, height_cm: h, profile_weight_kg: S.riderKg || null,
    count_in_range: inR.length, measurements: inR.slice(0, limit).map(m),
    method: 'Trend: 10 % smoothed average of the first weigh-in of each day (The Hacker\'s Diet), so single days do not move it much. Changes are of the trend.' };
}
