// Personal workouts (owner 17.11.: "pick a route, personalise the workout for the ride, save it under my name, find and
// edit it later in my profile"). Pure module, no DOM: used by the browser (js/myworkouts-ui.js, js/myworkouts-store.js)
// and by the server (tools/workouts-api.mjs), so both check a workout the same way.
// A personal workout: { id, name, base (built-in id or null), steps: [{ min, pct, label, free? }], routeId?, routeName?, updated }.
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
    const st = { min: r2(min), pct: Math.round(pct), label: clean(s.label, LIM.label) }; if (s.free === true) st.free = true;
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
/** time-weighted mean of % FTP */
export const avgPct = steps => { const t = totalSec(steps); return t ? Math.round(steps.reduce((a, s) => a + s.pct * stepSec(s), 0) / t) : 0; };
export const watts = (pct, ftp) => ftp > 0 ? Math.round(pct / 100 * ftp) : null;
/** a work step: everything harder than endurance (warm-up, rest and cool-down stay as they are when the intensity is scaled) */
export const isWork = s => s.pct >= 76;
/** the intensity slider: every work step d % harder (or easier), within the limits */
export const scaleWork = (steps, d) => steps.map(s => isWork(s) && !s.free ? { ...s, pct: Math.max(LIM.minPct, Math.min(LIM.maxPct, Math.round(s.pct * (1 + d / 100)))) } : { ...s });
const same = (a, b) => a.min === b.min && a.pct === b.pct && !!a.free === !!b.free;

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
  const one = s => `${fmtMin(s.min)} ${s.pct} %${s.free ? ' free' : ''}`;
  return collapse(steps).map(g => g.n > 1 ? `${g.n} × (${g.steps.map(one).join(' / ')})` : g.steps.map(one).join(', ')).join(', ');
}

/* ---- conversion ---- */
/** a personal workout in the shape of the built-ins, for js/workouts.js and the ride */
export function toRide(w) {
  return { id: w.id, name: w.name, what: `Personal workout: ${describe(w.steps)}.`, personal: true, base: w.base || null, routeId: w.routeId || null, routeName: w.routeName || '',
    steps: w.steps.map(s => ({ dur: stepSec(s), pct: s.pct, label: s.label || '', ...(s.free ? { free: true } : {}) })) };
}
/** a draft from a built-in workout (or any workout in ride shape) */
export function fromBuiltin(bw) {
  const steps = bw.steps.slice(0, LIM.steps).map(s => ({ min: Math.max(LIM.minMin, r2(s.dur / 60)), pct: Math.max(LIM.minPct, Math.min(LIM.maxPct, Math.round(s.pct))), label: clean(s.label, LIM.label), ...(s.free ? { free: true } : {}) }));
  return { id: newId(), name: clean(bw.name, LIM.name) || 'My workout', base: bw.personal ? bw.base || null : bw.id || null, steps, updated: 0 };
}
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
  const tot = totalSec(steps) || 1, max = Math.max(130, ...steps.map(s => s.pct)); let x = 0;
  const bars = steps.map((s, i) => {
    const bw = stepSec(s) / tot * 1000, bh = Math.max(2, s.pct / max * (h - 2)), z = zoneOf(s.pct);
    const r = `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.8, bw - 1.2).toFixed(1)}" height="${bh.toFixed(1)}" fill="${z[2]}"${s.free ? ' fill-opacity=".55"' : ''}${i === mark ? ' stroke="#ff5a1f" stroke-width="4" vector-effect="non-scaling-stroke"' : ''}/>`;
    x += bw; return r;
  }).join('');
  const ftpY = (h - 100 / max * (h - 2)).toFixed(1);
  return `<svg class="${cls}" viewBox="0 0 1000 ${h}" preserveAspectRatio="none" role="img" aria-label="Workout profile">${bars}<line x1="0" x2="1000" y1="${ftpY}" y2="${ftpY}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/></svg>`;
}
