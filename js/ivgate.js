// The wizard and the challengers in a workout (owner 17.11.), and the wizard in a group ride. Pure, tested in
// tools/ivhistory-test.mjs.
// · in a workout they only come inside a hard interval (pct >= 88, not a free test block, at least 1 min long: no openers),
//   never in a rest, the warm-up or the cool-down; their target is the rider's current interval target incl. his offset
//   (wAdj). If too little of the interval is left for the trial, the wizard waits for the next interval.
// · group ride: each rider is judged against his OWN target in % of it; the wizard comes for everyone at once (the first rider
//   who meets him calls him for the others); each passes or fails alone; the card shows your own target and, small, the
//   friends' result. Wire: one optional field wz = [lap, state, pct] in the rider state (old peers ignore it).
import { workoutState, isHard } from './workouts.js';

export const MIN_IV = 60;
/** the hard interval running at time t, or null: { i, left (s), target (W, with the offset), label } */
export function hardWindow(workout, t, ftp, adj = {}) {
  if (!workout) return null;
  const w = workoutState(workout, t, ftp, { hardAdj: adj.hard || 0, easyAdj: adj.easy || 0 });
  if (w.done || !isHard(w.step) || w.step.dur < MIN_IV || /^(warm|opener|cool|spin)/i.test(w.step.label || '')) return null; // never the warm-up's 90 % minute
  return { i: w.i, left: w.left, target: w.plateau, label: w.step.label || '' };
}

/** where the wizard stands when he is called in a workout or by a friend: close ahead, so the trial starts within seconds */
export const summonGap = v => Math.max(60, Math.min(150, (v || 0) * 10));
/** seconds until the trial starts once he is called (he casts 15 m before you reach him) */
export const approachS = v => (summonGap(v) - 15) / Math.max(2, v || 0);

/** the wizard's next step in a workout: 'summon' (call him now), 'dismiss' (he leaves and waits for the next interval) or null.
 *  z: the Wizard; win: hardWindow() now; hold: trial length (s) */
export function wizardGate(z, win, { elapsed, v, hold = 60 }) {
  if (!z) return null;
  const waiting = z.state === 'wait' && !Number.isFinite(z.at);
  if (waiting) return win && elapsed >= (z.armAt || 0) && win.left >= hold + approachS(v) + 3 ? 'summon' : null;
  if (z.state === 'ann' || z.state === 'near') return !win || win.left < hold + 1 ? 'dismiss' : null;
  return null;
}

/** what a challenge may do in a workout: { ok, hard, W, left } for Challenges.tick (null outside a workout) */
export const challengeGate = win => win ? { ok: true, hard: true, W: win.target, left: win.left, i: win.i } : { ok: false, hard: false, W: 0, left: 0, i: -1 };

// ---------- group ride ----------
export const WZ = { off: 0, on: 1, pass: 2, fail: 3 };
/** my wizard as the wire field: [lap, state, pct of my own target] or null when nothing is going on */
export function wzOf(z, lap) {
  if (!z) return null;
  const pct = z.tgt > 0 ? Math.round((z.avg || 0) / z.tgt * 100) : 0;
  if (z.state === 'near' || z.state === 'cast') return [lap, WZ.on, z.state === 'cast' ? pct : 0];
  const res = z.state === 'fly' || z.was === 'fly' ? WZ.pass : z.state === 'hell' || z.was === 'hell' ? WZ.fail : 0;
  return res ? [lap, res, z.pct ?? pct] : null;
}
/** a friend met the wizard (same lap) while mine still waits: call mine now */
export const friendCalls = (z, others, lap) => !!z && (z.state === 'wait' || z.state === 'ann') && (others || []).some(r => Array.isArray(r.wz) && r.wz[0] === lap && r.wz[1] >= WZ.on);
/** the small line under the wizard card: "Tom: made it · Ann: 96 %" */
export function friendsLine(others, lap) {
  return (others || []).filter(r => Array.isArray(r.wz) && r.wz[0] === lap && r.wz[1] >= WZ.on).slice(0, 3)
    .map(r => `${r.name}: ${r.wz[1] === WZ.pass ? 'made it' : r.wz[1] === WZ.fail ? `failed${r.wz[2] ? ` (${r.wz[2]} %)` : ''}` : r.wz[2] ? `${r.wz[2]} %` : 'meets him'}`).join(' · ');
}
/** the wire field from a peer, never trusted */
export const cleanWz = x => Array.isArray(x) && x.length >= 2 ? [Math.round(+x[0] || 0), Math.max(0, Math.min(3, Math.round(+x[1] || 0))), Math.max(0, Math.min(400, Math.round(+x[2] || 0)))] : null;
