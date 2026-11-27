// VO2max levels (27.11., the overview's VO2max card as a ring gauge like the watch's): five bands by age and sex after the Cooper Institute
// norms that the watch makers use (poor, fair, good, excellent, superior); without age and sex plain bands for adults. Pure (tools/vo2lvl-test.mjs).
// Each row: the lower bounds of fair, good, excellent, superior in ml/kg/min.
const M = [[29, [41.7, 45.4, 51.1, 55.4]], [39, [40.5, 44.0, 48.3, 54.0]], [49, [38.5, 42.4, 46.4, 52.5]], [59, [35.6, 39.2, 43.4, 48.9]], [69, [32.3, 35.5, 39.5, 45.7]], [200, [29.4, 32.3, 36.7, 42.1]]];
const F = [[29, [36.1, 39.5, 43.9, 49.6]], [39, [34.4, 37.8, 42.4, 47.4]], [49, [33.0, 36.3, 39.7, 45.3]], [59, [30.1, 33.0, 36.7, 41.1]], [69, [27.5, 30.0, 33.0, 37.8]], [200, [25.9, 28.1, 30.9, 36.7]]];
const PLAIN = [35, 42, 50, 57];
export const LEVELS = [['poor', 'Poor', '#ff4f3c'], ['fair', 'Fair', '#ff9f1c'], ['good', 'Good', '#2fb36b'], ['excellent', 'Excellent', '#3d9bff'], ['superior', 'Superior', '#a66bff']];
/** the four bounds for this person (age in years, sex 'm' | 'f'), and whether they are by age and sex */
export function bounds({ age = null, sex = null } = {}) {
  const t = sex === 'm' ? M : sex === 'f' ? F : null;
  if (!t || !(age >= 18 && age < 110)) return { b: PLAIN, by: 'plain' };
  return { b: t.find(([hi]) => age <= hi)[1], by: 'age' };
}
/** { i (0..4), key, name, color, by } for a value */
export function levelOf(v, who = {}) {
  const { b, by } = bounds(who); let i = 0; while (i < 4 && v >= b[i]) i++;
  const [key, name, color] = LEVELS[i]; return { i, key, name, color, by, b };
}
export const ageOf = (birthYear, now = Date.now()) => birthYear > 1900 ? new Date(now).getFullYear() - birthYear : null;

/** the ring: a 270° gauge from lo to hi, the five bands coloured, a marker at the value, the number in the middle (size in px) */
export function ringSVG(v, who = {}, { size = 88, lo = 20, hi = 70, label = '' } = {}) {
  const { b } = bounds(who), lv = levelOf(v, who), r = 40, cx = 50, cy = 50, a0 = 135, span = 270;
  const ang = x => a0 + (Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo) * span, pt = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const arc = (x0, x1) => { const A = ang(x0), B = ang(x1); if (B - A < 0.5) return ''; const [p, q] = [pt(A + 1.2), pt(B - 1.2)]; return `M${p[0].toFixed(2)},${p[1].toFixed(2)}A${r},${r} 0 ${B - A > 180 ? 1 : 0} 1 ${q[0].toFixed(2)},${q[1].toFixed(2)}`; };
  const edges = [lo, ...b, hi], segs = LEVELS.map(([, , c], i) => `<path d="${arc(edges[i], edges[i + 1])}" stroke="${c}" opacity="${i === lv.i ? 1 : .35}"/>`).join('');
  const [mx, my] = pt(ang(v));
  return `<svg class="vring" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${label ? label + ' ' : ''}VO2max ${Math.round(v)}, ${lv.name}">
    <g fill="none" stroke-width="8" stroke-linecap="butt">${segs}</g><circle cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="6.5" fill="var(--ink-2)" stroke="${lv.color}" stroke-width="3"/>
    <text x="50" y="${label ? 54 : 58}" text-anchor="middle" class="vrnum">${Math.round(v)}</text>${label ? `<text x="50" y="72" text-anchor="middle" class="vrlab">${label}</text>` : ''}
    <text x="50" y="94" text-anchor="middle" class="vrlv" fill="${lv.color}">${lv.name}</text></svg>`;
}
