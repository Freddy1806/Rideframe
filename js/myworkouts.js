// Personal workouts (owner 17.11.: "pick a route, personalise the workout for the ride, save it under my name, find and
// edit it later in my profile"). Pure module, no DOM: used by the browser (js/myworkouts-ui.js, js/myworkouts-store.js)
// and by the server (tools/workouts-api.mjs), so both check a workout the same way.
// A personal workout: { id, name, base (built-in id or null), steps: [{ min, pct, pct2?, label, free? }], routeId?, routeName?, updated }.
// pct2 makes the step a ramp: the target moves evenly from pct to pct2 (like the built-ins' warm-up, js/workouts.js pctAt).
// For riding it becomes the shape of the built-ins (js/workouts.js: { id, name, what, steps: [{ dur, pct, label, free? }] }),
// so js/ride.js and workoutAt() run it unchanged.

export const LIM = { name: 40, label: 24, steps: 200, minMin: 0.17, maxMin: 120, minPct: 30, maxPct: 200, count: 50, bytes: 24000, total: 256000, rep: 20 };
const ID = /^[A-Za-z0-9_-]{4,40}$/, REF = /^[A-Za-z0-9_.:-]{1,80}$/;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);
const r2 = v => Math.round(v * 100) / 100;

export const newId = () => 'pw_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** checks and normalises one personal workout; returns { error } or { w }. Out-of-range values are refused, not clamped. */
export function validateWorkout(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'Workout must be an object.' };
  const id = String(b.id ?? ''); if (!ID.test(id)) return { error: 'id: 4–40 letters, digits, _ or -.' };
  if (typeof b.name !== 'string') return { error: `Name: 1–${LIM.name} characters.` };
  const raw = b.name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ');
  if (raw.length < 1 || raw.length > LIM.name) return { error: `Name: 1–${LIM.name} characters.` };
  const base = b.base == null || b.base === '' ? null : String(b.base); if (base !== null && !REF.test(base)) return { error: 'base: a workout id or null.' };
  const routeId = b.routeId == null || b.routeId === '' ? null : String(b.routeId); if (routeId !== null && !REF.test(routeId)) return { error: 'routeId: a route id.' };
  if (b.v === 2) return validateV2(b, id, raw, base, routeId); // the builder's step model (below); anything else is the old flat one
  if (!Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > LIM.steps) return { error: `steps: 1 to ${LIM.steps}.` };
  const steps = [];
  for (const [i, s] of b.steps.entries()) {
    if (!s || typeof s !== 'object') return { error: `Step ${i + 1}: must be an object.` };
    const min = +s.min, pct = +s.pct;
    if (!Number.isFinite(min) || min < LIM.minMin || min > LIM.maxMin) return { error: `Step ${i + 1}: ${LIM.minMin}–${LIM.maxMin} min.` };
    if (!Number.isFinite(pct) || pct < LIM.minPct || pct > LIM.maxPct) return { error: `Step ${i + 1}: ${LIM.minPct}–${LIM.maxPct} % FTP.` };
    let pct2 = null;
    if (s.pct2 != null && s.pct2 !== '') { pct2 = +s.pct2; if (!Number.isFinite(pct2) || pct2 < LIM.minPct || pct2 > LIM.maxPct) return { error: `Step ${i + 1}: ramp to ${LIM.minPct}–${LIM.maxPct} % FTP.` }; }
    const st = { min: r2(min), pct: Math.round(pct) }; if (pct2 != null && Math.round(pct2) !== st.pct) st.pct2 = Math.round(pct2); // a ramp to the same value is flat
    st.label = clean(s.label, LIM.label); if (s.free === true) st.free = true;
    steps.push(st);
  }
  const w = { id, name: raw, base, steps, updated: Math.round(+b.updated) > 0 ? Math.round(+b.updated) : 0 };
  if (routeId) { w.routeId = routeId; const rn = clean(b.routeName, LIM.name); if (rn) w.routeName = rn; }
  if (JSON.stringify(w).length > LIM.bytes) return { error: 'Workout too large.' };
  return { w };
}

/** a whole list (the server file, the local copy): valid ones only, ids unique, at most LIM.count */
export function validateList(list) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(list) ? list : []) { const v = validateWorkout(x); if (v.w && !seen.has(v.w.id)) { seen.add(v.w.id); out.push(v.w); } if (out.length >= LIM.count) break; }
  return out;
}

/* ---- numbers ---- */
export const stepSec = s => Math.round(s.min * 60); // the same rounding as js/workouts.js W()
export const totalSec = steps => steps.reduce((a, s) => a + stepSec(s), 0);
/** mean % FTP of one step (a ramp: halfway) */
export const stepAvg = s => s.pct2 == null ? s.pct : (s.pct + s.pct2) / 2;
/** time-weighted mean of % FTP */
export const avgPct = steps => { const t = totalSec(steps); return t ? Math.round(steps.reduce((a, s) => a + stepAvg(s) * stepSec(s), 0) / t) : 0; };
export const watts = (pct, ftp) => ftp > 0 ? Math.round(pct / 100 * ftp) : null;
/** a work step: everything harder than endurance (warm-up, rest and cool-down stay as they are when the intensity is scaled) */
export const isWork = s => stepAvg(s) >= 76;
/** the intensity slider: every work step d % harder (or easier), within the limits */
const scale1 = (v, d) => Math.max(LIM.minPct, Math.min(LIM.maxPct, Math.round(v * (1 + d / 100))));
export const scaleWork = (steps, d) => steps.map(s => isWork(s) && !s.free ? { ...s, pct: scale1(s.pct, d), ...(s.pct2 != null ? { pct2: scale1(s.pct2, d) } : {}) } : { ...s });
const same = (a, b) => a.min === b.min && a.pct === b.pct && (a.pct2 ?? null) === (b.pct2 ?? null) && !!a.free === !!b.free;

