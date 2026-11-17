// Gearing: real drivetrain (trainer only simulates the road) or virtual shifting
// (bike stays in one gear, the app changes resistance per virtual gear).
export const CASSETTES = {
  '11-34': [11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30, 34],   // Shimano 105 R7100 12-fach
  '11-30': [11, 12, 13, 14, 15, 16, 17, 19, 21, 24, 27, 30],
  '11-28': [11, 12, 13, 14, 15, 16, 17, 19, 21, 23, 25, 28],
  '11-32': [11, 12, 13, 14, 15, 16, 17, 19, 21, 24, 28, 32],
};

const nums = s => String(s ?? '').split(/[^\d]+/).map(Number).filter(n => n > 0);
/** Chainrings / cogs from free text; null when nothing plausible is in it (e.g. "abc"). */
export const parseRings = s => { const r = nums(s).filter(n => n >= 20 && n <= 60); return r.length ? r : null; };

/** All chainring × cog combos, sorted easy -> hard, near-duplicates removed. */
export function gearsFrom(settings) {
  const rings = (parseRings(settings.chainrings) || [50, 34]).sort((a, b) => b - a);
  const cogs = CASSETTES[settings.cassette] || nums(settings.cassette);
  const all = [];
  rings.forEach((f, fi) => cogs.forEach(r => all.push({ f, r, ratio: f / r, fi })));
  all.sort((a, b) => a.ratio - b.ratio);
  const out = [];
  for (const g of all) {
    const prev = out[out.length - 1];
    if (prev && g.ratio / prev.ratio < 1.06) { if (g.fi === 0 && prev.fi !== 0) out[out.length - 1] = g; continue; } // prefer big ring
    out.push(g);
  }
  return out;
}

export const gearName = g => `${g.f}×${g.r}`;

export function parseGear(s) { const [f, r] = nums(s); return f >= 20 && f <= 60 && r >= 9 && r <= 40 ? { f, r, ratio: f / r } : { f: 50, r: 17, ratio: 50 / 17 }; }

/** Nearest real gear for a measured wheel speed (m/s) and cadence (rpm). */
export function estimateGear(gears, speed, cadence, wheelMm) {
  if (!(speed > 1 && cadence > 30)) return null;
  const ratio = speed / (cadence / 60 * wheelMm / 1000);
  let best = null, err = Infinity;
  for (const g of gears) { const e = Math.abs(Math.log(g.ratio / ratio)); if (e < err) { err = e; best = g; } }
  return err < 0.08 ? best : null;
}

/**
 * Virtual shifting: grade to send so the trainer (which sees the real gear) feels like the virtual gear.
 * Trainer force ~ m·g·(grade+crr) + cw·v²; we want force_real = k · force_road(v_virtual), k = virtual/real ratio.
 */
export function virtualGrade(gradePct, k, wheelSpeed, massKg, crr = 0.004, cw = 0.51) {
  const mg = massKg * 9.81, vv = wheelSpeed * k;
  const road = mg * (gradePct / 100 + crr) + cw * vv * vv;
  const want = k * road;
  const g = (want - cw * wheelSpeed * wheelSpeed - mg * crr) / mg * 100;
  return Math.max(-10, Math.min(20, g));
}

/** the gear list and the start gear (nearest to the fixed real one) from the settings; the 3D ride's defaults when unset */
export function gearSet(st = {}) {
  let gears = gearsFrom({ chainrings: st.chainrings || '50,34', cassette: st.cassette || '11-34' });
  if (!gears.length) gears = gearsFrom({ chainrings: st.chainrings || '50,34', cassette: '11-34' }); // cassette text without numbers
  const real = parseGear(st.realGear), d = g => Math.abs(Math.log(g.ratio / real.ratio));
  return { gears, real, gi: gears.reduce((b, g, i) => d(g) < d(gears[b]) ? i : b, 0) };
}
/** Zwift Cog: the bike keeps one 14-tooth sprocket, so the real gear is "big ring x 14" */
export const COG_TEETH = 14;
/**
 * virtualGrade for a trainer that can brake but never push (a freewheel): where the virtual road would push the rider
 * (steep descent, light gear) the trainer just goes as light as it can at this wheel speed. So a harder gear is never
 * easier, downhill too; uphill and on the flat this is exactly virtualGrade.
 */
export function shiftGrade(gradePct, k, wheelSpeed, massKg, crr = 0.004, cw = 0.51) {
  const free = -(cw * wheelSpeed * wheelSpeed / (massKg * 9.81) + crr) * 100; // trainer force 0 at this wheel speed
  return Math.max(-10, Math.min(20, Math.max(virtualGrade(gradePct, k, wheelSpeed, massKg, crr, cw), free)));
}
