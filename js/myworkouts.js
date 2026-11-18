// Personal workouts (owner 17.11.: "pick a route, personalise the workout for the ride, save it under my name, find and
// edit it later in my profile"). Pure module, no DOM: used by the browser (js/myworkouts-ui.js, js/myworkouts-store.js)
// and by the server (tools/workouts-api.mjs), so both check a workout the same way.
// A personal workout: { id, name, base (built-in id or null), steps: [{ min, pct, pct2?, label, free? }], routeId?, routeName?, updated }.
// pct2 makes the step a ramp: the target moves evenly from pct to pct2 (like the built-ins' warm-up, js/workouts.js pctAt).
// For riding it becomes the shape of the built-ins (js/workouts.js: { id, name, what, steps: [{ dur, pct, label, free? }] }),
// so js/ride.js and workoutAt() run it unchanged.

export const LIM = { name: 40, label: 24, steps: 60, minMin: 0.25, maxMin: 120, minPct: 30, maxPct: 200, count: 50, bytes: 8000, total: 256000, rep: 20 };
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
