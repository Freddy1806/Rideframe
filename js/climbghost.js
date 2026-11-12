// Ghost challenge on the climbs (Freddy: "Ghost-Challenge"): when you ride into a climb you have ridden before on this
// route, your own best effort there rides with you as a grey ghost, and at the top you learn whether you beat yourself.
// Uses the per-second samples [t, d, ...] every saved ride keeps.

/** seconds a sample list needed to reach distance d (linear), or null if it never got there */
export function timeAtDist(s, d) {
  if (!s?.length || s[s.length - 1][1] < d) return null;
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m][1] < d) lo = m; else hi = m; }
  const a = s[lo], b = s[hi]; if (b[1] === a[1]) return b[0];
  return a[0] + (b[0] - a[0]) * Math.max(0, Math.min(1, (d - a[1]) / (b[1] - a[1])));
}
/** distance a sample list had covered after t seconds (linear) */
export function distAtTime(s, t) {
  if (!s?.length) return 0; if (t <= s[0][0]) return s[0][1]; if (t >= s[s.length - 1][0]) return s[s.length - 1][1];
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m][0] < t) lo = m; else hi = m; }
  const a = s[lo], b = s[hi]; return a[1] + (b[1] - a[1]) * ((t - a[0]) / ((b[0] - a[0]) || 1));
}
/** your fastest time over climb c among rides: { samples, t0, dur, date } or null */
export function bestClimb(rides, c) {
  let best = null;
  for (const r of rides || []) {
    const t0 = timeAtDist(r.samples, c.from), t1 = timeAtDist(r.samples, c.to);
    if (t0 == null || t1 == null || t1 - t0 < 20) continue; // too short: a resumed or broken ride
    if (!best || t1 - t0 < best.dur) best = { samples: r.samples, t0, dur: t1 - t0, date: r.date };
  }
  return best;
}
