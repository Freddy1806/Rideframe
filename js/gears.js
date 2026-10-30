// Gearing: real drivetrain (trainer only simulates the road) or virtual shifting
// (bike stays in one gear, the app changes resistance per virtual gear).
export const CASSETTES = {
  '11-34': [11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30, 34],   // Shimano 105 R7100 12-fach
  '11-30': [11, 12, 13, 14, 15, 16, 17, 19, 21, 24, 27, 30],
  '11-28': [11, 12, 13, 14, 15, 16, 17, 19, 21, 23, 25, 28],
  '11-32': [11, 12, 13, 14, 15, 16, 17, 19, 21, 24, 28, 32],
};

const nums = s => String(s).split(/[^\d]+/).map(Number).filter(n => n > 0);

/** All chainring × cog combos, sorted easy -> hard, near-duplicates removed. */
export function gearsFrom(settings) {
  const rings = nums(settings.chainrings).sort((a, b) => b - a);
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

export function parseGear(s) { const [f, r] = nums(s); return f && r ? { f, r, ratio: f / r } : { f: 50, r: 17, ratio: 50 / 17 }; }

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
