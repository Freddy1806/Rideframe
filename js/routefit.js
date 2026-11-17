// Does the chosen workout fit the chosen route? (owner 17.11.: "tell me right away if it does not fit, pick another one")
// Pure: rides the route second by second with the app's own physics (js/physics.js, the same step as js/ride.js) at the
// workout's target watts from the FTP (ramps via pctAt, free blocks at 100 %), after the workout on at AFTER_PCT.
// Laps start over from the start like js/ride.js _nextLap. Tested in Node (tools/routefit-test.mjs).
import { gradeAt } from './track.js';
import { defaultParams, step } from './physics.js';
import { pctAt } from './workouts.js';

export const FREE_PCT = 100;  // a free block ("ride as you like"): counted at FTP
export const AFTER_PCT = 65;  // after the workout the rider rides on easily
export const TOL = 60;        // a minute short still counts as fitting
export const LONG = 15 * 60;  // more than 15 minutes of route left: say where the workout ends
export const MAX_LAPS = 20;   // like the ride (js/ride.js laps)

export const workoutSec = w => (w?.steps || []).reduce((a, s) => a + (+s.dur || 0), 0);

/** target watts t seconds into the workout (ride shape: steps { dur, pct, pct2?, free? }); after the end AFTER_PCT */
export function powerAt(w, t, ftp) {
  let s = 0;
  for (const st of w.steps) { if (t < s + st.dur) return (st.free ? FREE_PCT : pctAt(st, t - s)) / 100 * ftp; s += st.dur; }
  return AFTER_PCT / 100 * ftp;
}

/** the estimate for one route: track (length, grade), w = workout in ride shape, settings = { ftp, riderKg, bikeKg },
 *  laps = how many times the route is ridden. Returns null without a track or workout, else
 *  { workoutSec, routeSec (all laps), lapSec (one lap), laps, lapsNeeded, endLap, endD (m into that lap), spare, verdict }
 *  verdict: 'fits' | 'short' (the route ends more than TOL before the workout) | 'long' (more than LONG of route left). */
export function fitRoute(track, w, settings = {}, { laps = 1, dt = 1 } = {}) {
  const L = +track?.length || 0, W = workoutSec(w);
  if (!(L > 0) || !track.grade?.length || !(W > 0)) return null;
  const p = defaultParams(settings), ftp = +settings.ftp || 200, n = Math.max(1, Math.min(MAX_LAPS, Math.round(+laps) || 1));
  const lapT = []; let v = 0, d = 0, t = 0, end = null;
  const tMax = W + 10 * 3600; // a stall on an absurd grade never hangs the page
  while (t < tMax && (end == null || lapT.length < n) && lapT.length < MAX_LAPS) {
    v = step(v, powerAt(w, t, ftp), gradeAt(track, d % L), dt, p);
    const nd = d + v * dt;
    for (let k = lapT.length + 1; k * L <= nd && lapT.length < MAX_LAPS; k++) lapT.push(t + dt * (k * L - d) / (nd - d)); // finish line crossed in this step
    if (end == null && t + dt >= W) end = d + (nd - d) * (W - t) / dt; // where the last workout second ends
    d = nd; t += dt;
  }
  const routeSec = lapT[n - 1] ?? null;
  if (routeSec == null) return null; // never reached the end (stall)
  const endLap = end == null ? null : Math.floor(end / L) + 1, endD = end == null ? null : end - (endLap - 1) * L;
  const lapsNeeded = end == null ? null : Math.max(1, Math.ceil(end / L - 1e-9));
  const spare = Math.round(routeSec - W);
  return { workoutSec: W, routeSec: Math.round(routeSec), lapSec: Math.round(lapT[0]), laps: n, lapsNeeded: lapsNeeded > MAX_LAPS ? null : lapsNeeded, endLap, endD: endD == null ? null : Math.round(endD),
    spare, verdict: spare < -TOL ? 'short' : spare > LONG ? 'long' : 'fits' };
}

/** other routes the workout fits on in one lap, closest fit first: [{ id, name, fit }] (routes = [{ id, name, track }]) */
export function fittingRoutes(routes, w, settings = {}, { not = null, max = 3 } = {}) {
  return routes.filter(r => r.id !== not).map(r => ({ id: r.id, name: r.name, fit: fitRoute(r.track, w, settings) }))
    .filter(x => x.fit && x.fit.verdict !== 'short').sort((a, b) => a.fit.spare - b.fit.spare).slice(0, max);
}