/** "repeat block ×N": steps from..to (0-based, inclusive) stand n times in a row (n counts the block itself) */
export function repeatBlock(steps, from, to, n) {
  from = Math.max(0, Math.floor(from)); to = Math.min(steps.length - 1, Math.floor(to)); n = Math.max(1, Math.min(LIM.rep, Math.floor(n)));
  if (!(to >= from)) return steps.slice();
  const block = steps.slice(from, to + 1), extra = Array.from({ length: n - 1 }, () => block.map(s => ({ ...s }))).flat();
  return [...steps.slice(0, to + 1), ...extra, ...steps.slice(to + 1)].slice(0, LIM.steps);
}
/** the other way round: runs of the same block found again, [{ n, steps }] (n = how often the block stands in a row) */
export function collapse(steps) {
  const out = [];
  for (let i = 0; i < steps.length;) {
    let best = { n: 1, len: 1 };
    for (let len = 1; len <= 6 && i + 2 * len <= steps.length; len++) {
      let n = 1; while (i + (n + 1) * len <= steps.length && steps.slice(i + n * len, i + (n + 1) * len).every((s, k) => same(s, steps[i + k]))) n++;
      if (n > 1 && n * len > best.n * best.len) best = { n, len };
    }
    out.push({ n: best.n, steps: steps.slice(i, i + best.len) }); i += best.n * best.len;
  }
  return out;
}
export const expand = groups => groups.flatMap(g => Array.from({ length: g.n }, () => g.steps.map(s => ({ ...s }))).flat());
const fmtMin = m => m >= 1 ? `${r2(m)} min` : `${Math.round(m * 60)} s`;
/** one line on what the workout is, e.g. "10 min 60 %, 5 × (3 min 118 % / 3 min 50 %), 5 min 50 %" */
export function describe(steps) {
  const one = s => `${fmtMin(s.min)} ${s.pct}${s.pct2 != null ? '→' + s.pct2 : ''} %${s.free ? ' free' : ''}`;
  return collapse(steps).map(g => g.n > 1 ? `${g.n} × (${g.steps.map(one).join(' / ')})` : g.steps.map(one).join(', ')).join(', ');
}

/* ---- conversion ---- */
/** a personal workout in the shape of the built-ins, for js/workouts.js and the ride */
export function toRide(w) {
  if (isV2(w)) return toRide2(w);
  return { id: w.id, name: w.name, what: `Personal workout: ${describe(w.steps)}.`, personal: true, base: w.base || null, routeId: w.routeId || null, routeName: w.routeName || '',
    steps: w.steps.map(s => ({ dur: stepSec(s), pct: s.pct, ...(s.pct2 != null ? { pct2: s.pct2 } : {}), label: s.label || '', ...(s.free ? { free: true } : {}) })) };
}
/** a draft from a built-in workout (or any workout in ride shape) */
export function fromBuiltin(bw) {
  const cp = v => Math.max(LIM.minPct, Math.min(LIM.maxPct, Math.round(v)));
  const steps = bw.steps.slice(0, LIM.steps).map(s => { const st = { min: Math.max(LIM.minMin, r2(s.dur / 60)), pct: cp(s.pct) }; if (s.pct2 != null && cp(s.pct2) !== st.pct) st.pct2 = cp(s.pct2);
    st.label = clean(s.label, LIM.label); if (s.free) st.free = true; return st; });
  return { id: newId(), name: clean(bw.name, LIM.name) || 'My workout', base: bw.personal ? bw.base || null : bw.id || null, steps, updated: 0 };
}
/* ---- the fast editor (owner 17.11. 22:14: "a usable workout in a few taps"): templates, +/- steps, a whole set at once ---- */
const WU = () => ({ min: 10, pct: 45, pct2: 70, label: 'Warm-up' }), CD = () => ({ min: 8, pct: 60, pct2: 40, label: 'Cool-down' });
const set = (n, work, rest, wl) => Array.from({ length: n }, (_, i) => [{ ...work, label: `${wl} ${i + 1}/${n}` }, ...(rest ? [{ ...rest, label: 'Rest' }] : [])]).flat();
/** starting points, one tap each: warm-up ramp, the main part, cool-down ramp */
export const TEMPLATES = [
  { id: 'end', name: 'Endurance', hint: '63 min · steady Z2', steps: () => [WU(), { min: 45, pct: 68, label: 'Endurance' }, CD()] },
  { id: 'ss', name: 'Sweet spot', hint: '3 × 10 min at 90 %', steps: () => [WU(), ...set(3, { min: 10, pct: 90 }, { min: 4, pct: 55 }, 'Sweet spot'), CD()] },
  { id: 'thr', name: 'Threshold', hint: '2 × 15 min at 100 %', steps: () => [WU(), ...set(2, { min: 15, pct: 100 }, { min: 5, pct: 55 }, 'Threshold'), CD()] },
  { id: 'vo2', name: 'VO2max', hint: '5 × 3 min at 118 %', steps: () => [WU(), ...set(5, { min: 3, pct: 118 }, { min: 3, pct: 50 }, 'VO2max'), CD()] },
  { id: 'spr', name: 'Sprints', hint: '6 × 30 s all out', steps: () => [WU(), ...set(6, { min: 0.5, pct: 170 }, { min: 4.5, pct: 50 }, 'Sprint'), CD()] },
  { id: 'ramp', name: 'Ramp up', hint: '20 min climbing 60 → 105 %', steps: () => [WU(), { min: 20, pct: 60, pct2: 105, label: 'Ramp' }, { min: 5, pct: 55, label: 'Easy' }, CD()] },
];
/** one tap on − / +: minutes in 0.5 steps up to 5, 1 up to 20, then 5; % FTP in 5s (to the next multiple of 5); within the limits */
export function bump(s, f, d) {
  const dir = d > 0 ? 1 : -1;
  if (f === 'min') { const v = s.min, st = (dir > 0 ? v < 5 : v <= 5) ? 0.5 : (dir > 0 ? v < 20 : v <= 20) ? 1 : 5, n = Math.round((dir > 0 ? Math.floor(v / st + 1e-9) * st + st : Math.ceil(v / st - 1e-9) * st - st) * 100) / 100;
    return { ...s, min: Math.max(LIM.minMin, Math.min(LIM.maxMin, n)) }; }
  const k = f === 'pct2' ? 'pct2' : 'pct', v = s[k] ?? s.pct, n = Math.max(LIM.minPct, Math.min(LIM.maxPct, dir > 0 ? Math.floor(v / 5 + 1e-9) * 5 + 5 : Math.ceil(v / 5 - 1e-9) * 5 - 5));
  const o = { ...s, [k]: n }; if (o.pct2 != null && o.pct2 === o.pct) delete o.pct2; return o;
}
/** where new blocks go: before a cool-down at the end, else at the end */
export const insertAt = steps => steps.length > 1 && /cool/i.test(steps[steps.length - 1].label || '') ? steps.length - 1 : steps.length;
/** a whole interval set at once (n × work + rest), before the cool-down; the default when the editor adds a set */
export function addSet(steps, { n = 4, work = { min: 4, pct: 105 }, rest = { min: 3, pct: 55 }, label = 'Interval' } = {}) {
  n = Math.max(1, Math.min(LIM.rep, Math.floor(n))); const at = insertAt(steps), add = set(n, work, rest, label);
  return [...steps.slice(0, at), ...add, ...steps.slice(at)].slice(0, LIM.steps);
}
/** a sensible next block: after a hard one its rest, else a hard one */
export const nextBlock = steps => { const last = steps[insertAt(steps) - 1]; return last && isWork(last) ? { min: Math.max(1, Math.round(last.min / 2 * 2) / 2), pct: 55, label: 'Rest' } : { min: 4, pct: 105, label: 'Interval' }; };

