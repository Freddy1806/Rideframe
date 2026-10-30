// Road-bike physics: from power and grade to speed (like outdoor riding).
const G = 9.81;

export function defaultParams(s) {
  return {
    mass: (s.riderKg || 75) + (s.bikeKg || 8.5),
    crr: 0.004,          // rolling resistance, good asphalt
    cda: 0.32,           // drag area, hoods
    rho: 1.2,            // air density
    drivetrain: 0.975,
  };
}

/** Advance speed v (m/s) by dt seconds with power P (W) on grade (%). */
export function step(v, power, gradePct, dt, p) {
  const theta = Math.atan(gradePct / 100);
  const fGrav = p.mass * G * Math.sin(theta);
  const fRoll = p.mass * G * Math.cos(theta) * p.crr;
  const fAero = 0.5 * p.rho * p.cda * v * v;
  const fPedal = power * p.drivetrain / Math.max(v, 1.0);
  const a = (fPedal - fGrav - fRoll - fAero) / (p.mass * 1.04); // +4% for rotating mass
  let nv = v + a * dt;
  if (nv < 0) nv = 0;
  if (power < 1 && nv < 0.4 && gradePct >= 0) nv = 0;
  return Math.min(nv, 30);
}

/** Steady-state power needed for speed v on grade (used for the demo rider / ghost). */
export function powerFor(v, gradePct, p) {
  const theta = Math.atan(gradePct / 100);
  const f = p.mass * G * (Math.sin(theta) + Math.cos(theta) * p.crr) + 0.5 * p.rho * p.cda * v * v;
  return Math.max(0, f * v / p.drivetrain);
}