/** "free ride with intervals": the start when no workout is chosen */
export function freeTemplate() {
  return { id: newId(), name: 'Free ride with intervals', base: null, updated: 0,
    steps: [{ min: 10, pct: 60, label: 'Warm-up' }, { min: 15, pct: 68, label: 'Endurance' }, { min: 4, pct: 105, label: 'Interval' }, { min: 4, pct: 55, label: 'Rest' }, { min: 4, pct: 105, label: 'Interval' }, { min: 10, pct: 68, label: 'Endurance' }, { min: 5, pct: 50, label: 'Cool-down' }] };
}
/** the list for one route: the ones made for it first, then the newest */
export const orderFor = (list, routeId) => list.slice().sort((a, b) => ((b.routeId === routeId) - (a.routeId === routeId)) || (b.updated || 0) - (a.updated || 0));

/* ---- the profile graph ---- */
// the app's power zones (the same colours as the indoor page, js/pure.js ZONES), by % FTP
export const ZONES = [[55, 'Z1', '#6b7480'], [75, 'Z2', '#2f8fe0'], [90, 'Z3', '#2fb36b'], [105, 'Z4', '#f2b630'], [120, 'Z5', '#ff8a1f'], [150, 'Z6', '#ff4f3c'], [1e9, 'Z7', '#c43cff']];
export const zoneOf = pct => ZONES.find(z => pct < z[0]);
/** bars over time, height = % FTP, colour = zone; mark = index of a step to outline (the one being edited) */
export function graphSVG(steps, { h = 60, mark = -1, cls = 'mwgraph' } = {}) {
  const tot = totalSec(steps) || 1, max = Math.max(130, ...steps.map(s => Math.max(s.pct, s.pct2 ?? 0))); let x = 0;
  const bars = steps.map((s, i) => {
    const bw = stepSec(s) / tot * 1000, bh = Math.max(2, s.pct / max * (h - 2)), z = zoneOf(stepAvg(s)), w = Math.max(0.8, bw - 1.2);
    const att = `data-i="${i}" fill="${z[2]}"${s.free ? ' fill-opacity=".55"' : ''}${i === mark ? ' stroke="#ff5a1f" stroke-width="4" vector-effect="non-scaling-stroke"' : ''}`;
    const r = s.pct2 == null ? `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" ${att}/>`
      : `<polygon points="${x.toFixed(1)},${h} ${x.toFixed(1)},${(h - bh).toFixed(1)} ${(x + w).toFixed(1)},${(h - Math.max(2, s.pct2 / max * (h - 2))).toFixed(1)} ${(x + w).toFixed(1)},${h}" ${att}/>`; // a ramp: sloped top
    x += bw; return r;
  }).join('');
  const ftpY = (h - 100 / max * (h - 2)).toFixed(1);
  return `<svg class="${cls}" viewBox="0 0 1000 ${h}" preserveAspectRatio="none" role="img" aria-label="Workout profile">${bars}<line x1="0" x2="1000" y1="${ftpY}" y2="${ftpY}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---- names without a keyboard (gamepad): a default and a few one-tap suggestions ---- */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** what kind of session, from the built-in's name: "VO2max 5 × 3" -> "VO2", "Sweet Spot 3 × 10" -> "Sweet Spot" */
export const kindOf = name => String(name || '').replace(/\s*\(.*?\)/g, '').replace(/^VO2max\b/, 'VO2').replace(/\s+\d.*$/, '').trim() || 'Intervals';
const free1 = (base, taken) => { let n = 1; while (taken.has((cut1(base, n)).toLowerCase())) n++; return cut1(base, n); };
const cut1 = (base, n) => { const t = ` ${n}`; return (base.length + t.length > LIM.name ? base.slice(0, LIM.name - t.length).trim() : base) + t; };
/** "River Valley VO2 1": route + kind + the first free number among the existing names */
export function defaultName(routeName, kind, existing = []) {
  const taken = new Set(existing.map(x => String(x).toLowerCase()));
  return free1([clean(routeName, LIM.name), kind].filter(Boolean).join(' ') || 'My workout', taken);
}
/** up to four names to pick with one tap */
export function nameSuggestions(routeName, kind, existing = [], { minutes = 0, day = new Date().getDay() } = {}) {
  const taken = new Set(existing.map(x => String(x).toLowerCase())), out = [];
  const add = n => { n = clean(n, LIM.name); if (n && !out.includes(n)) out.push(n); };
  add(defaultName(routeName, kind, existing)); add(taken.has(`my ${kind}`.toLowerCase()) ? free1(`My ${kind}`, taken) : `My ${kind}`); add(`${kind} ${DAYS[day % 7]}`); if (minutes) add(`${kind} ${minutes} min`);
  return out.slice(0, 4);
}

/* =====================================================================================================================
 * Version 2: the step model of a bike-computer workout builder (owner 24.11.: "rebuild the workout builder exactly like the
 * one in Garmin Connect"): a workout is a list of steps and repeat blocks, every step has a type, a duration of a kind and an
 * intensity target of a kind, plus notes. RIDEFRAME's own extra: the target "% FTP" with a ramp pct → pct2.
 *   { v: 2, id, name, notes, sport: 'bike', base, steps: [Step | Repeat], routeId?, routeName?, updated }
 *   Step   = { type: warmup|work|recover|rest|cooldown|other, dur: Dur, target: Target, target2?: Target, note?, label? }
 *   Repeat = { repeat: 1..99, steps: [Step, …], skipLast?: true }   (one level: no repeat inside a repeat)
 *   Dur    = { kind: 'time', sec } | { kind: 'distance', m } | { kind: 'lap' } | { kind: 'calories', kcal }
 *          | { kind: 'hr', op: 'gt'|'lt', bpm } | { kind: 'power', op: 'gt'|'lt', w }
 *   Target = { kind: 'none', pct? } | { kind: 'powerZone', zone: 1..7 } | { kind: 'power', lo, hi } (W) | { kind: 'ftp', pct, pct2? }
 *          | { kind: 'hrZone', zone: 1..5 } | { kind: 'hr', lo, hi } (bpm) | { kind: 'cadence', lo, hi } (rpm) | { kind: 'speed', lo, hi } (km/h)
 * Old workouts ({ steps: [{ min, pct, pct2?, label, free? }] }) stay valid as they are (validateWorkout keeps their shape);
 * toV2() turns one into steps without losing anything, the editor saves it as v2. toRide() runs both.
 * ===================================================================================================================== */
import { ftpNow, HR_ZONES } from './workouts.js';
export { HR_ZONES };
export const STEP_TYPES = [['warmup', 'Warm up', '#f2b630'], ['work', 'Bike', '#ff5a1f'], ['recover', 'Recover', '#2fb36b'], ['rest', 'Rest', '#7d8794'], ['cooldown', 'Cool down', '#2f8fe0'], ['other', 'Other', '#b061ff']];
export const DUR_KINDS = [['time', 'Time'], ['distance', 'Distance'], ['lap', 'Lap button press'], ['calories', 'Calories'], ['hr', 'Heart rate'], ['power', 'Power']];
export const TGT_KINDS = [['none', 'No target'], ['powerZone', 'Power zone'], ['power', 'Custom power'], ['ftp', '% FTP'], ['hrZone', 'Heart rate zone'], ['hr', 'Custom heart rate'], ['cadence', 'Cadence'], ['speed', 'Speed']];
/** what a secondary target can be: only ones that are shown, never a second power target for the trainer */
export const TGT2_KINDS = TGT_KINDS.filter(([k]) => ['none', 'hrZone', 'hr', 'cadence', 'speed'].includes(k));
// power zones in % FTP (the 7-zone model, the same borders as ZONES above); Z1 and Z7 are open in theory, these ends are
// what ERG holds for them (the middle of the zone)
export const ZONE_PCT = [[40, 55], [56, 75], [76, 90], [91, 105], [106, 120], [121, 150], [151, 180]];
export const L2 = { sec: [5, 21600], m: [50, 300000], kcal: [1, 5000], bpm: [40, 230], w: [20, 2000], pct: [LIM.minPct, LIM.maxPct], rpm: [20, 200], kmh: [1, 100], rep: [1, 99], inRep: 20, note: 200, notes: 1000 };
const TYPE = Object.fromEntries(STEP_TYPES.map(([k, n, c]) => [k, { name: n, col: c }]));
export const typeName = t => TYPE[t]?.name || 'Step', typeColor = t => TYPE[t]?.col || '#7d8794';
// intensity used for charts and estimates where the target says nothing about power (no target, heart rate, cadence, speed)
const TYPE_PCT = { warmup: 55, work: 75, recover: 50, rest: 40, cooldown: 50, other: 60 };
const HRZ_PCT = [50, 65, 80, 95, 110]; // a heart-rate zone drawn at about this % FTP (chart only, never sent to the trainer)
/** the assumptions for steps without a fixed time (only for the chart, the total and the route fit; the ride ends them for real) */
export const EST = { lap: 300, hr: 300, power: 180, kmh: 30, kmhPct: 70 }; // lap / HR / power: nominal 5 / 5 / 3 min; 30 km/h at 70 % FTP on the flat
const cleanML = (s, n) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
export const isV2 = w => !!w && w.v === 2;
const inR = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
/** does this repeat really skip its last step? Only ×2 or more, two steps or more, the last a recovery or rest. The builder
 *  keeps the rider's tick while a step passes through the block (a move, a type change), so the flag counts only when it applies */
export const skips = x => !!x?.skipLast && x.repeat > 1 && x.steps?.length > 1 && /^(recover|rest)$/.test(x.steps.at(-1).type);

function vDur(d) {
  if (!d || typeof d !== 'object') return { error: 'duration missing' };
  const k = d.kind;
  if (k === 'time') { const v = Math.round(+d.sec); return inR(v, L2.sec) ? { d: { kind: k, sec: v } } : { error: `time ${L2.sec[0]} s – ${L2.sec[1] / 3600} h` }; }
  if (k === 'distance') { const v = Math.round(+d.m); return inR(v, L2.m) ? { d: { kind: k, m: v } } : { error: `distance ${L2.m[0]} m – ${L2.m[1] / 1000} km` }; }
  if (k === 'lap') return { d: { kind: k } };
  if (k === 'calories') { const v = Math.round(+d.kcal); return inR(v, L2.kcal) ? { d: { kind: k, kcal: v } } : { error: `calories ${L2.kcal[0]}–${L2.kcal[1]} kcal` }; }
  if (k === 'hr' || k === 'power') { const op = d.op === 'lt' ? 'lt' : d.op === 'gt' ? 'gt' : null, f = k === 'hr' ? 'bpm' : 'w', v = Math.round(+d[f]);
    if (!op) return { error: `${k === 'hr' ? 'heart rate' : 'power'}: above or below` };
    return inR(v, L2[f]) ? { d: { kind: k, op, [f]: v } } : { error: `${k === 'hr' ? 'heart rate' : 'power'} ${L2[f][0]}–${L2[f][1]} ${k === 'hr' ? 'bpm' : 'W'}` }; }
  return { error: 'unknown duration type' };
}
function vTgt(t, timed, second) {
  if (t == null) return { t: { kind: 'none' } };
  if (typeof t !== 'object') return { error: 'target must be an object' };
  const k = t.kind, ok = (second ? TGT2_KINDS : TGT_KINDS).some(x => x[0] === k); if (!ok) return { error: 'unknown target type' };
  if (k === 'none') { if (t.pct == null || t.pct === '') return { t: { kind: k } }; const p = Math.round(+t.pct); return inR(p, L2.pct) ? { t: { kind: k, pct: p } } : { error: 'intensity hint 30–200 %' }; }
  if (k === 'powerZone' || k === 'hrZone') { const z = Math.round(+t.zone), n = k === 'powerZone' ? 7 : 5; return z >= 1 && z <= n ? { t: { kind: k, zone: z } } : { error: `zone 1–${n}` }; }
  if (k === 'ftp') { const p = Math.round(+t.pct); if (!inR(p, L2.pct)) return { error: `${L2.pct[0]}–${L2.pct[1]} % FTP` };
    const o = { kind: k, pct: p }; if (t.pct2 != null && t.pct2 !== '') { const p2 = Math.round(+t.pct2); if (!inR(p2, L2.pct)) return { error: `ramp to ${L2.pct[0]}–${L2.pct[1]} % FTP` }; if (timed && p2 !== p) o.pct2 = p2; } // a ramp needs a time
    return { t: o }; }
  const R = { power: ['w', 'W'], hr: ['bpm', 'bpm'], cadence: ['rpm', 'rpm'], speed: ['kmh', 'km/h'] }[k], lim = L2[R[0]];
  const rnd = v => k === 'speed' ? Math.round(v * 10) / 10 : Math.round(v); let lo = rnd(+t.lo), hi = rnd(+t.hi);
  if (!inR(lo, lim) || !inR(hi, lim)) return { error: `${lim[0]}–${lim[1]} ${R[1]}` };
  if (lo > hi) [lo, hi] = [hi, lo];
  return { t: { kind: k, lo, hi } };
}
function vStep(s, where) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: `${where}: must be an object.` };
  if (!TYPE[s.type]) return { error: `${where}: unknown step type.` };
  const d = vDur(s.dur); if (d.error) return { error: `${where}: ${d.error}.` };
  const t = vTgt(s.target, d.d.kind === 'time'); if (t.error) return { error: `${where}: ${t.error}.` };
  const st = { type: s.type, dur: d.d, target: t.t };
  if (s.target2 != null && s.target2.kind !== 'none') { const t2 = vTgt(s.target2, false, true); if (t2.error) return { error: `${where}: secondary target: ${t2.error}.` }; st.target2 = t2.t; }
  const note = cleanML(s.note, L2.note); if (note) st.note = note;
  const label = clean(s.label, LIM.label); if (label) st.label = label;
  return { s: st };
}
function validateV2(b, id, name, base, routeId) {
  if (!Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > LIM.steps) return { error: `steps: 1 to ${LIM.steps}.` };
  const steps = []; let n = 0;
  for (const [i, x] of b.steps.entries()) {
    if (x && typeof x === 'object' && 'repeat' in x) {
      const r = Math.round(+x.repeat); if (!inR(r, L2.rep)) return { error: `Repeat ${i + 1}: ${L2.rep[0]}–${L2.rep[1]} times.` };
      if (!Array.isArray(x.steps) || x.steps.length < 1 || x.steps.length > L2.inRep) return { error: `Repeat ${i + 1}: 1 to ${L2.inRep} steps.` };
      const inner = [];
      for (const [j, s] of x.steps.entries()) { if (s && typeof s === 'object' && 'repeat' in s) return { error: `Repeat ${i + 1}: no repeat inside a repeat.` };
        const v = vStep(s, `Step ${i + 1}.${j + 1}`); if (v.error) return v; inner.push(v.s); }
      const rep = { repeat: r, steps: inner }; if (x.skipLast === true && skips({ ...rep, skipLast: true })) rep.skipLast = true;
      n += r * inner.length - (rep.skipLast ? 1 : 0); steps.push(rep);
    } else { const v = vStep(x, `Step ${i + 1}`); if (v.error) return v; steps.push(v.s); n++; }
  }
  if (n > LIM.steps) return { error: `At most ${LIM.steps} steps with the repeats counted (now ${n}).` };
  const w = { v: 2, id, name, notes: cleanML(b.notes, L2.notes), sport: 'bike', base, steps, updated: Math.round(+b.updated) > 0 ? Math.round(+b.updated) : 0 };
  if (routeId) { w.routeId = routeId; const rn = clean(b.routeName, LIM.name); if (rn) w.routeName = rn; }
  if (JSON.stringify(w).length > LIM.bytes) return { error: 'Workout too large.' };
  return { w };
}

/* ---- numbers of v2 ---- */
/** the steps one after the other, repeats written out: [{ ...step, rep: { at (item index), k (1..n), n } | null, path: 'i' | 'i.j' }] */
export function flatSteps(steps) {
  const out = [];
  steps.forEach((x, i) => {
    if (!x.repeat) return out.push({ ...x, rep: null, path: String(i) });
    const skip = skips(x);
    for (let k = 1; k <= x.repeat; k++) x.steps.forEach((s, j) => { if (skip && k === x.repeat && j === x.steps.length - 1) return; out.push({ ...s, rep: { at: i, k, n: x.repeat }, path: `${i}.${j}` }); });
  });
  return out;
}
export const countSteps = steps => flatSteps(steps).length;
/** % FTP of a step for the trainer and the chart: { pct, pct2?, rlo?, rhi?, erg (the trainer holds it), watts? (custom power) } at this FTP */
export function stepPct(s, ftp = ftpNow()) {
  const t = s.target || { kind: 'none' };
  if (t.kind === 'ftp') return { pct: t.pct, ...(t.pct2 != null && s.dur?.kind === 'time' ? { pct2: t.pct2 } : {}), erg: true };
  if (t.kind === 'powerZone') { const [lo, hi] = ZONE_PCT[t.zone - 1]; return { pct: Math.round((lo + hi) / 2), rlo: lo, rhi: hi, erg: true }; }
  if (t.kind === 'power') { const f = ftp > 0 ? ftp : 200, m = (t.lo + t.hi) / 2; return { pct: Math.round(m / f * 1000) / 10, rlo: t.lo / f * 100, rhi: t.hi / f * 100, watts: m, erg: true }; }
  if (t.kind === 'hrZone') return { pct: HRZ_PCT[t.zone - 1], erg: false };
  if (t.kind === 'none' && t.pct) return { pct: t.pct, erg: false };
  return { pct: TYPE_PCT[s.type] ?? 60, erg: false };
}
/** estimated seconds of a step: exact for time, else from the assumptions in EST (distance: the speed target's middle, else
 *  30 km/h at 70 % FTP scaling with the cube root of the power; calories: kcal ≈ kJ at the step's watts) */
export function estSec(s, ftp = ftpNow()) {
  const d = s.dur;
  if (d.kind === 'time') return d.sec;
  if (d.kind === 'lap') return EST.lap; if (d.kind === 'hr') return EST.hr; if (d.kind === 'power') return EST.power;
  const p = stepPct(s, ftp).pct;
  if (d.kind === 'distance') { const t = s.target, kmh = t.kind === 'speed' ? (t.lo + t.hi) / 2 : Math.max(15, Math.min(45, EST.kmh * Math.cbrt(p / EST.kmhPct))); return Math.max(1, Math.round(d.m / (kmh / 3.6))); }
  if (d.kind === 'calories') { const wt = Math.max(50, p / 100 * (ftp > 0 ? ftp : 200)); return Math.max(1, Math.round(d.kcal * 1000 / wt)); }
  return 60;
}
/** estimated distance of a step in m (exact for distance steps), with the same speed assumption */
export function estM(s, ftp = ftpNow()) {
  if (s.dur.kind === 'distance') return s.dur.m;
  const t = s.target, p = stepPct(s, ftp).pct, kmh = t.kind === 'speed' ? (t.lo + t.hi) / 2 : Math.max(15, Math.min(45, EST.kmh * Math.cbrt(p / EST.kmhPct)));
  return estSec(s, ftp) * kmh / 3.6;
}
/** the summary line of the builder: { sec, exact (no estimate in it), m, mExact, avg (% FTP over the steps the trainer holds), steps } */
export function summary2(steps, ftp = ftpNow()) {
  const f = flatSteps(steps); let sec = 0, m = 0, exact = true, mExact = true, ps = 0, pt = 0;
  for (const s of f) { const t = estSec(s, ftp), p = stepPct(s, ftp); sec += t; m += estM(s, ftp); if (s.dur.kind !== 'time') exact = false; if (s.dur.kind !== 'distance') mExact = false;
    if (p.erg) { ps += (p.pct2 != null ? (p.pct + p.pct2) / 2 : p.pct) * t; pt += t; } }
  return { sec, exact, m: Math.round(m), mExact, avg: pt ? Math.round(ps / pt) : 0, steps: f.length };
}

/* ---- conversion ---- */
const guessType = (label, pct) => /warm|ein(fahren|rollen)/i.test(label) ? 'warmup' : /cool|aus(fahren|rollen)|spin down/i.test(label) ? 'cooldown'
  : /rest|recover|easy|spin|float|pause|erhol/i.test(label) ? 'recover' : 'work';
/** an old workout (flat { min, pct, … } steps) as v2, step by step, nothing lost: every step a timed step at its % FTP
 *  (a free step: no target, its % kept as the intensity hint), label kept */
export function toV2(w) {
  if (isV2(w)) return JSON.parse(JSON.stringify(w));
  const steps = (w.steps || []).map(s => ({ type: guessType(s.label || '', s.pct), dur: { kind: 'time', sec: stepSec(s) },
    target: s.free ? { kind: 'none', pct: s.pct } : { kind: 'ftp', pct: s.pct, ...(s.pct2 != null ? { pct2: s.pct2 } : {}) }, ...(s.label ? { label: s.label } : {}) }));
  const o = { v: 2, id: w.id, name: w.name, notes: '', sport: 'bike', base: w.base ?? null, steps, updated: w.updated || 0 };
  if (w.routeId) { o.routeId = w.routeId; if (w.routeName) o.routeName = w.routeName; }
  return o;
}
const stem = l => String(l || '').replace(/[\s·]*\d+\s*\/\s*\d+$/, '').trim();
const key = s => JSON.stringify([s.type, s.dur, s.target, s.label || '', s.note || '']);
/** repeats found again in flat steps: [on, off] × (n−1) + on is a repeat ×n that skips its last recovery */
export function findRepeats(flat) {
  const out = [];
  for (let i = 0; i < flat.length;) {
    let best = null;
    for (let len = 1; len <= 6 && i + 2 * len - 1 <= flat.length; len++) {
      const blk = flat.slice(i, i + len), same = (a, b) => key(a) === key(b);
      let n = 1; while (i + (n + 1) * len <= flat.length && flat.slice(i + n * len, i + (n + 1) * len).every((s, k) => same(s, blk[k]))) n++;
      let skip = false; const rest = flat.slice(i + n * len, i + n * len + len - 1);
      if (len > 1 && /^(recover|rest)$/.test(blk[len - 1].type) && rest.length === len - 1 && rest.every((s, k) => same(s, blk[k]))) { n++; skip = true; }
      const cover = n * len - (skip ? 1 : 0);
      if (n > 1 && (len > 1 || n > 2) && (!best || cover > best.cover)) best = { len, n, skip, cover };
    }
    if (best) { const rep = { repeat: best.n, steps: flat.slice(i, i + best.len) }; if (best.skip) rep.skipLast = true; out.push(rep); i += best.cover; }
    else { out.push(flat[i]); i++; }
  }
  return out;
}
/** a draft from a built-in workout (ride shape { steps: [{ dur, pct | watts, pct2?, label, free? }] }): steps with their type
 *  guessed from the label, interval sets as repeat blocks ("VO2max 1/5" + "Rest" five times: Repeat ×5, last recovery skipped) */
export function fromBuiltin2(bw) {
  const cp = v => Math.max(LIM.minPct, Math.min(LIM.maxPct, Math.round(v)));
  const flat = bw.steps.map(s => {
    const label = clean(stem(s.label), LIM.label), type = guessType(label, s.pct), sec = Math.max(L2.sec[0], Math.round(s.dur));
    const target = s.free ? { kind: 'none', pct: cp(s.pct) } : s.watts != null ? { kind: 'power', lo: Math.round(s.watts), hi: Math.round(s.watts) }
      : { kind: 'ftp', pct: cp(s.pct), ...(s.pct2 != null && cp(s.pct2) !== cp(s.pct) ? { pct2: cp(s.pct2) } : {}) };
    return { type, dur: { kind: 'time', sec }, target, ...(label ? { label } : {}) };
  });
  const steps = findRepeats(flat).slice(0, LIM.steps);
  return { v: 2, id: newId(), name: clean(bw.name, LIM.name) || 'Bike Workout', notes: '', sport: 'bike', base: bw.personal ? bw.base || null : bw.id || null, steps, updated: 0 };
}
/** a new workout: warm-up and cool-down until the lap button, one main step in between (the builder's start) */
export const newStep = (type = 'work', o = {}) => ({ type, dur: { kind: 'time', sec: type === 'recover' ? 120 : type === 'rest' ? 60 : 600 }, target: { kind: 'none' }, ...o });
export const newRepeat = () => ({ repeat: 2, steps: [newStep('work', { dur: { kind: 'time', sec: 300 } }), newStep('recover')] });
export function newWorkout2(name = 'Bike Workout') {
  return { v: 2, id: newId(), name, notes: '', sport: 'bike', base: null, updated: 0,
    steps: [{ type: 'warmup', dur: { kind: 'lap' }, target: { kind: 'none' } }, newStep('work'), { type: 'cooldown', dur: { kind: 'lap' }, target: { kind: 'none' } }] };
}
/** one step in the shape js/workouts.js runs: dur (the estimate for open steps), pct (getter for custom watts: follows the FTP),
 *  free (no ERG: no target, heart rate, cadence, speed), end (not by time), tgt / tgt2 (shown targets), type, note */
function rideStep(s) {
  const t = s.target || { kind: 'none' }, numbered = s.rep && s.rep.n > 1 && s.type === 'work';
  const o = { dur: 0, pct: 0, label: (s.label || typeName(s.type)) + (numbered ? ` ${s.rep.k}/${s.rep.n}` : ''), type: s.type };
  if (s.note) o.note = s.note;
  if (s.dur.kind !== 'time') o.end = { ...s.dur };
  const live = t.kind === 'power' || s.dur.kind === 'calories' || s.dur.kind === 'distance'; // depends on the FTP: worked out when read
  if (live) {
    Object.defineProperty(o, 'pct', { get: () => stepPct(s).pct, enumerable: true, configurable: true });
    Object.defineProperty(o, 'dur', { get: () => estSec(s), enumerable: true, configurable: true });
    if (t.kind === 'power') { Object.defineProperty(o, 'rlo', { get: () => stepPct(s).rlo, enumerable: true, configurable: true }); Object.defineProperty(o, 'rhi', { get: () => stepPct(s).rhi, enumerable: true, configurable: true }); o.watts = (t.lo + t.hi) / 2; }
  } else { const p = stepPct(s); o.pct = p.pct; if (p.pct2 != null) o.pct2 = p.pct2; if (p.rlo != null) { o.rlo = p.rlo; o.rhi = p.rhi; } o.dur = estSec(s); }
  if (!stepPct(s).erg) { o.free = true; if (t.kind !== 'none') o.tgt = { ...t }; }
  if (s.target2) o.tgt2 = { ...s.target2 };
  if (s.rep) o.rep = { k: s.rep.k, n: s.rep.n, at: s.rep.at }; // at: which repeat block (js/workouts.js counts each block as its own series)
  return o;
}
/** a v2 workout in the shape of the built-ins (see toRide) */
export function toRide2(w) {
  const steps = flatSteps(w.steps).map(rideStep);
  return { id: w.id, name: w.name, what: `Personal workout: ${describe2(w.steps)}.`, personal: true, base: w.base || null, routeId: w.routeId || null, routeName: w.routeName || '', notes: w.notes || '', steps };
}
/* ---- words ---- */
export const fmtDur = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
/** "1:30", "90", "1:02:03", "45s", "10m" → seconds, or NaN */
export function parseDur(txt) {
  const t = String(txt ?? '').trim().toLowerCase().replace(/\s+/g, ''); if (!t) return NaN;
  let m = /^(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(t);
  if (m) { const a = [m[1], m[2], m[3]].filter(x => x != null).map(Number); if (a.slice(1).some(x => x > 59)) return NaN; return a.length === 3 ? a[0] * 3600 + a[1] * 60 + a[2] : a.length === 2 ? a[0] * 60 + a[1] : a[0] * 60; } // a bare number: minutes
  m = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s)?$/.exec(t); if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return NaN;
}
export function durText(d) {
  if (d.kind === 'time') return fmtDur(d.sec);
  if (d.kind === 'distance') return d.m >= 1000 ? `${Math.round(d.m / 10) / 100} km` : `${d.m} m`;
  if (d.kind === 'lap') return 'Lap button';
  if (d.kind === 'calories') return `${d.kcal} kcal`;
  return `until ${d.kind === 'hr' ? 'HR' : 'power'} ${d.op === 'lt' ? 'below' : 'above'} ${d.kind === 'hr' ? d.bpm + ' bpm' : d.w + ' W'}`;
}
/** the target in words, with the rider's numbers when known: "Zone 4 · 228–263 W", "250–270 W", "90 % · 225 W", "HR zone 2 · 114–133 bpm" */
export function tgtText(t, { ftp = 0, hrMax = 0 } = {}) {
  if (!t || t.kind === 'none') return 'No target';
  const W = p => ftp > 0 ? Math.round(p / 100 * ftp) : null;
  if (t.kind === 'powerZone') { const [lo, hi] = ZONE_PCT[t.zone - 1]; return `Power zone ${t.zone} · ${ftp ? `${W(lo)}–${W(hi)} W` : `${lo}–${hi} % FTP`}`; }
  if (t.kind === 'power') return t.lo === t.hi ? `${t.lo} W` : `${t.lo}–${t.hi} W`;
  if (t.kind === 'ftp') return t.pct2 != null ? `${t.pct} → ${t.pct2} % FTP${ftp ? ` · ${W(t.pct)} → ${W(t.pct2)} W` : ''}` : `${t.pct} % FTP${ftp ? ` · ${W(t.pct)} W` : ''}`;
  if (t.kind === 'hrZone') { const [lo, hi] = HR_ZONES[t.zone - 1]; return `HR zone ${t.zone} · ${hrMax ? `${Math.round(lo / 100 * hrMax)}–${Math.round(hi / 100 * hrMax)} bpm` : `${lo}–${hi} % max HR`}`; }
  const u = { hr: 'bpm', cadence: 'rpm', speed: 'km/h' }[t.kind], n = { hr: 'HR', cadence: 'Cadence', speed: 'Speed' }[t.kind];
  return `${n} ${t.lo}–${t.hi} ${u}`;
}
/** one line on what the workout is: "Warm up lap, 3 × (Bike 5:00 Zone 5 / Recover 2:00), Cool down lap" */
export function describe2(steps) {
  const one = s => `${s.label || typeName(s.type)} ${s.dur.kind === 'lap' ? 'lap' : durText(s.dur)}${s.target.kind === 'none' ? '' : ' ' + tgtText(s.target).replace(/ · .*$/, '')}`;
  return steps.map(x => x.repeat ? `${x.repeat} × (${x.steps.map(one).join(' / ')})` : one(x)).join(', ');
}
/** list stats for any saved workout (old or v2): { sec, exact, avg, steps }; ftp: the rider's (estimates of open steps and custom watts depend on it) */
export function statsOf(w, ftp = ftpNow()) { if (isV2(w)) return summary2(w.steps, ftp); const sec = totalSec(w.steps); return { sec, exact: true, avg: avgPct(w.steps), steps: w.steps.length, m: 0, mExact: false }; }

/** the chart of the builder: one bar per step (width = time, estimated for open steps, height = % FTP), coloured by the step
 *  type; open steps hatched, repeats with a bracket below. mark = path of the step to outline. */
export function chartSVG(steps, { h = 110, mark = '', ftp = ftpNow(), cls = 'mwgraph' } = {}) {
  const f = flatSteps(steps), secs = f.map(s => estSec(s, ftp)), tot = secs.reduce((a, b) => a + b, 0) || 1;
  const ps = f.map(s => stepPct(s, ftp)), max = Math.max(130, ...ps.map(p => Math.max(p.pct, p.pct2 ?? 0))), Y = p => (h - 10 - Math.max(2, p / max * (h - 12))).toFixed(1), base = h - 10;
  let x = 0, bars = '', brk = '', repX = null;
  f.forEach((s, i) => {
    const bw = secs[i] / tot * 1000, w = Math.max(0.8, bw - 1.5), p = ps[i], col = typeColor(s.type), open = s.dur.kind !== 'time', soft = !p.erg;
    const att = `data-p="${s.path}" fill="${open ? 'url(#wbHatch)' : col}" ${open ? `stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke" color="${col}"` : ''}${soft && !open ? ' fill-opacity=".5"' : ''}${s.path === mark ? ' class="mk"' : ''}`;
    bars += p.pct2 == null ? `<rect x="${x.toFixed(1)}" y="${Y(p.pct)}" width="${w.toFixed(1)}" height="${(base - Y(p.pct)).toFixed(1)}" ${att}><title>${typeName(s.type)} · ${durText(s.dur)} · ${tgtText(s.target)}</title></rect>`
      : `<polygon points="${x.toFixed(1)},${base} ${x.toFixed(1)},${Y(p.pct)} ${(x + w).toFixed(1)},${Y(p.pct2)} ${(x + w).toFixed(1)},${base}" ${att}><title>${typeName(s.type)} · ${durText(s.dur)} · ${tgtText(s.target)}</title></polygon>`;
    const next = f[i + 1];
    if (s.rep && repX == null) repX = x;
    if (s.rep && (!next || !next.rep || next.rep.at !== s.rep.at)) { brk += `<path d="M${(repX + 1).toFixed(1)} ${h - 7} v4 H${(x + bw - 2).toFixed(1)} v-4" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`; repX = null; }
    x += bw;
  });
  const ftpY = Y(100);
  return `<svg class="${cls}" viewBox="0 0 1000 ${h}" preserveAspectRatio="none" role="img" aria-label="Workout chart"><defs><pattern id="wbHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="currentColor" fill-opacity=".12"/><line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" stroke-opacity=".45" stroke-width="3"/></pattern></defs>${bars}${brk}<line x1="0" x2="1000" y1="${ftpY}" y2="${ftpY}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/></svg>`;
}
